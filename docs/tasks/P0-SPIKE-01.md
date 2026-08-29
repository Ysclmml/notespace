# P0-SPIKE-01 — CodeMirror editor feasibility spike

- Status: REVIEW
- Owner / next owner: Editor review fixes (`/root/p0_spike_01_fix`) / Integration
- Base revision / head revision: `576a435` / `86e109f` (review-fix implementation)
- Requirement IDs: `DATA-SOURCE-001`, `DATA-ROUNDTRIP-001`, `DATA-UNKNOWN-001`, `EDIT-LIVE-001`, `EDIT-UNDO-001`, `EDIT-IME-001`, `EDIT-TABLE-001`, `PERF-VIEWPORT-001`, `PERF-LARGE-001`
- Product UX IDs: none; this is a disposable Phase 0 feasibility spike and cannot complete product acceptance
- Test / acceptance IDs: `RT-001`, `RT-002`, `EDT-LIVE-001`, `EDT-UNDO-001`, `IME-001`, `TABLE-001`, `PERF-001`, `PERF-010`, `PROC-002`
- ADRs / contract and schema versions: `ADR-0001`, `ADR-0002`, `ADR-0004`; IPC `1.0-draft` untouched
- Feature flags: none; the spike is not wired into the application shell
- Owned and touched paths: `src/features/editor/spike/**`, `package.json`, `pnpm-lock.yaml`, this task note, and only the `P0-SPIKE-01` row in `docs/PROJECT_STATE.md`

## Goal and non-goals

Build an isolated, removable CodeMirror 6 harness that measures and tests composition/IME event semantics, viewport-bounded incremental decorations, unified undo/redo, cursor-local source reveal, and synthetic large-text/long-line behavior. Record machine, data sizes, sample counts, measurement boundaries, thresholds, and limitations so `P1-EDITOR-01` can make an evidence-based implementation decision.

This task does not implement the Phase 1 editor, does not connect CodeMirror to React/AppShell, does not open user files, does not define native preflight or IPC, and does not claim full macOS/Windows IME product acceptance from a synthetic DOM harness.

## Dependencies and baseline

- Dependency task/freeze status: `P0-BOOT-01` is `DONE`; F0 is not published and Phase 1 remains blocked.
- Baseline commands:
  - `ruby scripts/validate_design_docs.rb`
  - `volta run --node 24.14.0 --pnpm 10.32.1 pnpm install --frozen-lockfile`
  - `PATH="${CARGO_HOME:-${HOME}/.cargo}/bin:${PATH}" volta run --node 24.14.0 --pnpm 10.32.1 pnpm verify`
- Baseline result: PASS at `576a435` on macOS 26.6.2 arm64, Node 24.14.0, pnpm 10.32.1, Rust 1.98.0. The first `pnpm verify` attempt correctly failed before checks because the new worktree had no `node_modules` and the interactive shell selected Node 16.20.2; the frozen install and pinned PATH resolved only that environment prerequisite. Documentation validator snapshot: `e0905a48147eee7c3264b382aeab2a8c2c2e40dab2ef6b7f5b9963a96cca8509`.

## Acceptance criteria status

| Requirement / acceptance ID | Expected evidence | Status |
|---|---|---|
| `IME-001` / `EDIT-IME-001` | Composition start freezes decoration switching; composition end schedules one refresh; teardown cancels pending work | PASS at DOM-event-order/transaction layer: `composing -> refreshPending -> idle`; a final post-`compositionend` mutation maps only and the single RAF rescans; target-platform IME remains a later product gate |
| `EDT-LIVE-001` / `EDIT-LIVE-001` | Cursor-local complete source range is revealed without changing `EditorState.doc` | PASS for heading/link/image/fenced-code/emphasis/table ranges, cursor, and non-empty selection; table outranks nested link/inline-code and reveals the complete table source |
| `EDT-UNDO-001` / `EDIT-UNDO-001` | Typing/composition edits use one CodeMirror history while decoration/selection work adds no history entries | PASS at isolated editor layer; navigation/multi-view integration is out of scope |
| `PERF-001` / `PERF-VIEWPORT-001` | Instrumentation proves decoration scanning is bounded to requested visible ranges and maps/recomputes incrementally | PASS; proven plain-word interior edits rescan relevant visible ranges, while fence/list/quote/reference-definition boundary edits conservatively rebuild all current visible ranges and match a fresh projection |
| `PERF-010` / `PERF-LARGE-001` | Runtime-generated 10 MiB multiline source-only state and permitted long-line cases remain locally editable within recorded spike thresholds | PASS for editor-side feasibility; native classification and full click-to-input remain later gates |
| `RT-001`, `RT-002`, `TABLE-001` | Spike mutations preserve untouched/unknown/table source bytes; no renderer serialization is introduced | Source-preservation feasibility PASS; formal open/save and rendered-table gates remain Phase 1/4 |

