# P0-FLAG-01 — Typed feature-flag registry

- Status: DONE
- Owner / next owner: Integration / Phase 1 feature consumers
- Base revision / head revision: `813da5aec969c2751feb6c80116686d7c90b3dae` / implementation `21b3de5`, independently reviewed handoff `84783c2`, review record `50c9a67`, main merge `2ce079e`
- Requirement IDs: `DATA-REVISION-001`, `SAFE-IPC-001`, `EXT-ROUTER-001`, `EXT-COMMAND-001`, `OPS-LOG-001`, `OPS-CONTEXT-001`, `OPS-HANDOFF-001`
- Product UX IDs: `UX-EXT-001`
- Test / acceptance IDs: `CORE-001`, `SEC-001`, `EXT-001`, `EXT-002`, `OBS-001`, `CONTRACT-001`, `CONTRACT-002`, `CONTRACT-003`, `PROC-001`, `PROC-002`
- ADRs / contract and schema versions: `ADR-0001`–`ADR-0004`; IPC `1.0-draft` / `apiVersion=1.0`; generated `AppFeatures` remains the four-field native/runtime availability contract
- Feature flags: all 14 flags listed in `docs/IMPLEMENTATION_PLAN.md` §13; production safety flags fail closed
- Owned and touched paths: `src/app/flags/**`, colocated flag tests, `docs/tasks/P0-FLAG-01.md`, and only the `P0-FLAG-01` row in `docs/PROJECT_STATE.md`

## Goal and non-goals

Implement an immutable, typed, dependency-aware frontend feature registry with fixed production defaults, explicit test-only overrides, exhaustive mapping from generated `AppFeatures`, stable privacy-safe diagnostics, and fail-closed production safety behavior.

This task does not wire flags into product UI, change IPC/generated types, change Rust safety enforcement, add dependencies, or edit root manifests/CI/release configuration.

## Dependencies and baseline

- Dependency task/freeze status: `P0-CONTRACT-01` is `DONE`; IPC `1.0-draft` generated types are present on the base revision.
- Baseline commands: `pnpm install --frozen-lockfile`; `pnpm verify` with the installed Rust toolchain already available on `PATH`.
- Baseline result: `pnpm install --frozen-lockfile` passed with the frozen lockfile; the first `pnpm verify` reached 32/32 frontend tests and then failed only because Cargo was absent from the invoking shell `PATH`; rerunning with the installed Rust toolchain available on `PATH` passed the complete check/build/Tauri debug-build gate. `ruby scripts/validate_design_docs.rb` also passed with snapshot `e06037592d3ae82d8d9c8251d47071641f788950e1aa1567cd20824555c7ae12`.

## Acceptance criteria status

| Requirement / acceptance ID | Expected evidence | Status |
|---|---|---|
| `UX-EXT-001` / `EXT-001` / `EXT-002` | Exactly 14 centrally registered flags with immutable typed lookup and no feature-local environment checks | Complete: canonical registry and production barrel are frozen and typed |
| `SAFE-IPC-001` / `SEC-001` / `CONTRACT-001` | Exhaustive generated `AppFeatures` availability mapping without changing the frozen IPC contract | Complete: mapped-type readers cover every generated field; IPC/generated diff is empty |
| `CONTRACT-002` / `CONTRACT-003` | Production defaults and explicit test overrides are validated; unknown/non-boolean/missing/self/cyclic dependencies fail deterministically | Complete: focused negative and dependency tests pass |
| `OPS-LOG-001` / `OBS-001` | Stable diagnostics contain only registered IDs/reason codes and no paths, content, environment, storage, or Tauri details | Complete: canonical frozen diagnostics and privacy scan pass |
| `ADR-0004` | `safety.largeInputGuard` and `recovery.dirty` cannot be disabled by production construction; Rust remains the enforcement boundary | Complete: one-argument production factory has no override input; native safety remains unchanged |

## Changes made

