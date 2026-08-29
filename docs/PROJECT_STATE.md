# 项目状态与持久化交接

最后更新：2026-08-30

状态版本：6

设计基线：Approved baseline 0.2

这是上下文压缩、换代理和中断后的唯一状态入口。先读根 `AGENTS.md`，再读本文件、`DESIGN.md`、`REQUIREMENTS.md` 和 `ADR-0005`。

## 1. 当前结论

- 产品定位：普通单用户、本地优先 Markdown 编辑器；Typora 风格单画布 + 浏览器式 Tab/历史。
- 运行时技术栈：React 19、TypeScript、CodeMirror 6、Tauri 2、Rust。Node 只用于构建/测试/仓库检查；Ruby 已退出活动工具链。
- 当前代码：已有可启动的 Paper & Ink 桌面壳和经过测试的 CodeMirror source-first 技术 spike；工作区、真实文件打开/保存、Tab/history 和产品 Editor adapter 正在实现。
- 当前设计：baseline 0.2 由 `ADR-0005` 收窄，只保留 Base64 防卡死、截图落盘、原子保存三项实用护栏。
- 旧 Phase 0 的 HMAC/nonce、host smoke、复杂 native safety、193 MiB transport、14 flags 和预冻结 37 命令契约已从主线删除，不得作为未完成任务恢复。
- Hosted CI 不是本地产品开发的阻塞条件；标准门禁是 `pnpm verify`。

## 2. 已实现事实

| 能力 | 状态 | 证据/说明 |
|---|---|---|
| Tauri 2 + React/Vite/Rust desktop shell | DONE | debug app 可构建启动 |
| Paper & Ink 空状态与侧栏/Tab 视觉骨架 | DONE | shell 组件和快照图片 |
| CodeMirror/Lezer source-first feasibility | DONE SPIKE | CJK composition、选择、Undo、装饰增量测试 |
| 精简产品边界 | DONE | `ADR-0005`、baseline 0.2 文档 |
| 活动工具链移除 Ruby | INTEGRATING | Node repository check 替代旧验证器；遗留实验脚本删除 |
| Rust 文件纵向切片 | IN_PROGRESS | chooser/list/open/preflight/save/image 正在独立实现 |
| 前端 DocumentSession/Tab/history | NOT_STARTED | Phase 1 下一项 |
| 产品 Editor adapter | NOT_STARTED | 从 spike 收敛，不直接把 spike 当产品代码 |
| 工作区文件树和真实打开/保存 | NOT_STARTED | 等最小 native adapter 接口 |
| 截图粘贴 | NOT_STARTED | Rust 写入接口后接入 |
| Mermaid viewer | NOT_STARTED | Phase 3 |

## 3. 当前不可变决策

1. Markdown 源码是唯一真相；渲染与 Outline 不参与保存。
2. `DocumentSession != Tab != HistoryEntry`；同文档共享正文，每 Tab 历史/位置独立。
3. 内部链接默认当前 Tab 跳转；`⌘`/中键新后台 Tab，`⌘⇧` 新前台 Tab。
4. 截图先写相邻 `assets/`，成功后才插入相对链接；产品不生成 Base64 Markdown。
5. 大 data-image/病态长行在进入 EditorView 前阻止；约 10 MiB 普通多行文档走 source-only。
6. 保存使用同目录临时文件 + flush + rename；失败保留旧文件。
7. 当前命令当前定义类型，不建设未来接口全集、通用 flags 或安全认证框架。
8. macOS 首发；保持普通 Rust/Tauri 代码的跨平台可移植性，不提前实现三平台差异层。

## 4. 真实语料结论

真实工作文档只做过只读聚合，没有复制、提交或写回：

- 约 79 篇 Markdown、总计约 1.02 MiB；最大单篇约 243 KiB。
- 大量 GFM 表格和约千条本地链接，因此表格可读性、导航、中文输入和零差异保存优先。
- Mermaid 数量较少但现有查看体验很差，因此 viewer 是第一版明确功能。
- 多年使用只出现过一次误粘贴约 10 MiB Base64；只需要低成本防卡死，不需要完整修复系统。

任何实现与测试都不得把真实语料内容或其个人路径带入仓库。

## 5. 当前任务

| Task | Status | Owner | 独占范围 | 出口 |
|---|---|---|---|---|
| `LEAN-DOCS-01` | IN_PROGRESS | Integration | docs、AGENTS、README | baseline 0.2 无旧 F0 阻塞 |
| `LEAN-TOOLING-01` | REVIEW | Integration | package、CI、scripts | Node check；活动路径无 Ruby/旧 contract gate |
| `P1-NATIVE-01` | IN_PROGRESS | Native agent | `src-tauri/**` | chooser/list/open/save/image + Rust tests |
| `P1-STATE-01` | READY | next agent | `src/app/state/**` | sessions/tabs/history reducer + tests |
| `P1-EDITOR-01` | READY after state types | next agent | `src/features/editor/**` | 产品 EditorView adapter + paste guard |
| `P1-INTEGRATE-01` | WAITING | Integration | shell/adapter/root config | 真工作区打开→编辑→保存 |

## 6. 精确下一步

1. 集成 Node tooling 与 Rust native slice，运行完整门禁。
2. 实现并单测 `DocumentSession`、Tab 和 per-tab history reducer。
3. 把 CodeMirror spike 收敛成产品组件，先完成打开、编辑、dirty、保存和大 Base64 paste guard。
4. 将真实工作区、文件树和 Tab 接入现有 Paper & Ink shell。
5. 在隔离的临时示例工作区上启动 Tauri app，人工验证主链路；不操作真实用户目录。

## 7. 最近主线变更

- `54d9ef4`：删除未被产品调用的 host security、transport、native safety 和 feature flag 实验，共约 6.7k 行。
- `a367d98`：删除预生成 37 命令/巨型 IPC schema 与绑定，共约 35.7k 行。
- baseline 0.2：新增 `ADR-0005`，将产品重新聚焦到可运行纵向切片。

## 8. 验证记录

- 删除安全实验后：`cargo check --all-targets --all-features`、`pnpm typecheck`、`pnpm test` 通过（前端 21/21）。
- 删除巨型 IPC 后：相同检查通过；Rust 仅保留可启动 Tauri 壳。
- Node tooling 和 native slice 完成合并后，必须在这里记录一次最新 `pnpm verify` 的准确结果，旧 baseline 0.1 的通过数字不代表当前版本。

## 9. 退役记录

旧 `P0-CI/CONTRACT/FIXTURE/FLAG/HOST-SMOKE/SPIKE-02/TRANSPORT` task notes 与实验代码仅存在于 Git 历史。退役原因不是“实现失败”，而是它们远超普通文本编辑器当前需求。除非用户提出新的具体风险或发布要求且新 ADR 接受，否则后续代理不得恢复。
