"""Tests for the simplified AttachmentProcessor."""
import base64
import tempfile
from pathlib import Path

import pytest

from openharness.engine.messages import ImageBlock, TextBlock
from openharness.services.attachment_processor import (
    AttachmentError,
    _SINGLE_FILE_LIMIT,
    _sanitize_filename,
    process_attachments,
)
from openharness.ui.protocol import AttachmentPayload


def _make_payload(filename: str, mime_type: str, data: bytes) -> AttachmentPayload:
    return AttachmentPayload(
        filename=filename,
        mime_type=mime_type,
        data=base64.b64encode(data).decode(),
        size_bytes=len(data),
    )


def _make_path_payload(filename: str, path: str) -> AttachmentPayload:
    return AttachmentPayload(filename=filename, mime_type="", data="", size_bytes=0, path=path)


# --- Image -------------------------------------------------------------------

def test_png_produces_image_block():
    blocks, errors = process_attachments([_make_payload("photo.png", "image/png", b"png")])
    assert not errors
    assert isinstance(blocks[0], ImageBlock)


def test_jpeg_produces_image_block():
    blocks, errors = process_attachments([_make_payload("img.jpg", "image/jpeg", b"\xff\xd8")])
    assert not errors
    assert isinstance(blocks[0], ImageBlock)


def test_unsupported_image_type_returns_error():
    blocks, errors = process_attachments([_make_payload("icon.bmp", "image/bmp", b"bmp")])
    assert not blocks
    assert "不支持的图片格式" in errors[0].message


# --- Text/code/data files → save to disk (no inline) -------------------------

def test_csv_saves_to_disk():
    payload = _make_payload("data.csv", "text/csv", b"name,age\nAlice,30\n")
    with tempfile.TemporaryDirectory() as d:
        blocks, errors = process_attachments([payload], upload_dir=Path(d))
    assert not errors
    assert isinstance(blocks[0], TextBlock)
    assert "data.csv" in blocks[0].text


def test_json_saves_to_disk():
    payload = _make_payload("cfg.json", "application/json", b'{"x":1}')
    with tempfile.TemporaryDirectory() as d:
        blocks, errors = process_attachments([payload], upload_dir=Path(d))
    assert not errors
    assert isinstance(blocks[0], TextBlock)
    assert "cfg.json" in blocks[0].text


def test_python_saves_to_disk():
    payload = _make_payload("main.py", "text/x-python", b"print('hi')")
    with tempfile.TemporaryDirectory() as d:
        blocks, errors = process_attachments([payload], upload_dir=Path(d))
    assert not errors
    assert isinstance(blocks[0], TextBlock)
    assert "main.py" in blocks[0].text


# --- Other binary files → save to disk ---------------------------------------

def test_pdf_saves_to_disk():
    payload = _make_payload("report.pdf", "application/pdf", b"%PDF-1.4")
    with tempfile.TemporaryDirectory() as d:
        blocks, errors = process_attachments([payload], upload_dir=Path(d))
    assert not errors
    assert isinstance(blocks[0], TextBlock)
    assert "report.pdf" in blocks[0].text


def test_audio_saves_to_disk():
    payload = _make_payload("audio.mp3", "audio/mpeg", b"\xff\xfb")
    with tempfile.TemporaryDirectory() as d:
        blocks, errors = process_attachments([payload], upload_dir=Path(d))
    assert not errors
    assert isinstance(blocks[0], TextBlock)
    assert "audio.mp3" in blocks[0].text


def test_video_saves_to_disk():
    payload = _make_payload("demo.mp4", "video/mp4", b"\x00\x00")
    with tempfile.TemporaryDirectory() as d:
        blocks, errors = process_attachments([payload], upload_dir=Path(d))
    assert not errors
    assert isinstance(blocks[0], TextBlock)
    assert "demo.mp4" in blocks[0].text


# --- Local path reference (no upload) ----------------------------------------

def test_path_reference_pdf_uses_original_path():
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
        f.write(b'%PDF-1.4')
        pdf_path = f.name
    try:
        blocks, errors = process_attachments([_make_path_payload("report.pdf", pdf_path)])
        assert not errors
        assert isinstance(blocks[0], TextBlock)
        assert pdf_path in blocks[0].text  # original path, no copy
    finally:
        Path(pdf_path).unlink(missing_ok=True)


