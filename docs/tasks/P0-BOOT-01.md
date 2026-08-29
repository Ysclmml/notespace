# P0-BOOT-01 — Git 基线与桌面应用壳

- Status: CLAIMED
- Owner / next owner: Integration (`/root`) / Integration review
- Base revision / head revision: `unversioned` / `7f98624`（privacy-safe baseline checkpoint）
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
- Baseline result: 领取前设计门禁 `RESULT=PASS`，`design_snapshot_sha256=7663910ab21fdef1a6deb4f3662652feb69c712bafd3f99bbf541ec6485c23c2`；已建立唯一根提交 `7f98624` 并切换到 `task/P0-BOOT-01-bootstrap`。创建 task note 后校验仍为 PASS（21 Markdown；snapshot `f967d73f...`）；哈希变化来自被校验器纳入的执行元数据，不代表批准设计正文发生变化。

## Acceptance criteria status

| Requirement / acceptance ID | Expected evidence | Status |
|---|---|---|
| `OPS-CONTEXT-001` / `PROC-001` | 冷接手只依赖仓库即可识别当前任务、限制与下一步；task note 和状态账本一致 | IN PROGRESS |
| `OPS-BUILD-001` / `BUILD-001` | 干净 checkout 使用仓库锁定工具和单一命令构建、启动 Tauri 壳 | NOT STARTED |

## Changes made

- 已按规定读取 durable context chain，并记录领取状态。
- 已创建 privacy-safe `.gitignore` 与根提交 `7f98624`；`.DS_Store`、本机状态和用户语料均未进入当前 Git 历史。
- 含截图衍生内部名称的原型 PNG 仅保留为本机 ignored 参考，不是 clean-checkout 规范或构建输入。
- 已核验 macOS desktop 只需现有 Command Line Tools；安装 Rust `1.98.0` minimal toolchain，并补齐 `rustfmt` / `clippy`，未修改用户 shell 配置。

## Decisions and assumptions

- 视觉壳使用脱敏的 Paper & Ink 约束：暖白画布、石墨正文、克制钴蓝、紧凑浏览器式顶部栏、文件/大纲侧栏和单画布主体；只交付不会误导为完整产品的合成空状态。
- 依赖采用 create-tauri-app `4.6.2` 的 React/TypeScript 兼容组合并写入双 lockfile；不安装 CodeMirror、Mermaid 或产品能力依赖。
- bundle identifier 固定为 `app.markdownworkspace.desktop`；显示名仍为项目暂名 `Markdown Workspace`。
- 官方模板的 `greet` IPC、opener plugin 和 `csp: null` 不进入本项目；P0 壳不直接 invoke，capability 保持最小，生产 CSP 默认拒绝远程执行与网络连接。

## Verification evidence

| Test / acceptance ID | Exact command and environment | Result | Artifact or failure |
|---|---|---|---|
| `PROC-001` baseline | `ruby scripts/validate_design_docs.rb`；macOS / repository root | PASS；20 Markdown、56 requirements、83 tests、snapshot 一致 | stdout；无持久化用户数据 |
| `PROC-001` privacy checkpoint | `git status --short --ignored`; `git log -1 --oneline` | PASS；HEAD `7f98624`，仅 `.DS_Store` 与本机原型目录 ignored | 本地 stdout；原型没有进入当前 Git 历史 |
| `BUILD-001` toolchain preflight | Node `24.14.0`; pnpm `10.32.1`; rustc/cargo `1.98.0`; Apple clang `21.0.0`; macOS arm64 | PASS；desktop prerequisites available | 完整 Xcode 与签名 identity 属于 P6，不阻塞桌面壳 |

## Open questions and blockers

- 当前无产品、架构或工具链 blocker。
- 设计 snapshot 目前包含 `docs/tasks/**`，因此任务元数据会改变所谓 design hash；本任务只记录该已知流程缺口，长期修复由 Design/Integration 单独收束，不暗改 validator 范围。

## Remaining numbered steps

1. 创建符合架构目录的最小 Tauri/React/Rust 壳与合成 Paper & Ink 空状态。
2. 增加固定开发、检查、测试和构建命令，提交 lockfile 与工具链版本。
3. 在当前工作树和干净 clone 执行 `BUILD-001`，并完成桌面窗口 smoke。
4. 记录 head revision、验证证据与下一任务，交给 Integration review。

## Data safety, recovery, and temporary artifacts

- 禁止提交 `.DS_Store`、真实用户文档、个人绝对路径、恢复数据、剪贴板内容和大 Base64 fixture。
- 脚手架临时文件必须限定在仓库或显式 `mktemp` 目录；失败时保留可诊断的依赖/构建摘要，不记录正文。

## Single recommended next action

从临时官方 scaffold 选择性导入最小文件，删除示例 IPC/opener，并实现合成 Paper & Ink 桌面壳。
