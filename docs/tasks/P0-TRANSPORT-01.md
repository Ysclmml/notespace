# P0-TRANSPORT-01 — 真实 Tauri 正文 IPC 容量验证

- Status: CLAIMED
- Owner / next owner: Performance/Integration (`/root`) / independent review
- Base revision / head revision: `28e6d8e` / working tree
- Requirement IDs: `SAFE-IPC-001`, `PERF-LARGE-001`
- Product UX IDs: `UX-SAFE-001`
- Test / acceptance IDs: `CONTRACT-024`（Phase 0 transport feasibility evidence only）
- ADRs / contract and schema versions: `ADR-0001`, `ADR-0004`; IPC `1.0-draft`
- Feature flags: none; harness must compile only behind an explicit non-default Cargo feature
- Owned and touched paths: `tests/contract/ipc/contract-024-document-content-budget/**`; a narrow runner under `scripts/**`; dedicated Rust spike module; conditional wiring in `src-tauri/src/lib.rs`; `src-tauri/Cargo.toml`; this task note; only this task's `docs/PROJECT_STATE.md` row

## Goal and non-goals

目标：在真实 macOS Tauri 2/WKWebView IPC custom-protocol 路径中往返 32 MiB UTF-8 正文和 32 MiB、接近 6x JSON escaping 的最坏正文，记录 raw/wire 大小、成功性和耗时；证明测试命令只在显式 spike feature 下存在。若 transport 不可靠，提供 F0 前改用版本化 chunk/handle ADR 的确定证据。

非目标：不实现 Phase 1 gateway、文件打开/保存/checkpoint/recovery handler，不把 `CONTRACT-024` 的全产品行为标为完成，不放宽 32 MiB raw、193 MiB wire 或普通 1 MiB 上限。

## Dependencies and baseline

- Dependency task/freeze status: `P0-BOOT-01` DONE；canonical 32 MiB/193 MiB 预算已批准；`P0-CONTRACT-01` 正在修复且 `CONTRACT-024` 仍是 frozen port，本任务只提供其 Phase 0 真实 transport 可行性证据。
- Baseline commands: repository hygiene self-test/scan；design validator；`pnpm verify`；native shell smoke prerequisites。
- Baseline result: claim `ade2504` PASS；hygiene self-test 4/4、89 tracked files；design snapshot `fe6727f...`；Vitest 3/3、Rust fmt/clippy/tests、Vite 与 Tauri debug build 全通过。

## Acceptance criteria status

| Requirement / acceptance ID | Expected evidence | Status |
|---|---|---|
| `SAFE-IPC-001` / `CONTRACT-024` Phase 0 feasibility | 真实 Tauri/WKWebView 对 32 MiB ordinary 与 worst-escaping 正文双向往返，wire 小于等于 193 MiB，返回字节等同；测试有超时和结构化结果 | IN PROGRESS |
| production isolation | 默认 debug/release build 均不注册或打包测试命令；只有显式 Cargo feature 能启用 harness | IN PROGRESS |
| boundary evidence | 前置预算函数覆盖 raw/wire `-1 / exact / +1`，普通载荷仍受 1 MiB 限制；不得把 sizing 冒充真实 transport | IN PROGRESS |

## Changes made

- 仅建立独立 branch/worktree 与持久任务交接，尚未实现 harness。

## Decisions and assumptions

- 使用已固定的 Tauri 版本和系统 WKWebView；网络、localhost server、mock IPC 或 Rust-only serialization 都不能替代证据。
- harness 可以复用 Tauri 内部注入的 invoke API，但只能位于显式、非默认 spike feature；生产应用入口不导入测试前端模块。
- 每种大载荷在独立进程运行以避免前一轮内存状态污染；结果只含长度、hash/等同性、耗时和错误类别，不记录正文。

## Verification evidence

| Test / acceptance ID | Exact command and environment | Result | Artifact or failure |
|---|---|---|---|
| claim baseline | `pnpm install --frozen-lockfile`; hygiene self-test/scan；design validator；`pnpm verify`；macOS arm64 | PASS | Vitest 3/3；Rust fmt/clippy/tests；Vite/Tauri debug build；无 tracked lockfile diff |

## Open questions and blockers

- 若任一真实 32 MiB round-trip 超时、WebContent process 终止、数据不一致或最坏 wire 超过预算，本任务必须保持 BLOCKED，并由 Integration 在 F0 前发起 chunk/handle transport ADR；不得降低到 1 MiB 后声称通过。

## Remaining numbered steps

1. 实现 feature-gated native command、on-page-load JS harness 和有超时的外部 runner。
2. 运行 ordinary/worst-escaping 多次独立进程实测，以及默认构建无测试 surface 的断言。
3. 独立复核结果；可靠则进入 REVIEW，不可靠则记录 BLOCKED 与 ADR 输入。

## Data safety, recovery, and temporary artifacts

- 载荷由内存确定性生成，不读取用户文档，不写入 Git，不在日志输出正文。
- 结构化结果写入 runner 创建的系统临时目录并在验证后清理；超时必须终止且只针对本 runner 启动的精确进程。

## Single recommended next action

实现只在显式 Cargo feature 下可用的真实 Tauri/WKWebView round-trip harness。
