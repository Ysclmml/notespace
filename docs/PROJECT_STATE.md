# 项目状态与持久化交接

最后更新：2026-08-30
状态版本：5
设计基线：Approved design baseline 0.1

> 本文件是上下文压缩、换代理和中断后恢复工作的唯一状态入口。聊天记录不是项目状态。任何实现者先按 `AGENTS.md` 的读取链恢复上下文。

## 1. 当前终态

- 当前阶段：**Phase 0 基础壳已集成，第一批契约/CI/夹具/技术 Spike 可并行执行**。
- 应用代码：`P0-BOOT-01` 已建立 Tauri 2 + React/TypeScript/Vite + Rust 桌面壳和 Paper & Ink 合成空状态；尚未实现任何 Phase 1 产品能力。
- 构建与测试：任务分支和全新 clone 均通过格式、lint、类型、前端单测、Rust fmt/clippy/tests、Vite build 与 Tauri debug build；CI 仍由后续独立任务建立。
- 工作区：Git 仓库已建立；`main` 已 fast-forward 集成 `P0-BOOT-01`，已验证 revision `52dc387`。
- 下一个可执行动作：为下表 READY 任务建立各自 task note 与独立 branch/worktree；优先并行 `P0-CONTRACT-01`、`P0-CI-01`、`P0-SPIKE-01`、`P0-SPIKE-02`，`P0-FIXTURE-01` 可由空闲 QA 随后领取。
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
| Phase 0 / F0 | IN_PROGRESS | 应用壳、本地 CI 门禁、Rust 单源 IPC 契约与脱敏夹具已在 `main` 集成并通过；hosted CI、typed flags 与技术 Spike 尚待收口，F0 尚未发布 |
| Phase 1–6 | NOT_STARTED | 严格按 `IMPLEMENTATION_PLAN.md` 的依赖和 Freeze Gate |

实施任务 ledger（claim/交接时只修改自己的一行，详细证据在 task note）：

| Task | Status | Owner / next owner | Base / head | IDs / scope | Task note / exact next action |
|---|---|---|---|---|---|
| `P0-BOOT-01` | DONE | Integration / none | `7f98624` / `52dc387` | `OPS-BUILD-001`、`OPS-CONTEXT-001` / Git baseline + desktop shell | [`P0-BOOT-01.md`](tasks/P0-BOOT-01.md)；主线文档门禁与 `pnpm verify` PASS |
| `P0-CI-01` | REVIEW | Integration/QA / Integration | `576a435` / `2cdc7df` | `OPS-CI-001`、`OPS-BUILD-001`、`OPS-CONTEXT-001` / pinned CI quality gates and artifact build | [`P0-CI-01.md`](tasks/P0-CI-01.md)；本地等价门禁与 artifact PASS；合并后等待首次 GitHub hosted run 补证 |
| `P0-CONTRACT-01` | DONE | Integration / none | merge `9b0ea10` / gate `055084b` | `DATA-REVISION-001`、`SAFE-IPC-001`、`EXT-ROUTER-001`、`EXT-COMMAND-001` / IPC `1.0-draft` Rust single-source contract | [`P0-CONTRACT-01.md`](tasks/P0-CONTRACT-01.md)；独立终审 MERGE；canonical runner 已纳入 root `verify`/CI；main Rust 15/15 + TS 29/29、full verify PASS；`004`–`024` 保持 frozen ports |
| `P0-FLAG-01` | CLAIMED | Application Core (`/root/p0_flag_01`) / same owner | `813da5a` / `813da5a` | `DATA-REVISION-001`、`SAFE-IPC-001`、`EXT-ROUTER-001`、`EXT-COMMAND-001`、`UX-EXT-001` / typed feature registry | [`P0-FLAG-01.md`](tasks/P0-FLAG-01.md)；先重跑基线，再实现 production defaults、test overrides、dependency/capability validation 与脱敏 diagnostics |
| `P0-FIXTURE-01` | DONE | Integration / downstream fixture consumers | implementation `80e434a` / merge `9172a9c` | `DATA-ROUNDTRIP-001`、`DATA-UNKNOWN-001`、`EDIT-IME-001`、`EDIT-TABLE-001` + 09 §4.3 safety/recovery corpus / privacy-safe fixtures | [`P0-FIXTURE-01.md`](tasks/P0-FIXTURE-01.md)；14 manifests、18 committed files、18 runtime artifacts、33 `-text` paths；独立终审 MERGE；fixture/canonical/full main 门禁 PASS |
| `P0-SPIKE-01` | READY | unowned | `52dc387` / — | `EDIT-IME-001`、`EDIT-TABLE-001`、`PERF-LARGE-001` / CodeMirror feasibility | 领取后创建 task note；仅 spike/测量，不实现 Phase 1 编辑器 |
| `P0-SPIKE-02` | READY | unowned | `52dc387` / — | `FILE-PREFLIGHT-001`、`PERF-LARGE-001`、`SAFE-DATAURI-001`、`SAFE-IPC-001` / native safety feasibility | 领取后创建 task note；仅 spike/测量，不实现 Phase 1 file open |

