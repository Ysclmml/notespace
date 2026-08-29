# 项目状态与持久化交接

最后更新：2026-08-29  
状态版本：3  
设计基线：Approved design baseline 0.1

> 本文件是上下文压缩、换代理和中断后恢复工作的唯一状态入口。聊天记录不是项目状态。任何实现者先按 `AGENTS.md` 的读取链恢复上下文。

## 1. 当前终态

- 当前阶段：**设计基线已冻结，实现未开始**。
- 应用代码、依赖、构建、测试与 CI：尚未创建。
- 工作区：当前不是 Git 仓库。
- 下一个可执行任务：用户确认开始实现后，由 Integration 领取 `P0-BOOT-01`；不得跳过 Phase 0 / F0 直接开发功能。
- 基线不等于字段 schema 已冻结：`03-domain-model-and-contracts.md` 的 `1.0-draft` 必须在 `P0-CONTRACT-01` 中生成 Rust/TypeScript 类型、通过契约测试后才能发布 F0。

## 2. 已接受且实现不得自行改动的决策

- `ADR-0001`：Tauri 2 + React/TypeScript/Vite + CodeMirror 6/Lezer + Rust；无服务端。
- `ADR-0002`：source-first；`EditorState.doc` 是编辑期文本唯一真相，渲染为可重建投影。
- `ADR-0003`：`DocumentSession != DocumentView != Tab != NavEntry`；同文档多视图共享正文、隔离历史与视图状态。
- `ADR-0004`：不做通用巨型文件编辑器；Rust 预检把病态内容挡在 WebView 外。
- 普通点击当前 Tab 导航；Primary-click 新后台 Tab；Primary+Shift-click 新前台 Tab；中键新后台 Tab。
- 截图粘贴必须二进制落盘后插入相对链接，产品路径禁止 Base64 Markdown。
- 文件分类顺序与阈值是契约：
  1. 二进制/不支持编码或大于 32 MiB -> `Unsupported`。
  2. 任意物理行大于 1 MiB，或 data image 解码估算大于 512 KiB -> `SafetyBlocked`。
  3. 不大于 8 MiB 且最长行不大于 256 KiB -> `editable/normal`。
  4. 其余不大于 32 MiB 的文本 -> `editable/largeText`。
- P0 表格是“渲染预览 + 精确 pipe 源码退路”；结构化单元格编辑为 P1。Math 为 P1。raw HTML 在 P0 只显示源码。
- P0 只承诺 dirty checkpoint 恢复和有毒资源隔离；完整窗口/Tab/布局恢复为 P1。
- P1 分栏最多两个左右 Pane，不引入递归布局树。Mermaid 查看器保留矢量缩放、平移、Fit 和返回源码。
- `DocumentSession` 只在 editable open/recovery 后建立；loading、SafetyBlocked、Unsupported 和 failed 属于不携带正文的 `DocumentLoadState`。
- 未命名草稿的 DraftId/DocumentId 由 Rust 幂等创建；用户明确“不保存”必须经冻结、revision 校验和 `session_discard_v1` 成功后才能关闭，失败仍保留 dirty UI。
- 原生 open/close 是 Rust-held pending request，不以可丢事件为唯一副本；app reconcile 使用“原子 snapshot 到 S、缓存事件、丢 `<=S`、连续重放 `>S`”算法。checkpoint 不能替代用户的保存/不保存决议。
- Save As 使用 durable `saveAsIntentId` 与 prepare/abort/commit/status/ack journal；commit 响应丢失或崩溃后只能恢复为唯一 committed outcome 或完整 rollback，ack 前保留 recovery/staging alias。
- 系统 reveal 只接受无 raw path 的 `RevealTarget`；工作区根/相对条目、standalone grant 和 asset scope 都由 Rust 重新校验。
- 完整正文 IPC 同时受 32 MiB raw 与 193 MiB 最坏 JSON wire 预算；Phase 0 必须实测，不可行时先用 ADR 改为版本化 chunk/handle transport。

要改变以上任何一项，先更新需求/领域设计并新建 ADR，不得用实现或聊天结论暗中覆盖。

## 3. 文档工作流状态

| Workstream | 规范入口 | 状态 |
|---|---|---|
| 总纲、需求、ADR | `DESIGN.md`、`REQUIREMENTS.md`、`decisions/*` | Approved baseline 0.1 |
| 产品 UX | `design/01-product-ux.md` | Approved baseline 0.1 |
| 系统边界与契约 | `design/02-*`、`design/03-*` | Approved baseline 0.1；F0 冻结 schema |
| 编辑器与导航 | `design/04-*`、`design/05-*` | Approved baseline 0.1 |
| 文件、资产、恢复 | `design/06-*` | Approved baseline 0.1 |
| 性能与安全 | `design/07-*` | Approved baseline 0.1 |
| 扩展、测试与可观测性 | `design/08-*`、`design/09-*` | Approved baseline 0.1 |
| 实施编排与代理规则 | `IMPLEMENTATION_PLAN.md`、`AGENTS.md`、`tasks/TEMPLATE.md` | Approved execution baseline 0.1 |

## 4. 真实语料基线（只读）

真实文档没有被复制或修改，仓库不记录用户绝对路径或正文。截止 2026-08-29 的聚合统计：

- 79 篇 Markdown，1,066,143 bytes，9,507 行；中位文件 7,072 bytes，最大 248,920 bytes。
- 最长物理行 3,277 bytes；未发现 Base64 data image。
- 76/79 包含 GFM 表格，约 279 张表/3,668 行；约 1,106 条链接。
- Mermaid 4 块，Markdown 图片链接 2 条。

