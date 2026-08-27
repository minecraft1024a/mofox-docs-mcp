#!/usr/bin/env python3
"""mofox-docs-mcp — Neo-MoFox 官方文档 MCP 服务器。

通过 Model Context Protocol 提供 MoFox-Bot-Docs 文档站的检索与阅读能力：
  - 工具：search_docs / list_docs / get_doc
  - 资源：mofox://docs（全量索引）、mofox://docs/<id>（单篇正文）

数据源为文档站 JSON API（https://docs.mofox-sama.com/api/docs/*），
与 MoFox 插件市场中的 mofox_docs 插件共用同一套索引（llms.json）。
"""

from __future__ import annotations

import argparse
import contextlib
import json
import logging
import os
import sys
import time
from collections.abc import Callable
from typing import Annotated, Any

import anyio
import httpx
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ResourceError, ToolError
from pydantic import Field

from . import __version__

logging.getLogger("httpx").setLevel(logging.WARNING)

DEFAULT_BASE_URL = "https://docs.mofox-sama.com"
DEFAULT_TIMEOUT_S = 30.0
DEFAULT_CACHE_TTL_S = 300.0

# ── 命令行参数 ────────────────────────────────────────────────────────


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="mofox-docs-mcp",
        description="Neo-MoFox 官方文档 MCP 服务器",
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("MOFOX_DOCS_BASE_URL") or DEFAULT_BASE_URL,
        help=f"文档站地址（默认 {DEFAULT_BASE_URL}，可用环境变量 MOFOX_DOCS_BASE_URL）",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=_env_float("MOFOX_DOCS_TIMEOUT", DEFAULT_TIMEOUT_S),
        help="请求超时秒数（默认 30，可用环境变量 MOFOX_DOCS_TIMEOUT）",
    )
    parser.add_argument(
        "--cache-ttl",
        type=float,
        default=_env_float("MOFOX_DOCS_CACHE_TTL", DEFAULT_CACHE_TTL_S),
        help="索引缓存时长秒数（默认 300，可用环境变量 MOFOX_DOCS_CACHE_TTL）",
    )
    parser.add_argument(
        "--version", action="version", version=f"mofox-docs-mcp {__version__}"
    )
    return parser.parse_args(argv)


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


# ── 文档 API 客户端 ───────────────────────────────────────────────────


class DocsApiClient:
    def __init__(self, base_url: str, timeout_s: float, cache_ttl_s: float) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_s = timeout_s
        self._cache_ttl_s = cache_ttl_s
        self._client = httpx.Client(
            base_url=self._base_url,
            timeout=timeout_s,
            headers={"Accept": "application/json"},
        )
        self._llms_cache: tuple[float, dict[str, Any]] | None = None

    def _request(self, path: str) -> Any:
        try:
            resp = self._client.get(path)
            if resp.status_code >= 400:
                raise RuntimeError(
                    f"文档 API 请求失败 (HTTP {resp.status_code}): {self._base_url}{path}"
                )
            return resp.json()
        except httpx.TimeoutException:
            raise RuntimeError(
                f"文档 API 请求超时（{self._timeout_s:g}s）: {self._base_url}{path}"
            ) from None
        except httpx.HTTPError as err:
            raise RuntimeError(f"文档 API 请求失败: {self._base_url}{path} ({err})") from err

    def get_llms(self) -> dict[str, Any]:
        """获取 LLM 检索索引（llms.json），带 TTL 缓存。"""
        now = time.monotonic()
        if self._llms_cache is not None and now - self._llms_cache[0] < self._cache_ttl_s:
            return self._llms_cache[1]
        data = self._request("/api/docs/llms.json")
        self._llms_cache = (now, data)
        return data

    def get_doc(self, doc_id: str) -> dict[str, Any]:
        """获取单篇文档（含正文）。"""
        data = self._request(f"/api/docs/{doc_id}.json")
        if not isinstance(data, dict):
            raise RuntimeError(f"文档返回格式异常: {self._base_url}/api/docs/{doc_id}.json")
        return data

    def search_docs(self, query: str) -> list[dict[str, Any]]:
        """按关键词检索：按命中的关键词数量降序（多关键词优先，至少命中一个即返回）。"""
        docs: list[dict[str, Any]] = self.get_llms().get("docs", [])
        tokens = [t for t in query.strip().lower().split() if t]
        if not tokens:
            return []

        def haystack(doc: dict[str, Any]) -> str:
            return " ".join(
                str(doc.get(key, ""))
                for key in ("title", "description", "preview", "section", "id", "path")
            ).lower()

        scored: list[tuple[int, int, dict[str, Any]]] = []
        for index, doc in enumerate(docs):
            hay = haystack(doc)
            score = sum(1 for token in tokens if token in hay)
            if score > 0:
                scored.append((score, index, doc))
        scored.sort(key=lambda item: (-item[0], item[1]))
        return [doc for _, _, doc in scored]

    def close(self) -> None:
        self._client.close()


