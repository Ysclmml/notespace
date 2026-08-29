# P0-SPIKE-02 — Native/Safety feasibility

- Status: DONE
- Owner / next owner: Integration / `P1-PREFLIGHT-01`
- Base revision / implementation head revision: original base `52dc387`, implementation `67e33dd`, reviewed handoff `eb11e2e`, main merge `d30e1db`
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
| `SAFE-003` / `SAFE-DATAURI-001` | Runtime-generated 10 MiB single-line data image is detected across bounded chunks and classified before any editor/product path | PASS at scanner layer; threshold -1/exact/+1 and every split boundary covered; ambiguous candidates fail closed; TAB/LF/CR at every `data:image/` prefix position cannot evade detection across arbitrary split boundaries at the production 512 KiB + 1 decoded boundary |
| `PERF-010` / `PERF-LARGE-001` | Runtime-generated 10 MiB multiline UTF-8 is classified `largeText`; measured scanner duration and retained-buffer bound are recorded | PASS at scanner layer |
| `CONTRACT-010` | Deterministic cancellation stops a streaming scan before full consumption | PASS |
| `CONTRACT-011` | Binary/invalid UTF-8/oversize remain `Unsupported`; safety-blocked reports expose no body or Base64 snippet | PASS for spike report shape |
| `FILE-001` supporting evidence | Pre-rename failure leaves old bytes complete; post-rename state contains complete new bytes; stale task-owned temporary files are scoped and removable | PASS on macOS spike; random UUID v4 operation names and a durable private issuance manifest are required; cleanup discovers only issued entries, moves candidates into a private same-filesystem quarantine, and rechecks temp/target/manifest identity before deletion; exact-shape unissued same-owner decoys, malformed names, symlinks, directories, recent files, and a deterministic path-swap replacement are not deleted |
| `CONTRACT-024` | Record bounded raw/wire-budget feasibility evidence without claiming end-to-end Tauri transport | Stream sizing PASS only; actual Tauri/WebView transport NOT RUN and remains an F0 blocker |
| `AC-SAFE-002`, `AC-SAFE-005` | Spike-level classifier/timing evidence only; real UI/WebView acceptance remains owned by later product/E2E tasks | supporting evidence PASS; product AC not claimed |

## Changes made

- Added one isolated Rust integration-test harness; no product module imports it, and its only direct dependency is the exact-pinned test-only UUID v4 crate described below.
- Implemented a fixed-size streaming scan that observes exact accepted byte thresholds, streaming UTF-8 validity, binary indicators, BOM/line metrics, and `data:image/...;base64,` state across arbitrary read boundaries.
- Closed both data-image review reproductions: folded header/payload whitespace and CRLF no longer terminate counting; percent-obfuscated, overlong-header, malformed-padding, or otherwise unprovable image candidates enter a fail-closed quarantine instead of returning editable; threshold -1/exact/+1 is checked at every possible two-read split. URL-ignored ASCII TAB/LF/CR inserted at every position of `data:image/` retains the candidate and is exercised with one-byte reads plus every split through the obfuscated prefix at the real 512 KiB + 1 decoded threshold.
- Defined the spike's physical-line measurement explicitly: the UTF-8 BOM is excluded from line bytes, both bytes of CRLF are excluded from line bytes and count as one line ending, while a lone CR remains content. One-byte chunk tests cover BOM and CRLF boundaries.
- Added deterministic cancellation and read-failure paths that return no partial success/body.
- Added runtime generators for 8/32 MiB file boundaries, 256 KiB/1 MiB line boundaries, 512 KiB decoded-image boundaries, 10 MiB multiline text, and 10 MiB single-line data image; no hazardous fixture is stored in Git.
- Added explicitly macOS-only same-directory temp/write/flush/sync/rename/directory-sync feasibility with injected failures before and after the commit point; no Windows replace claim is made.
- Replaced predictable timestamp/PID/sequence names with an exact target-bound grammar containing a random operation UUID v4. A test-only Rust-owned private journal records a durably synced, bounded, strict manifest for the exact target and temporary dev/inode/UID plus issuance time.
- Cleanup enumerates issuance manifests rather than target-directory prefixes. It requires an exact canonical UUID/name, private one-link `0600` manifest and temporary, matching target/temp dev/inode/UID, and strict issuance/mtime age. An eligible temp is first atomically moved to a private same-filesystem quarantine; temp identity, target identity, and the reloaded manifest identity/content are rechecked before deletion. Any mismatch remains quarantined with its manifest for recovery.
- Added an exact-shape same-owner but unissued decoy, malformed-name decoy, symlink, directory, recent issued temp, crash-issued stale temp, and a deterministic post-stat path swap. The swap replacement is retained in quarantine and restored by explicit rename in the test; the original target and rescued issued temp remain intact.
- Added bounded worst-case JSON escape sizing for the accepted 32 MiB raw / 193 MiB wire budget without pretending it exercises the Tauri WebView bridge.

