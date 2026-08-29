# P0-FIXTURE-01 — 脱敏 Markdown 与病态输入语料

- Status: DONE
- Owner / next owner: Integration / downstream fixture consumers
- Base revision / head revision: `28e6d8e` / verified implementation `80e434a`; reviewed handoff `4a427022a7f11c7afedf9fb6699838e2a50c4906`; main merge `9172a9c`
- Requirement IDs: `DATA-ROUNDTRIP-001`, `DATA-UNKNOWN-001`, `EDIT-IME-001`, `EDIT-TABLE-001`, `NAV-ANCHOR-001`, `FILE-PREFLIGHT-001`, `DATA-CONFLICT-001`, `ASSET-STAGING-001`, `RECOVERY-DIRTY-001`, `RECOVERY-LOOP-001`, `PERF-LARGE-001`, `SAFE-DATAURI-001`, `SAFE-URL-001`, `SAFE-RENDER-001`
- Product UX IDs: fixture 基础设施任务，不直接关闭任何产品 UX / AC
- Test / acceptance IDs: `RT-001`, `RT-002`, `IME-001`, `TABLE-001`, `LINK-001`, `WORKSPACE-001`, `SAFE-001`, `SAFE-003`, `SEC-002`, `SEC-003`, `VIS-001`, `PERF-001`, `PERF-002`, `PERF-010`, `FILE-004`, `ASSET-001`, `ASSET-002`, `REC-001`, `REC-002`
- ADRs / contract and schema versions: `ADR-0002`, `ADR-0004`; committed fixture manifest version 1; generated plan version 1
- Feature flags: 无
- Owned and touched paths: `tests/fixtures/**`; `tools/generate_fixtures.rb`; `scripts/validate_fixtures.rb`; `package.json`; Integration 明确授权的根 `.gitattributes` 精确规则 `tests/fixtures/** -text`；本 task note；`PROJECT_STATE.md` 的 `P0-FIXTURE-01` 行

## Goal and non-goals

目标：建立脱敏、可追踪、确定性且跨 Git 换行策略字节稳定的 fixture 体系；覆盖 09 §4.1–4.3 规定的 canonical/GFM、CJK/IME、链接、Mermaid、图片、编码、病态/恶意输入和恢复场景，且让大、二进制、不合法编码与符号链接项只在隔离临时目录生成。

非目标：本任务只证明 fixture availability、schema、语义、确定性与隐私/路径边界；不声称 open/save round-trip、IME、预检、渲染、恢复或安全用户行为已经 PASS。

## Dependencies and baseline

- Dependency task/freeze status: 设计基线已批准；`P0-BOOT-01` DONE；本任务不依赖 F0 schema。
- Original base evidence: base `28e6d8e` 上 `pnpm install --frozen-lockfile`、hygiene、design validator 和 `pnpm verify` PASS。
- Independent-review remediation start: clean branch at `dec8bef`; only the paths declared above were changed.

## Acceptance criteria status

| Requirement / acceptance ID | Expected evidence | Status |
|---|---|---|
| `DATA-ROUNDTRIP-001` / `RT-001` | canonical empty/source、BOM/CRLF/mixed newline、GFM、CJK 与视觉源码 fixture 有强 schema 与字节策略 | PASS（fixture ready only） |
| `DATA-UNKNOWN-001` / `RT-002` | 未知块与 4,096 层标记输入有确定性语料 | PASS（fixture ready only） |
| `EDIT-IME-001` / `IME-001` | CJK、组合字符、astral、ZWJ、中文链接文本/表格单元格/fenced code 输入语料 | PASS（fixture ready only） |
| `EDIT-TABLE-001` / `TABLE-001` | GFM 边界、24 列宽表与运行时 300 表 fixture | PASS（fixture ready only） |
| `FILE-PREFLIGHT-001` / `SAFE-001`; `SAFE-DATAURI-001` / `SAFE-003`; `PERF-LARGE-001` / `PERF-010` | 10 MiB 多行、10 MiB Data URI、1 MiB -1/=/+1 物理行、invalid UTF-8 的参数、hash、bytes/files 和语义断言 | PASS（fixture ready only） |
| `NAV-ANCHOR-001` / `LINK-001`; `SAFE-URL-001` / `SEC-002`; `SAFE-RENDER-001` / `SEC-003`; `RECOVERY-*` / `REC-*` | 目录链接、断链、路径逃逸/symlink/javascript/HTML-SVG event、Mermaid 超限/恶意 HTML、图片与 recovery 矩阵 | PASS（fixture ready only） |

## Changes made

- 14 个 committed manifests 覆盖 18 个小型合成文件；每个 manifest 有唯一稳定 ID、严格字段/类型/枚举和结构化 `ownerIntent`，所有文件只能被覆盖一次。
- 18 个 runtime-only artifacts 冻结 `expectedSha256`、`expectedBytes`、`expectedFiles`；包含 canonical empty、10 MiB 边界、1 MiB -1/=/+1、invalid UTF-8、BOM/CRLF/mixed、300 表、79 文件/1,106 链接、4 Mermaid/2 images、嵌套标记、5,001 Mermaid 节点、图片验证矩阵、symlink 工作区与 recovery 场景。
- 生成器从最近存在父级做 `realpath` canonicalization；词法或 symlink 解析后落入仓库都 fail closed，output-root 和 intermediate-parent 两类旁路均有隔离自测。
- validator 使用 `lstat` + `realpath` 拒绝 manifest、generated plan、committed fixture 的 symlink/越界，使用 `YAML.safe_load` 和 exact-key/type/range/non-overlap schema，并执行不依赖 hash 的语义断言。
- 根 `.gitattributes` 仅新增 Integration 授权的 `tests/fixtures/** -text`；validator 通过 `git check-attr -z text` 确认全部 33 个 fixture 路径为 `unset`。生成产物统一以 binary mode 写入，包括 SVG 和 generation JSON。
- 已有 `fixtures:check` 仍保持在根 `package.json` 的 `pnpm check` / `pnpm verify` 中；本次未更改 lockfile 或依赖。

