"""Swarm role library router — catalog and content endpoints."""

from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path
from urllib.parse import urlparse
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

import logging

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/swarm/role-library", tags=["role-library"])

# ---------------------------------------------------------------------------
# Static role catalog
# ---------------------------------------------------------------------------

AGENT_CATALOG: list[dict[str, Any]] = [
    {
        "id": "engineering",
        "label": "工程",
        "agents": [
            {"name": "ai-data-remediation-engineer", "path": "engineering/engineering-ai-data-remediation-engineer.md", "description": "AI数据修复工程师"},
            {"name": "ai-engineer", "path": "engineering/engineering-ai-engineer.md", "description": "AI工程师"},
            {"name": "autonomous-optimization-architect", "path": "engineering/engineering-autonomous-optimization-architect.md", "description": "自主优化架构师"},
            {"name": "backend-architect", "path": "engineering/engineering-backend-architect.md", "description": "后端架构师"},
            {"name": "cms-developer", "path": "engineering/engineering-cms-developer.md", "description": "CMS开发工程师"},
            {"name": "code-reviewer", "path": "engineering/engineering-code-reviewer.md", "description": "代码审查专家"},
            {"name": "codebase-onboarding-engineer", "path": "engineering/engineering-codebase-onboarding-engineer.md", "description": "代码库引导工程师"},
            {"name": "data-engineer", "path": "engineering/engineering-data-engineer.md", "description": "数据工程师"},
            {"name": "database-optimizer", "path": "engineering/engineering-database-optimizer.md", "description": "数据库优化师"},
            {"name": "devops-automator", "path": "engineering/engineering-devops-automator.md", "description": "DevOps自动化工程师"},
            {"name": "dingtalk-integration-developer", "path": "engineering/engineering-dingtalk-integration-developer.md", "description": "钉钉集成开发工程师"},
            {"name": "email-intelligence-engineer", "path": "engineering/engineering-email-intelligence-engineer.md", "description": "邮件智能工程师"},
            {"name": "embedded-firmware-engineer", "path": "engineering/engineering-embedded-firmware-engineer.md", "description": "嵌入式固件工程师"},
            {"name": "embedded-linux-driver-engineer", "path": "engineering/engineering-embedded-linux-driver-engineer.md", "description": "嵌入式Linux驱动工程师"},
            {"name": "feishu-integration-developer", "path": "engineering/engineering-feishu-integration-developer.md", "description": "飞书集成开发工程师"},
            {"name": "filament-optimization-specialist", "path": "engineering/engineering-filament-optimization-specialist.md", "description": "耗材优化专家"},
            {"name": "fpga-digital-design-engineer", "path": "engineering/engineering-fpga-digital-design-engineer.md", "description": "FPGA数字设计工程师"},
            {"name": "frontend-developer", "path": "engineering/engineering-frontend-developer.md", "description": "前端开发工程师"},
            {"name": "git-workflow-master", "path": "engineering/engineering-git-workflow-master.md", "description": "Git工作流专家"},
            {"name": "incident-response-commander", "path": "engineering/engineering-incident-response-commander.md", "description": "事件响应指挥官"},
            {"name": "iot-solution-architect", "path": "engineering/engineering-iot-solution-architect.md", "description": "IoT解决方案架构师"},
            {"name": "mechanical-design-engineer", "path": "engineering/engineering-mechanical-design-engineer.md", "description": "机械设计工程师"},
            {"name": "minimal-change-engineer", "path": "engineering/engineering-minimal-change-engineer.md", "description": "最小改动工程师"},
            {"name": "mobile-app-builder", "path": "engineering/engineering-mobile-app-builder.md", "description": "移动应用开发工程师"},
            {"name": "pc-host-engineer", "path": "engineering/engineering-pc-host-engineer.md", "description": "PC主机工程师"},
            {"name": "rapid-prototyper", "path": "engineering/engineering-rapid-prototyper.md", "description": "快速原型开发工程师"},
            {"name": "security-engineer", "path": "engineering/engineering-security-engineer.md", "description": "安全工程师"},
            {"name": "senior-developer", "path": "engineering/engineering-senior-developer.md", "description": "高级开发工程师"},
            {"name": "software-architect", "path": "engineering/engineering-software-architect.md", "description": "软件架构师"},
            {"name": "solidity-smart-contract-engineer", "path": "engineering/engineering-solidity-smart-contract-engineer.md", "description": "Solidity智能合约工程师"},
            {"name": "sre", "path": "engineering/engineering-sre.md", "description": "站点可靠性工程师"},
            {"name": "technical-writer", "path": "engineering/engineering-technical-writer.md", "description": "技术文档工程师"},
            {"name": "threat-detection-engineer", "path": "engineering/engineering-threat-detection-engineer.md", "description": "威胁检测工程师"},
            {"name": "voice-ai-integration-engineer", "path": "engineering/engineering-voice-ai-integration-engineer.md", "description": "语音AI集成工程师"},
            {"name": "wechat-mini-program-developer", "path": "engineering/engineering-wechat-mini-program-developer.md", "description": "微信小程序开发工程师"},
        ],
    },
    {
        "id": "design",
        "label": "设计",
        "agents": [
            {"name": "brand-guardian", "path": "design/design-brand-guardian.md", "description": "品牌守护者"},
            {"name": "image-prompt-engineer", "path": "design/design-image-prompt-engineer.md", "description": "图像提示词工程师"},
            {"name": "inclusive-visuals-specialist", "path": "design/design-inclusive-visuals-specialist.md", "description": "无障碍视觉专家"},
            {"name": "ui-designer", "path": "design/design-ui-designer.md", "description": "UI设计师"},
            {"name": "ux-architect", "path": "design/design-ux-architect.md", "description": "UX架构师"},
            {"name": "ux-researcher", "path": "design/design-ux-researcher.md", "description": "UX研究员"},
            {"name": "visual-storyteller", "path": "design/design-visual-storyteller.md", "description": "视觉叙事师"},
            {"name": "whimsy-injector", "path": "design/design-whimsy-injector.md", "description": "创意灵感注入师"},
        ],
    },
    {
        "id": "marketing",
        "label": "市场运营",
        "agents": [
            {"name": "agentic-search-optimizer", "path": "marketing/marketing-agentic-search-optimizer.md", "description": "智能搜索优化师"},
            {"name": "ai-citation-strategist", "path": "marketing/marketing-ai-citation-strategist.md", "description": "AI引用策略师"},
            {"name": "app-store-optimizer", "path": "marketing/marketing-app-store-optimizer.md", "description": "应用商店优化师"},
            {"name": "baidu-seo-specialist", "path": "marketing/marketing-baidu-seo-specialist.md", "description": "百度SEO专家"},
            {"name": "bilibili-strategist", "path": "marketing/marketing-bilibili-strategist.md", "description": "B站运营策略师"},
            {"name": "book-co-author", "path": "marketing/marketing-book-co-author.md", "description": "书籍共创者"},
            {"name": "carousel-growth-engine", "path": "marketing/marketing-carousel-growth-engine.md", "description": "轮播增长引擎"},
            {"name": "china-ecommerce-operator", "path": "marketing/marketing-china-ecommerce-operator.md", "description": "中国电商运营专家"},
            {"name": "china-market-localization-strategist", "path": "marketing/marketing-china-market-localization-strategist.md", "description": "中国市场本地化策略师"},
            {"name": "content-creator", "path": "marketing/marketing-content-creator.md", "description": "内容创作者"},
            {"name": "cross-border-ecommerce", "path": "marketing/marketing-cross-border-ecommerce.md", "description": "跨境电商专家"},
            {"name": "daily-news-briefing", "path": "marketing/marketing-daily-news-briefing.md", "description": "每日新闻简报编辑"},
            {"name": "douyin-strategist", "path": "marketing/marketing-douyin-strategist.md", "description": "抖音运营策略师"},
            {"name": "ecommerce-operator", "path": "marketing/marketing-ecommerce-operator.md", "description": "电商运营专家"},
            {"name": "growth-hacker", "path": "marketing/marketing-growth-hacker.md", "description": "增长黑客"},
            {"name": "instagram-curator", "path": "marketing/marketing-instagram-curator.md", "description": "Instagram内容策划"},
            {"name": "knowledge-commerce-strategist", "path": "marketing/marketing-knowledge-commerce-strategist.md", "description": "知识付费策略师"},
            {"name": "kuaishou-strategist", "path": "marketing/marketing-kuaishou-strategist.md", "description": "快手运营策略师"},
            {"name": "linkedin-content-creator", "path": "marketing/marketing-linkedin-content-creator.md", "description": "LinkedIn内容创作者"},
            {"name": "livestream-commerce-coach", "path": "marketing/marketing-livestream-commerce-coach.md", "description": "直播带货教练"},
            {"name": "podcast-strategist", "path": "marketing/marketing-podcast-strategist.md", "description": "播客策略师"},
            {"name": "private-domain-operator", "path": "marketing/marketing-private-domain-operator.md", "description": "私域运营专家"},
            {"name": "reddit-community-builder", "path": "marketing/marketing-reddit-community-builder.md", "description": "Reddit社区建设者"},
            {"name": "seo-specialist", "path": "marketing/marketing-seo-specialist.md", "description": "SEO专家"},
            {"name": "short-video-editing-coach", "path": "marketing/marketing-short-video-editing-coach.md", "description": "短视频剪辑教练"},
            {"name": "social-media-strategist", "path": "marketing/marketing-social-media-strategist.md", "description": "社交媒体策略师"},
            {"name": "tiktok-strategist", "path": "marketing/marketing-tiktok-strategist.md", "description": "TikTok运营策略师"},
            {"name": "twitter-engager", "path": "marketing/marketing-twitter-engager.md", "description": "Twitter互动专家"},
            {"name": "video-optimization-specialist", "path": "marketing/marketing-video-optimization-specialist.md", "description": "视频优化专家"},
            {"name": "wechat-official-account", "path": "marketing/marketing-wechat-official-account.md", "description": "微信公众号运营"},
            {"name": "wechat-operator", "path": "marketing/marketing-wechat-operator.md", "description": "微信运营专家"},
            {"name": "weibo-strategist", "path": "marketing/marketing-weibo-strategist.md", "description": "微博运营策略师"},
            {"name": "weixin-channels-strategist", "path": "marketing/marketing-weixin-channels-strategist.md", "description": "微信视频号策略师"},
            {"name": "xiaohongshu-operator", "path": "marketing/marketing-xiaohongshu-operator.md", "description": "小红书运营专家"},
            {"name": "xiaohongshu-specialist", "path": "marketing/marketing-xiaohongshu-specialist.md", "description": "小红书专家"},
            {"name": "zhihu-strategist", "path": "marketing/marketing-zhihu-strategist.md", "description": "知乎运营策略师"},
        ],
    },
    {
        "id": "game-development",
        "label": "游戏开发",
        "agents": [
            {"name": "game-audio-engineer", "path": "game-development/game-audio-engineer.md", "description": "游戏音频工程师"},
            {"name": "game-designer", "path": "game-development/game-designer.md", "description": "游戏设计师"},
            {"name": "level-designer", "path": "game-development/level-designer.md", "description": "关卡设计师"},
            {"name": "narrative-designer", "path": "game-development/narrative-designer.md", "description": "叙事设计师"},
            {"name": "technical-artist", "path": "game-development/technical-artist.md", "description": "技术美术师"},
        ],
    },
]