## Decisions and assumptions

- The spike lives only under the Rust integration-test tree so no disposable feasibility implementation becomes a product command or service.
- Hazardous inputs are generated inside validated process-scoped temporary directories and are never committed or logged.
- Scanner memory evidence means an explicit retained-state bound (fixed read buffer plus constant parser state); whole-process RSS includes the Rust/Tauri test harness and will not be misrepresented as scanner memory.
- Ambiguous image candidates are represented by an internal spike counter and conservatively map to the existing `largeDataImage` safety reason; the frozen IPC schema is not changed. The production preflight task must keep a typed internal ambiguity path without exposing blocked bytes.
- BOM/CRLF accounting above is a spike measurement definition, not a silent frozen-schema change. Integration/Native Core must carry the same definition into the production policy or persist a reviewed contract clarification before `P1-PREFLIGHT-01`.
- macOS same-directory `rename`/directory-sync feasibility is the only atomic-replace result. Windows replacement, file-share, random-name issuance, journal placement, quarantine, and directory-durability semantics remain a separately designed and tested production adapter responsibility; this spike must not be treated as a cross-platform implementation.
- Threshold order and values were copied unchanged from the accepted policy. No design, schema, error-code, feature-flag, runtime-dependency, or JavaScript lockfile change was made.
- The sole dependency change is `uuid = { version = "=1.26.0", features = ["v4"] }` under `[dev-dependencies]`. Integration explicitly approved the exact pin. Version 1.26.0 was already present in `Cargo.lock`; the lock diff adds only the root test crate's direct edge, with no new package, checksum, or unrelated feature. It is MIT OR Apache-2.0 licensed and test-only. Using the reviewed OS-backed UUID v4 generator avoids inventing or mis-auditing custom entropy for a safety test; no runtime dependency is added.
- A crash after private temp creation but before durable manifest issuance can leave an unissued orphan. Cleanup intentionally does not guess ownership and will not delete it. A production adapter must make issuance/reconciliation explicit; preservation is the safe spike result.

## Verification evidence

Environment for final evidence: macOS `26.6.2` (`25G83`) arm64, rustc `1.98.0`, pnpm `10.32.1`, project-managed Node `24.14.0`. Inputs are generated at runtime; no source/Base64 payload is logged or committed.

| Test / acceptance ID | Exact command | Result | Artifact or failure |
|---|---|---|---|
| `PROC-001` second-review baseline | `ruby scripts/validate_design_docs.rb` at `f07e3e5` before edits | PASS | snapshot `9a21a8b57883ec90b3e16a667fbe8da96be8325e27efb63339264db6fa982eef` |
| `SAFE-001`, `SAFE-003`, `PERF-010`, `CONTRACT-010`, `CONTRACT-011`, `FILE-001`, `CONTRACT-024` | `PATH=<rustup-bin>:$PATH cargo test --manifest-path src-tauri/Cargo.toml --test p0_spike_02_native_safety -- --nocapture --test-threads=1` at `67e33dd` | PASS, 18/18 | debug: 10 MiB multiline `251,529 us`; data image `220,428 us`; scanner retained bound `65,644 B`; worst JSON sizing `1,075,479 us` |
| `SAFE-003`, `PERF-010`, `CONTRACT-024` | `PATH=<rustup-bin>:$PATH cargo test --release --manifest-path src-tauri/Cargo.toml --test p0_spike_02_native_safety -- --nocapture --test-threads=1` at `67e33dd` | PASS, 18/18 | release: multiline `41,343 us`; data image `44,313 us`; worst JSON sizing `97,416 us`; 32 MiB raw -> `202,375,168 B` wire; JSON retained bound `458,752 B`; output explicitly says `transport=end_to_end_not_tested` |
| Rust format/lint | `PATH=<rustup-bin>:$PATH cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`; `PATH=<rustup-bin>:$PATH cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` at `67e33dd` | PASS | no warnings |
| Cargo dependency review | `git diff f07e3e5..67e33dd -- src-tauri/Cargo.toml src-tauri/Cargo.lock` | PASS | exact test-only UUID v4 direct edge; lockfile adds one root dependency line and no package/checksum/feature block |
| `PROC-001`, `PROC-002` full branch gate | `ruby scripts/validate_design_docs.rb`; `PATH=<rustup-bin>:$PATH pnpm verify` after the implementation and handoff metadata | PASS | validator reported 22 Markdown files, 69 relative links, 83 fence pairs, and `RESULT=PASS`; full gate passed Prettier, ESLint, TypeScript, frontend 3/3, Rust fmt/clippy and 18/18 spike tests, Vite build, and Tauri debug no-bundle build |
| Schema drift | searched repository for a schema/generator drift command | NOT RUN | `P0-CONTRACT-01` has not landed on this base; no schema/generated file was touched; Integration must run its new drift gate after ordered merge |
| Integration focused gates | `cargo test --manifest-path src-tauri/Cargo.toml --test p0_spike_02_native_safety -- --nocapture --test-threads=1`; same command with `--release` on main merge `d30e1db` | PASS, debug 18/18 and release 18/18 | release: multiline 41,211 us; data image 42,665 us; worst JSON 69,227 us; retained bounds unchanged |
| Integration repository gate | `PATH="${HOME}/.cargo/bin:${PATH}" pnpm verify` on main merge `d30e1db` | PASS; frontend 50/50, canonical contract Rust 15/15 + TS 29/29, fixtures 14/18/18/33, Rust unit 17/17 + safety 18/18, Vite and Tauri debug build | stdout only; no user content or hazardous committed artifact |

