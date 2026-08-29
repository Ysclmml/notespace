# P0-HOST-SMOKE-01 — macOS release host smoke harness

- Status: REVIEW
- Owner / next owner: `/root/p0_host_smoke` / Integration
- Base revision / head revision: `4fcc284` / `770ec51` (implementation head; reviewed handoff metadata follows)
- Requirement IDs: `EDIT-IME-001`, `FILE-SAVE-001`, `OPS-BUILD-001`, `OPS-CONTEXT-001`, `OPS-HANDOFF-001`
- Product UX IDs: `UX-EDIT-003`, `UX-KEY-001`, `UX-PLATFORM-001` (Phase 0 host evidence only; no product acceptance claim)
- Test / acceptance IDs: `IME-001`, `FILE-001`, `AC-KEY-001`, `AC-PLATFORM-001`, `BUILD-001`, `PROC-001`, `PROC-002`
- ADRs / contract and schema versions: accepted `ADR-0001`, accepted `ADR-0002`; IPC `1.0-draft` untouched
- Feature flags: no product flag; non-default Cargo feature `host-release-smoke`, test-build-only `VITE_HOST_RELEASE_SMOKE=1`, runtime `MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE=1`, manual/automated mode, and private system-temp-root gates
- Owned and touched paths: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/src/host_release_smoke.rs`, `src-tauri/src/host_release_smoke_init.js`, `src/app/bootstrap/AppBootstrap.tsx`, `src/features/editor/host-smoke/**`, `tests/host-smoke/**`, this task note, and only the `P0-HOST-SMOKE-01` row in `docs/PROJECT_STATE.md`

## Goal and non-goals

Supply the missing macOS release-host evidence named by accepted `ADR-0001` migration/rollback: a real Tauri/WKWebView harness that can record system Chinese composition confirmation and cancellation against a real CodeMirror control; expose a system menu and a native chooser whose cancel path reads no path/content; and execute an atomic-replace self-test only below a private system-temporary directory with a structured, content-free report.

The harness is test-only. It does not implement Phase 1 open/save/session behavior, change frozen IPC or product flags, read a user document, or complete the product `IME-001`, `FILE-001`, `AC-KEY-001`, or `AC-PLATFORM-001` acceptance suites. `automatedReady` proves only the automatic host prerequisites; it is not `manualPass`. Real system-Pinyin, menu activation, and chooser open/cancel remain Integration-run host evidence.

## Dependencies and baseline

- Explicit dependency: reviewed `P0-SPIKE-01` tip `4fcc284`, used only for the real CodeMirror control. F0 was not inferred and Phase 1 remained out of scope.
- Integration delegated the narrow host evidence surface, including the non-default Cargo/test build.
- Baseline at `4fcc284`: `ruby scripts/validate_design_docs.rb`, frozen `pnpm install`, and pinned `pnpm verify` passed on macOS 26.6.2 arm64 with Node 24.14.0, pnpm 10.32.1, and Rust 1.98.0.

## Acceptance criteria status

| Requirement / acceptance ID | Expected evidence | Status |
|---|---|---|
| `IME-001` / `EDIT-IME-001` | Trusted release-WKWebView composition start/update/end, strict `beforeinput`/`input` pairs, confirmed fixed text, and canceled unchanged fixed text | AUTOMATIC HARNESS PASS; real system-Pinyin confirmation/cancellation PENDING Integration; no product `IME-001` claim |
| `AC-KEY-001` / `UX-KEY-001` | Host-only system menu is visible and native activation is recorded | PARTIAL PASS: native menu construction/report automated; real activation PENDING Integration; no product AC claim |
| `AC-PLATFORM-001` / `UX-PLATFORM-001` | Release macOS host uses WKWebView, real CodeMirror, and native chooser | PARTIAL PASS: release host/control/input mounted automatically; chooser must actually open and emit trusted cancel under Integration; no product AC claim |
| `FILE-001` / `FILE-SAVE-001` | Private-temp self-test flushes, atomically replaces, verifies integrity, and reports no path/content | PASS for the scoped success-path host self-test; the product fault-injection matrix remains out of scope |
| `BUILD-001` / `OPS-BUILD-001` | Default debug/release have zero harness surface; only the explicitly gated feature release can run | PASS: default builds are marker/legacy-command free; feature + runtime + mode + private-root gates fail closed; automatic host report is `automatedReady` |
| `PROC-001`, `PROC-002` | Durable exact evidence, limitations, and next action survive handoff | PASS after final task-note/state checkpoint |

## Changes made

- Added a macOS-only, non-default Cargo feature. Default native builds do not compile the host module, and the default frontend build does not import the host screen.
- Added build-time Vite, native feature, runtime opt-in, mode, release-profile, macOS, and canonical private-system-temp-root gates. A feature build without the runtime latch uses the ordinary shell and writes no report.
- Added a document-start private capture boundary installed after Tauri core and before page scripts. It captures native event accessors, DOM methods, Tauri invoke, `TextEncoder`, and WebCrypto methods; page React code receives no evidence command or token.
- Added eight independently generated 256-bit values: seven ordered one-time flow tokens plus an evidence-MAC key. The key is immediately imported as a non-extractable sign-only WebCrypto `CryptoKey`; the raw byte buffer and injected key field are cleared after import.
- Added a zero-dependency minimal SHA-256/RFC 2104 HMAC implementation in the host-only Rust module. Length-framed canonical messages authenticate token, scenario/event kind, six counts, exactly six flags, and final UTF-16 length. Rust performs a fixed-content constant-time lowercase-hex comparison before accepting evidence.
- Added sticky native flow states for capture-ready, confirm begin/finish, cancel begin/finish, and chooser begin/finish. Wrong order, wrong token, invalid MAC, failed evidence, and replay cannot become pass.
- Added strict trusted IME capture: `Event.isTrusted`, native `CompositionEvent`/`InputEvent`, one target, a single ordered composition, bounded `data`, required `inputType`/`isComposing`, fixed confirmation text `确认：中文`, and unchanged cancellation text `取消：`. Synthetic or rejected events make the scenario fail.
- Added a browser-native file input. Only a trusted DOM `cancel` can pass; trusted `change` fails. The harness never reads `files`, path, name, content, bytes, streams, or readers. This is reported honestly as a compiled-source denylist audit, not a fabricated runtime read counter.
- Added a private system-temp atomic-replace self-test: create/flush/verify the old fixed fixture, create/flush same-directory staging, atomic rename, directory flush, verify the complete new fixed fixture, and exact cleanup. The report contains no path or content.
- Added a Ruby stdlib release runner that builds/scans the default release, builds the feature release, exercises negative runtime gating, launches with exact PID timeout and a private root, validates schema/privacy, and removes all runner-owned temporary evidence.
- Added malicious negatives for synthetic/untrusted event attempts and same-realm transport payload tampering, plus RFC 4231 and fixed WebCrypto/Rust canonical HMAC vectors.
- Added no dependency. `package.json`, `pnpm-lock.yaml`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock` have no dependency delta from the reviewed predecessor; frozen IPC and product flags are unchanged.

## Decisions and assumptions

- The editor spike is only a real host input control. No spike-only behavior is accepted as Phase 1 architecture.
- Private initialization-script evidence, ordered native tokens, and an authenticated canonical payload are all required. Any missing layer fails closed.
- Same-realm page code may observe or disrupt Tauri transport but cannot change authenticated evidence into a pass; doing so invalidates the Rust-held HMAC check. A replay consumes or encounters a terminal native flow state.
- Reports contain only fixed enums, booleans, bounded counts/lengths, and fixed-schema metadata. Tokens, keys, MACs, user text, filenames, paths, clipboard data, and document content never enter a report or committed artifact.
- `nativeDialogInteractionObserved` means a trusted native DOM chooser event followed an explicitly trusted open action; it does not claim the automatic runner opened the dialog. Automatic mode keeps chooser evidence pending.
- Real Pinyin event compatibility has not been asserted. Integration must run the exact manual sequence on the release host and accept only the runner's fail-closed `manualPass` validation.

## Verification evidence

| Test / acceptance ID | Exact command/environment | Result | Artifact or failure |
|---|---|---|---|
| `PROC-001`, `PROC-002` baseline docs | `ruby scripts/validate_design_docs.rb` at `4fcc284`; macOS 26.6.2 arm64 | PASS; 23 Markdown files / 70 links / 83 test IDs | stdout only |
| `BUILD-001` inherited baseline | frozen `pnpm install` then pinned Rust `PATH` + `volta run --node 24.14.0 --pnpm 10.32.1 pnpm verify` at `4fcc284` | PASS; 21/21 frontend tests, Rust fmt/clippy/tests, Vite build, Tauri debug build | ignored build output only |
| `IME-001`, `BUILD-001` authenticated focused tests | `volta run --node 24.14.0 --pnpm 10.32.1 pnpm exec vitest run src/features/editor/host-smoke/hostReleaseSmokeInit.test.ts`; `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --features host-release-smoke` | PASS; 3/3 JS tests and 6/6 Rust tests, including synthetic/untrusted, altered transport, wrong order/token, replay, RFC 4231, fixed cross-runtime vector, and chooser-change negatives | stdout only |
| `BUILD-001`, `IME-001`, `FILE-001` full task gate | `PATH="<rustup-bin>:$PATH" volta run --node 24.14.0 --pnpm 10.32.1 pnpm verify` at `770ec51` | PASS; format/lint/typecheck, 24/24 frontend tests, Rust fmt/clippy, 6/6 host Rust tests, default Vite build, default Tauri debug build | ignored build output only |
| `BUILD-001`, `IME-001`, `FILE-001`, `AC-KEY-001`, `AC-PLATFORM-001` release runner | `PATH="<rustup-bin>:$PATH" ruby tests/host-smoke/run_host_release_smoke.rb` at `770ec51` | PASS; default release marker/legacy-command free, feature release markers present, runtime-negative wrote no report, document-start WebCrypto/capture ready, atomic/menu/frontend/static-no-read ready, manual evidence pending, `resultState=automatedReady` | runner-owned private report/log/root removed after validation |
| same IDs, clean clone | `git clone --no-local --branch task/P0-HOST-SMOKE-01-host-release <local-repo> <system-temp>/repo`; frozen `pnpm install`; pinned `pnpm verify`; release runner; docs gate at `770ec51` | PASS; 24/24 frontend, 6/6 Rust host, default debug build, default/feature release isolation, automatic WKWebView report | exact clean-clone root removed securely after PASS |
| dependency security audit | npm-registry `pnpm audit --audit-level low` and `cargo audit` in `src-tauri` at `770ec51` | PASS; no npm/Rust vulnerability finding; 17 inherited allowed RustSec warnings | no repository artifact; no dependency/lock delta |
| dependency/manifest isolation | `git diff --exit-code 7dc08a6 -- src-tauri/Cargo.toml src-tauri/Cargo.lock` | PASS; no direct-dependency or lock delta for the HMAC repair | stdout only |
| independent strict security/release review | read-only review of `7dc08a6..770ec51` plus current durable handoff; reviewer independently reran focused/full/release/docs checks | MERGE; no security, correctness, release-isolation, privacy, or documentation blocker; validator snapshot `8c438728339c09e3517951b3ddf19531a304a261db37a34880df7dccb2eabe10` | no repository artifact; real system-Pinyin/menu/chooser explicitly left to Integration |
| schema drift | No schema-drift command exists on the `4fcc284` base; this task changed no IPC/schema/generated file | NOT AVAILABLE on this branch; Integration runs the current contract drift gate after combining branches | not a host-harness bypass |
| `PROC-001`, `PROC-002` final docs gate | `ruby scripts/validate_design_docs.rb` after the REVIEW checkpoint | PASS; 23 Markdown files / 70 links / 83 test IDs; snapshot `f923b9c3cfe82492808432a1662483f38098fe9602f1e57b7f28d6b1d88b29ab` before the terminal task-note/ledger metadata mirror | stdout only |

## Open questions and blockers

- Owner Integration, affected `IME-001` / `AC-KEY-001` / `AC-PLATFORM-001`: run the real system-Pinyin confirmation/cancellation, actual native menu activation, and actual chooser open/cancel. Automatic `automatedReady` is not release-host `manualPass`; Phase 0 evidence remains incomplete until this manual result passes.
- Owner Integration / Contract, affected integration gates: after combining this branch with the current contract result, run that revision's schema-drift gate. This branch has no IPC/generated/schema delta, so review and manual host verification may continue.
- Owner Integration / Release, affected dependency hygiene: triage the 17 inherited RustSec warnings in the shared Tauri graph separately. This task added no crate/lock delta and the audit found no vulnerability, so the warnings do not justify widening this host-only task.
- Owner Integration: the first clean-clone attempt from the rejected predecessor was interrupted and securely removed after the NO-MERGE review. Only the final `770ec51` clean clone above counts as verification evidence.

## Remaining numbered steps

1. Integration runs `PATH="<rustup-bin>:$PATH" ruby tests/host-smoke/run_host_release_smoke.rb --manual` from the reviewed or integrated revision.
2. In the visible release host, activate **Host Smoke → Record Menu Activation**.
3. Click **Begin confirm capture**, focus the fixed `确认：` editor, use the macOS system Pinyin IME to type `zhongwen`, choose `中文`, then click **Record confirm evidence**.
4. Click **Begin cancel capture**, focus the fixed `取消：` editor, start a system-Pinyin composition, press Escape so the fixed text remains unchanged, then click **Record cancel evidence**.
5. Click the chooser control, verify the native file dialog actually opens, cancel it without selecting a file, then refresh and complete the runner flow.
6. Accept only runner output `manual PASS`. Any missing trusted event, altered sequence, wrong final text, invalid MAC/token, chooser `change`, or incomplete menu evidence stays failed and must be recorded as an `ADR-0001` host blocker.
7. Integration merges/rebases as appropriate and reruns current full, release-runner, schema-drift, and manual host gates before accepting Phase 0 evidence.

## Data safety, recovery, and temporary artifacts

All automatic runner roots and the final clean-clone root were removed by exact canonical path after PASS. One initial cleanup command failed before deletion because it omitted Ruby's `tmpdir` library; the validated retry then securely removed the exact root, and a negative existence check passed. The harness read no user file, clipboard image, personal path, Markdown body, filename, chooser path, or chooser content. Reports contain no token, key, MAC, user text, path, or content. No screenshot, report, log, or temporary fixture is committed. A timed-out/manual-incomplete run terminates only its exact child PID and can write only below its private system-temp root.

## Single recommended next action

Integration runs the seven-step manual release-host flow above and accepts only a fail-closed `manualPass` result.
