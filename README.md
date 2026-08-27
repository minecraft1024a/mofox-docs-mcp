# mofox-docs-mcp

Neo-MoFox 官方文档 MCP 服务器：通过 [Model Context Protocol](https://modelcontextprotocol.io) 提供 MoFox-Bot-Docs 文档站的检索与阅读能力，供 Claude、Cursor、Neo-MoFox 等 MCP 客户端直接搜索与阅读官方文档。

数据源为文档站 JSON API（`https://docs.mofox-sama.com/api/docs/*`），与 MoFox 插件市场中的 `mofox_docs` 插件共用同一套 `llms.json` 索引，行为一致。

## 功能

### 工具 Tools

| 工具 | 说明 |
| --- | --- |
| `search_docs(query, limit?, offset?)` | 按关键词检索文档。查询按空白拆词，按「命中关键词数量」降序返回（如 `"Windows 部署 安装"` 会优先命中 `guides/deployment/deployment_guide`）。支持分页 |
| `list_docs(limit?, offset?)` | 列出文档。按 section 排序，部署指南（`guides/deployment`）排最前，每篇含 title / description / preview / section |
| `get_doc(doc_id)` | 获取指定文档完整正文（纯文本）。`doc_id` 形如 `guides/deployment/deployment_guide` |

### 资源 Resources

| 资源 | 说明 |
| --- | --- |
| `mofox://docs` | 全量索引（`llms.json`，含每篇的标题 / 简介 / 正文预览） |
| `mofox://docs/{id}` | 单篇文档完整内容（如 `mofox://docs/guides/configuration/bot_config_guide`） |

## 快速开始

### 方式一：uvx 直接运行（推荐）

```bash
uvx mofox-docs-mcp
```

或使用 pipx：

```bash
pipx run mofox-docs-mcp
```

### 方式二：pip 安装后运行

```bash
pip install mofox-docs-mcp
mofox-docs-mcp
```

### 方式三：克隆 / 本地构建

```bash
uv sync            # 或 pip install -e .
uv run mofox-docs-mcp
```

## 接入 Neo-MoFox

编辑 `config/mcp.toml`：

```toml
[mcp.stdio_servers.mofox-docs]
command = "uvx"
args = ["mofox-docs-mcp"]
instructions = "提供 Neo-MoFox 官方文档的搜索与阅读功能，当用户询问框架功能、配置、插件开发、API 用法时使用"
```

重启 Neo-MoFox 即可生效。

## 其他 MCP 客户端

```json
{
  "mcpServers": {
    "mofox-docs": {
      "command": "uvx",
      "args": ["mofox-docs-mcp"]
    }
  }
}
```

## 配置选项

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `--base-url <url>` | 文档站地址 | `https://docs.mofox-sama.com` |
| `--timeout <秒>` | 请求超时 | `30` |
| `--cache-ttl <秒>` | 索引缓存时长（`llms.json`） | `300` |

也支持同名环境变量：`MOFOX_DOCS_BASE_URL`、`MOFOX_DOCS_TIMEOUT`、`MOFOX_DOCS_CACHE_TTL`。

## 开发

```bash
uv sync               # 创建虚拟环境并安装依赖
uv run mofox-docs-mcp # 运行服务器
uv build              # 构建 sdist / wheel 到 dist/
```

## License

MIT
