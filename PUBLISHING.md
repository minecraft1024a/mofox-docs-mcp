# 发布指南：GitHub + npm

本目录是 `mofox-docs-mcp` MCP 服务器源码。以下步骤帮你把它发布到 **GitHub**（源码仓库 + Release）和 **npm**（`npx -y mofox-docs-mcp` 直接可用）。

> 发布需要你本机已有的账号凭证，因此这里只提供操作指引，命令由你自己执行。

---

## 0. 前置检查

```bash
node --version   # 需要 >= 18（本机 26 已满足）
npm --version
git config --global user.name    # 应为 minecraft1024a
git config --global user.email
```

发布前先本地验证一遍：

```bash
npm install
npm run build        # 编译到 dist/
npm start            # 能正常启动即 OK
```

确认 `package.json`：

- `name`: `mofox-docs-mcp`（已确认 npm 上未被占用）
- `version`: `0.1.0`
- `bin`: `mofox-docs-mcp` → `./dist/index.js`
- `files`: 只发布 `dist/` 与 `README.md`

---

## 1. 发布到 GitHub

### 方式 A：用 gh CLI（推荐）

```bash
# 安装 gh：https://cli.github.com
gh auth login          # 选择 HTTPS + 浏览器授权

# 在 GitHub 上创建仓库（默认私有可改 --public）
gh repo create mofox-docs-mcp --public --source . --remote origin --push
```

### 方式 B：网页创建

1. 打开 https://github.com/new，仓库名 `mofox-docs-mcp`，Public，不勾选任何初始化文件。
2. 本地执行：

```bash
git init
git add -A
git commit -m "feat: Neo-MoFox 官方文档 MCP 服务器"
git branch -M master
git remote add origin https://github.com/minecraft1024a/mofox-docs-mcp.git
git push -u origin master
```

### 可选：创建 GitHub Release

```bash
# 打 tag 并推送（Release 会自动关联）
git tag v0.1.0
git push origin v0.1.0
```

然后在仓库页面 New release，选 tag `v0.1.0`，写 release notes。

---

## 2. 发布到 npm

### 2.1 登录 npm

```bash
npm login
```

会要求输入 npm 用户名、密码（一次性密码）。登录后可验证：

```bash
npm whoami   # 输出你的 npm 用户名即成功
```

### 2.2 发布

```bash
npm publish
```

### 2.3 验证

```bash
npx -y mofox-docs-mcp --help
```

能打印帮助即发布成功。任何 MCP 客户端现在都可以：

```bash
npx -y mofox-docs-mcp
```

---

## 3. 后续更新版本

改完代码后按语义化版本升级并重新发布：

```bash
npm run build
npm version patch   # 0.1.0 -> 0.1.1（或 minor / major）
npm publish
git push origin master --tags
```

> `npm version` 会自动修改 `package.json` 的 version 并打一个本地 git tag，记得 `git push --tags`。

---

## 4. 接入 Neo-MoFox

发布成功后，在 Neo-MoFox 的 `config/mcp.toml` 添加：

```toml
[mcp.stdio_servers.mofox-docs]
command = "npx"
args = ["-y", "mofox-docs-mcp"]
instructions = "提供 Neo-MoFox 官方文档的搜索与阅读功能，当用户询问框架功能、配置、插件开发、API 用法时使用"
```

---

## 5. 常见问题

| 现象 | 原因 / 解决 |
| --- | --- |
| `npm publish` 报 `ENEEDAUTH` / `403` | 未登录或 token 过期：先 `npm login`，再 `npm whoami` 确认 |
| 报 `403 You cannot publish over the previously published versions` | 版本号未递增：`npm version patch` 后再发 |
| 报 `409` / `E409` | 包名已被占用：换名，或确认大小写（`mofox-docs-mcp` 唯一） |
| `git push` 被拒 | 远端已有内容：先 `git pull --rebase origin master` 再推 |
| 发布后 `npx` 还是旧版本 | 清除 npx 缓存：`npm cache clean --force` 或用 `npx -y mofox-docs-mcp@latest` |

---

## 6. 仓库内文件说明

| 文件 | 说明 |
| --- | --- |
| `src/index.ts` | MCP 服务器源码（单文件，含 3 个工具 + 2 类资源） |
| `package.json` | npm 包配置（bin / files / scripts） |
| `tsconfig.json` | TypeScript 编译配置 |
| `README.md` | 使用文档（会随包发布） |
| `dist/` | 编译产物（npm publish 发布内容，勿手改） |