- Added the immutable canonical registry for all 14 frozen flags, including exact production defaults, dependencies, capability requirements, and fail-closed metadata.
- Added exhaustive typed mapping from generated `AppFeatures` to native/runtime availability. `AppFeatures` remains the four-field IPC capability contract; the rollout flags were not added to IPC.
- Added deterministic transitive resolution and frozen, privacy-safe `dependencyDisabled` / `capabilityUnavailable` diagnostics in canonical flag order.
- Added a one-argument production factory with no override input and a separate test-only factory for overrides and invalid-graph tests.
- Added validation for unknown/duplicate/incomplete definitions, invalid definition/capability types, unknown/non-boolean overrides, self/missing/cyclic dependencies, unknown capabilities, and unsafe fail-closed defaults.
- Added 15 focused tests for production defaults, safety behavior, exact `session.restore` isolation from `recovery.dirty`, capability mapping, transitive resolution, stable ordering, deep immutability, privacy, and every required negative case.
- Performed a fresh post-implementation source/diff review against the frozen 14-flag table. A separate read-only reviewer then reviewed exact handoff `84783c2` and returned `MERGE` with no blocker, major, or minor findings.

## Decisions and assumptions

- `AppCapabilities.features` remains native/runtime availability only: `clipboardImage`, `splitView`, `recovery`, and `mermaid`.
- `session.restore` depends on tabs, history, and recovery availability, but never controls P0 dirty recovery.
- No production override input or environment/storage lookup will exist in the production factory.
- A false native capability disables the corresponding requested frontend feature with a safe diagnostic; it never claims the native capability exists. `recovery.dirty` remains requested and fail-closed, while Rust still enforces recovery independently of this UI registry.
- The test factory may exercise overrides, including safety-off cases, solely to test dependent behavior. It is not exported by the production barrel.
- Cancellation and stale-revision cases are not applicable: the registry is synchronous, immutable configuration with no I/O, commands, events, revisions, or async work.

任何会影响其他代理的决定必须同时写入 REQUIREMENTS、领域设计或 ADR；本节不能成为唯一事实来源。

## Verification evidence

