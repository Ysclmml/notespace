# P0-FIXTURE-01 — 脱敏 Markdown 与病态输入语料

- Status: CLAIMED
- Owner / next owner: QA (`/root`) / Integration review
- Base revision / head revision: `28e6d8e` / working tree
- Requirement IDs: `DATA-ROUNDTRIP-001`, `DATA-UNKNOWN-001`, `EDIT-IME-001`, `EDIT-TABLE-001`
- Product UX IDs: fixture 基础设施任务，不直接关闭产品 UX
- Test / acceptance IDs: `RT-001`, `RT-002`, `IME-001`, `TABLE-001`
- ADRs / contract and schema versions: `ADR-0002`, `ADR-0004`; fixture manifest version 1
- Feature flags: 无
- Owned and touched paths: `tests/fixtures/**`; `tools/generate_fixtures.rb`; `scripts/validate_fixtures.rb`; 本 task note；`PROJECT_STATE.md` 的 `P0-FIXTURE-01` 行

## Goal and non-goals

目标：建立脱敏、可追踪、确定性的 Markdown fixture 体系，覆盖 canonical/GFM、CJK/IME、表格、重复标题和相对链接、图片、Math、Mermaid、未知语法、外部修改，以及运行时生成的 invalid UTF-8、10 MiB 普通文本、超大 Base64/单行和真实形状 79 文件工作区；每个 fixture 带 manifest，危险语料只写入临时目录并校验 hash。

非目标：本任务只提供 fixture 与验证工具，不声称已完成 open/save round-trip、IME、表格预览或大文件产品验收；这些 ID 仍由后续真实应用任务执行。

## Dependencies and baseline

- Dependency task/freeze status: 产品设计基线已批准；`P0-BOOT-01` DONE；本任务不依赖 F0 schema。
- Baseline commands: `pnpm install --frozen-lockfile`; repository hygiene self-test/scan；`ruby scripts/validate_design_docs.rb`; `pnpm verify`。
- Baseline result: base `28e6d8e` PASS；hygiene 88 tracked files；design snapshot `93b184a7...`；3/3 Vitest、Rust fmt/clippy/tests、Vite/Tauri debug build 全通过。

## Acceptance criteria status

| Requirement / acceptance ID | Expected evidence | Status |
|---|---|---|
| `DATA-ROUNDTRIP-001` / `RT-001` | canonical/GFM/CJK/链接/视觉源码 fixture 带确定性 manifest，可供无编辑字节 round-trip 测试 | IN PROGRESS |
| `DATA-UNKNOWN-001` / `RT-002` | 未知块/未来语法 fixture 明确保留源码边界 | IN PROGRESS |
| `EDIT-IME-001` / `IME-001` | CJK、组合字符、emoji/ZWJ 输入语料可供 composition harness 使用 | IN PROGRESS |
| `EDIT-TABLE-001` / `TABLE-001` | GFM 对齐/转义/代码内管道及运行时 300 表 fixture 可供无损预览测试 | IN PROGRESS |

## Changes made

- 已完成独立 worktree 冷基线，尚未添加 fixture。

## Decisions and assumptions

- 所有内容均为合成语料，不复制用户文档、文件名或绝对路径。
- 超大、非法编码和病态输入只由确定性生成器写入调用者提供的空目录；Git 只保存参数和预期 SHA-256。
- fixture availability 不等于产品行为通过；任务 note 只证明覆盖面、格式、确定性与隐私策略。

## Verification evidence

| Test / acceptance ID | Exact command and environment | Result | Artifact or failure |
|---|---|---|---|
| baseline | `pnpm install --frozen-lockfile`; hygiene + design validator + `pnpm verify`; macOS arm64 | PASS | 无用户数据；仅锁文件依赖和 ignored build output |

## Open questions and blockers

- 当前无 blocker。

## Remaining numbered steps

1. 添加每个核心语料族的最小代表 fixture 与 versioned manifest。
2. 实现确定性危险 fixture/79 文件工作区生成器，记录参数和 SHA-256。
3. 实现 fixture validator，验证 manifest、编码/换行、文件覆盖与生成确定性。
4. 运行 privacy/hygiene、fixture、design 和全仓门禁，更新 REVIEW 交接并提交。

## Data safety, recovery, and temporary artifacts

- 禁止向 Git 提交真实语料、绝对路径、10 MiB blob 或长 Base64 行。
- 生成器只允许显式空输出目录；验证使用系统临时目录，完成后自动清理。

## Single recommended next action

建立 committed fixture manifests 与 deterministic runtime generator，并让 validator 在临时目录复算全部 hash。
