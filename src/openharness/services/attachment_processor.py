"""Attachment processing service: converts attachments to ContentBlocks.

Handling strategy:
  image/png|jpeg|gif|webp  → ImageBlock  (base64 inline for vision models)
  everything else           → TextBlock with full absolute path
                              - if att.path is provided (local file reference):
                                  use original path directly, no disk copy
                              - if att.data is provided (browser upload):
                                  save to upload_dir, pass saved path
"""

from __future__ import annotations

import base64
import logging
import mimetypes
import re
from dataclasses import dataclass
from pathlib import Path

from openharness.engine.messages import ContentBlock, ImageBlock, TextBlock
from openharness.ui.protocol import AttachmentPayload

log = logging.getLogger(__name__)

_SUPPORTED_IMAGE_TYPES = frozenset({
    "image/png", "image/jpeg", "image/gif", "image/webp",
})

_SINGLE_FILE_LIMIT = 5 * 1024 * 1024   # 5 MB decoded
_TOTAL_LIMIT       = 10 * 1024 * 1024  # 10 MB decoded


@dataclass
class AttachmentError(Exception):
    """Structured error returned when a single attachment cannot be processed."""
    message: str


def process_attachments(
    attachments: list[AttachmentPayload],
    upload_dir: Path | None = None,
    allowed_roots: list[Path] | None = None,
) -> tuple[list[ContentBlock], list[AttachmentError]]:
    """Convert a list of AttachmentPayload objects to ContentBlocks.

    Two attachment modes:
    - att.path is set  → local file reference, use path directly (no disk copy)
    - att.data is set  → browser upload (base64), save to upload_dir if needed

    For images: always inline base64 so the vision model can see the content.
    For everything else: pass full absolute path so the model uses read_file.

    allowed_roots: if provided, local path references (att.path) must be under
    one of these directories. Pass the session CWD and/or the upload dir.
    """
    blocks: list[ContentBlock] = []
    errors: list[AttachmentError] = []

    # Size guard only applies to data uploads (path refs have no data to check)
    data_uploads = [a for a in attachments if a.data and not a.path]
    total_decoded = sum(len(a.data) * 3 // 4 for a in data_uploads)
    if total_decoded > _TOTAL_LIMIT:
        errors.append(AttachmentError(
            f"附件总大小（约 {total_decoded // (1024 * 1024):.1f}MB）超过 10MB 限制"
        ))
        return [], errors

    for att in attachments:
        if att.data and not att.path:
            decoded_size = len(att.data) * 3 // 4
            if decoded_size > _SINGLE_FILE_LIMIT:
                errors.append(AttachmentError(
                    f"文件过大：{att.filename}（约 {decoded_size // (1024 * 1024):.1f}MB）"
                    "超过 5MB 限制\n💡 可用截图工具裁剪后重试"
                ))
                continue
        try:
            blocks.append(_process_single(att, upload_dir=upload_dir, allowed_roots=allowed_roots))
        except AttachmentError as exc:
            errors.append(exc)
        except Exception as exc:
            log.warning("Unexpected error processing %s: %s", att.filename, exc)
            errors.append(AttachmentError(f"处理文件 {att.filename} 时发生错误：{exc}"))

    return blocks, errors


def _process_single(
    att: AttachmentPayload,
    *,
    upload_dir: Path | None,
    allowed_roots: list[Path] | None = None,
) -> ContentBlock:
    """Process one attachment.

    Priority: if att.path is set, use as local file reference (no data needed).
    Otherwise decode att.data (browser upload).
    """
    mime = (att.mime_type or "").lower().split(";")[0].strip()

    # ── Local file path reference (no data transfer) ──────────────────────
    if att.path:
        file_path = Path(att.path)
        if not file_path.exists():
            raise AttachmentError(f"文件不存在：{att.path}")
        if not file_path.is_file():
            raise AttachmentError(f"路径不是文件：{att.path}")

        abs_path = file_path.resolve()

        # Enforce path access control when allowed_roots are provided.
        if allowed_roots:
            within = any(_is_within(abs_path, r.resolve()) for r in allowed_roots)
            if not within:
                raise AttachmentError(
                    f"拒绝访问：路径超出允许范围：{abs_path}"
                )

        # Always re-derive MIME from the file extension when we have the full
        # path.  The client-reported mime_type can be polluted by the OS
        # registry (e.g. Windows returns "picview.png" for .png files on some
        # systems). File extension is the reliable source of truth here.
        guessed, _ = mimetypes.guess_type(str(abs_path))
        mime = (guessed or "").lower()
        if not mime:
            # Fallback to client-reported type only if guessing failed
            mime = (att.mime_type or "").lower().split(";")[0].strip()
        if mime in _SUPPORTED_IMAGE_TYPES:
            raw = abs_path.read_bytes()
            data = base64.b64encode(raw).decode("ascii")
            return ImageBlock(media_type=mime, data=data, source_path=str(abs_path))

        if mime.startswith("image/"):
            raise AttachmentError(
                f"不支持的图片格式：{mime}。支持：PNG, JPEG, GIF, WebP"
            )

        # All other file types → pass path, model uses read_file
        return _path_text_block(att.filename, mime, abs_path)

    # ── Browser upload (base64 data) ───────────────────────────────────────
    if not att.data:
        raise AttachmentError(f"附件 {att.filename} 既无路径也无数据")

    if mime in _SUPPORTED_IMAGE_TYPES:
        return ImageBlock(media_type=mime, data=att.data, source_path=att.filename)

    if mime.startswith("image/"):
        raise AttachmentError(
            f"不支持的图片格式：{mime}。支持：PNG, JPEG, GIF, WebP"
        )

    # All non-image uploads → save to upload_dir, pass saved path
    if upload_dir is not None:
        saved_path = _save_to_upload_dir(att, upload_dir)
        return _path_text_block(att.filename, mime, saved_path)

    # Fallback: no upload_dir configured
    return TextBlock(
        text=(
            f"<attachment filename=\"{att.filename}\" mime_type=\"{mime}\">\n"
            f"[文件附件，如需读取请提供完整路径]\n"
            f"</attachment>"
        )
    )


def _is_within(path: Path, root: Path) -> bool:
    """Return True if path is under root (both must be resolved absolute paths)."""
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _sanitize_filename(filename: str) -> str:
    """Strip dangerous characters from a client-supplied filename."""
    # Keep only safe characters; replace everything else with underscore
    safe = re.sub(r'[^\w.\-]', '_', filename)
    # Prevent names like "." or ".."
    safe = safe.strip('.')
    return (safe or 'upload')[:255]


def _path_text_block(filename: str, mime: str, path: Path) -> TextBlock:
    return TextBlock(
        text=(
            f"<attachment filename=\"{filename}\" mime_type=\"{mime}\" "
            f"path=\"{path}\">\n"
            f"[文件路径: {path}，可使用 read_file 工具读取其内容]\n"
            f"</attachment>"
        )
    )


def _save_to_upload_dir(att: AttachmentPayload, upload_dir: Path) -> Path:
    """Decode base64 and write to upload_dir/{filename}, auto-rename on conflict."""
    upload_dir.mkdir(parents=True, exist_ok=True)

    target = upload_dir / _sanitize_filename(att.filename)
    if target.exists():
        stem, suffix = target.stem, target.suffix
        counter = 1
        while target.exists():
            target = upload_dir / f"{stem}_{counter}{suffix}"
            counter += 1

    raw = base64.b64decode(att.data, validate=True)
    target.write_bytes(raw)
    log.debug("Saved upload %s → %s (%d bytes)", att.filename, target, len(raw))
    return target.resolve()
