# P0-FIXTURE-01 — 脱敏 Markdown 与病态输入语料

- Status: CLAIMED
- Owner / next owner: QA (`/root/p0_fixture_01_fix`) / Integration
- Base revision / head revision: `28e6d8e` / `dec8bef` (independent-review remediation start)
- Requirement IDs: `DATA-ROUNDTRIP-001`, `DATA-UNKNOWN-001`, `EDIT-IME-001`, `EDIT-TABLE-001`
- Product UX IDs: fixture 基础设施任务，不直接关闭产品 UX
- Test / acceptance IDs: `RT-001`, `RT-002`, `IME-001`, `TABLE-001`
- ADRs / contract and schema versions: `ADR-0002`, `ADR-0004`; fixture manifest version 1
- Feature flags: 无
- Owned and touched paths: `tests/fixtures/**`; `tools/generate_fixtures.rb`; `scripts/validate_fixtures.rb`; `package.json`; Integration 明确授权的根 `.gitattributes` 精确 fixture 规则；本 task note；`PROJECT_STATE.md` 的 `P0-FIXTURE-01` 行

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
| `DATA-ROUNDTRIP-001` / `RT-001` | canonical/GFM/CJK/链接/视觉源码 fixture 带确定性 manifest，可供无编辑字节 round-trip 测试 | PASS（fixture ready） |
| `DATA-UNKNOWN-001` / `RT-002` | 未知块/未来语法 fixture 明确保留源码边界 | PASS（fixture ready） |
| `EDIT-IME-001` / `IME-001` | CJK、组合字符、emoji/ZWJ 输入语料可供 composition harness 使用 | PASS（fixture ready） |
| `EDIT-TABLE-001` / `TABLE-001` | GFM 对齐/转义/代码内管道及运行时 300 表 fixture 可供无损预览测试 | PASS（fixture ready） |

## Changes made

- 添加 10 个 versioned manifests 和 15 个小型 committed synthetic files，覆盖 canonical/GFM、未知语法、CJK/IME、表格、重复标题/Unicode 与空格路径、图片、Math、Mermaid 和外部修改双版本。
- 添加 9 项 runtime-only 生成计划：10 MiB 多行、10 MiB Data URI 单行、1 MiB 行边界、invalid UTF-8、BOM/CRLF、300 表、断链与 79 文件/1106 链接工作区；冻结每项 SHA-256。
- 添加确定性生成器与 fixture validator；生成器拒绝仓库内输出、非空输出目录和越界 artifact path，validator 在临时目录复算 hash、形状和 manifest 覆盖。
- 把 `fixtures:check` 纳入仓库统一 `pnpm check` / `pnpm verify` 门禁。

## Decisions and assumptions

- 所有内容均为合成语料，不复制用户文档、文件名或绝对路径。
- 超大、非法编码和病态输入只由确定性生成器写入调用者提供的空目录；Git 只保存参数和预期 SHA-256。
- fixture availability 不等于产品行为通过；任务 note 只证明覆盖面、格式、确定性与隐私策略。

## Verification evidence

| Test / acceptance ID | Exact command and environment | Result | Artifact or failure |
|---|---|---|---|
| baseline | `pnpm install --frozen-lockfile`; hygiene + design validator + `pnpm verify`; macOS arm64 | PASS | 无用户数据；仅锁文件依赖和 ignored build output |
| fixture schema + deterministic generation | `ruby -c tools/generate_fixtures.rb`; `ruby -c scripts/validate_fixtures.rb`; `ruby scripts/validate_fixtures.rb` | PASS | `manifests=10 committed_files=15 generated_artifacts=9`；临时输出自动清理 |
| privacy/repository hygiene | `ruby scripts/check_repository_hygiene.rb --self-test`; `ruby scripts/check_repository_hygiene.rb` | PASS | self-test 4/4；117 tracked files，无大 blob/绝对用户路径 |
| design invariants | `ruby scripts/validate_design_docs.rb` | PASS | `requirements=56 test_ids=83 ipc_commands=37`; snapshot `265b9acd...` |
| full repository gate | `pnpm verify`（rustup toolchain 已加入 PATH）；macOS arm64 | PASS | Prettier/ESLint/TS/Vitest 3/3、fixture、Rust fmt/clippy/tests、Vite 与 Tauri debug build 全通过 |
| staged patch | `git diff --cached --check` | PASS | 无 whitespace error |

## Open questions and blockers

- 当前无实现 blocker；任务仅待 Integration 复核与主线合并。fixture PASS 不代表对应产品行为已经验收。

## Remaining numbered steps

1. Integration 在 `P0-CONTRACT-01` 后按既定顺序复核并合并本分支。
2. 合并时保留其他任务对 `package.json` 与 `PROJECT_STATE.md` 的并行改动，再运行全仓门禁。
3. 后续产品任务引用这些 fixture 执行真实 round-trip、IME、表格与大文件验收，不把“fixture ready”误记为产品 DONE。

## Data safety, recovery, and temporary artifacts

- 禁止向 Git 提交真实语料、绝对路径、10 MiB blob 或长 Base64 行。
- 生成器只允许显式空输出目录；验证使用系统临时目录，完成后自动清理。

## Single recommended next action

Integration 复核 `fadd833`，在契约任务之后合并，并运行 `pnpm verify`。
