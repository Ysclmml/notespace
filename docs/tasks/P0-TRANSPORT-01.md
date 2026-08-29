# P0-TRANSPORT-01 — 真实 Tauri 正文 IPC 容量验证

- Status: REVIEW
- Owner / next owner: Performance/Integration (`/root`) / independent reviewer
- Base revision / head revision: `28e6d8e` / `e07efb8`
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
| `SAFE-IPC-001` / `CONTRACT-024` Phase 0 feasibility | 真实 Tauri/WKWebView 对 32 MiB ordinary 与 worst-escaping 正文双向往返，wire 小于等于 193 MiB，返回字节等同；测试有超时和结构化结果 | PASS；每种场景 3 个独立进程 |
| production isolation | 默认 debug/release build 均不注册或打包测试命令；只有显式 Cargo feature 能启用 harness | PASS；默认二进制 marker 扫描无测试 surface |
| boundary evidence | 前置预算函数覆盖 raw/wire `-1 / exact / +1`，普通载荷仍受 1 MiB 限制；不得把 sizing 冒充真实 transport | PASS；Rust 2/2，并有真实 transport 证据 |

## Changes made

- 增加非默认 `ipc-transport-spike` Cargo feature；测试命令、page-load harness 和 WebContent process 终止报告只在 macOS + 显式 feature 下编译。
- JavaScript 在页面内确定性生成 32 MiB 载荷，包装 `fetch` 响应读取并观测 Tauri 精确 fallback warning；只有 IPC custom-protocol 请求、响应解析、内容等同同时成立才报 PASS。
- Ruby runner 先证明默认 debug/release 二进制不含 spike marker，再构建 feature release；每场景运行 3 个独立进程，180 s 超时只终止 runner 启动的进程组。
- 结果用 `create_new` 写入系统私有临时目录，runner 严格校验 JSON shape/预算/传输标记，临时文件离开运行块后删除，日志不包含正文。

## Decisions and assumptions

- 使用已固定的 Tauri 版本和系统 WKWebView；网络、localhost server、mock IPC 或 Rust-only serialization 都不能替代证据。
- harness 可以复用 Tauri 内部注入的 invoke API，但只能位于显式、非默认 spike feature；生产应用入口不导入测试前端模块。
- 每种大载荷在独立进程运行以避免前一轮内存状态污染；结果只含长度、等同性、耗时和错误类别，不记录正文。
- Tauri/Wry 在 WKWebView 中将 `window.ipc` 定义为 frozen/non-configurable，因此不伪造可替换的 fallback trap；证据改为同时观测 IPC URL fetch 成功、response body 解析成功和无 Tauri fallback warning，任一观测不可用均 fail closed。

## Verification evidence

| Test / acceptance ID | Exact command and environment | Result | Artifact or failure |
|---|---|---|---|
| claim baseline | `pnpm install --frozen-lockfile`; hygiene self-test/scan；design validator；`pnpm verify`；macOS arm64 | PASS | Vitest 3/3；Rust fmt/clippy/tests；Vite/Tauri debug build；无 tracked lockfile diff |
| `CONTRACT-024` real transport | `ruby scripts/run_tauri_ipc_transport_spike.rb`；macOS 26.6.2 arm64，Tauri 2.11.5/WKWebView，Rust 1.98.0，Node 24.14.0，pnpm 10.32.1 | PASS | default debug/release isolation PASS；ordinary 3/3；worst-escaping 3/3；每进程仅 1 round-trip |
| ordinary measurement | 同上；32 MiB `x` 正文 | PASS | request `33,554,446` bytes，response `33,554,434` bytes；`136/124/122 ms`，median `124 ms`，max `136 ms` |
| worst-escaping measurement | 同上；32 MiB NUL 正文，JSON 6x escaping | PASS | request `201,326,606` bytes，response `201,326,594` bytes；`878/872/872 ms`，median `872 ms`，max `878 ms` |
| boundary unit tests | `cargo test --all-targets --all-features` via `pnpm verify` | PASS | Rust 2/2；32 MiB raw、193 MiB wire、1 MiB default 的 `-1/exact/+1` 语义 |
| repository quality gate | hygiene self-test/scan；design validator；Ruby syntax；`pnpm verify`，Cargo 工具链目录显式加入当次命令环境 | PASS | format/lint/typecheck；Vitest 3/3；Rust fmt/clippy/tests；Vite；Tauri debug build |

## Open questions and blockers

- 当前 macOS arm64 的 3+3 进程全部通过，因此本机 F0 不被 chunk/handle ADR 阻塞；这是可行性证据，不是跨 macOS/Windows/Linux 的长期稳定性保证。
- 193 MiB 预算只留约 1 MiB 余量；后续若调整 command envelope、Tauri/Wry 版本、serializer 或正文 schema，必须重跑本 harness，不能沿用本次结论。
- Windows WebView2 与 Linux WebKitGTK 仍需各自的 transport evidence；P0 macOS 首发不因此阻塞。

## Remaining numbered steps

1. 独立复核 feature isolation、fallback 观测和 runner 超时/清理边界。
2. 在独立复核环境再运行 `ruby scripts/run_tauri_ipc_transport_spike.rb`与 `pnpm verify`。
3. 复核 MERGE 后由 Integration 合并，并把这份实测作为 `P0-CONTRACT-01`/F0 发布的 `CONTRACT-024` transport 证据；不要把其他产品行为标为完成。

## Data safety, recovery, and temporary artifacts

- 载荷由内存确定性生成，不读取用户文档，不写入 Git，不在日志输出正文。
- 结构化结果写入 runner 创建的系统临时目录并在验证后清理；超时必须终止且只针对本 runner 启动的精确进程。

## Single recommended next action

独立复核 branch `task/P0-TRANSPORT-01-tauri-ipc` 的 `e07efb8`，重跑真实 transport runner 与全门禁；给出 MERGE/NO-MERGE。