# CATALOG.md path in the remote repo — authoritative source with Chinese descriptions
_CATALOG_PATH = "CATALOG.md"

# GitHub tree API — used to dynamically build catalog when catalog.json doesn't exist
_GITHUB_TREE_URL = "https://api.github.com/repos/jnMetaCode/agency-agents-zh/git/trees/main?recursive=1"
_TREE_CACHE_KEY = "__repo_tree__"

# Departments to include from the repo (exclude scripts, examples, .github, etc.)
_DEPT_LABELS: dict[str, str] = {
    "academic": "学术研究",
    "design": "设计",
    "engineering": "工程",
    "finance": "金融",
    "game-development": "游戏开发",
    "hr": "人力资源",
    "legal": "法务",
    "marketing": "市场运营",
    "paid-media": "付费媒体",
    "product": "产品",
    "project-management": "项目管理",
    "sales": "销售",
    "spatial-computing": "空间计算",
    "specialized": "专项服务",
    "supply-chain": "供应链",
    "support": "运营支持",
    "testing": "测试质量",
}

# Cache directory
_CACHE_ROOT = Path(os.environ.get("HLAGENT_CONFIG_DIR", Path.home() / ".hlagent")) / "role-library"

# Content sources — try in order until one succeeds
_CONTENT_SOURCES = [
    "https://cdn.jsdelivr.net/gh/jnMetaCode/agency-agents-zh@main",
    "https://raw.githubusercontent.com/jnMetaCode/agency-agents-zh/main",
]

# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------


class RoleAgentOut(BaseModel):
    name: str
    path: str
    description: str


class RoleDepartmentOut(BaseModel):
    id: str
    label: str
    agents: list[RoleAgentOut]


class CatalogOut(BaseModel):
    departments: list[RoleDepartmentOut]


# ---------------------------------------------------------------------------
# L1 in-memory cache — per-path dict supporting individual entry eviction
# ---------------------------------------------------------------------------

_l1_cache: dict[str, str] = {}
_l1_lock = asyncio.Lock()


async def _l1_get(path: str) -> str | None:
    async with _l1_lock:
        return _l1_cache.get(path)


async def _l1_set(path: str, content: str) -> None:
    async with _l1_lock:
        _l1_cache[path] = content


async def _l1_clear() -> None:
    async with _l1_lock:
        _l1_cache.clear()


# ---------------------------------------------------------------------------
# L2 disk cache helpers (synchronous — always call via asyncio.to_thread)
# ---------------------------------------------------------------------------


def _read_from_disk(path: str) -> str | None:
    cache_file = _CACHE_ROOT / path
    if cache_file.exists():
        return cache_file.read_text(encoding="utf-8")
    return None


def _write_to_disk(path: str, content: str) -> None:
    cache_file = _CACHE_ROOT / path
    resolved = cache_file.resolve()
    cache_root_resolved = _CACHE_ROOT.resolve()
    try:
        resolved.relative_to(cache_root_resolved)
    except ValueError:
        raise ValueError(f"Invalid cache path: {path}")
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    # Sanitize lone surrogates before writing to ensure valid UTF-8 on disk
    clean = content.encode("utf-8", errors="replace").decode("utf-8")
    cache_file.write_text(clean, encoding="utf-8")