| Test / acceptance ID | Exact command and environment | Result | Artifact or failure |
|---|---|---|---|
| `BUILD-001`, `CONTRACT-001`–`CONTRACT-003`, fixture baseline | Base `813da5a`; macOS 26.6.2 arm64; Node 24.14.0; pnpm 10.32.1; Rust 1.98.0; installed Rust toolchain added to `PATH`; `pnpm verify` | PASS before implementation: frontend 32/32; canonical contract Rust 15/15 and TS 29/29; full Rust 17/17; fixture validator 14 manifests / 18 committed / 18 generated / 33 attributed; Vite and Tauri debug builds completed | First attempt reached frontend 32/32 then failed only with `spawnSync cargo ENOENT`; the recorded rerun supplied the installed toolchain; debug binary stayed ignored under `src-tauri/target/` |
| `EXT-001`, `EXT-002`, `SEC-001`, `OBS-001`, `CONTRACT-001`–`CONTRACT-003` | Implementation `21b3de5`; `pnpm exec vitest run src/app/flags/featureFlags.test.ts` | PASS: 1 file, 15/15 tests | No artifact |
| `BUILD-001`, `EXT-001`, `SEC-001`, `CONTRACT-001`–`CONTRACT-003` | Implementation `21b3de5`; installed Rust toolchain added to `PATH`; `pnpm verify` | PASS: Vitest 47/47; canonical contract Rust 15/15 and TS 29/29; full Rust 17/17; fixture 14 manifests / 18 committed / 18 generated / 33 attributed; format, lint, typecheck, schema drift, Rust fmt/clippy, Vite, and Tauri debug build all pass | Debug binary stayed ignored under `src-tauri/target/` |
| `PROC-002`, `BUILD-001`, `EXT-001`, `SEC-001` | Fresh system-temporary clone of implementation `21b3de5`; macOS 26.6.2 arm64; Node 16.20.2; pnpm 10.32.1; Rust/Cargo 1.98.0; `git clone --local --no-hardlinks . "$clean_checkout/repo"`; `pnpm --dir "$clean_checkout/repo" install --frozen-lockfile`; installed Rust toolchain added to `PATH`; `pnpm --dir "$clean_checkout/repo" verify` | PASS: frozen install reused 273 packages; Vitest 47/47; canonical Rust 15/15 + TS 29/29; full Rust 17/17; fixture 14/18/18/33; format/lint/typecheck/contracts/schema/Rust/build/Tauri all pass | Scoped temporary clone moved to macOS Trash after verification; no repository artifact |
| `PROC-001` / documentation pre-handoff | Implementation `21b3de5`; Ruby 2.6.10; `ruby scripts/validate_design_docs.rb` | PASS: 41 Markdown files, 79 links, 56 requirements, 41 UX requirements/crosswalk rows, 83 test IDs, 41 acceptance IDs, 37 IPC commands, 43 tasks; pre-handoff snapshot `66d8cf78af0ed80e1466cb8929bb474df32d0b8961cd4e9837a4692efd711d3e` | No artifact |
| `OBS-001`, `PROC-001` / privacy and scope | Implementation `21b3de5`; `rg -n -i 'import\\.meta\\.env|process\\.env|localStorage|sessionStorage|indexedDB|@tauri|invoke\\(|listen\\(|data:image' src/app/flags`; `ruby scripts/validate_design_docs.rb`; `git diff --quiet 813da5a..HEAD -- src/generated src-tauri package.json pnpm-lock.yaml .github`; `git diff --check 813da5a..HEAD` | PASS: no forbidden lookup/import/path/content pattern, validator found no personal path or embedded Base64, no IPC/generated/native/dependency/manifest/CI diff, no whitespace errors | No artifact |
| `PROC-001`, `PROC-002` / handoff record | Review handoff branch tip; `ruby scripts/validate_design_docs.rb`; `git status --short --branch`; `git diff --check` | PASS after task-note and ledger transition to `REVIEW`; the deterministic snapshot is intentionally emitted by the validator rather than copied into its own hashed Markdown input | No artifact |
| `EXT-001`, `EXT-002`, `SEC-001`, `OBS-001`, `CONTRACT-001`–`CONTRACT-003`, `PROC-002` / independent review | Read-only review of exact handoff `84783c2`; `pnpm exec vitest run src/app/flags/featureFlags.test.ts`; `pnpm test`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`; `ruby scripts/validate_design_docs.rb`; `git diff --check 813da5a..84783c2` | `MERGE`; no blocker/major/minor findings; focused 15/15 and full 47/47 tests pass; types/lint/format/docs/diff pass; worktree stayed clean | Reviewer noted only the intentional deferred consumer wiring and recommended future lint/review continue preventing deep imports of the test-only seam |
| Integration gate | `pnpm exec vitest run src/app/flags/featureFlags.test.ts`; privacy scan; `ruby scripts/validate_design_docs.rb`; `PATH="${HOME}/.cargo/bin:${PATH}" pnpm verify` on main merge `2ce079e` | PASS; focused 15/15, full frontend 65/65, canonical contract Rust 16/16 + TS 29/29, fixtures 14/18/18/33, Rust unit 19/19 + safety 18/18, Vite/Tauri debug build | No forbidden environment/storage/Tauri lookup in `src/app/flags`; no user data or repository artifact |

## Open questions and blockers

None. The branch is buildable, locally verified, and independently reviewed `MERGE`. Integration still owns merge-order conflict handling against the advanced `main`, integrated gates, and the only permitted transition to `DONE`.

## Remaining numbered steps

1. Phase 1 consumers import only the production barrel; test-only construction remains isolated in `src/app/flags/testing.ts`.

## Data safety, recovery, and temporary artifacts

No user documents, clipboard contents, filesystem paths, environment values, storage values, or Tauri payloads are read or persisted by this registry. Tests use synthetic identifiers and booleans only. Runtime diagnostics contain only frozen registered flag IDs, capability IDs, dependency IDs, and reason codes. No temporary repository artifact remains; the scoped clean-clone directory was moved to macOS Trash after verification and is recoverable until Trash is emptied.

## Single recommended next action

Integration completes the remaining macOS host manual evidence and hosted CI evidence before publishing F0.
