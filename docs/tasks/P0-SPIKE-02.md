# P0-SPIKE-02 — Native/Safety feasibility

- Status: REVIEW
- Owner / next owner: Native/Safety spike agent / Integration
- Base revision / head revision: `576a435` / `d395624` (verified implementation revision; handoff metadata follows)
- Requirement IDs: `FILE-PREFLIGHT-001`, `FILE-SAVE-001`, `PERF-LARGE-001`, `SAFE-DATAURI-001`, `SAFE-IPC-001`, `OPS-CONTEXT-001`, `OPS-HANDOFF-001`
- Product UX IDs: `UX-SAFE-001`
- Test / acceptance IDs: `SAFE-001`, `SAFE-003`, `PERF-010`, `FILE-001`, `AC-SAFE-002`, `AC-SAFE-005`, `CONTRACT-010`, `CONTRACT-011`, `CONTRACT-024`, `PROC-001`, `PROC-002`
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
| `SAFE-001` / `FILE-PREFLIGHT-001` | Ordered threshold boundary tests and blocked/unsupported reports that never contain source text | PASS |
| `SAFE-003` / `SAFE-DATAURI-001` | Runtime-generated 10 MiB single-line data image is detected across bounded chunks and classified before any editor/product path | PASS at scanner layer |
| `PERF-010` / `PERF-LARGE-001` | Runtime-generated 10 MiB multiline UTF-8 is classified `largeText`; measured scanner duration and retained-buffer bound are recorded | PASS at scanner layer |
| `CONTRACT-010` | Deterministic cancellation stops a streaming scan before full consumption | PASS |
| `CONTRACT-011` | Binary/invalid UTF-8/oversize remain `Unsupported`; safety-blocked reports expose no body or Base64 snippet | PASS for spike report shape |
| `FILE-001` supporting evidence | Pre-rename failure leaves old bytes complete; post-rename state contains complete new bytes; stale task-owned temporary files are scoped and removable | PASS on macOS spike; product fault matrix remains Phase 1 |
| `CONTRACT-024` | Record bounded raw/wire-budget feasibility evidence without claiming end-to-end Tauri transport | PASS for stream sizing; actual Tauri transport NOT RUN |
| `AC-SAFE-002`, `AC-SAFE-005` | Spike-level classifier/timing evidence only; real UI/WebView acceptance remains owned by later product/E2E tasks | supporting evidence PASS; product AC not claimed |

## Changes made

- Added one dependency-free Rust integration-test harness; no product module imports it.
- Implemented a fixed-size streaming scan that observes exact accepted byte thresholds, streaming UTF-8 validity, binary indicators, BOM/line metrics, and `data:image/...;base64,` state across arbitrary read boundaries.
- Added deterministic cancellation and read-failure paths that return no partial success/body.
- Added runtime generators for 8/32 MiB file boundaries, 256 KiB/1 MiB line boundaries, 512 KiB decoded-image boundaries, 10 MiB multiline text, and 10 MiB single-line data image; no hazardous fixture is stored in Git.
- Added macOS same-directory temp/write/flush/sync/rename/directory-sync feasibility with injected failures before and after the commit point.
- Added a real child-process exit after temp-file sync, followed by exact-target stale cleanup that preserves the original, an unrelated decoy, and a recent matching temp.
- Added bounded worst-case JSON escape sizing for the accepted 32 MiB raw / 193 MiB wire budget without pretending it exercises the Tauri WebView bridge.

## Decisions and assumptions

- The spike lives only under the Rust integration-test tree so no disposable feasibility implementation becomes a product command or service.
- Hazardous inputs are generated inside validated process-scoped temporary directories and are never committed or logged.
- Scanner memory evidence means an explicit retained-state bound (fixed read buffer plus constant parser state); whole-process RSS includes the Rust/Tauri test harness and will not be misrepresented as scanner memory.
- macOS same-directory `rename`/directory-sync feasibility is the primary-platform result. Cross-platform replacement semantics remain a production adapter responsibility.
- Threshold order and values were copied unchanged from the accepted policy. No design, schema, error-code, flag, manifest, dependency, or lockfile change was required.

