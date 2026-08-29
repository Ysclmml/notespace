# P0-BOOT-01 — Git 基线与桌面应用壳

- Status: CLAIMED
- Owner / next owner: Integration (`/root`) / Integration review
- Base revision / head revision: `unversioned` / —
- Requirement IDs: `OPS-BUILD-001`, `OPS-CONTEXT-001`
- Product UX IDs: 纯基础设施任务，不适用
- Test / acceptance IDs: `BUILD-001`, `PROC-001`
- ADRs / contract and schema versions: `ADR-0001`; IPC schema 尚未进入 `P0-CONTRACT-01`
- Feature flags: 无；本任务不启用产品功能
- Owned and touched paths: `.gitignore`; root manifests/lockfiles/build config; `src/**` 的最小 bootstrap/shell；`src-tauri/**` 的最小 Tauri 壳；本任务 note；`PROJECT_STATE.md` 的本任务行

## Goal and non-goals

目标：建立隐私安全、可复现的 Git 基线，并按 `ADR-0001` 创建 Tauri 2 + React/TypeScript/Vite + Rust 的最小桌面应用壳，使固定命令可以完成格式检查、类型检查、测试、Rust 检查、生产构建和桌面启动。

非目标：不实现 IPC v1 领域 schema、文件打开/保存、CodeMirror 编辑器、Tab/历史、图片粘贴、Mermaid 或 Phase 1 之后的产品行为；这些能力必须等待对应任务与 Freeze Gate。

## Dependencies and baseline

- Dependency task/freeze status: Approved design baseline 0.1 已标记 `DONE`；用户已明确授权开始实现。
- Baseline commands: `ruby scripts/validate_design_docs.rb`; `git status --short --branch`。
- Baseline result: 文档门禁 `RESULT=PASS`，`design_snapshot_sha256=7663910ab21fdef1a6deb4f3662652feb69c712bafd3f99bbf541ec6485c23c2`；目录尚不是 Git 仓库，符合首个 checkpoint 的 `unversioned` 例外。

## Acceptance criteria status

| Requirement / acceptance ID | Expected evidence | Status |
|---|---|---|
| `OPS-CONTEXT-001` / `PROC-001` | 冷接手只依赖仓库即可识别当前任务、限制与下一步；task note 和状态账本一致 | IN PROGRESS |
| `OPS-BUILD-001` / `BUILD-001` | 干净 checkout 使用仓库锁定工具和单一命令构建、启动 Tauri 壳 | NOT STARTED |

## Changes made

- 已按规定读取 durable context chain，并记录领取状态。

## Decisions and assumptions

- 视觉壳遵循 `docs/prototypes/markdown-workspace-main-v1.png` 的 Paper & Ink 方向，但本任务只交付不会误导为完整产品的最小壳。
- 依赖版本以实施时的 Tauri 2 官方稳定工具链核验结果为准并写入 lockfile；不在本任务中新增架构依赖。

## Verification evidence

| Test / acceptance ID | Exact command and environment | Result | Artifact or failure |
|---|---|---|---|
| `PROC-001` baseline | `ruby scripts/validate_design_docs.rb`；macOS / repository root | PASS；20 Markdown、56 requirements、83 tests、snapshot 一致 | stdout；无持久化用户数据 |

## Open questions and blockers

- 当前无产品或架构 blocker；工具链预检结果落地后记录锁定版本。

## Remaining numbered steps

1. 创建 privacy-safe `.gitignore`，初始化 Git，提交经验证的设计基线。
2. 核验本机 Node/Rust/Tauri 2 工具链和官方脚手架参数。
3. 创建符合架构目录的最小 Tauri/React/Rust 壳与 Paper & Ink 占位界面。
4. 增加固定开发、检查、测试和构建命令并执行 `BUILD-001`。
5. 记录 head revision、验证证据与下一任务，交给 Integration review。

## Data safety, recovery, and temporary artifacts

- 禁止提交 `.DS_Store`、真实用户文档、个人绝对路径、恢复数据、剪贴板内容和大 Base64 fixture。
- 脚手架临时文件必须限定在仓库或显式 `mktemp` 目录；失败时保留可诊断的依赖/构建摘要，不记录正文。

## Single recommended next action

创建 `.gitignore`，重新运行文档校验后初始化 Git 并提交 approved design baseline。
