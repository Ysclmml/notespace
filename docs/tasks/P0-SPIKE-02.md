# P0-SPIKE-02 — Native/Safety feasibility

- Status: CLAIMED
- Owner / next owner: Native/Safety second-review remediation agent / Integration
- Base revision / head revision: `f07e3e5` / `f07e3e5` (second-review remediation starts here)
- Requirement IDs: `FILE-PREFLIGHT-001`, `FILE-SAVE-001`, `PERF-LARGE-001`, `SAFE-DATAURI-001`, `SAFE-IPC-001`, `OPS-CONTEXT-001`, `OPS-HANDOFF-001`
- Product UX IDs: `UX-SAFE-001`
- Test / acceptance IDs: `SAFE-001`, `SAFE-003`, `PERF-010`, `FILE-001`, `AC-SAFE-002`, `AC-SAFE-005`, `CONTRACT-010`, `CONTRACT-011`, `CONTRACT-024`, `PROC-001`, `PROC-002`
- ADRs / contract and schema versions: `ADR-0001`, `ADR-0004`; IPC `1.0-draft` is read-only for this spike
- Feature flags: no flag implementation; future production path remains gated by fail-closed `safety.largeInputGuard`
- Owned and touched paths: `src-tauri/tests/p0_spike_02_native_safety.rs`, explicitly delegated test-only dependency edits in `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock`, `docs/tasks/P0-SPIKE-02.md`, and only the `P0-SPIKE-02` ledger row in `docs/PROJECT_STATE.md`

## Goal and non-goals

Validate, using an isolated Rust-only spike and runtime-generated synthetic inputs, that the accepted Native/Safety design is feasible with bounded memory: fixed-buffer preflight, cancellation, Base64 data-image detection across read boundaries, same-directory atomic replacement, and scoped crash/stale-temporary cleanup.

This task does not implement `document_open_v1`, product IPC, a safety-page UI, repair/extraction, production save/recovery services, or any Phase 1 behavior. It does not change accepted thresholds, schema, feature flags, runtime dependencies, or global CI. The only dependency change allowed by Integration is an exact-pinned, test-only UUID v4 dev dependency for random operation identities in the disposable spike.

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
  - second-review takeover at `f07e3e5`: design validator PASS (snapshot `9a21a8b57883ec90b3e16a667fbe8da96be8325e27efb63339264db6fa982eef`), focused Rust 16/16 PASS, and complete `pnpm verify` PASS before new edits.

## Acceptance criteria status

| Requirement / acceptance ID | Expected evidence | Status |
|---|---|---|
| `SAFE-001` / `FILE-PREFLIGHT-001` | Ordered threshold boundary tests and blocked/unsupported reports that never contain source text | PASS; explicit `Unsupported` precedence when binary and both safety thresholds also match |
| `SAFE-003` / `SAFE-DATAURI-001` | Runtime-generated 10 MiB single-line data image is detected across bounded chunks and classified before any editor/product path | PASS at scanner layer; threshold -1/exact/+1 and every split boundary covered; ambiguous candidates fail closed |
| `PERF-010` / `PERF-LARGE-001` | Runtime-generated 10 MiB multiline UTF-8 is classified `largeText`; measured scanner duration and retained-buffer bound are recorded | PASS at scanner layer |
| `CONTRACT-010` | Deterministic cancellation stops a streaming scan before full consumption | PASS |
| `CONTRACT-011` | Binary/invalid UTF-8/oversize remain `Unsupported`; safety-blocked reports expose no body or Base64 snippet | PASS for spike report shape |
| `FILE-001` supporting evidence | Pre-rename failure leaves old bytes complete; post-rename state contains complete new bytes; stale task-owned temporary files are scoped and removable | PASS on macOS spike; full-name/owner/age validation preserves malformed decoys, symlinks, directories, and recent files; product fault matrix remains Phase 1 |
| `CONTRACT-024` | Record bounded raw/wire-budget feasibility evidence without claiming end-to-end Tauri transport | Stream sizing PASS only; actual Tauri/WebView transport NOT RUN and remains an F0 blocker |
| `AC-SAFE-002`, `AC-SAFE-005` | Spike-level classifier/timing evidence only; real UI/WebView acceptance remains owned by later product/E2E tasks | supporting evidence PASS; product AC not claimed |

