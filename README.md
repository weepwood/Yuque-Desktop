# Yuque Desktop

基于 **Electron + Vue 3 + TypeScript + SQLite** 的非官方语雀桌面客户端。v0.2.0 使用官方网页登录所建立的浏览器会话访问语雀内部只读接口，不再要求 API Token。

> ⚠️ 本项目与语雀官方无关联。本文档中使用的 /api/... 路径来自 2026-10-26 的有限实测，属于**未公开、可能随时变更的内部接口**。使用者需自行遵守语雀服务条款与账户安全规则。

## 功能（v0.2.0）

- **网页登录**：独立的 Electron BrowserWindow 打开 https://www.yuque.com/login，支持网站提供的登录方式。登录后的 `_yuque_session` HttpOnly Cookie 保留在 **persist:yuque-web-login** Chromium Session 中，无需手动提取或复制。
- **知识库**：我的所有知识库（含协作库），根据书库内容更新时间排序、侧栏过滤。
- **目录树**：从 `/api/catalog_nodes?book_id=...` 获取扁平目录，按 `parent_uuid` 还原层级并使用虚拟列表显示。
- **文档阅读**：请求文档详情时总是携带 `book_id`；Lake 正文显示在禁用脚本的沙盒 iframe。
- **全站搜索**：使用 `/api/zsearch?q=...&type=doc`，结果中读取 `_record.book_id`；搜索总数 5000 显示为 5000+。
- **小记**：分页、置顶小记、搜索和正文预览，兼容该接口没有 `data` 外壳的特性。
- **离线缓存**：SQLite 本地缓存成功读取的正文、知识库、目录和小记；网络故障时标记数据陈旧（stale）。
- **浅色/深色**：支持切换主题。

### 安全设计

- 登录窗口和应用主窗口使用**不同 Electron Session**；语雀登录窗口无 preload、禁用 Node 集成、启用沙盒。
- Cookie 只由 Electron 的持久化 Session 管理，不出现在渲染进程、IPC 返回、URL 或日志中。应用不尝试导入系统浏览器的 Cookie。
- 内部 API 在 Electron 主进程中通过该 Session 的 Chromium 网络栈访问，使用 `credentials: 'include'`；渲染进程只有白名单 IPC 方法。
- 文档内容是未受信任的 HTML：DOMPurify 清理后在 `sandbox=""` 的 iframe 中显示，附加禁止脚本、表单和网络脚本来源的 CSP。
- 只允许将匹配 `https://www.yuque.com` 的链接交由系统浏览器打开。
- **只读**：暂不执行内部写接口。上传材料没有包含实际验证过的写请求格式与签名完整上下文，因此不猜测参数，防止污染文档。
- 退出登录只清空本客户端专属的登录 Session；不会改动 Edge/Chrome 原有 Cookie。v0.1.0 的历史 SQLite 草稿不会被迁移或删除。

## 开发

```sh
npm install --no-audit --no-fund
npm run dev
npm test
npm run typecheck
npm run build
```

打包：

```sh
npm run dist:win
npm run dist:mac
```

需要 Node.js 24、当前平台的 Electron 构建依赖。无数字签名的安装包可能被 SmartScreen/Gatekeeper 提醒。

## 接口来源及限制

详见 [docs/internal-api.md](docs/internal-api.md)。目前只支持附件 `API(1).md` 中 **A 级已验证的 9 个 GET 接口**。API 的字段/服务行为可能随语雀升级而发生变化，不能保证 2026 年以后仍持续兼容。

### 开发优先级

- P0：真实账号登录、身份/知识库/目录/文档/搜索/小记联调（需要在本地完成，不提供凭证给 CI）。
- P1：多账号隔离、中文全文搜索性能评估、离线体验、图像和资源地址的兼容性。
- P2：待单独取得**完整、经测试且用户同意**的写入契约后，再开发创建/修改/目录重排；须先做冲突检测和回读验证。

## 测试边界

GitHub Actions 可以验证 TypeScript、纯逻辑单元测试以及 Windows/macOS 打包，但不能替代有真实账号的端到端测试。不要将语雀 Cookie、账号密码或私有文档内容提交到公开仓库。
