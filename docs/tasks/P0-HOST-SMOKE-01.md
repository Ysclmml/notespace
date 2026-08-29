# P0-HOST-SMOKE-01 — macOS release host smoke harness

- Status: CLAIMED
- Owner / next owner: `/root/p0_host_smoke` / Integration
- Base revision / head revision: `4fcc284` / pending
- Requirement IDs: `EDIT-IME-001`, `FILE-SAVE-001`, `OPS-BUILD-001`, `OPS-CONTEXT-001`, `OPS-HANDOFF-001`
- Product UX IDs: `UX-EDIT-003`, `UX-KEY-001`, `UX-PLATFORM-001` (Phase 0 host evidence only; this task does not complete product acceptance)
- Test / acceptance IDs: `IME-001`, `FILE-001`, `AC-KEY-001`, `AC-PLATFORM-001`, `BUILD-001`, `PROC-001`, `PROC-002`
- ADRs / contract and schema versions: `ADR-0001`, `ADR-0002`; IPC `1.0-draft` untouched
- Feature flags: no product flag; proposed non-default Cargo build feature `host-release-smoke`, additionally latched by a test-only runtime environment variable
- Owned and touched paths: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/src/host_release_smoke.rs`, `src/app/bootstrap/AppBootstrap.tsx`, `src/features/editor/host-smoke/**`, `tests/host-smoke/**`, this task note, and only the `P0-HOST-SMOKE-01` row in `docs/PROJECT_STATE.md`

## Goal and non-goals

Supply the missing macOS release-host evidence required by accepted `ADR-0001` migration/rollback: a real Tauri/WKWebView harness that can record Chinese composition candidate confirmation and cancellation against a real CodeMirror control; expose a system menu plus a native chooser whose cancel path reads no path or content; and execute a scoped atomic-replace self-test only below a private system-temporary directory with a structured, content-free report.

The harness is test-only. It does not implement Phase 1 open/save/session behavior, does not change frozen IPC or product feature flags, does not read user documents, and cannot by itself complete `AC-KEY-001`, `AC-PLATFORM-001`, or the full `FILE-001` fault-injection matrix. Real Pinyin candidate interaction and visual menu/chooser verification remain an Integration-run host step.

## Dependencies and baseline

- Dependency task/freeze status: explicit dependency on reviewed `P0-SPIKE-01` tip `4fcc284`; F0 is not published and Phase 1 remains blocked. Integration explicitly delegated the narrow host evidence task and the non-default Cargo/test build surface.
- Baseline commands:
  - `ruby scripts/validate_design_docs.rb`
  - `volta run --node 24.14.0 --pnpm 10.32.1 pnpm install --frozen-lockfile`
  - `PATH="${CARGO_HOME:-${HOME}/.cargo}/bin:${PATH}" volta run --node 24.14.0 --pnpm 10.32.1 pnpm verify`
- Baseline result: PASS at `4fcc284` on macOS 26.6.2 (25G83) arm64, Node 24.14.0, pnpm 10.32.1, and Rust 1.98.0. The documentation gate reported 23 Markdown files / 70 relative links / 83 test IDs and snapshot `1e299acb...`; the full repository gate passed 21/21 frontend tests, Rust fmt/clippy/tests, the 33-module product Vite build, and a Tauri debug build.

## Acceptance criteria status

| Requirement / acceptance ID | Expected evidence | Status |
|---|---|---|
| `IME-001` / `EDIT-IME-001` | Release WKWebView records composition start/update/end, candidate-confirm final state, candidate-cancel unchanged state, and no decoration switch while composing | PENDING |
| `AC-KEY-001` / `UX-KEY-001` | Host-only system menu is visually reviewable and its deterministic menu IDs are reported | PENDING; partial Phase 0 evidence only |
| `AC-PLATFORM-001` / `UX-PLATFORM-001` | Release macOS host exposes the real WKWebView, native chooser, and manual Pinyin flow | PENDING; partial Phase 0 evidence only |
| `FILE-001` / `FILE-SAVE-001` | Host self-test writes only a private system-temp fixture, flushes, atomically replaces, verifies old-or-new integrity, and reports without paths/content | PENDING; success-path host evidence only |
| `BUILD-001` / `OPS-BUILD-001` | Default debug/release contain no host-smoke surface; explicit non-default release build launches and reports | PENDING |
| `PROC-001`, `PROC-002` | Durable task context, exact evidence, limitations, and next action survive handoff | IN PROGRESS |

## Changes made

None yet.

## Decisions and assumptions

- The reviewed editor spike is used only as a real CodeMirror input control; no Phase 1 session/file behavior is inferred from it.
- Test UI and commands must require both a non-default build-time gate and a runtime opt-in. Default debug/release binaries must not contain callable host commands or visible harness UI.
- The chooser harness never reads a `File`, filename, browser fake path, or bytes. It reports only cancel/change event kind and selected-count bucket; a selected file is not accepted by the smoke path.
- Structured artifacts contain booleans, enums, counts, timings, versions, and hashes of fixed test expectations only. They contain no user text, clipboard data, document content, or absolute path.

## Verification evidence

| Test / acceptance ID | Exact command and environment | Result | Artifact or failure |
|---|---|---|---|
| `PROC-001`, `PROC-002` baseline docs | `ruby scripts/validate_design_docs.rb` at `4fcc284`; macOS 26.6.2 arm64 | PASS; 23 Markdown files, 70 relative links, 83 test IDs | stdout only; snapshot `1e299acb...` |
| `BUILD-001` inherited baseline | `volta run --node 24.14.0 --pnpm 10.32.1 pnpm install --frozen-lockfile` then pinned Rust `PATH` + `pnpm verify` at `4fcc284` | PASS; 21/21 frontend tests, Rust fmt/clippy/tests, Vite build, Tauri debug build | ignored build output only |

## Open questions and blockers

- Owner Integration: perform the final real macOS Pinyin candidate-confirm/cancel and visual system-menu/native-chooser interaction after automated release-host checks pass. This is required because synthetic DOM events are not platform IME evidence.

## Remaining numbered steps

1. Implement the doubly gated release host surface, structured report, and temp-only atomic self-test.
2. Add automated default-build isolation and explicit-release runner coverage.
3. Run full gates, audits, and a clean-clone replay; record the minimal manual host procedure.
4. Update this note and the ledger to `REVIEW` for Integration.

## Data safety, recovery, and temporary artifacts

The task may create only runner-owned private directories under the canonical system temporary directory. No user file, clipboard image, personal path, or Markdown body may be read or persisted. The runner must remove only the exact directory it created; failure reports retain only a redacted artifact basename or digest.

## Single recommended next action

Run the documented baseline at `4fcc284`, then implement the default-off host harness without changing production IPC or flags.
