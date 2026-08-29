# P0-HOST-SMOKE-01 — macOS release host smoke harness

- Status: CLAIMED
- Owner / next owner: `/root/p0_host_smoke` / Integration
- Base revision / head revision: `4fcc284` / `263d750` (NO-MERGE review restart; fix pending)
- Requirement IDs: `EDIT-IME-001`, `FILE-SAVE-001`, `OPS-BUILD-001`, `OPS-CONTEXT-001`, `OPS-HANDOFF-001`
- Product UX IDs: `UX-EDIT-003`, `UX-KEY-001`, `UX-PLATFORM-001` (Phase 0 host evidence only; this task does not complete product acceptance)
- Test / acceptance IDs: `IME-001`, `FILE-001`, `AC-KEY-001`, `AC-PLATFORM-001`, `BUILD-001`, `PROC-001`, `PROC-002`
- ADRs / contract and schema versions: `ADR-0001`, `ADR-0002`; IPC `1.0-draft` untouched
- Feature flags: no product flag; non-default Cargo build feature `host-release-smoke`, test-build-only `VITE_HOST_RELEASE_SMOKE=1`, and runtime `MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE=1` latch
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
| `IME-001` / `EDIT-IME-001` | Release WKWebView records composition start/update/end, candidate-confirm final state, candidate-cancel unchanged state, and no decoration switch while composing | HARNESS PASS; real system-Pinyin interaction PENDING Integration; does not complete product `IME-001` |
| `AC-KEY-001` / `UX-KEY-001` | Host-only system menu is visually reviewable and its deterministic menu IDs are reported | PARTIAL PASS: native menu construction/report automated; human activation PENDING; no product AC claim |
| `AC-PLATFORM-001` / `UX-PLATFORM-001` | Release macOS host exposes the real WKWebView, native chooser, and manual Pinyin flow | PARTIAL PASS: release WKWebView, CodeMirror and native file input automated; visual interaction PENDING; no product AC claim |
| `FILE-001` / `FILE-SAVE-001` | Host self-test writes only a private system-temp fixture, flushes, atomically replaces, verifies old-or-new integrity, and reports without paths/content | PASS for the scoped success-path host self-test; full product fault-injection matrix remains out of scope |
| `BUILD-001` / `OPS-BUILD-001` | Default debug/release contain no host-smoke surface; explicit non-default release build launches and reports | PASS: default debug/release sentinel-free; doubly gated host release reports `automatedReady` |
| `PROC-001`, `PROC-002` | Durable task context, exact evidence, limitations, and next action survive handoff | PASS |

## Changes made

- Added a macOS-only, non-default `host-release-smoke` Cargo feature. The module is absent from default native builds and registers no product IPC or product feature flag.
- Added a fail-closed native harness with fixed command/menu IDs, immutable runtime frontend latch, structured content-free JSON, release-only startup validation, sticky evidence failures, and exact-PID timeout behavior.
- Added a real CodeMirror/WKWebView test screen that observes native composition events and the reviewed spike's freeze phases. Confirmation and cancellation use fixed test strings; only event counts, booleans, and UTF-16 length cross the test bridge.
- Added a browser-native file input that observes only `cancel`/`change` plus selected-count. Source and runner checks reject `FileReader`, byte/text streams, filename, fake path, and relative-path access.
- Added a private system-temp atomic-replace self-test: create old version, flush, verify, create/flush same-directory staging version, atomic rename, directory flush, verify complete new version, and exact cleanup.
- Added a Ruby stdlib release runner that builds and scans default release, builds the explicit host release, checks the runtime latch negatively, launches with a private root and timeout, validates the report, and optionally exposes the four-step manual host flow.
- Added no dependency. `pnpm-lock.yaml` and `src-tauri/Cargo.lock` have no delta; frozen IPC `1.0-draft` and product flags are untouched.

## Decisions and assumptions

- The reviewed editor spike is used only as a real CodeMirror input control; no Phase 1 session/file behavior is inferred from it.
- Test UI and commands must require both a non-default build-time gate and a runtime opt-in. Default debug/release binaries must not contain callable host commands or visible harness UI.
- The host frontend additionally requires a native-injected, non-writable window latch. A host-feature binary launched without the runtime enable variable keeps the ordinary shell and writes no smoke report.
- The chooser harness never reads a `File`, filename, browser fake path, or bytes. It reports only cancel/change event kind and selected-count bucket; a selected file is not accepted by the smoke path.
- Structured artifacts contain booleans, enums, counts, timings, versions, and hashes of fixed test expectations only. They contain no user text, clipboard data, document content, or absolute path.
- A synthetic composition event is never accepted as release-host proof. The automated report deliberately leaves both IME scenarios, menu activation, and chooser cancellation `pending`; only real Integration interaction can produce `manualPass`.

## Verification evidence

