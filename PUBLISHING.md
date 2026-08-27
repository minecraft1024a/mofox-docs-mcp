# 发布指南：PyPI

本目录是 `mofox-docs-mcp` MCP 服务器 Python 源码。以下步骤帮你把它发布到 **PyPI**（`uvx mofox-docs-mcp` / `pip install mofox-docs-mcp` 直接可用）。

> 发布需要你自己的 PyPI 账号凭证，因此这里只提供操作指引。

---

## 0. 前置检查

```bash
python3 --version   # 需要 >= 3.10
uv --version        # https://docs.astral.sh/uv/
```

发布前先本地验证一遍：

```bash
uv sync                 # 创建 .venv 并安装依赖（含本包，可编辑模式）
uv run mofox-docs-mcp   # 能正常启动（Ctrl+C 退出）即 OK
```

确认 `pyproject.toml`：

- `name`: `mofox-docs-mcp`（已确认 PyPI 上未被占用）
- `version`: `0.1.0`

---

## 1. 构建

```bash
uv build    # 生成 dist/mofox_docs_mcp-*.tar.gz 与 dist/mofox_docs_mcp-*.whl
```

发布前可用 [TestPyPI](htt.ps://test.pypi.org) 预演：

```bash
uv publish --publish-url https://test.pypi.org/legacy/ --token pypi-xxxx
```

---

## 2. 登录并发布到 PyPI

### 方式 A：API Token（推荐）

1. 在 <https://pypi.org/manage/account/token/> 创建一个 API Token（范围可选限定到本项目）。
2. 发布：

```bash
uv publish --token pypi-xxxx
```

或用环境变量：

```bash
UV_PUBLISH_TOKEN=pypi-xxxx uv publish
```

### 方式 B：trusted publishing（GitHub Actions 自动发布）

在 PyPI 项目设置中配置 GitHub Trusted Publisher 后，推送 tag 时由 CI 调用 `uv publish`，无需手动 token。

### 验证

```bash
uvx mofox-docs-mcp --help
```

能打印帮助即发布成功。任何 MCP 客户端现在都可以：

```bash
uvx mofox-docs-mcp
```

---

## 3. 后续更新版本

改完代码后按语义化版本升级并重新发布：

```bash
# 手动把 pyproject.toml 与 src/mofox_docs_mcp/__init__.py 的 __version__ 同步升级
# 0.1.0 -> 0.1.1（patch）或 minor / major
uv build && uv publish --token pypi-xxxx
git tag v0.1.1 && git push origin master --tags
```

---

## 4. 接入 Neo-MoFox

发布成功后，在 Neo-MoFox 的 `config/mcp.toml` 添加：

```toml
[mcp.stdio_servers.mofox-docs]
command = "uvx"
args = ["mofox-docs-mcp"]
instructions = "提供 Neo-MoFox 官方文档的搜索与阅读功能，当用户询问框架功能、配置、插件开发、API 用法时使用"
```

---

## 5. 常见问题

| 现象 | 原因 / 解决 |
| --- | --- |
| `uv publish` 报 403 | 未带 token 或 token 无权限：先在 PyPI 创建/更新 API Token |
| 报 "File already exists" / 版本冲突 | 版本号未递增：升级 `pyproject.toml` 与 `__init__.py` 的 version 后再发 |
| `uvx` 还是旧版本 | 清缓存：`uv cache clean mofox-docs-mcp` 或指定 `mofox-docs-mcp==x.y.z` |
| 包名被占用 | 换名；PyPI 上 `mofox-docs-mcp` 归先注册者所有 |
| `git push` 被拒 | 先 `git pull --rebase origin master` 再推 |

---

## 6. 仓库内文件说明

| 文件 | 说明 |
| --- | --- |
| `src/mofox_docs_mcp/server.py` | MCP 服务器源码（3 个工具 + 2 类资源 + CLI 解析） |
| `src/mofox_docs_mcp/__init__.py` | 包元数据与版本号 |
| `src/mofox_docs_mcp/__main__.py` | `python -m mofox_docs_mcp` 入口 |
| `pyproject.toml` | PyPI 包配置（依赖 / 入口脚本 / 构建后端） |
| `README.md` | 使用文档（会随包发布） |
| `dist/` | 构建产物（`uv build` 生成，勿手改） |
