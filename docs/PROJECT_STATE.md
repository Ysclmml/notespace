# 项目状态与持久化交接

最后更新：2026-08-30

状态版本：7

设计基线：Approved baseline 0.2

这是上下文压缩、换代理和中断后的唯一状态入口。先读根 `AGENTS.md`，再读本文件、`DESIGN.md`、`REQUIREMENTS.md` 和 `ADR-0005`。

## 1. 当前结论

- 产品定位：普通单用户、本地优先 Markdown 编辑器；Typora 风格单画布 + 浏览器式 Tab/历史。
- 运行时技术栈：React 19、TypeScript、CodeMirror 6、Tauri 2、Rust。Node 只用于构建、测试和轻量仓库检查；Ruby 已从活动代码和工具链移除。
- 基本纵向切片已连通：工作区选择/文件树 → 打开 Markdown → 单画布编辑 → dirty 状态 → `⌘S` 原子保存。
- 浏览器式基础链路已实现：Tab、每 Tab back/forward、内部 Markdown 链接解析、快速打开、文件树和 Outline 点击定位。精确的 back/forward 滚动/选区恢复尚未连到 EditorView。
- 截图粘贴自动化链路已实现：前端只识别粘贴中有图片，Rust 直接读取系统剪贴板、写入文档相邻 `assets/`，成功后前端才插入相对链接。真实 macOS 剪贴板仍需人工 smoke。
- 设计只保留三项实用护栏：大 Base64/data-image 预检、截图先落盘后插链接、同目录原子保存。不得恢复通用安全平台、巨型 IPC 契约或 feature flag 框架。
- Mermaid 文内渲染与沉浸查看器尚未实现。

## 2. 已实现事实

| 能力                                          | 状态             | 证据/说明                                                                                                         |
| --------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| Tauri 2 + React/Vite/Rust desktop shell       | DONE             | debug app 可构建                                                                                                  |
| Paper & Ink 应用壳、文件树、Tab Rail、Outline | DONE             | shell 已接入真实 adapter 与浏览器 demo adapter；Outline 可点击定位                                                |
| Ruby 移除                                     | DONE             | Node `scripts/check_repository.mjs` 负责轻量仓库检查；活动路径无 Ruby                                             |
| Rust 本地文件纵向切片                         | DONE             | `pick_workspace` / `list_workspace` / `open_document` / `save_document` / `save_clipboard_image`；11 个 Rust 测试 |
| DocumentSession / Tab / HistoryEntry reducer  | DONE             | 同文档共享正文，每 Tab 历史独立；5 个 reducer 测试                                                                |
| 产品 MarkdownEditor adapter                   | DONE             | CodeMirror 6/Lezer、source-first、source-only、CJK/Undo/选择回归、大 Base64 paste guard                           |
| 工作区打开→编辑→保存                          | DONE (automated) | shell 集成及 adapter/Rust 测试覆盖；待真实 Tauri 人工 smoke                                                       |
| 内部链接、Tab、back/forward、Quick Open       | BASIC DONE       | 文档级导航可用；精确 view-state 恢复待完成                                                                        |
| 截图落盘后插入相对链接                        | DONE (automated) | Rust 生成 PNG；成功/失败前端行为有测试；待系统剪贴板人工 smoke                                                    |
| 大文件预检与 source-only                      | DONE             | 64 KiB 固定缓冲；10 MiB 普通多行文档和 blocked 无正文有 Rust 测试                                                 |
| Mermaid 预览/沉浸查看器                       | NOT_STARTED      | 下一产品功能                                                                                                      |

## 3. 当前不可变决策