## Changes made

- Added one dependency-free Rust integration-test harness; no product module imports it.
- Implemented a fixed-size streaming scan that observes exact accepted byte thresholds, streaming UTF-8 validity, binary indicators, BOM/line metrics, and `data:image/...;base64,` state across arbitrary read boundaries.
- Closed the independent-review data-image blocker: folded header/payload whitespace and CRLF no longer terminate counting; percent-obfuscated, overlong-header, malformed-padding, or otherwise unprovable image candidates enter a fail-closed quarantine instead of returning editable; threshold -1/exact/+1 is checked at every possible two-read split.
- Defined the spike's physical-line measurement explicitly: the UTF-8 BOM is excluded from line bytes, both bytes of CRLF are excluded from line bytes and count as one line ending, while a lone CR remains content. One-byte chunk tests cover BOM and CRLF boundaries.
- Added deterministic cancellation and read-failure paths that return no partial success/body.
- Added runtime generators for 8/32 MiB file boundaries, 256 KiB/1 MiB line boundaries, 512 KiB decoded-image boundaries, 10 MiB multiline text, and 10 MiB single-line data image; no hazardous fixture is stored in Git.
- Added explicitly macOS-only same-directory temp/write/flush/sync/rename/directory-sync feasibility with injected failures before and after the commit point; no Windows replace claim is made.
- Closed the independent-review stale-cleanup blocker: temporary names now use an exact versioned fixed-width grammar bound to the target filename and owner UID; cleanup additionally requires a secure regular file (`0600`, one hard link), matching target/candidate ownership, and both embedded timestamp and filesystem mtime to be stale. Same-prefix malformed files, wrong-owner files, symlinks, directories, unrelated files, and recent valid files are retained.
- Added bounded worst-case JSON escape sizing for the accepted 32 MiB raw / 193 MiB wire budget without pretending it exercises the Tauri WebView bridge.

## Decisions and assumptions

- The spike lives only under the Rust integration-test tree so no disposable feasibility implementation becomes a product command or service.
- Hazardous inputs are generated inside validated process-scoped temporary directories and are never committed or logged.
- Scanner memory evidence means an explicit retained-state bound (fixed read buffer plus constant parser state); whole-process RSS includes the Rust/Tauri test harness and will not be misrepresented as scanner memory.
- Ambiguous image candidates are represented by an internal spike counter and conservatively map to the existing `largeDataImage` safety reason; the frozen IPC schema is not changed. The production preflight task must keep a typed internal ambiguity path without exposing blocked bytes.
- BOM/CRLF accounting above is a spike measurement definition, not a silent frozen-schema change. Integration/Native Core must carry the same definition into the production policy or persist a reviewed contract clarification before `P1-PREFLIGHT-01`.
- macOS same-directory `rename`/directory-sync feasibility is the only atomic-replace result. Windows replacement, file-share, and directory-durability semantics remain a separately tested production adapter responsibility.
- Threshold order and values were copied unchanged from the accepted policy. No design, schema, error-code, flag, manifest, dependency, or lockfile change was required.

## Verification evidence