# ---------------------------------------------------------------------------
# Internal: fetch content with L1 → L2 → CDN fallback chain
# ---------------------------------------------------------------------------


async def _fetch_content(path: str) -> str:
    """L1 dict → L2 disk → CDN sources. Raises HTTPException(503) on total failure."""
    cached = await _l1_get(path)
    if cached is not None:
        return cached

    disk_content = await asyncio.to_thread(_read_from_disk, path)
    if disk_content is not None:
        await _l1_set(path, disk_content)
        return disk_content

    proxy_url = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    client_kwargs: dict[str, Any] = {"timeout": 10.0}
    if proxy_url:
        client_kwargs["proxy"] = proxy_url
    last_error: str = "all sources failed"

    async with httpx.AsyncClient(**client_kwargs) as client:
        for base_url in _CONTENT_SOURCES:
            url = f"{base_url}/{path}"
            try:
                resp = await client.get(url)
                if resp.status_code == 200:
                    content = resp.text
                    await asyncio.to_thread(_write_to_disk, path, content)
                    await _l1_set(path, content)
                    return content
                last_error = f"upstream_error:{resp.status_code}"
            except httpx.TimeoutException:
                last_error = f"timeout:{base_url}"
                continue
            except Exception as e:
                last_error = f"error:{base_url}:{e}"
                continue

    raise HTTPException(
        status_code=503,
        detail={"error": "fetch_failed", "detail": last_error, "cached": False},
    )


