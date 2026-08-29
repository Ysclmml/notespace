# P0-SPIKE-02 — Native/Safety feasibility

- Status: CLAIMED
- Owner / next owner: Native/Safety spike agent / same owner
- Base revision / head revision: `576a435` / pending
- Requirement IDs: `FILE-PREFLIGHT-001`, `PERF-LARGE-001`, `SAFE-DATAURI-001`, `SAFE-IPC-001`, `OPS-CONTEXT-001`, `OPS-HANDOFF-001`
- Product UX IDs: `UX-SAFE-001`
- Test / acceptance IDs: `SAFE-001`, `SAFE-003`, `PERF-010`, `AC-SAFE-002`, `AC-SAFE-005`, `CONTRACT-010`, `CONTRACT-011`, `CONTRACT-024`, `PROC-001`, `PROC-002`
- ADRs / contract and schema versions: `ADR-0001`, `ADR-0004`; IPC `1.0-draft` is read-only for this spike
- Feature flags: no flag implementation; future production path remains gated by fail-closed `safety.largeInputGuard`
- Owned and touched paths: `src-tauri/tests/p0_spike_02_native_safety.rs`, `docs/tasks/P0-SPIKE-02.md`, and only the `P0-SPIKE-02` ledger row in `docs/PROJECT_STATE.md`

## Goal and non-goals

Validate, using an isolated Rust-only spike and runtime-generated synthetic inputs, that the accepted Native/Safety design is feasible with bounded memory: fixed-buffer preflight, cancellation, Base64 data-image detection across read boundaries, same-directory atomic replacement, and scoped crash/stale-temporary cleanup.

This task does not implement `document_open_v1`, product IPC, a safety-page UI, repair/extraction, production save/recovery services, or any Phase 1 behavior. It does not change accepted thresholds, schema, feature flags, manifests, lockfiles, or global CI.

## Dependencies and baseline

- Dependency task/freeze status: `P0-BOOT-01` is `DONE`; F0 is not published and Phase 1 remains prohibited.
- Baseline commands:
  - `ruby scripts/validate_design_docs.rb`
  - `pnpm install --frozen-lockfile`
  - `PATH=<rustup-bin>:$PATH pnpm verify`
- Baseline result:
  - design validator `RESULT=PASS`, snapshot `e0905a48147eee7c3264b382aeab2a8c2c2e40dab2ef6b7f5b9963a96cca8509`;
  - the first `pnpm verify` correctly failed before installation because the independent worktree had no `node_modules` (`prettier: command not found`); after frozen-lockfile installation, the complete verify command passed;
  - environment: macOS `26.6.2` arm64, rustc `1.98.0`, pnpm `10.32.1`, and project-managed Node (`pnpm exec node`) `24.14.0`.

## Acceptance criteria status

| Requirement / acceptance ID | Expected evidence | Status |
|---|---|---|
| `SAFE-001` / `FILE-PREFLIGHT-001` | Ordered threshold boundary tests and blocked/unsupported reports that never contain source text | pending |
| `SAFE-003` / `SAFE-DATAURI-001` | Runtime-generated 10 MiB single-line data image is detected across bounded chunks and classified before any editor/product path | pending |
| `PERF-010` / `PERF-LARGE-001` | Runtime-generated 10 MiB multiline UTF-8 is classified `largeText`; measured scanner duration and retained-buffer bound are recorded | pending |
| `CONTRACT-010` | Deterministic cancellation stops a streaming scan before full consumption | pending |
| `CONTRACT-011` | Binary/invalid UTF-8/oversize remain `Unsupported`; safety-blocked reports expose no body or Base64 snippet | pending |
| `FILE-001` supporting evidence | Pre-rename failure leaves old bytes complete; post-rename state contains complete new bytes; stale task-owned temporary files are scoped and removable | pending |
| `CONTRACT-024` | Record bounded raw/wire-budget feasibility evidence without claiming end-to-end Tauri transport | pending |
| `AC-SAFE-002`, `AC-SAFE-005` | Spike-level classifier/timing evidence only; real UI/WebView acceptance remains owned by later product/E2E tasks | pending |

## Changes made

Task claim and baseline evidence only.

## Decisions and assumptions

- The spike will live only under the Rust integration-test tree so no disposable feasibility implementation becomes a product command or service.
- Hazardous inputs are generated inside validated process-scoped temporary directories and are never committed or logged.
- Scanner memory evidence means an explicit retained-state bound (fixed read buffer plus constant parser state); whole-process RSS includes the Rust/Tauri test harness and will not be misrepresented as scanner memory.
- macOS same-directory `rename`/directory-sync feasibility is the primary-platform result. Cross-platform replacement semantics remain a production adapter responsibility.

## Verification evidence

| Test / acceptance ID | Exact command and environment | Result | Artifact or failure |
|---|---|---|---|
| `PROC-001` | `ruby scripts/validate_design_docs.rb` at `576a435` | PASS | snapshot `e0905a48...` |
| `BUILD-001` baseline | `pnpm install --frozen-lockfile && PATH=<rustup-bin>:$PATH pnpm verify`; macOS 26.6.2 arm64, rustc 1.98.0, pnpm 10.32.1, project Node 24.14.0 | PASS | frontend 3/3; Rust 0 tests before spike; Vite and Tauri debug build PASS |

## Open questions and blockers

None at claim. End-to-end 32 MiB Tauri document transport is outside this isolated scanner/filesystem spike; if it is not covered by `P0-CONTRACT-01`, Integration must assign the remaining `CONTRACT-024` transport experiment before F0.

## Remaining numbered steps

1. Add the dependency-free Rust spike with success, boundary, cancellation, failure, and crash-cleanup tests.
2. Run focused debug/release measurements and record aggregate-only results.
3. Run all required repository gates, update this note and the ledger to `REVIEW`, and commit the narrow branch.

## Data safety, recovery, and temporary artifacts

No user documents, clipboard bytes, recovery data, personal paths, or committed large fixtures are used. Tests create only uniquely named synthetic directories under the OS temporary root and validate their scope before cleanup. A failed test may leave only a synthetic task-prefixed directory for diagnosis; no user file is touched.

## Single recommended next action

Implement the isolated Rust scanner and filesystem feasibility tests without changing any manifest or product module.
