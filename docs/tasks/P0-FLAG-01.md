# P0-FLAG-01 — Typed feature-flag registry

- Status: CLAIMED
- Owner / next owner: Application Core (`/root/p0_flag_01`) / same owner until review handoff
- Base revision / head revision: `813da5aec969c2751feb6c80116686d7c90b3dae` / `813da5aec969c2751feb6c80116686d7c90b3dae`
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
| `UX-EXT-001` / `EXT-001` / `EXT-002` | Exactly 14 centrally registered flags with immutable typed lookup and no feature-local environment checks | Pending |
| `SAFE-IPC-001` / `SEC-001` / `CONTRACT-001` | Exhaustive generated `AppFeatures` availability mapping without changing the frozen IPC contract | Pending |
| `CONTRACT-002` / `CONTRACT-003` | Production defaults and explicit test overrides are validated; unknown/non-boolean/missing/self/cyclic dependencies fail deterministically | Pending |
| `OPS-LOG-001` / `OBS-001` | Stable diagnostics contain only registered IDs/reason codes and no paths, content, environment, storage, or Tauri details | Pending |
| `ADR-0004` | `safety.largeInputGuard` and `recovery.dirty` cannot be disabled by production construction; Rust remains the enforcement boundary | Pending |

## Changes made

- Task claimed; implementation not started.

## Decisions and assumptions

- `AppCapabilities.features` remains native/runtime availability only: `clipboardImage`, `splitView`, `recovery`, and `mermaid`.
- `session.restore` depends on tabs, history, and recovery availability, but never controls P0 dirty recovery.
- No production override input or environment/storage lookup will exist in the production factory.

任何会影响其他代理的决定必须同时写入 REQUIREMENTS、领域设计或 ADR；本节不能成为唯一事实来源。

## Verification evidence

| Test / acceptance ID | Exact command and environment | Result | Artifact or failure |
|---|---|---|---|
| `BUILD-001`, `CONTRACT-001`–`CONTRACT-003`, fixture baseline | macOS 26.6.2 arm64; Node 24.14.0; pnpm 10.32.1; Rust 1.98.0; `PATH` contains the installed Rust toolchain; `pnpm verify` | PASS: frontend 32/32; canonical contract Rust 15/15 and TS 29/29; full Rust 17/17; fixture validator 14 manifests / 18 committed / 18 generated / 33 attributed; Vite and Tauri debug builds completed | Debug binary under ignored `src-tauri/target/` |
| `PROC-001` / documentation baseline | Ruby 3.3.6; `ruby scripts/validate_design_docs.rb` | PASS; snapshot `e06037592d3ae82d8d9c8251d47071641f788950e1aa1567cd20824555c7ae12` | No artifact |

## Open questions and blockers

None at claim time.

## Remaining numbered steps

1. Run the recorded baseline gates on the claimed base revision.
2. Implement registry types, validation, resolution, capability mapping, diagnostics, and public factories.
3. Add focused tests for defaults, transitive dependencies, unavailable capabilities, ordering/immutability, and all validation negatives.
4. Run focused/full/docs/privacy/clean-clone verification and perform an independent self-review.
5. Commit narrow `P0-FLAG-01` changes and hand off in `REVIEW` without marking `DONE`.

## Data safety, recovery, and temporary artifacts

No user documents, clipboard contents, filesystem paths, environment values, storage values, or Tauri payloads are read or persisted by this registry. Tests use synthetic identifiers and booleans only.

## Single recommended next action

Run the clean-base dependency install and full `pnpm verify`, then implement under `src/app/flags/**` only.