## Changes made

- Pinned `@codemirror/state` 6.7.1, `view` 6.43.9, `commands` 6.11.0, `language` 6.12.4, and `lang-markdown` 6.5.2 as development-only dependencies. Their 21 added transitive packages are lockfile-pinned; CodeMirror/Lezer packages report MIT licenses.
- Added an isolated CodeMirror/Lezer GFM harness with complete-node source reveal, visible-range marker replacement, changed-range rescanning, composition freeze/next-frame refresh, teardown cancellation, and unified CodeMirror history.
- Added deterministic in-memory Markdown, 10 MiB multiline, 256 KiB + 1, and 1 MiB long-line generators. No large source is written to the repository or artifact.
- Added fifteen focused tests covering cursor and non-empty selection, unknown/incomplete syntax, exact pipe-table source, structural ancestor priority, composition DOM-event ordering, undo/redo, cancellation, range normalization, proven-local scanning, cross-line syntax propagation, and generator failure boundaries.
- Closed independent review findings: structural punctuation or an unproven Markdown context now invalidates changed-line reuse and rebuilds `visibleRanges`; source reveal has explicit table/fence/image/link priority; composition stays frozen through the post-end RAF window.
- Added a disposable DOM input harness that dispatches actual `composition*`, `beforeinput`, and `input` event types/order. Because jsdom has no native IME DOM mutation pipeline, the harness explicitly applies the transaction that CodeMirror's browser observer would otherwise derive.
- Added a separate 30-sample measurement config/command. The ignored JSON artifact contains only environment, sizes, thresholds, timing summaries, undo depths, RSS totals, and limitations.
- Confirmed the product entry graph does not import the spike. Production Vite output remains 33 modules / 193.99 kB JavaScript (61.22 kB gzip), matching the pre-spike shell build.

## Decisions and assumptions

- CodeMirror packages added by this spike will be development dependencies because no product runtime path consumes the harness. Integration may promote only packages intentionally reused by `P1-EDITOR-01`.
- Tight P0 user budgets remain defined by design documents. Spike timing assertions will use separately labeled feasibility ceilings appropriate to a non-release jsdom/Node harness and will report raw samples; they do not revise product budgets.
- Synthetic large inputs are created at runtime and never persisted as repository fixtures or artifacts containing content.
- Source reveal chooses the highest-priority complete safe ancestor at each selection boundary: a table or fenced block dominates nested inline syntax, then image/link specificity applies, while equal-priority inline structures keep the smallest complete range. Fully covered selection nodes remain included.
- Composition changes map existing decorations but do not rescan or switch them during both `composing` and `refreshPending`. `compositionend` enters `refreshPending`; the single next-frame callback returns to `idle` before dispatching a non-history refresh. View teardown or a superseding composition cancels pending work.
- A changed-line refresh is allowed only for a word-character edit inside an otherwise plain-text line with word characters on both sides. This intentionally narrow proof excludes structural punctuation and reference definitions; all unproven edits rebuild only current `visibleRanges`, preventing stale off-line syntax projections without scanning the whole document.
- The 10 MiB path intentionally uses source-only CodeMirror state with no Markdown language or live decoration extension, matching the accepted `largeText` degradation direction. Rust remains authoritative for deciding whether a document may enter this path.
- The post-review measurement process retained 315,310,080 B RSS after repeatedly constructing/destroying all 30-sample scenarios without forced GC. This is below the 512 MiB spike ceiling but is not a memory-plateau proof; `P1-EDITOR-01`/`P5-LARGE-01` must measure real WebKit lifecycle and multiple views.

## Verification evidence

