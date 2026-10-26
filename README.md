# Yuque Desktop (Electron)

跨平台语雀客户端的首个工程版。Electron 45 + Vue 3 + TypeScript + SQLite（Electron 内置 Node.js `node:sqlite`）。无需自建后端。

> **状态：v0.1.0 工程源码。** 已编写基本界面、主进程 API 通信、Token 安全存储、Markdown/YFM 读写、本地缓存、草稿和冲突检查；尚未使用真实 Token 进行端到端回归，也未在 Windows/macOS 真机打包验证。**请先用测试知识库验证写回。**

## 安装与启动

要求：Node.js 24+、npm、Windows 11 或 macOS 13+。在项目根目录执行：

```sh
npm install
npm run dev
```

验证 / 打包：

```sh
npm test
npm run typecheck
npm run build
npm run dist:win  # Windows 上
npm run dist:mac  # macOS 上
```

打包产物位于 `release/`。仓库包含可手动触发的 GitHub Actions Windows/macOS 构建工作流。当前无代码签名 / Apple 公证，不应当作正式发行版。

## 首版功能

- 安全设置个人或语雀团队空间 Token（只允许 `https://*.yuque.com`）；
- 获取用户、个人知识库、每库前 100 条文档；
- 查看 Markdown 或 Lake 文档，Lake 只读；
- Markdown 直接编辑、自动保存本地草稿、显式确认上传；
- 通过 YFM API 回读校验后清除草稿；
- 检测云端版本变更，禁止静默覆盖；
- SQLite WAL 缓存，离线读取已打开的文档；
- 深浅主题、文档本地过滤、常用快捷键；
- Electron 安全隔离 + HTTPS 域名白名单。

## 已知限制（重要）

1. **真实 API 功能尚未端到端验证**。语雀的开放 API、账号权限与返回值因账号/文档而异。
2. `/yfm/docs` 返回原始 YFM 字符串；编辑时不自动转换格式，上传前会检查远端时间戳，写回后回读比较内容。由于官方 API 未提供已确认的条件写接口，检查与写入之间仍可能发生竞争，不保证无冲突覆盖。
3. 仅在 `format=markdown` 且 YFM 读取成功时允许编辑；Lake/html 采用只读 HTML（渲染前 DOMPurify 清理）。
4. Markdown 先使用零额外编辑器依赖的原生文本框。CodeMirror 6、代码高亮、附件、TOC、小记、离线全文搜索及分页加载将在后续迭代。
5. 每个知识库首版只加载 100 篇文档；某些团队空间列表权限需要在后续版本完善。
6. 草稿和文档缓存当前保存在本地 SQLite，**没有加密**。敏感内容请在启用 BitLocker/FileVault 的电脑上使用。Token 通过 Electron `safeStorage` 加密保存，系统安全存储不可用时拒绝持久化。
7. 退出或切换账号时存在未同步草稿会阻止操作，以避免丢失；已发布文档也可能因语雀侧转换而产生格式差异。
8. 无签名安装包可能出现系统安全提示，正式发布需要 Windows 证书签名与 macOS 公证。
9. 需要网络获取 npm 依赖与 Electron 二进制；本环境没有可用 npm 网络访问，因而未能执行依赖安装 / 真实构建。

## 安全设计

- `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`；
- 只暴露细粒度 preload API，主进程验证 IPC 的发送窗口及来源；
- 主进程处理所有网络请求，Token 不返回渲染进程；
- 禁止应用内导航/弹窗，外部链接只允许 `https://*.yuque.com`；
- CSP 限制脚本来源，Markdown/Lake HTML 使用 DOMPurify 净化；
- 读取缓存不需要网络，离线写入只写本地草稿。

## 官方接口参考

- [语雀 Yuque MCP Server](https://github.com/yuque/yuque-mcp-server)
- [官方 API 能力](https://github.com/yuque/yuque-mcp-server/blob/main/docs/capability-scope.md)
- [Electron Security Checklist](https://www.electronjs.org/docs/latest/tutorial/security/)

## 下一步

1. 使用专用测试 Token 完成连接、Markdown 创建、读取、更新、回读及冲突测试；
2. 添加文档列表分页、团队知识库、目录树、小记、全文搜索；
3. CodeMirror 编辑体验升级，Lake 格式往返测试后再考虑编辑；
4. 添加 E2E、性能基准、异常恢复、Release 自动签名和更新。

### 依赖体积

Vue、Markdown 渲染器、图标等只用于渲染进程，统一由 Vite 打进产物，放在 `devDependencies`，避免 electron-builder 将多余的 UI 包整体附带到安装包。Electron 45 沙盒化 preload 采用无第三方依赖的 IPC 接口。
