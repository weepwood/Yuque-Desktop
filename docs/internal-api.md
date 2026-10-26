# 语雀内部 API：只读契约（2026-10-26）

> 来源为项目使用者提供的 API 实测文档；此文件刻意**省略账号身份、会话 Cookie、示例私密资源 ID 和正文**。内部接口非公开且可能变更。

| 功能 | 方法与路径 | 数据 |
| --- | --- | --- |
| 当前用户 | `GET /api/mine` | `data` |
| 团队 | `GET /api/mine/groups` | `data` |
| 我的知识库 | `GET /api/mine/books` | `data` |
| 目录树 | `GET /api/catalog_nodes?book_id=ID` | `data`（扁平数组） |
| 文档详情 | `GET /api/docs/ID?book_id=ID` | `data` |
| 搜索 | `GET /api/zsearch?q=Q&type=doc` | `data` |
| 小记列表 | `GET /api/modules/note/notes/NoteController/index?offset=0&q=&filter_type=all&status=0&merge_dynamic_data=0&order=content_updated_at&with_pinned_notes=true&limit=20` | 裸对象 |
| 小记详情 | `GET /api/modules/note/notes/NoteController/show?id=ID&merge_dynamic_data=0` | 裸对象 |
| 小记标签 | `GET /api/modules/note/tags/TagController/index` | `data` |

关键约束：

1. GET 只使用 Electron 登录 Session 的 Cookie；`_yuque_session` 不得暴露给 Vue。
2. `/api/docs/:id` 必须带 `book_id`，否则可能返回 404。
3. `/api/zsearch` 必须带 `type=doc`，总数可能封顶 5000。
4. 小记列表/详情不套 `data`，不能统一用 `payload.data` 取值。
5. 目录是扁平数组，按 `parent_uuid`、`uuid` 还原。
6. 文档 `content` 是 Lake 串，读预览可展示，但不保证无损转成 Markdown。
7. 某些接口在本地或部分会员/团队权限下可能失败；对 HTTP 401/403 不允许静默使用旧缓存伪装仍登录。
8. 内部写接口需要 CSRF、正文签名、版本冲突处理。本版不实现，也不依赖未提供的 `02-auth.md` 或 `03-api-catalog.md` 进行猜测。

参考：Electron [Session](https://www.electronjs.org/docs/latest/api/session) 和 Chromium Cookie 存储。