| Test / acceptance ID | Exact command and environment | Result | Artifact or failure |
|---|---|---|---|
| `PROC-001`, `PROC-002` baseline docs | `ruby scripts/validate_design_docs.rb` at `4fcc284`; macOS 26.6.2 arm64 | PASS; 23 Markdown files, 70 relative links, 83 test IDs | stdout only; snapshot `1e299acb...` |
| `BUILD-001` inherited baseline | `volta run --node 24.14.0 --pnpm 10.32.1 pnpm install --frozen-lockfile` then pinned Rust `PATH` + `pnpm verify` at `4fcc284` | PASS; 21/21 frontend tests, Rust fmt/clippy/tests, Vite build, Tauri debug build | ignored build output only |
| `BUILD-001`, `IME-001`, `FILE-001` full task gate | `PATH="<rustup-bin>:$PATH" volta run --node 24.14.0 --pnpm 10.32.1 pnpm verify` at `9d33b40`; macOS 26.6.2 (25G83) arm64, Node 24.14.0, pnpm 10.32.1, Rust 1.98.0 | PASS; format/lint/typecheck, 23/23 frontend tests, Rust fmt/clippy, 3/3 host Rust tests, default Vite build and default Tauri debug build | ignored build output only |
| `BUILD-001` default debug isolation | `rg -a` negative sentinel scan over default `src-tauri/target/debug/markdown-workspace` and `dist` after `pnpm verify` | PASS; no native or frontend host marker | stdout only |
| `BUILD-001`, `IME-001`, `FILE-001`, `AC-KEY-001`, `AC-PLATFORM-001` release runner | `PATH="<rustup-bin>:$PATH" ruby tests/host-smoke/run_host_release_smoke.rb` at `9d33b40` | PASS twice in the task worktree; default release had no test surface, explicit host release had all expected markers, missing runtime latch wrote no report, automated WKWebView report was `automatedReady` | runner-owned private system-temp report/log removed after validation |
| same IDs, clean clone | `git clone --no-hardlinks --branch task/P0-HOST-SMOKE-01-host-release <local-repo> <system-temp>/repo`; frozen `pnpm install`; pinned `pnpm verify`; release runner | PASS at `9d33b40`; 23/23 frontend, 3/3 Rust host, debug build, default/host release isolation, automated WKWebView report | exact clean-clone temporary root removed after PASS |
| dependency security audit | `pnpm audit --registry=https://registry.npmjs.org --audit-level high --prod` and full dev audit | PASS; no known vulnerabilities | no artifact |
| dependency security audit | `cargo audit --file src-tauri/Cargo.lock` with cargo-audit 0.22.2 | PASS for vulnerabilities; 0 vulnerability findings, 17 inherited allowed warnings (unmaintained GTK3/proc-macro/unic transitive crates and one `glib` unsoundness warning); no lock delta from `4fcc284` | advisory database fetched locally; no repository artifact |
| schema drift | No schema-drift command exists on the `4fcc284` base because `P0-CONTRACT-01` was not integrated; this task changed no IPC/schema/generated file | NOT AVAILABLE on this branch; Integration must run the current contract drift gate after merge | not a host-harness bypass |
| `PROC-001`, `PROC-002` final docs gate | `ruby scripts/validate_design_docs.rb` after REVIEW handoff update | PASS; 23 Markdown files, 70 relative links, 83 test IDs | stdout only; validator emitted the final deterministic snapshot |

## Open questions and blockers

- Owner `/root/p0_host_smoke`: independent review rejected `263d750` because React-authored counts/flags/event kinds could fabricate `manualPass`; `Event.isTrusted`, `InputEvent.data/inputType/isComposing`, a strict single-composition sequence, and chooser trust were not enforced, while fixed zero read-attempt counters were not an observed fact. Replace this with native-nonce-bound private capture/state-machine evidence, malicious synthetic-event negatives, and an accurately labeled static no-read audit before returning to REVIEW.
- Owner Integration: run the final real macOS system-Pinyin candidate-confirm/cancel plus visual system-menu/native-chooser interaction. A valid report must be `manualPass`, menu activation at least one, both IME sections `passed`, chooser event `cancel`, selected-count `zero`, and both read-attempt counts zero. This is required because synthetic DOM events are not platform evidence; all automated work may continue safely.
- Owner Integration / Contract: after combining this branch with the current `P0-CONTRACT-01` result, run that revision's schema-drift gate. This branch has no IPC or generated-file delta, so review and manual host verification may continue.
- Owner Integration / Release: triage the 17 pre-existing RustSec warnings in the shared Tauri lock graph separately. This task introduced no crate or lockfile delta; the scan reported no vulnerabilities, so it does not require widening this harness task.

## Remaining numbered steps

1. Integration runs `PATH="<rustup-bin>:$PATH" ruby tests/host-smoke/run_host_release_smoke.rb --manual` from the reviewed or integrated revision.
2. In the visible host: activate **Host Smoke → Record Menu Activation**; confirm `zhongwen` as `中文`; start another Pinyin composition after `取消：` and press Escape; open and cancel the chooser; then refresh and complete.
3. Integration verifies the runner prints manual PASS and retains no report, log, or temporary root. Any missing event stays fail-closed and must be recorded as an ADR-0001 host blocker, not waved through.
4. Integration merges/rebases as appropriate and reruns the then-current full and schema-drift gates before accepting Phase 0 evidence.

## Data safety, recovery, and temporary artifacts

All automated runner roots and the clean-clone root were removed by exact canonical path after PASS. The harness read no user file, clipboard image, personal path, Markdown body, filename, or chooser path. Reports contained only fixed schema fields, counts, booleans, enums, and timings; process output remained inside the private root and a failure would expose only its SHA-256 digest. No screenshot or report artifact is committed. A killed/manual-incomplete run is recoverable by rerunning; it cannot modify anything outside its private system-temp root.

## Single recommended next action

Integration runs the four-step `--manual` release-host flow and accepts only a fail-closed `manualPass` result.