## Open questions and blockers

- The review-targeted spike blockers are closed for independent re-review: URL-ignored TAB/LF/CR at every prefix position no longer causes the matcher to abandon a candidate, and cleanup cannot delete an exact-shape unissued decoy or a post-stat path-swap replacement. This statement is scoped to the Rust/macOS spike and is not a product acceptance claim.
- **F0 BLOCKER — Integration/Contract owner:** this branch proves only bounded `CONTRACT-024` raw/wire sizing. It does not send 32 MiB ordinary text and the approximately 193 MiB worst-escaped wire payload through the actual Tauri/WKWebView bridge as required by 03 §10.3, §10.5, and §17. A separate real transport harness must pass before F0; if either ordinary or worst-escaping transport fails, an accepted chunk/handle ADR plus regenerated contract is required. `CONTRACT-024` and F0 transport are not closed by this task.
- **Cross-platform follow-up — Native Core:** Windows replacement/share-mode, random issuance storage, quarantine/recovery, and directory durability semantics were not run because the atomic-replace spike is compiled and tested only on macOS. A Windows platform adapter and equivalent fault/recovery matrix remain required before Windows support is claimed.
- **Production issuance follow-up — Native Core:** the deliberate fail-safe behavior for a crash before manifest durability is to retain an unissued orphan. Production must specify journal placement, issuance reconciliation, retention, operator-visible recovery, and bounded garbage collection without relaxing exact ownership.

## Remaining numbered steps

1. Before F0, Integration merges and verifies the separately reviewed actual Tauri/WKWebView raw/wire transport experiment; sizing alone cannot close `CONTRACT-024`.
2. After F0, `P1-PREFLIGHT-01` reimplements the proven algorithm behind frozen production contracts and adds product-level outcomes/UI integration; it must not copy test-only code into a Tauri command wholesale.

## Data safety, recovery, and temporary artifacts

No user documents, clipboard bytes, recovery data, personal paths, or committed large fixtures are used. Tests create only uniquely named synthetic directories under the OS temporary root, validate their scope before cleanup, and emit only byte counts, durations, retained-state bounds, and outcome enums. Successful debug/release/full-gate runs left no task temporary file. A killed/failed test may leave only a synthetic task-prefixed directory for diagnosis; no user file is touched.

For the path-swap case, cleanup moves the replacement into the private same-filesystem `.mdapp-spike-quarantine-v1` directory, reports its operation UUID and quarantine path, retains the issuance manifest, and does not unlink either mismatched object. Recovery is an explicit operator-reviewed rename or copy from that quarantine path; the deterministic test restores it by rename and verifies the bytes. The spike intentionally has no automatic deletion of quarantined mismatches. An unissued orphan has no manifest and is likewise retained rather than guessed at.

## Single recommended next action

Integration merges the reviewed real Tauri/WKWebView transport spike and retains the later product/platform follow-ups documented above.