| Test / acceptance ID | Exact command and environment | Result | Artifact or failure |
|---|---|---|---|
| `PROC-001` | `ruby scripts/validate_design_docs.rb` at `5982219` before handoff metadata | PASS | snapshot `becce4ad080c0625d55341a7c7965a4033bbe1c9f63194f6daaf305e3e5aed8c` |
| `BUILD-001` baseline | `pnpm install --frozen-lockfile && PATH=<rustup-bin>:$PATH pnpm verify`; macOS 26.6.2 arm64, rustc 1.98.0, pnpm 10.32.1, project Node 24.14.0 | PASS | frontend 3/3; Rust 0 tests before spike; Vite and Tauri debug build PASS |
| `SAFE-001`, `SAFE-003`, `PERF-010`, `CONTRACT-010`, `CONTRACT-011`, `FILE-001`, `CONTRACT-024` | `PATH=<rustup-bin>:$PATH cargo test --manifest-path src-tauri/Cargo.toml --test p0_spike_02_native_safety -- --nocapture --test-threads=1`; debug at `dcd1b6e`, same environment | PASS, 16/16 | 10 MiB multiline `235,203 us`; data image `212,091 us`; scanner retained bound `65,644 B`; worst JSON sizing `1,040,846 us` |
| `SAFE-003`, `PERF-010`, `CONTRACT-024` | `PATH=<rustup-bin>:$PATH cargo test --release --manifest-path src-tauri/Cargo.toml --test p0_spike_02_native_safety -- --nocapture --test-threads=1` at `dcd1b6e` | PASS, 16/16 | release: multiline `40,762 us`; data image `43,463 us`; worst JSON sizing `92,557 us`; 32 MiB raw -> `202,375,168 B` wire; JSON retained bound `458,752 B`; explicitly not WebView transport |
| Rust format/lint | `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`; `cargo clippy --manifest-path src-tauri/Cargo.toml --test p0_spike_02_native_safety -- -D warnings` | PASS | no warnings |
| Full branch gate | `ruby scripts/validate_design_docs.rb && PATH=<rustup-bin>:$PATH pnpm verify` at `dcd1b6e` with handoff metadata; macOS 26.6.2 arm64, rustc 1.98.0, pnpm 10.32.1, project Node 24.14.0 | PASS | validator, Prettier, ESLint, TypeScript, frontend 3/3, Rust 16/16, Vite build, Tauri debug build |
| Schema drift | searched repository for a schema/generator drift command | NOT RUN | `P0-CONTRACT-01` has not landed on this base; no schema/generated file was touched; Integration must run its new drift gate after ordered merge |

## Open questions and blockers

- The two independent-review P0 blockers are closed in the spike: ambiguous/cross-boundary data images no longer fail open, and stale cleanup no longer accepts a loose same-prefix name.
- **F0 blocker — Integration/Contract owner:** this branch proves only bounded `CONTRACT-024` raw/wire sizing. It does not send 32 MiB ordinary text and the approximately 193 MiB worst-escaped wire payload through the actual Tauri/WKWebView bridge as required by 03 §10.5 and §17. A separate real transport harness must pass before F0; otherwise an accepted chunk/handle ADR and regenerated contract are required. Product code must not assume success.
- **Cross-platform follow-up — Native Core:** Windows replacement/share-mode and directory durability semantics were not run because the atomic-replace spike is compiled and tested only on macOS. A Windows platform adapter and equivalent fault matrix remain required before Windows support is claimed.

## Remaining numbered steps

1. An independent reviewer rechecks `dcd1b6e` specifically against the two prior blocker reproductions and this task note.
2. Integration merges the reviewed branch in Phase 0 order, then reruns the new contract/schema gate and full repository gate on the integration head.
3. Before F0, Integration assigns a separate actual Tauri/WKWebView raw/wire transport experiment; sizing alone cannot close `CONTRACT-024`.
4. After F0, `P1-PREFLIGHT-01` reimplements the proven algorithm behind frozen production contracts and adds product-level outcomes/UI integration; it must not copy test-only code into a Tauri command wholesale.

## Data safety, recovery, and temporary artifacts

No user documents, clipboard bytes, recovery data, personal paths, or committed large fixtures are used. Tests create only uniquely named synthetic directories under the OS temporary root, validate their scope before cleanup, and emit only byte counts, durations, retained-state bounds, and outcome enums. Successful debug/release/full-gate runs left no task temporary file. A killed/failed test may leave only a synthetic task-prefixed directory for diagnosis; no user file is touched.

## Single recommended next action

An independent reviewer rechecks implementation `dcd1b6e`; after a clean review, Integration preserves the explicit F0 transport blocker and merges only when Phase 0 ordering allows it.