## Decisions and assumptions

- 全部内容均为合成语料，没有读取、复制或记录用户文档、剪贴板、文件名或绝对路径。
- 恶意 Markdown、断链、非法编码、二进制图片、超大/长行、解码炸弹和符号链接语料不进入 Git，只写入 validator 拥有的系统临时目录并自动清理。
- `ownerIntent` 声明下游 test/task 消费者，不把“fixture 存在”写成“产品行为 PASS”。
- 本任务不改动已接受 ADR、IPC/schema、feature flag、产品阈值或信任边界。

## Verification evidence

Environment: macOS arm64; Ruby 2.6.10; Git 2.50.1; `pnpm exec node --version` = 24.14.0; pnpm 10.32.1; rustc 1.98.0.

| Test / acceptance ID | Exact command/environment | Result | Artifact or failure |
|---|---|---|---|
| fixture schema, determinism, semantics, symlink guards | `ruby -c tools/generate_fixtures.rb`; `ruby -c scripts/validate_fixtures.rb`; `ruby scripts/validate_fixtures.rb` | PASS | `manifests=14 committed_files=18 generated_artifacts=18 attributed_files=33 schema_self_tests=4 symlink_self_tests=3`; generated output auto-cleaned |
| fixture byte stability under checkout conversion | `git clone --no-local --branch task/P0-FIXTURE-01-corpus --config core.autocrlf=true . "$TMPDIR/clone"`; binary aggregate compare; in clone `ruby scripts/validate_fixtures.rb` | PASS | 33/33 fixture paths byte-identical; aggregate SHA-256 `afae2944e04b322a097d8a4a4d8e6d537d2f052a465c4897a892ab1a3d4cbbf0`; clone cleaned |
| privacy/repository hygiene | `ruby scripts/check_repository_hygiene.rb --self-test`; `ruby scripts/check_repository_hygiene.rb` | PASS | self-test 4/4; 125 tracked files; no large blob, personal path, secret, or committed hazardous output |
| design invariants | `ruby scripts/validate_design_docs.rb` | PASS | 39 Markdown, 77 relative links, 89 fence pairs, 56 requirements, 83 test IDs, 37 IPC commands; authoritative post-handoff snapshot is mirrored in `PROJECT_STATE.md` because that file is excluded from the digest |
| full repository gate | `PATH` including rustup toolchain, then `pnpm verify` | PASS | Prettier, ESLint, TypeScript, Vitest 3/3, fixture gate, Rust fmt/clippy/tests, Vite build, and Tauri debug build all passed |
| Integration / main gate | `ruby scripts/validate_design_docs.rb`; `ruby scripts/validate_fixtures.rb`; `PATH` including rustup toolchain, then `pnpm verify` after merge `9172a9c` | PASS | 14 manifests, 18 committed files, 18 runtime artifacts, 33 attributed paths; canonical Rust 15/15 + TS 29/29; full Vitest 32/32 + Rust 17/17; Vite/Tauri debug build PASS |
| staged patch | `git diff --cached --check` | PASS | no whitespace error before implementation commit `80e434a` |

## Open questions and blockers

- 无实现 blocker。独立终审已给出 MERGE，Integration 已合并并在主线重跑全门禁。
- 非阻断观察：故意以 `core.autocrlf=true` 克隆时，非 fixture 的 Ruby shebang 因全局换行策略产生警告，但 validator 完整 PASS 且 33 个 fixture 字节全部一致。根据授权，本任务没有扩大 `.gitattributes` 到其他路径；若 Windows CI 直接执行 Ruby，由 Integration/CI 后续评估全局源码换行策略。
- 运行时 symlink fixture 在 macOS 门禁上通过；未来 Windows 运行器若不允许创建 symlink，`P5-SECURITY-01` 的 Platform/QA owner 必须用等价的平台隔离 harness，不得删除 `SEC-002` 语义。

## Remaining numbered steps

No work remains in `P0-FIXTURE-01`. 后续 feature/E2E owner 按 `ownerIntent` 消费语料执行真实产品行为验收；本任务不替代这些测试。

## Data safety, recovery, and temporary artifacts

- Git 中没有真实语料、用户绝对路径、10 MiB blob、长 Base64 行、非法 UTF-8、二进制测试图片或 symlink。
- 生成器仅允许显式空的仓库外目录；validator 和 `core.autocrlf=true` clone 使用的隔离临时目录已自动或经边界校验后清理，无遗留恢复操作。

## Single recommended next action

继续集成 `P0-SPIKE-01`；后续功能任务必须复用本语料而不得提交危险大 blob。