# ── 工具 / 资源响应辅助 ───────────────────────────────────────────────


def _clamp_limit(limit: int) -> int:
    return min(100, max(1, int(limit)))


def _clamp_offset(offset: int) -> int:
    return max(0, int(offset))


def _json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


# ── 服务器主入口 ──────────────────────────────────────────────────────


def build_server(opts: argparse.Namespace) -> MCPServer:
    client = DocsApiClient(opts.base_url, opts.timeout, opts.cache_ttl)

    server = MCPServer(name="mofox-docs-mcp", version=__version__)

    # ── 工具 ──

    @server.tool()
    async def search_docs(
        query: Annotated[
            str, Field(description='检索关键词，如 "Windows 部署 安装" 或 "docker"')
        ],
        limit: Annotated[int, Field(ge=1, le=100, description="返回条数，默认 10，最大 100")] = 10,
        offset: Annotated[int, Field(ge=0, description="结果偏移量，用于分页，默认 0")] = 0,
    ) -> dict[str, Any]:
        """按关键词检索 Neo-MoFox 官方文档。查询按空白拆分为多个关键词，按「命中关键词数量」降序返回（命中全部关键词的文档排最前，至少命中一个即返回）。匹配标题 / 简介 / 正文预览 / 分类 / id / 路径。结果不含完整正文，需要全文时再用 get_doc 获取。"""
        try:
            results = await _to_thread(lambda: client.search_docs(query))
            offset_ = _clamp_offset(offset)
            page = results[offset_ : offset_ + _clamp_limit(limit)]
            return {
                "type": "docs_search_result",
                "action": "search",
                "query": query,
                "total": len(results),
                "offset": offset_,
                "count": len(page),
                "results": page,
            }
        except Exception as err:
            raise ToolError(f"错误: {err}") from err

    @server.tool()
    async def list_docs(
        limit: Annotated[int, Field(ge=1, le=100, description="返回条数，默认 10，最大 100")] = 10,
        offset: Annotated[int, Field(ge=0, description="结果偏移量，用于分页，默认 0")] = 0,
    ) -> dict[str, Any]:
        """列出 Neo-MoFox 官方文档。按 section 排序，部署指南（guides/deployment）排最前，每篇含 title / description / preview / section。支持 offset 分页。"""
        try:
            index = await _to_thread(client.get_llms)
            docs: list[dict[str, Any]] = index.get("docs", [])
            total = index.get("total", len(docs))
            offset_ = _clamp_offset(offset)
            page = docs[offset_ : offset_ + _clamp_limit(limit)]
            return {
                "type": "docs_index",
                "action": "list",
                "total": total,
                "offset": offset_,
                "count": len(page),
                "docs": page,
            }
        except Exception as err:
            raise ToolError(f"错误: {err}") from err

    @server.tool()
    async def get_doc(
        doc_id: Annotated[
            str,
            Field(description="文档唯一标识，如 guides/configuration/bot_config_guide"),
        ],
    ) -> dict[str, Any]:
        """获取指定文档的完整正文（纯文本）。doc_id 形如 guides/deployment/deployment_guide，可从 search_docs / list_docs 结果的 id 字段获取。"""
        try:
            doc = await _to_thread(lambda: client.get_doc(doc_id))
            return {"type": "docs_doc", "action": "get", "doc": doc}
        except Exception as err:
            raise ToolError(f"错误: {err}") from err

    # ── 资源 ──

    @server.resource(
        "mofox://docs", name="docs-index", mime_type="application/json"
    )
    async def docs_index_resource() -> str:
        index = await _to_thread(client.get_llms)
        return _json(index)

    @server.resource(
        "mofox://docs/{+doc_id}", name="docs-doc", mime_type="application/json"
    )
    async def docs_doc_resource(doc_id: str) -> str:
        try:
            doc = await _to_thread(lambda: client.get_doc(doc_id))
            return _json(doc)
        except Exception as err:
            raise ResourceError(str(err)) from err

    return server


async def _to_thread(func: Callable[[], Any]) -> Any:
    return await anyio.to_thread.run_sync(func)


def main(argv: list[str] | None = None) -> None:
    opts = parse_args(argv)
    server = build_server(opts)

    try:
        # 启动提示写到 stderr（stdout 由 stdio 传输协议占用）。
        print(
            f"mofox-docs-mcp v{__version__} 已启动，文档源: {opts.base_url}",
            file=sys.stderr,
        )
        with contextlib.suppress(KeyboardInterrupt):
            server.run(transport="stdio")
    except Exception as err:
        print(f"mofox-docs-mcp 启动失败: {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