| Test / acceptance ID | Exact command and environment | Result | Artifact or failure |
|---|---|---|---|
| `PROC-002` baseline docs | `ruby scripts/validate_design_docs.rb` at `576a435`, macOS 26.6.2 arm64 | PASS; 21 Markdown files, 68 links, 83 test IDs | stdout only; snapshot `e0905a48...` |
| `BUILD-001` inherited baseline | pinned Node/Rust PATH + `pnpm install --frozen-lockfile && pnpm verify` at `576a435` | PASS; 3 frontend tests, Rust fmt/clippy/tests, Vite and Tauri debug build | `src-tauri/target/debug/markdown-workspace` (ignored build output) |
| `IME-001`, `EDT-LIVE-001`, `EDT-UNDO-001`, `RT-002`, `TABLE-001`, `PERF-001`, `PERF-010` | `volta run --node 24.14.0 --pnpm 10.32.1 pnpm exec vitest run src/features/editor/spike/editorSpike.test.ts --reporter=verbose` at `86e109f` | PASS; 15/15 tests, including opening/closing fence, list continuation, quote/fence, reference-definition propagation, post-composition final input, and table structural priority | stdout only; no document-content artifact |
| `PERF-001`, `PERF-010` | `volta run --node 24.14.0 --pnpm 10.32.1 pnpm test:editor-spike:measure --reporter=verbose --logHeapUsage`; Apple M3 Max, 16 logical CPUs, 48 GiB, macOS 26.6.2 arm64, Node 24.14.0, Vitest 3.2.7 + jsdom 26.1.0; 3 warm-ups + 30 samples at `86e109f` | PASS. p95 ms: 243 KiB Markdown mount 6.79/edit 0.53; 10 MiB source-only mount 13.84/edit 0.10; 256 KiB + 1 line mount 0.53; 1 MiB line mount 0.52. RSS delta 315,310,080 B < 512 MiB ceiling | ignored `benchmark-results/P0-SPIKE-01/editor-spike.json`; metrics/limitations only |
| `BUILD-001` repository gate | `PATH="${CARGO_HOME:-${HOME}/.cargo}/bin:${PATH}" volta run --node 24.14.0 --pnpm 10.32.1 pnpm verify` at `86e109f`; macOS 26.6.2 arm64, Rust 1.98.0 | PASS; formatter, lint, typecheck, 18/18 frontend tests, Rust fmt/clippy/tests, Vite and Tauri debug build | ignored build output; Vite product bundle unchanged at 33 modules / 193.99 kB JS (61.22 kB gzip) |
| dependency security/license | `volta run --node 24.14.0 --pnpm 10.32.1 pnpm audit --registry=https://registry.npmjs.org --audit-level high` and `pnpm licenses list --json` | PASS; no known vulnerabilities; CodeMirror/Lezer dependency set MIT | stdout only |
| isolation/privacy/schema check | `git diff --check`; scoped `rg` scans for product imports, personal paths, embedded data images; inspect `src/generated/ipc.ts` / `tests/contract` presence at `86e109f` | PASS; no product import, personal path, embedded payload, or whitespace error. Schema-drift runner is not present on this branch because parallel `P0-CONTRACT-01` has not integrated; Integration must run it after merge | stdout only |
| `PROC-001`, `PROC-002` documentation gate | `ruby scripts/validate_design_docs.rb` after implementation | PASS; 22 Markdown files, 69 relative links, 83 test IDs, 43 implementation tasks | stdout only; snapshot is intentionally not embedded because task-note content participates in that hash |

## Open questions and blockers

- No Phase 0 feasibility blocker was found.
- Owner `P1-EDITOR-01` / `P4-A11Y-01`: run real macOS Pinyin in WKWebView and Windows Microsoft Pinyin in WebView2 for candidate confirm/cancel, both observed final-input orderings, cursor movement, mouse selection, and Tab/view-switch. The new harness proves DOM event/transaction policy but explicitly substitutes the browser-observer mutation and is not platform IME evidence.
- Owner `P1-EDITOR-01` / `P5-LARGE-01`: rerun the 30-sample timing and memory-plateau matrix in release WebKit/WebView2 with actual layout, animation frames, five views of one session, and ten different documents.
- Owner Integration / `P1-EDITOR-01`: decide whether to promote the five direct CodeMirror packages to runtime dependencies. `@codemirror/lang-markdown` brings HTML/JavaScript parser support transitively even though this spike renders no raw HTML; product bundling should remain driven by used imports and CSP review.
- Owner `P0-CONTRACT-01`: provide the schema-drift runner. It is not available on this task's base, and this spike changes no schema or IPC code.

## Remaining numbered steps

1. Integration reviews the feasibility claims and dependency footprint, merges the branch in Phase 0 order, and reruns the full gate plus the then-current schema-drift runner.
2. `P1-EDITOR-01` consumes the findings only after F0; it must not treat this disposable harness as the frozen editor/session adapter.

## Data safety, recovery, and temporary artifacts

No user documents or clipboard data are read. Large/long-line sources are deterministic in-memory values. The metrics-only JSON contains no fixture text or path. `node_modules`, `dist`, Rust `target`, generated Tauri schema output, and benchmark output remain ignored and can be regenerated. No cleanup can affect user files.

## Single recommended next action

Integration reviews and merges `task/P0-SPIKE-01-editor`, then reruns `ruby scripts/validate_design_docs.rb`, the full repository gate, the editor measurement command, and the schema-drift command available on the integration head.
