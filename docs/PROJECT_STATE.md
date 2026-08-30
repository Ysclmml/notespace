# 项目状态与持久化交接

最后更新：2026-08-30

状态版本：8

设计基线：Approved baseline 0.2

这是上下文压缩、换代理和中断后的唯一状态入口。先读根 `AGENTS.md`，再读本文件、`DESIGN.md`、`REQUIREMENTS.md` 和 `ADR-0005`。

## 1. 当前结论

- 产品定位：普通单用户、本地优先 Markdown 编辑器；Typora 风格单画布 + 浏览器式 Tab/历史。
- 运行时技术栈：React 19、TypeScript、CodeMirror 6、Tauri 2、Rust。Node 只用于构建、测试和轻量仓库检查；Ruby 已从活动代码和工具链移除。
- 基本纵向切片已连通：工作区选择/文件树 → 打开 Markdown → 单画布编辑 → dirty 状态 → `⌘S` 原子保存。
- 浏览器式链路已实现：Tab、每 Tab back/forward、内部 Markdown 链接、heading anchor、快速打开、文件树和 Outline；历史项的滚动与选区已接入 EditorView。
- 截图粘贴自动化链路已实现：前端只识别粘贴中有图片，Rust 直接读取系统剪贴板、写入文档相邻 `assets/`，成功后前端才插入相对链接。真实 macOS 剪贴板仍需人工 smoke。
- 设计只保留三项实用护栏：大 Base64/data-image 预检、截图先落盘后插链接、同目录原子保存。不得恢复通用安全平台、巨型 IPC 契约或 feature flag 框架。
- 产品编辑器已使用真正的 live preview：标题、强调、引用、列表/任务、代码、GFM 表格、图片和 Mermaid 在非活动状态直接呈现，点击对应块回到精确源码。
- Mermaid 与图片查看器已实现滚轮缩放、拖拽平移、Fit、100%、快捷键和关闭后焦点恢复。

## 2. 已实现事实

| 能力                                          | 状态             | 证据/说明                                                                                                         |
| --------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| Tauri 2 + React/Vite/Rust desktop shell       | DONE             | debug app 可构建                                                                                                  |
| Paper & Ink 应用壳、文件树、Tab Rail、Outline | DONE             | shell 已接入真实 adapter 与浏览器 demo adapter；Outline 可点击定位                                                |
| Ruby 移除                                     | DONE             | Node `scripts/check_repository.mjs` 负责轻量仓库检查；活动路径无 Ruby                                             |
| Rust 本地文件纵向切片                         | DONE             | `pick_workspace` / `list_workspace` / `open_document` / `save_document` / `save_clipboard_image`；11 个 Rust 测试 |
| DocumentSession / Tab / HistoryEntry reducer  | DONE             | 同文档共享正文，每 Tab 历史独立；5 个 reducer 测试                                                                |
| 产品 MarkdownEditor adapter                   | DONE             | CodeMirror 6/Lezer、source-first live preview、source-only、CJK/Undo/选择回归、大 Base64 paste guard              |
| 工作区打开→编辑→保存                          | DONE (automated) | shell 集成及 adapter/Rust 测试覆盖；待真实 Tauri 人工 smoke                                                       |
| 内部链接、Tab、back/forward、Quick Open       | DONE             | heading anchor、重复 slug、滚动和选区恢复已接线并测试                                                             |
| 截图落盘后插入相对链接                        | DONE (automated) | Rust 生成 PNG；成功/失败前端行为有测试；待系统剪贴板人工 smoke                                                    |
| 大文件预检与 source-only                      | DONE             | 64 KiB 固定缓冲；10 MiB 普通多行文档和 blocked 无正文有 Rust 测试                                                 |
| GFM 表格与代码块阅读态                        | DONE             | 非活动块以真实 table/code card 呈现，点击后显示未改写源码                                                         |
| Mermaid/图片预览与沉浸查看器                  | DONE             | Mermaid 按需加载；文内预览；zoom/pan/Fit/100%/Esc；本地图片走 Tauri asset protocol                                |

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

| 工作包                                  | 状态             | 说明                                              |
| --------------------------------------- | ---------------- | ------------------------------------------------- |
| 精简文档与 Node tooling                 | DONE             | baseline 0.2；无 Ruby/旧 contract gate            |
| Rust 文件纵向切片                       | DONE             | 5 个当前 Tauri 命令 + 11 个测试                   |
| Session/Tab/history 状态                | DONE             | reducer + selectors + 5 个测试                    |
| 产品 Editor、Workspace UI 与 shell 集成 | DONE (automated) | 前端总计 51 个测试                                |
| live preview、表格、Mermaid 与 viewer   | DONE             | 自动测试 + 浏览器视觉/交互点测                    |
| 精确 anchor/滚动/选区恢复               | DONE             | reducer、DOM EditorView 和 heading slug 测试      |
| 真实 Tauri 主链路人工 smoke             | BLOCKED BY LOCK  | `.app` 已构建；Computer Use 被当前 macOS 锁屏拦截 |

## 6. 唯一下一步

Mac 解锁后，在隔离临时工作区补跑真实 `.app` smoke：“选择工作区 → 打开 → live preview → 编辑/保存 → 本地图片 → Mermaid viewer → back/forward”。之后按实际使用反馈决定是否进入 Phase 4 的外部修改提示、最近工作区和原生菜单；不得把这些扩展误报为当前渲染修复的阻塞项。

## 7. 最近主线变更

- `54d9ef4`：删除未被产品调用的 host security、transport、native safety 和 feature flag 实验。
- `a367d98`：删除预生成 37 命令/巨型 IPC schema 与绑定。
- `151de32`：确立 baseline 0.2 和 `ADR-0005`，Ruby 工具链退役。
- `54ef34e`：增加产品 MarkdownEditor adapter。
- `82e8957`：增加精简 Rust 本地文档后端。
- `6d036ac`：增加 Tauri/demo desktop adapter。
- `ce36eda`：增加 Session/Tab/history reducer。
- `20befcc`：连通 Paper & Ink shell、工作区/大纲、内部链接、截图粘贴与基础导航。
- 本次渲染升级：交付产品 live preview、GFM 表格/代码块、Mermaid/图片 viewer、heading anchor 与 view-state 恢复。

## 8. 验证记录

- 当前自动化：前端 51/51、Rust 11/11；仓库检查、format、lint、typecheck、Web production build、Rust fmt/clippy/test 和 Tauri debug build 均通过。
- 浏览器演示模式已视觉点测 live preview、真实 GFM table、文内链接原地跳转、Mermaid 文内 SVG、viewer 放大/关闭和源码退路。
- macOS debug app 已重新打包；真实 UI smoke 尝试时系统返回“Mac is locked”，因此没有伪造人工验收结论。

## 9. 退役记录

旧 `P0-CI/CONTRACT/FIXTURE/FLAG/HOST-SMOKE/SPIKE-02/TRANSPORT` task notes 与实验代码仅存在于 Git 历史。退役原因不是“实现失败”，而是它们远超普通文本编辑器当前需求。除非用户提出新的具体风险或发布要求且新 ADR 接受，否则后续代理不得恢复。