## Verification evidence

| Test / acceptance ID | Exact command and environment | Result | Artifact or failure |
|---|---|---|---|
| `PROC-001` | `ruby scripts/validate_design_docs.rb` at `576a435` | PASS | snapshot `e0905a48...` |
| `BUILD-001` baseline | `pnpm install --frozen-lockfile && PATH=<rustup-bin>:$PATH pnpm verify`; macOS 26.6.2 arm64, rustc 1.98.0, pnpm 10.32.1, project Node 24.14.0 | PASS | frontend 3/3; Rust 0 tests before spike; Vite and Tauri debug build PASS |
| `SAFE-001`, `SAFE-003`, `PERF-010`, `CONTRACT-010`, `CONTRACT-011`, `FILE-001`, `CONTRACT-024` | `PATH=<rustup-bin>:$PATH cargo test --manifest-path src-tauri/Cargo.toml --test p0_spike_02_native_safety -- --nocapture --test-threads=1`; debug, same environment | PASS, 11/11 | 10 MiB multiline `223,023 us`; data image `166,161 us`; scanner retained bound `65,591 B`; worst JSON sizing `1,036,794 us` |
| `SAFE-003`, `PERF-010`, `CONTRACT-024` | `PATH=<rustup-bin>:$PATH cargo test --release --manifest-path src-tauri/Cargo.toml --test p0_spike_02_native_safety -- --nocapture --test-threads=1` | PASS, 11/11 | release: multiline `27,367 us`; data image `21,406 us`; worst JSON sizing `103,410 us`; 32 MiB raw -> `202,375,168 B` wire; JSON retained bound `458,752 B` |
| Rust format/lint | `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`; `cargo clippy --manifest-path src-tauri/Cargo.toml --test p0_spike_02_native_safety -- -D warnings` | PASS | no warnings |
| Full branch gate | `ruby scripts/validate_design_docs.rb && PATH=<rustup-bin>:$PATH pnpm verify` | PASS | validator, Prettier, ESLint, TypeScript, frontend 3/3, Rust 11/11, Vite build, Tauri debug build |
| Schema drift | searched repository for a schema/generator drift command | NOT RUN | `P0-CONTRACT-01` has not landed on this base; no schema/generated file was touched; Integration must run its new drift gate after ordered merge |

## Open questions and blockers

- No blocker was found for bounded scanning, cancellation, cross-chunk detection, macOS same-directory atomic replacement, or scoped stale cleanup.
- Integration owns one F0 risk: this branch proves `CONTRACT-024` raw/wire sizing can be streamed with bounded retained state, but does not test a 32 MiB/193 MiB payload through the actual Tauri WebView bridge. `P0-CONTRACT-01` or a follow-up pre-F0 transport experiment must close it; product code must not assume success.
- Native Core owns the later cross-platform adapter risk: Windows replacement and directory durability semantics were not run on this macOS-first host. This does not block the accepted macOS feasibility result.

## Remaining numbered steps

1. Integration reviews and merges this branch in the Phase 0 order, then reruns the new contract/schema gate and full repository gate on the integration head.
2. Before F0, Integration assigns or confirms an actual Tauri raw/wire transport experiment for the remaining `CONTRACT-024` bridge risk.
3. After F0, `P1-PREFLIGHT-01` reimplements the proven algorithm behind frozen production contracts and adds product-level outcomes/UI integration; it must not copy test-only code into a Tauri command wholesale.

## Data safety, recovery, and temporary artifacts

No user documents, clipboard bytes, recovery data, personal paths, or committed large fixtures are used. Tests create only uniquely named synthetic directories under the OS temporary root, validate their scope before cleanup, and emit only byte counts, durations, retained-state bounds, and outcome enums. Successful debug/release/full-gate runs left no task temporary file. A killed/failed test may leave only a synthetic task-prefixed directory for diagnosis; no user file is touched.

## Single recommended next action

Integration reviews `d395624`, preserves the explicit Tauri-transport caveat, and merges only after the Phase 0 contract/CI ordering allows it.