def test_path_reference_nonexistent_returns_error():
    blocks, errors = process_attachments([_make_path_payload("ghost.pdf", "/nonexistent/ghost.pdf")])
    assert not blocks
    assert "不存在" in errors[0].message


# --- Size validation ---------------------------------------------------------

def test_single_file_over_5mb_rejected():
    big = b"x" * (_SINGLE_FILE_LIMIT + 1)
    payload = _make_payload("big.csv", "text/csv", big)
    blocks, errors = process_attachments([payload])
    assert not blocks
    assert "5MB" in errors[0].message


def test_total_over_10mb_rejected():
    chunk = b"x" * (3 * 1024 * 1024)
    payloads = [_make_payload(f"f{i}.csv", "text/csv", chunk) for i in range(4)]
    blocks, errors = process_attachments(payloads)
    assert not blocks
    assert "10MB" in errors[0].message


# --- Mixed -------------------------------------------------------------------

def test_mixed_image_plus_pdf():
    img = _make_payload("photo.png", "image/png", b"png")
    pdf = _make_payload("doc.pdf", "application/pdf", b"%PDF")
    with tempfile.TemporaryDirectory() as d:
        blocks, errors = process_attachments([img, pdf], upload_dir=Path(d))
    assert not errors
    assert isinstance(blocks[0], ImageBlock)
    assert isinstance(blocks[1], TextBlock)
    assert "doc.pdf" in blocks[1].text


# --- Security: path access control -------------------------------------------

def test_path_reference_outside_allowed_root_is_rejected():
    with tempfile.TemporaryDirectory() as allowed_dir, \
         tempfile.NamedTemporaryFile(delete=False) as outside_file:
        outside_file.write(b"sensitive content")
        outside_file.flush()
        payload = _make_path_payload("secret.txt", outside_file.name)
        blocks, errors = process_attachments(
            [payload],
            allowed_roots=[Path(allowed_dir)],
        )
        assert not blocks
        assert "拒绝访问" in errors[0].message


def test_path_reference_inside_allowed_root_is_accepted():
    with tempfile.TemporaryDirectory() as allowed_dir:
        allowed_file = Path(allowed_dir) / "notes.txt"
        allowed_file.write_text("hello")
        payload = _make_path_payload("notes.txt", str(allowed_file))
        blocks, errors = process_attachments(
            [payload],
            allowed_roots=[Path(allowed_dir)],
        )
        assert not errors
        assert blocks


def test_path_reference_no_allowed_roots_skips_access_check():
    """When no allowed_roots are configured, path access check is skipped."""
    with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as f:
        f.write(b"content")
        fpath = f.name
    try:
        blocks, errors = process_attachments(
            [_make_path_payload("f.txt", fpath)],
            allowed_roots=None,
        )
        assert not errors
    finally:
        Path(fpath).unlink(missing_ok=True)


# --- Security: filename sanitization -----------------------------------------

def test_sanitize_filename_strips_path_separators():
    assert "/" not in _sanitize_filename("../../etc/passwd")
    assert "\\" not in _sanitize_filename("..\\..\\windows\\system32")


def test_sanitize_filename_strips_null_bytes():
    result = _sanitize_filename("file\x00.txt")
    assert "\x00" not in result


def test_sanitize_filename_prevents_dotdot():
    result = _sanitize_filename("..")
    assert result not in {"", "..", "."}


def test_sanitize_filename_preserves_safe_name():
    assert _sanitize_filename("report_2024.pdf") == "report_2024.pdf"


def test_save_to_upload_dir_uses_sanitized_name():
    """Filenames with path traversal characters are sanitized — the saved path stays in upload_dir."""
    payload = _make_payload("../../../../evil.txt", "text/plain", b"data")
    with tempfile.TemporaryDirectory() as d:
        upload_dir = Path(d)
        blocks, errors = process_attachments([payload], upload_dir=upload_dir)
    assert not errors
    assert isinstance(blocks[0], TextBlock)
    # Extract the saved path from the TextBlock text
    import re
    match = re.search(r'path="([^"]+)"', blocks[0].text)
    assert match, "TextBlock should contain a path attribute"
    saved_path = Path(match.group(1))
    # The saved file must be within the upload_dir (no path traversal)
    assert str(saved_path).startswith(d) or str(saved_path.resolve()).startswith(str(upload_dir.resolve()))