只列出了依赖已满足的第一批任务；`P0-FLAG-01` 必须等待 `P0-CONTRACT-01` 生成初始契约后才能进入 READY。

## 7. 下一步（精确到可执行）

1. 从 `055084b` 集成检查点领取 `P0-FLAG-01`，不改动已生成 IPC 契约。
2. 按固定顺序集成已复审的 fixture、editor spike、native safety 与 real transport；每次保留其他 ledger 行并重跑全门禁。
3. 完成 host release 可信证据修复的独立终审和真实系统拼音/菜单/chooser 人工验证。
4. 获取 GitHub hosted `macos-15` 精确提交的 workflow/artifact 证据；当前无 remote，未获得前不得宣称 `P0-CI-01` DONE。
5. 只有 Phase 0 出口全部满足时由 Integration 发布 F0；F0 之前禁止进入 Phase 1 功能实现。

## 8. 验证记录

- 设计阶段只允许文档静态校验和真实语料只读统计；没有可运行应用，因此未伪报构建、单测或 E2E。
- 2026-08-29 最终运行 `ruby scripts/validate_design_docs.rb` -> `RESULT=PASS`：20 个 Markdown、66 条内部相对链接、81 对 fence、56 条工程需求、41 条 UX 需求/41 条交叉映射、83 个领域 test ID、41 个 AC ID、37 个 IPC command、43 个实施任务；无重复、无未解析引用、无缺失实施追踪。
- 最终设计快照（校验器自身 + 除本状态文件外的全部 Markdown，路径与内容确定性聚合）SHA-256：`7663910ab21fdef1a6deb4f3662652feb69c712bafd3f99bbf541ec6485c23c2`。后续运行同一校验器会直接输出 `design_snapshot_sha256`；不一致即表示规范已变化，必须更新状态/证据后才能宣称基线仍有效。
- 同一命令同时检查未完成状态、已退役契约术语、个人绝对路径、嵌入式 Base64、错误码集合和关键 task-level phase 接棒；本次均无命中。
- 两个独立只读审计从“语义一致性”和“无聊天冷接手”视角复核最终规范，均无剩余 blocker/major。此结论只覆盖设计包，不冒充尚不存在的应用构建、单测或 E2E。
- 2026-08-30 `P0-BOOT-01` 在任务分支和系统临时目录中的全新 clone 均执行 `pnpm verify` 并 PASS；Tauri debug `.app` 通过原生窗口 smoke，未读取或提交用户文档。详细命令与证据见 [`P0-BOOT-01.md`](tasks/P0-BOOT-01.md)。
- 2026-08-30 Integration fast-forward 合并 `P0-BOOT-01` 到 `main` revision `52dc387`；`ruby scripts/validate_design_docs.rb` PASS（snapshot `3be99dea...`），补齐已记录的 Rustup `PATH` 前提后 `pnpm verify` 全部 PASS。
- 2026-08-30 Integration no-ff 合并 `P0-CONTRACT-01` 到 `main` revision `9b0ea10`，并以 `055084b` 把 `contracts/run.mjs` 接入 root `check`/`verify`/CI；design snapshot `a9644030...`、repository hygiene、cargo audit、canonical Rust 15/15 + TS 29/29、full Vitest 32/32 + Rust 17/17、Vite/Tauri debug build 全部 PASS。
- 2026-08-30 Integration no-ff 合并 `P0-FIXTURE-01` 到 `main` revision `9172a9c`，保留 canonical contract gate 并把 `fixtures:check` 接入 root `check`/`verify`/CI；fixture validator（14/18/18/33）、canonical Rust 15/15 + TS 29/29、full Vitest 32/32 + Rust 17/17、Vite/Tauri debug build 全部 PASS。

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