async def _fetch_catalog_from_url(url: str) -> CatalogOut | None:
    """Fetch catalog JSON from a custom URL (enterprise override). Returns None on any failure."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            log.error("HLAGENT_EXPERT_CATALOG_URL has invalid scheme/host: %s", url)
            return None
    except Exception:
        log.error("HLAGENT_EXPERT_CATALOG_URL is not a valid URL: %s", url)
        return None

    proxy_url = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    client_kwargs: dict[str, Any] = {"timeout": 10.0}
    if proxy_url:
        client_kwargs["proxy"] = proxy_url
    try:
        async with httpx.AsyncClient(**client_kwargs) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                return CatalogOut.model_validate_json(resp.text)
            log.warning("Custom catalog URL returned %s: %s", resp.status_code, url)
    except Exception as e:
        log.warning("Custom catalog URL fetch failed: %s", e)
    return None


def _build_catalog_out(data: list[dict[str, Any]]) -> CatalogOut:
    return CatalogOut(
        departments=[
            RoleDepartmentOut(
                id=dept["id"],
                label=dept["label"],
                agents=[RoleAgentOut(**a) for a in dept["agents"]],
            )
            for dept in data
        ]
    )


def _parse_catalog_md(text: str) -> CatalogOut:
    """Parse CATALOG.md markdown table format into CatalogOut.

    Expected section header: ## {emoji} {label} ({count})
    Expected table row:      | {中文名} | `{path}` |
    """
    departments: list[RoleDepartmentOut] = []
    current_label: str | None = None
    current_dept_id: str | None = None
    current_agents: list[RoleAgentOut] = []

    for line in text.splitlines():
        # Section header: ## 🎭 工程部 (35)
        header_match = re.match(r'^##\s+(?:\S+\s+)?(.+?)\s*\(\d+\)\s*$', line.strip())
        if header_match:
            if current_dept_id and current_agents:
                departments.append(RoleDepartmentOut(
                    id=current_dept_id,
                    label=current_label or current_dept_id,
                    agents=current_agents,
                ))
            current_label = header_match.group(1).strip()
            current_dept_id = None
            current_agents = []
            continue

        # Table data row: | 前端开发者 | `engineering/engineering-frontend-developer.md` |
        row_match = re.match(r'^\|\s*(.+?)\s*\|\s*`([^`]+\.md)`\s*\|', line)
        if row_match and current_label:
            description = row_match.group(1).strip()
            path = row_match.group(2).strip()
            # Skip header row
            if description == '中文名' or description.startswith('-'):
                continue
            # Infer dept_id from first path segment
            if current_dept_id is None:
                current_dept_id = path.split('/')[0]
            # Derive agent name from filename (strip dept prefix if present)
            filename_stem = path.rsplit('/', 1)[-1][:-3]
            dept_prefix = current_dept_id + '-'
            agent_name = filename_stem[len(dept_prefix):] if filename_stem.startswith(dept_prefix) else filename_stem
            current_agents.append(RoleAgentOut(name=agent_name, path=path, description=description))

    # Flush last department
    if current_dept_id and current_agents:
        departments.append(RoleDepartmentOut(
            id=current_dept_id,
            label=current_label or current_dept_id,
            agents=current_agents,
        ))

    return CatalogOut(departments=departments)


# Description lookup from built-in catalog — used for known agents so they keep Chinese names
_KNOWN_DESCRIPTIONS: dict[str, str] = {
    a["path"]: a["description"]
    for dept in AGENT_CATALOG
    for a in dept["agents"]
}


def _humanize_agent_name(name: str) -> str:
    """Convert kebab-case agent name to readable title (used for agents not in known list)."""
    return name.replace("-", " ").title()


async def _fetch_github_tree() -> list[dict[str, Any]] | None:
    """Fetch the repo file tree from GitHub API. Returns None on any failure."""
    proxy_url = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    client_kwargs: dict[str, Any] = {"timeout": 15.0}
    if proxy_url:
        client_kwargs["proxy"] = proxy_url
    try:
        async with httpx.AsyncClient(**client_kwargs) as client:
            resp = await client.get(
                _GITHUB_TREE_URL,
                headers={"Accept": "application/vnd.github.v3+json"},
            )
            if resp.status_code != 200:
                log.warning("GitHub tree API returned %s", resp.status_code)
                return None
            return resp.json().get("tree", [])
    except Exception as e:
        log.warning("GitHub tree API failed: %s", e)
        return None


def _parse_github_tree(tree: list[dict[str, Any]]) -> CatalogOut | None:
    """Build CatalogOut from a GitHub repo tree item list. Returns None if no agents found."""
    dept_agents: dict[str, list[dict[str, str]]] = {}
    for item in tree:
        if item.get("type") != "blob":
            continue
        path: str = item["path"]
        if not path.endswith(".md") or path.lower().endswith("readme.md"):
            continue
        parts = path.split("/")
        if len(parts) < 2:
            continue
        dept_id = parts[0]
        if dept_id not in _DEPT_LABELS:
            continue
        filename_stem = parts[-1][:-3]
        agent_name = filename_stem[len(dept_id) + 1:] if filename_stem.startswith(dept_id + "-") else filename_stem
        description = _KNOWN_DESCRIPTIONS.get(path, _humanize_agent_name(agent_name))
        dept_agents.setdefault(dept_id, []).append({"name": agent_name, "path": path, "description": description})

    if not dept_agents:
        return None
    departments = [
        RoleDepartmentOut(id=dept_id, label=_DEPT_LABELS[dept_id], agents=[RoleAgentOut(**a) for a in agents])
        for dept_id, agents in dept_agents.items()
        if agents
    ]
    return CatalogOut(departments=departments)


async def _build_catalog_from_github_tree() -> CatalogOut | None:
    """Build catalog from GitHub tree with L1/L2 caching. Returns None on total failure."""
    cached = await _l1_get(_TREE_CACHE_KEY)
    if cached is not None:
        try:
            return CatalogOut.model_validate_json(cached)
        except Exception:
            pass

    disk_content = await asyncio.to_thread(_read_from_disk, _TREE_CACHE_KEY)
    if disk_content is not None:
        try:
            catalog = CatalogOut.model_validate_json(disk_content)
            await _l1_set(_TREE_CACHE_KEY, disk_content)
            return catalog
        except Exception:
            pass

    tree = await _fetch_github_tree()
    if tree is None:
        return None

    catalog = _parse_github_tree(tree)
    if catalog is None:
        return None

    json_str = catalog.model_dump_json()
    try:
        await asyncio.to_thread(_write_to_disk, _TREE_CACHE_KEY, json_str)
    except Exception:
        pass
    await _l1_set(_TREE_CACHE_KEY, json_str)
    log.info("Built catalog from GitHub tree: %d depts, %d agents",
             len(catalog.departments), sum(len(d.agents) for d in catalog.departments))
    return catalog


async def _get_catalog() -> CatalogOut:
    """Fetch catalog. Priority: custom URL → CATALOG.md (CDN/GitHub) → GitHub tree API → built-in."""
    custom_url = os.environ.get("HLAGENT_EXPERT_CATALOG_URL")
    if custom_url:
        result = await _fetch_catalog_from_url(custom_url)
        if result is not None:
            return result
        log.warning("Custom catalog URL failed, trying default CDN/GitHub path")

    # Primary: fetch CATALOG.md (exists in repo, has Chinese descriptions)
    try:
        text = await _fetch_content(_CATALOG_PATH)
        catalog = _parse_catalog_md(text)
        if catalog.departments:
            return catalog
    except Exception as e:
        log.warning("CATALOG.md fetch/parse failed: %s", e)

    # Secondary: build dynamically from GitHub repo tree
    tree_catalog = await _build_catalog_from_github_tree()
    if tree_catalog is not None:
        return tree_catalog

    log.warning("All remote catalog sources failed, using built-in catalog")
    return _build_catalog_out(AGENT_CATALOG)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/catalog")
async def get_catalog() -> Response:
    """Return the role catalog. Fetches from catalog.json (CDN/GitHub) or custom URL, falls back to built-in."""
    data = await _get_catalog()
    return Response(
        content=data.model_dump_json(),
        media_type="application/json",
        headers={"Cache-Control": "max-age=3600"},
    )


@router.get("/content")
async def get_content(path: str = Query(...)) -> Response:
    """Fetch role Markdown content. L1 dict → L2 disk → CDN sources (fallback chain)."""
    catalog = await _get_catalog()
    valid_paths = {a.path for dept in catalog.departments for a in dept.agents}
    if path not in valid_paths:
        raise HTTPException(status_code=400, detail=f"Unknown role path: {path!r}")

    cached_before = await _l1_get(path)
    content = await _fetch_content(path)
    cache_status = "HIT" if cached_before is not None else "MISS"

    return Response(
        content=content,
        media_type="text/markdown",
        headers={"X-Cache": cache_status},
    )


@router.delete("/cache")
async def clear_cache() -> dict[str, Any]:
    """Clear all disk-cached role content and invalidate L1 cache."""
    cleared = 0
    if _CACHE_ROOT.exists():
        for f in _CACHE_ROOT.rglob("*"):
            if f.is_file():
                await asyncio.to_thread(f.unlink)
                cleared += 1
    await _l1_clear()
    return {"cleared_files": cleared}