1. Markdown 源码是唯一真相；渲染与 Outline 不参与保存。
2. `DocumentSession != Tab != HistoryEntry`；同文档共享正文，每 Tab 历史/位置独立。
3. 内部链接默认当前 Tab 跳转；`⌘`/中键新后台 Tab，`⌘⇧` 新前台 Tab。
4. 截图先写相邻 `assets/`，成功后才插入相对链接；产品不生成 Base64 Markdown。
5. 大 data-image/病态长行在进入 EditorView 前阻止；约 10 MiB 普通多行文档走 source-only。
6. 保存使用同目录临时文件 + flush/sync + rename；失败保留旧文件。
7. 当前命令当前定义类型，不建设未来接口全集、通用 flags 或安全认证框架。
8. macOS 首发；保持普通 Rust/Tauri 代码的跨平台可移植性，不提前实现三平台差异层。

## 4. 真实语料结论

真实工作文档只做过只读聚合，没有复制、提交或写回：

- 约 79 篇 Markdown、总计约 1.02 MiB；最大单篇约 243 KiB。
- 大量 GFM 表格和约千条本地链接，因此表格可读性、导航、中文输入和零差异保存优先。
- Mermaid 数量较少但现有查看体验很差，因此 viewer 是第一版明确功能。
- 多年使用只出现过一次误粘贴约 10 MiB Base64；只需要低成本防卡死，不需要完整修复系统。

任何实现与测试都不得把真实语料内容或其个人路径带入仓库。

## 5. 当前工作包

| 工作包                                  | 状态             | 说明                                     |
| --------------------------------------- | ---------------- | ---------------------------------------- |
| 精简文档与 Node tooling                 | DONE             | baseline 0.2；无 Ruby/旧 contract gate   |
| Rust 文件纵向切片                       | DONE             | 5 个当前 Tauri 命令 + 11 个测试          |
| Session/Tab/history 状态                | DONE             | reducer + selectors + 5 个测试           |
| 产品 Editor、Workspace UI 与 shell 集成 | DONE (automated) | 前端总计 40 个测试                       |
| 真实 Tauri 主链路人工 smoke             | READY            | 必须只用临时示例工作区                   |
| 精确 anchor/滚动/选区恢复               | READY            | reducer 已存 view，EditorView 接线未完成 |
| Mermaid 预览与沉浸查看器                | READY            | 尚无实现                                 |

## 6. 唯一下一步

在隔离的临时示例工作区启动真实 Tauri app，人工验证“选择工作区 → 打开 → 编辑 → 保存 → 粘贴系统剪贴板截图”。不操作真实用户文档；验收结果写回本文件后，再实现 Mermaid 查看器。

## 7. 最近主线变更

- `54d9ef4`：删除未被产品调用的 host security、transport、native safety 和 feature flag 实验。
- `a367d98`：删除预生成 37 命令/巨型 IPC schema 与绑定。
- `151de32`：确立 baseline 0.2 和 `ADR-0005`，Ruby 工具链退役。
- `54ef34e`：增加产品 MarkdownEditor adapter。
- `82e8957`：增加精简 Rust 本地文档后端。
- `6d036ac`：增加 Tauri/demo desktop adapter。
- `ce36eda`：增加 Session/Tab/history reducer。
- 当前未提交集成层：工作区/大纲、内部链接、Paper & Ink shell 与截图粘贴接线。

## 8. 验证记录

- 当前完整集成门禁：`pnpm verify` 通过；前端 40/40、Rust 11/11，并通过仓库检查、format、lint、typecheck、Web build 与 Tauri debug no-bundle build。
- 浏览器演示模式已人工点测文内原地跳转、back/forward、`⌘`/中键后台 Tab、Quick Open 与 Outline 定位；浏览器控制台无错误。

## 9. 退役记录

旧 `P0-CI/CONTRACT/FIXTURE/FLAG/HOST-SMOKE/SPIKE-02/TRANSPORT` task notes 与实验代码仅存在于 Git 历史。退役原因不是“实现失败”，而是它们远超普通文本编辑器当前需求。除非用户提出新的具体风险或发布要求且新 ADR 接受，否则后续代理不得恢复。