因此 P0 优先级是表格、导航、中文 IME 和零差异保存；Mermaid/资产紧随其后；大文件主要是低成本安全护栏。

## 5. 不阻塞 P0 的开放决策

| 决策 | 最迟负责阶段 | 未决前安全默认 |
|---|---|---|
| P1 Math 选 KaTeX 或 MathJax | `P4-MATH-01` 的 ADR | flag off，显示源码 |
| P1 是否提供净化 raw HTML 预览 | 新建安全 ADR | 只显示源码 |
| P1 表格网格交互 | `P6-TABLE-01` | `table.structuredEditing = off` |
| P1 索引存储用内存或 SQLite | `P6-SEARCH-01` 的 ADR | P0 不引入 SQLite |
| Linux 进入首个公开版或只做持续构建 | `P6-PACKAGE-01` 的发布决策 | macOS 首发，Windows/Linux 保持语义可移植 |

上述问题不得阻塞 Phase 0–5 的 P0 工作，也不得由任务代理顺手选型。

## 6. 里程碑与任务状态

| 里程碑 | 状态 | 准入条件 |
|---|---|---|
| Design baseline 0.1 | DONE | 本文档包冻结并通过文档校验 |
| Phase 0 / F0 | IN_PROGRESS | Git 基线 `7f98624` 已建立；`P0-BOOT-01` 正在创建桌面壳 |
| Phase 1–6 | NOT_STARTED | 严格按 `IMPLEMENTATION_PLAN.md` 的依赖和 Freeze Gate |

实施任务 ledger（claim/交接时只修改自己的一行，详细证据在 task note）：

| Task | Status | Owner / next owner | Base / head | IDs / scope | Task note / exact next action |
|---|---|---|---|---|---|
| `P0-BOOT-01` | CLAIMED | Integration / `/root` | `unversioned` / `7f98624` | `OPS-BUILD-001`、`OPS-CONTEXT-001` / Git baseline + desktop shell | [`P0-BOOT-01.md`](tasks/P0-BOOT-01.md)；在 `task/P0-BOOT-01-bootstrap` 创建并验证 Tauri/React/Rust 壳 |

当前只有 `P0-BOOT-01` 为 `CLAIMED`；其余任务必须等待依赖满足后再进入 READY/CLAIMED，不要预建整张空表。

## 7. 下一步（精确到可执行）

1. 获得用户开始实现的指令；设计请求本身不授权创建应用代码。
2. Integration 重读 `AGENTS.md` -> 本文件 -> `DESIGN.md` -> `REQUIREMENTS.md` -> Phase 0 相关 ADR/领域设计。
3. 检查工作树，从 `docs/tasks/TEMPLATE.md` 创建 `docs/tasks/P0-BOOT-01.md`，只把该任务在本文件标为 `CLAIMED`。
4. 执行 `P0-BOOT-01`；先在当前非 Git 目录建立可追踪的设计基线（排除 `.DS_Store`、个人路径和用户语料），再创建桌面壳。该首个检查点落地后才能创建并行 branch/worktree。
5. 只有 Phase 0 出口全部满足时由 Integration 发布 F0；F0 之前禁止进入 Phase 1 功能实现。

## 8. 验证记录

- 设计阶段只允许文档静态校验和真实语料只读统计；没有可运行应用，因此未伪报构建、单测或 E2E。
- 2026-08-29 最终运行 `ruby scripts/validate_design_docs.rb` -> `RESULT=PASS`：20 个 Markdown、66 条内部相对链接、81 对 fence、56 条工程需求、41 条 UX 需求/41 条交叉映射、83 个领域 test ID、41 个 AC ID、37 个 IPC command、43 个实施任务；无重复、无未解析引用、无缺失实施追踪。
- 最终设计快照（校验器自身 + 除本状态文件外的全部 Markdown，路径与内容确定性聚合）SHA-256：`7663910ab21fdef1a6deb4f3662652feb69c712bafd3f99bbf541ec6485c23c2`。后续运行同一校验器会直接输出 `design_snapshot_sha256`；不一致即表示规范已变化，必须更新状态/证据后才能宣称基线仍有效。
- 同一命令同时检查未完成状态、已退役契约术语、个人绝对路径、嵌入式 Base64、错误码集合和关键 task-level phase 接棒；本次均无命中。
- 两个独立只读审计从“语义一致性”和“无聊天冷接手”视角复核最终规范，均无剩余 blocker/major。此结论只覆盖设计包，不冒充尚不存在的应用构建、单测或 E2E。

## 9. 标准任务交接

实施任务必须使用 `docs/tasks/TEMPLATE.md`，并在任务终态时把简要状态镜像到本文件。交接至少包含：

~~~text
Task ID:
Requirement / Product UX / Test IDs:
Status: CLAIMED | BLOCKED | REVIEW | DONE
Owner / next owner:
Base / head revision:
Files changed and owned scope:
Contracts / flags changed:
Exact commands, environment, results and artifact paths:
Decisions and assumptions persisted elsewhere:
Known risks / blockers with owner:
Data safety / recovery / temporary artifacts:
Single exact next action:
~~~

如果任务改变已接受 ADR、版本化契约、安全边界或 P0 范围，不能只写交接；必须同步更新规范、ADR、生成类型与契约测试。
