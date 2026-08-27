# mofox-docs-mcp — Neo-MoFox 官方文档 MCP 服务器
#
# 通过 Model Context Protocol 提供 MoFox-Bot-Docs 文档站的检索与阅读能力：
#   - 工具：search_docs / list_docs / get_doc
#   - 资源：mofox://docs（全量索引）、mofox://docs/<id>（单篇正文）
#
# 数据源为文档站 JSON API（https://docs.mofox-sama.com/api/docs/*），
# 与 MoFox 插件市场中的 mofox_docs 插件共用同一套索引（llms.json）。
"""Neo-MoFox 官方文档 MCP 服务器。"""

from __future__ import annotations

__version__ = "0.1.0"

__all__ = ["__version__"]
