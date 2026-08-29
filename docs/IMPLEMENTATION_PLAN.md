# Markdown Desktop Editor — Multi-Agent Implementation Plan

Status: approved execution baseline 0.1  
Audience: implementers, reviewers, integration/release owner  
Scope: local-first Typora-like desktop editor with browser-style navigation, safe image paste, unsafe-input protection, and zoomable diagrams

This is the execution plan, not the product or architecture specification. Durable project status is recorded in [`PROJECT_STATE.md`](PROJECT_STATE.md), the mandatory overview and precedence rules are in [`DESIGN.md`](DESIGN.md), stable requirements and their IDs are defined in [`REQUIREMENTS.md`](REQUIREMENTS.md), product behavior is defined in [`design/01-product-ux.md`](design/01-product-ux.md), and system boundaries/contracts are defined in [`design/02-system-architecture.md`](design/02-system-architecture.md) and [`design/03-domain-model-and-contracts.md`](design/03-domain-model-and-contracts.md). When they disagree, stop implementation, record the conflict durably, and let the integration owner resolve it through a requirement change or ADR.

## 1. Delivery principles

1. The Markdown file remains the source of truth. Opening and saving without an edit must never reformat it.
2. Potentially hostile or huge input is inspected before it becomes a JavaScript string or enters CodeMirror.
3. A `DocumentSession` is not a `Tab`; a `Tab` is not a `ViewState`. Shared content and independent navigation state stay separate.
4. Rust owns filesystem, clipboard binary data, atomic writes, recovery, and resource policy. TypeScript owns presentation and application state.
5. Contracts are generated and tested. `src/generated/ipc.ts` is generated from the Rust schema and is never hand-edited.
6. Incomplete capabilities remain behind named feature flags; safety checks fail closed.
7. Parallel work is organized around disjoint directories and frozen interfaces, not around broad feature descriptions.

## 2. Task protocol

### Durable context protocol

Chat history, agent memory, and a previous context window are non-durable hints. They are never an authoritative requirement, decision, task state, verification record, or handoff. If information is needed by the next agent, persist it in the repository before stopping.

Every task starts from this fixed context chain:

```text
AGENTS.md
  → docs/PROJECT_STATE.md
  → docs/DESIGN.md
  → docs/REQUIREMENTS.md + relevant docs/design/*.md
  → relevant accepted ADRs and domain code/tests
  → docs/tasks/<TASK-ID>.md
```

Do not reverse this order by trusting an older task note over current project state or accepted design. If later sources conflict with earlier sources, record the conflict under `Open questions` and stop at the affected boundary.

Stable traceability IDs are mandatory and must reuse, not replace, the repository's established namespaces:

- requirements: IDs exactly as defined in `docs/REQUIREMENTS.md`, for example `DATA-ROUNDTRIP-001`, `NAV-HISTORY-001`, and `ASSET-PASTE-001`; every user-visible task **MUST** also cite its applicable `UX-*` ID. The only exception is a crosswalk row explicitly marked “产品直接验收”, where UX + its AC is complete; a purely infrastructural task may use only engineering/contract IDs and its phase gate;
- implementation tasks: the phase IDs in this plan, such as `P2-HISTORY-01`;
- tests/acceptance/evidence: the IDs defined by `REQUIREMENTS.md` and the relevant test design, for example `RT-001`, `SAFE-003`, and `AC-NAV-001`, even if the executable test has a language-specific name;
- decisions: `ADR-NNNN`, matching `docs/decisions/NNNN-short-title.md`.

Never mint a parallel `REQ-*` or `TEST-*` namespace merely for a task note. New IDs are added by the owning requirements/test document and remain stable when their wording changes.

At task start, before implementation:

1. Read the fixed chain completely for the task's scope.
2. After claiming, rerun the recorded baseline checks; create or refresh `docs/tasks/<TASK-ID>.md` with requirement IDs, intended test/acceptance IDs, owned paths, contract versions, feature flags, base revision, and the new evidence.
3. Update only the task's entry in `docs/PROJECT_STATE.md` to `CLAIMED`, including owner, requirement IDs, base revision, scope, and task-note link.
4. Re-read `docs/PROJECT_STATE.md` immediately before patching it; keep the edit surgical and do not reformat another agent's entry.

At every task end, including `REVIEW`, `BLOCKED`, context-pressure checkpoint, or agent handoff:

1. Update the task note using the standard handoff template below.
2. Persist exact verification evidence and unresolved questions; “tests pass” without commands/results is not evidence.
3. Update the task's `docs/PROJECT_STATE.md` entry with status, head revision, evidence summary/link, open questions, and next owner/action.
4. Feature owners end at `REVIEW` or `BLOCKED`; only Integration marks `DONE` after integration gates.

If context may be compacted before normal task end, perform the same checkpoint immediately. Continuing from chat alone is prohibited.

### Status vocabulary

- `READY`: dependencies and acceptance criteria are satisfied; no owner yet.
- `CLAIMED`: one owner is implementing it.
- `BLOCKED`: an explicit dependency, decision, or external requirement prevents progress.
- `REVIEW`: implementation and local verification are complete.
- `DONE`: merged in integration order and all gates pass on the integration branch.

Each implementation task gets a single-owner note at `docs/tasks/<TASK-ID>.md`. `PROJECT_STATE.md` contains only the required compact start/end checkpoint; detailed progress belongs in the task note so multiple agents do not contend on a central narrative. The note records IDs, owner, base/head revisions, touched paths, decisions, evidence, remaining work, unresolved questions, and handoff revision. The integration owner updates phase status only at checkpoints.

### Definition of ready

A task is ready only when:

- every listed dependency is `DONE` or its required contract freeze is published;
- acceptance tests and owned paths are known;
- no unresolved product/architecture conflict affects the task;
- required fixture data exists or the task explicitly owns creating it;
- Integration has recorded a successful baseline on the advertised base revision. A future owner is not required while status is unowned `READY`; it must rerun that baseline immediately after claim and before implementation edits.

### Definition of done

A task is done only when:

- behavior and error paths meet the linked design contract;
- tests were added at the lowest useful layer and all required gates pass;
- generated bindings, schema version, docs, and flags are updated when applicable;
- logs and diagnostics do not expose document content or unredacted sensitive paths;
- no temporary bypass, skipped test, or unowned TODO remains;
- another owner or the integration owner reviewed it.

## 3. Phase map

Task IDs 中的 `P0-`…`P6-` 前缀表示**交付 Phase 编号**，不是 `REQUIREMENTS.md` 的产品优先级。例如产品 P0 的 Mermaid 会在 Phase 4 的 `P4-MERMAID-01` 实现，而产品 P1 的 Math 也可是 Phase 4 的 `P4-MATH-01`。任务优先级必须从所引用 requirement/UX ID 读取，禁止根据 task 前缀推断。

| Phase | Outcome | Earliest dependent phase |
|---|---|---|
| 0 — Foundation and contract freeze | Reproducible shell, schemas, fixtures, CI, risk spikes | Phase 1 |
| 1 — Safe editing vertical slice | Open, edit, save, reload, cancel, recover one document safely | Phase 2 and 3 |
| 2 — Browser-style workspace | Router, tabs, per-tab history, links, tree, outline | Phase 4 |
| 3 — Clipboard assets and repair | Transactional screenshot paste, staging, Base64 guard/repair | Phase 4 |
| 4 — Hybrid rendering | Typora-like live preview, math, Mermaid viewer, table UX | Phase 5 |
| 5 — Reliability and performance | Restore, conflicts, large documents, security and soak gates | Phase 6 |
| 6 — Product completion and distribution | Search, optional layouts, themes/export, signed packages | Release candidate |
| Later — Extension train | Backlinks, extensible resources, optional AI/local tooling | Post-v1 |

### 3.1 Minimum traceability map

The task owner narrows this mapping in the task note before changing code. A product/behavior task with no persisted requirement and test/acceptance IDs is not `READY`; foundation tasks must instead cite their OPS/ARCH/DOM contract and phase exit gate.

The rows below are minimum grouped seeds, not a waiver: before claim, each individual user-visible task copies only its applicable engineering + UX + evidence IDs into its task note. A direct-gate UX row uses UX + AC as defined above.

| Task(s) | Minimum requirement IDs | Minimum test / acceptance IDs |
|---|---|---|
| `P0-BOOT-01`, `P0-CI-01` | `OPS-BUILD-001`, `OPS-CI-001`, `OPS-CONTEXT-001` | `BUILD-001`, `CI-001`, `PROC-001` |
| `P0-CONTRACT-01`, `P0-FLAG-01` | `DATA-REVISION-001`, `SAFE-IPC-001`, `EXT-ROUTER-001`, `EXT-COMMAND-001`, `UX-EXT-001` | `CORE-001`, `SEC-001`, `EXT-001`, `EXT-002`, `CONTRACT-001`, `CONTRACT-002`, `CONTRACT-003` |
| `P0-FIXTURE-01`, `P0-SPIKE-01` | `DATA-ROUNDTRIP-001`, `DATA-UNKNOWN-001`, `EDIT-IME-001`, `EDIT-TABLE-001` | `RT-001`, `RT-002`, `IME-001` |
| `P0-SPIKE-02`, `P1-PREFLIGHT-01` | `FILE-PREFLIGHT-001`, `PERF-LARGE-001`, `SAFE-DATAURI-001`, `SAFE-IPC-001`, `UX-SAFE-001` | `SAFE-001`, `SAFE-003`, `AC-SAFE-002`, `AC-SAFE-005`, `CONTRACT-024` |
| `P1-FILE-01`, `P1-SAVE-01` | `FILE-OPEN-001`, `FILE-SAVE-001`, `DATA-ROUNDTRIP-001`, `DATA-CONFLICT-001`, `FILE-WATCH-001`, `UX-FILE-001`, `UX-FILE-002`, `UX-ERROR-001`, `UX-ERROR-002`, `UX-PLATFORM-001` | `RT-001`, `FILE-SCOPE-001`, `FILE-001`, `FILE-002`, `FILE-004`, `AC-EDIT-001`, `AC-SAFE-003`, `AC-PLATFORM-001`, `CONTRACT-004`, `CONTRACT-006`, `CONTRACT-007`, `CONTRACT-010`, `CONTRACT-011`, `CONTRACT-016`, `CONTRACT-020`, `CONTRACT-021` |
| `P1-SESSION-01`, `P1-EDITOR-01`, `P1-SHELL-01`, `P1-E2E-01` | `DATA-SOURCE-001`, `DATA-REVISION-001`, `FILE-DRAFT-001`, `RECOVERY-DIRTY-001`, `EDIT-UNDO-001`, `EDIT-IME-001`, `EDIT-FIND-001`, `UX-DOC-001`, `UX-DRAFT-001`, `UX-EDIT-003`, `UX-FIND-001`, `UX-KEY-001`, `UX-TAB-002` | `CORE-001`, `EDT-UNDO-001`, `IME-001`, `FIND-001`, `AC-EDIT-002`, `AC-EDIT-003`, `AC-DRAFT-001`, `AC-FIND-001`, `AC-KEY-001`, `CONTRACT-005`, `CONTRACT-009`, `CONTRACT-022`, `CONTRACT-023` |
| `P1-THEME-01` | `UX-A11Y-002` | `AC-A11Y-004` |
| `P2-ROUTER-01`, `P2-LINK-01` | `EXT-ROUTER-001`, `NAV-DISPOSITION-001`, `NAV-ANCHOR-001`, `EDIT-LINK-001`, `SAFE-URL-001`, `UX-NAV-001`, `UX-NAV-004` | `EXT-001`, `NAV-DISP-001`, `LINK-001`, `LINK-EDIT-001`, `SEC-002`, `AC-NAV-002`, `CONTRACT-019` |
| `P2-TABS-01`, `P2-HISTORY-01` | `NAV-MODEL-001`, `NAV-HISTORY-001`, `NAV-RESTORE-001`, `NAV-ASYNC-001`, `UX-DOC-001`, `UX-NAV-002`, `UX-NAV-003`, `UX-TAB-001`, `UX-TAB-002` | `NAV-CORE-001`, `NAV-CORE-002`, `HISTORY-001`, `HISTORY-RESTORE-001`, `AC-NAV-001`, `AC-NAV-003`, `AC-NAV-004`, `CONTRACT-009`, `CONTRACT-013`, `CONTRACT-014` |
| `P2-INDEX-01`, `P2-E2E-01` | `FILE-WATCH-001`, `NAV-ANCHOR-001`, `NAV-ASYNC-001`, `NAV-WORKSPACE-001`, `UX-WORKSPACE-001` | `FILE-002`, `LINK-001`, `NAV-CORE-002`, `WORKSPACE-001`, `AC-WORKSPACE-001`, `CONTRACT-019` |
| `P3-ASSET-01`, `P3-STAGING-01`, `P3-PASTE-01`, `P3-E2E-01` | `ASSET-PASTE-001`, `ASSET-BASE64-001`, `ASSET-STAGING-001`, `ASSET-UNDO-001`, `UX-IMAGE-001`, `UX-IMAGE-002`, `UX-SESSION-001` | `ASSET-001`, `SAFE-002`, `ASSET-002`, `ASSET-003`, `AC-EDIT-003`, `AC-IMAGE-001`, `AC-IMAGE-002`, `AC-IMAGE-003`, `CONTRACT-012`, `CONTRACT-017`, `CONTRACT-021` |
| `P3-GUARD-01` | `FILE-PREFLIGHT-001`, `SAFE-DATAURI-001`, `UX-IMAGE-003`, `UX-SAFE-001`, `UX-SAFE-002` | `SAFE-001`, `SAFE-003`, `AC-SAFE-001`, `AC-SAFE-004` |
| `P4-LIVE-01`, `P4-TABLE-01` | `EDIT-LIVE-001`, `EDIT-TABLE-001`, `UX-EDIT-001`, `UX-EDIT-002`, `UX-FILE-002`, `UX-TABLE-001`, `UX-TABLE-002` | `EDT-LIVE-001`, `TABLE-001`, `AC-EDIT-003`, `AC-EDIT-004`, `AC-TABLE-001`, `AC-TABLE-002` |
| `P4-MERMAID-01`, `P4-VIEWER-01` | `EDIT-MERMAID-001`, `EDIT-MERMAID-002`, `SAFE-RENDER-001`, `EXT-BLOCK-001`, `UX-DIAGRAM-001`, `UX-DIAGRAM-002` | `VIS-001`, `VIS-002`, `SEC-003`, `EXT-010`, `AC-DIAGRAM-001`, `AC-DIAGRAM-002`, `AC-DIAGRAM-003` |
| `P4-A11Y-01` | `UX-A11Y-001`, `UX-A11Y-002`, `UX-KEY-001`, `UX-PLATFORM-001` | `AC-A11Y-001`, `AC-A11Y-002`, `AC-A11Y-003`, `AC-A11Y-004`, `AC-KEY-001`, `AC-PLATFORM-001` |
| `P5-RECOVERY-01`, `P5-CONFLICT-01` | `RECOVERY-DIRTY-001`, `RECOVERY-LOOP-001`, `DATA-CONFLICT-001`, `UX-ERROR-001`, `UX-ERROR-002`, `UX-SESSION-001` | `REC-001`, `REC-002`, `FILE-004`, `AC-RECOVERY-001`, `CONTRACT-008`, `CONTRACT-015`, `CONTRACT-018`, `CONTRACT-023` |
| `P5-LARGE-01`, `P5-SECURITY-01`, `P5-SOAK-01` | `PERF-VIEWPORT-001`, `PERF-OPEN-001`, `PERF-TAB-001`, `PERF-LARGE-001`, `NAV-RESTORE-001`, `SAFE-IPC-001`, `SAFE-RENDER-001`, `EXT-CAP-001`, `OPS-LOG-001`, `UX-PERF-001`, `UX-PERF-002`, `UX-SAFE-001` | `PERF-001`, `PERF-002`, `PERF-003`, `PERF-004`, `PERF-010`, `SEC-001`, `SEC-003`, `SEC-010`, `OBS-001`, `AC-PERF-001`, `AC-PERF-002`, `AC-PERF-003`, `AC-PERF-004`, `AC-PERF-005` |
| `P6-LAYOUT-01` | `NAV-PEEK-001`, `NAV-SPLIT-001`, `UX-PEEK-001`, `UX-SPLIT-001` | `PEEK-001`, `SPLIT-001` |
| `P6-SESSION-01` | `NAV-REORDER-001`, `NAV-REOPEN-001`, `RECOVERY-WINDOW-001`, `UX-TAB-003`, `UX-TAB-004`, `UX-SESSION-002` | `AC-NAV-005`, `AC-NAV-006`, `AC-SESSION-001` |
| `P6-TABLE-01` | `EDIT-TABLE-002`, `UX-TABLE-003` | `TABLE-010`, `AC-TABLE-003` |
| `P6-PACKAGE-01` | `OPS-RELEASE-001`, `OPS-LOG-001`, `UX-PLATFORM-001` | `RELEASE-001`, `OBS-001`, `AC-PLATFORM-001` |
| all tasks and handoffs | `OPS-CONTEXT-001`, `OPS-HANDOFF-001` | `PROC-001`, `PROC-002` |

`P4-MATH-01` is an optional P1 task traced to `EDIT-MATH-001` / `UX-MATH-001` / `AC-MATH-001`; it may remain disabled without blocking v1. Phase 6/later tasks without an explicit mapping in this plan acquire requirement and acceptance IDs through a requirements amendment before becoming `READY`; their presence does not silently promote them into P0.

Phase 0 fixture/spike rows establish fixture availability and feasibility evidence only; they never complete a product AC that requires the real application. Such AC IDs appear on the feature/E2E task that owns the shipped behavior (for example `AC-EDIT-001` in Phase 1 and `AC-TABLE-002` in Phase 4).

## 4. Phase 0 — Foundation and contract freeze

### Tasks

| ID | Suggested owner | Depends on | Deliverable and acceptance |
|---|---|---|---|
| `P0-BOOT-01` | Integration | Design docs | If the directory is still unversioned, initialize Git, add a privacy-safe `.gitignore`, validate and commit the approved design baseline before any parallel worktree; then scaffold Tauri 2 + Rust + React/TypeScript so one command starts the desktop shell and the directory layout matches architecture. Never include `.DS_Store`, user corpora, personal paths, recovery data, or generated hazardous fixtures. |
| `P0-CI-01` | Integration/QA | `P0-BOOT-01` | Formatting, lint, typecheck, Rust tests, frontend tests, contract tests, and artifact build run in CI with pinned tool versions. |
| `P0-CONTRACT-01` | Contract/Domain | Design docs, `P0-BOOT-01` | Define IPC v1 schema, error/event envelopes, command cancellation, core models, and generate `src/generated/ipc.ts`. Establish the `CONTRACT-001`–`CONTRACT-024` canonical manifest/runner; F0 executes and gates `CONTRACT-001`–`CONTRACT-003`, while `004`–`024` freeze IDs/fixture ports and become required in their mapped feature tasks (09 §5.7). |
| `P0-FIXTURE-01` | QA | Product spec | Curated Markdown fixtures: GFM, CJK/IME, duplicate headings, relative links, images, math, Mermaid, invalid UTF-8, external modification, huge Base64, and huge single line. Huge fixtures are generated during tests, not committed as blobs. |
| `P0-SPIKE-01` | Editor | `P0-BOOT-01` | CodeMirror spike validates IME, composition events, incremental decorations, large-line behavior, undo/redo, and cursor-local source reveal. Record measured limits. |
| `P0-SPIKE-02` | Native/Safety | `P0-BOOT-01` | Rust spike validates bounded preflight scan, cancellation, streaming Base64 detection, same-directory atomic replacement, and crash-safe temporary-file cleanup. |
| `P0-FLAG-01` | Application Core | `P0-CONTRACT-01` | Typed feature-flag registry with production defaults, test overrides, dependency validation, and diagnostic visibility. |

### Freeze F0: IPC and domain vocabulary

Freeze after `P0-CONTRACT-01` passes. It includes:

- the complete versioned command whitelist owned by `design/03-domain-model-and-contracts.md`: capabilities plus app-scope reconcile/native-open ack/close response, application/workspace grants, `document_pick_v1`, `resource_grant_v1`, resource resolve/bounded preview, idempotent draft creation, document open/save/reload/conflict/repair, durable-intent Save-As prepare/abort/commit/status/ack, `document_read_disk_snapshot_v1`, asset import/release, dirty checkpoint/recovery list-open-discard and explicit `session_discard_v1`, P1 window-state save/load, cancellation, external-open and typed reveal commands; the Phase 0 task copies exact names/IDs from that canonical table rather than reconstructing them from this summary;
- models: `Workspace`, `ResourceRef`, `DocumentLoadState`, `DocumentSession`, `DocumentView`, `Tab`, `NavEntry`, `ViewState`, `AssetRef`, `DiskRevision`, `SessionRevision`;
- versioned command/error/event envelopes, event sequence rules, cancellation, and save-conflict semantics;
- Rust-schema-to-TypeScript generation and contract snapshot tests.

After F0, a breaking change requires an accepted ADR, IPC version decision, regenerated bindings, migration/compatibility notes, and updated contract tests.

### Exit criteria

- Clean checkout builds and launches on the primary development OS.
- CI reproduces all local baseline checks.
- IPC bindings are generated, not handwritten, and schema drift fails CI.
- Both risk spikes have documented measurements and no unresolved feasibility blocker.
- Fixture policy prevents secrets and oversized binary/text blobs from entering Git.

## 5. Phase 1 — Safe editing vertical slice

### Tasks

| ID | Suggested owner | Depends on | Deliverable and acceptance |
|---|---|---|---|
| `P1-FILE-01` | Native Core | F0 | Workspace/resource resolution and bounded `document_open_v1`; paths are canonicalized within granted scope and binary/invalid-text cases return typed diagnostics. Implement trusted native open/drop events so Finder/OS paths become grant-backed targets without crossing the WebView boundary raw. |
| `P1-PREFLIGHT-01` | Native/Safety | `P1-FILE-01`, `P0-SPIKE-02` | File-size, longest-line, data-URI, UTF-8, and rich-block risk report streams before editor creation; all long work is cancellable. |
| `P1-SESSION-01` | Application Core | F0, `P1-FILE-01` | `DocumentSessionRegistry` with one session per canonical resource, disk/session revisions, dirty state, reference counting, and deterministic state transitions. |
| `P1-EDITOR-01` | Editor | F0, `P0-SPIKE-01` | CodeMirror adapter supports load, incremental edit, selection, undo/redo, composition, Unicode find/replace (including largeText), and serialized `ViewState`; no filesystem knowledge. |
| `P1-SAVE-01` | Native Core | `P1-FILE-01`, `P1-SESSION-01` | Conflict-aware atomic save/reload, temporary file cleanup, recovery journal, and durable Save-As intent/status/ack. A failed save leaves the original intact; commit-response loss deterministically resumes the same outcome. |
| `P1-SHELL-01` | Workspace Shell | `P1-SESSION-01`, `P1-EDITOR-01`, `P1-SAVE-01` | Minimal window can create an idempotent unnamed dirty draft, open, edit, first-Save-As/save, reload, and respond to native close through app reconcile/closeRequest id without losing unsaved state; native-open batches are acked only after idempotent acceptance. |
| `P1-THEME-01` | UX | `P1-SHELL-01` | Product P0 built-in light/dark token themes cover shell, editor, focus, selection, errors and active states; pass `AC-A11Y-004`. Fine-grained/custom themes remain later scope. |
| `P1-E2E-01` | QA | `P1-FILE-01`, `P1-PREFLIGHT-01`, `P1-SESSION-01`, `P1-EDITOR-01`, `P1-SAVE-01`, `P1-SHELL-01`, `P1-THEME-01` | Golden round-trip, CJK composition, crash-during-save, cancellation, invalid input, dirty-close, and external revision tests. |

### Freeze F1: editor/session boundary

Freeze the editor adapter commands/events, `DocumentSessionRegistry` state machine, revision comparison, dirty-state semantics, and `ViewState` serialization. Navigation work may not reach into CodeMirror internals after F1.

### Exit criteria

- A normal Markdown file completes open → edit → atomic save → reopen with expected bytes.
- Open → save with no edit produces no write and zero textual difference.
- Save failure, cancellation, and forced process termination do not corrupt the original.
- Huge/unsafe input never constructs the primary editor and leads to a typed safe-mode decision.
- CJK IME, undo/redo, selection, and dirty-close tests pass.

## 6. Phase 2 — Browser-style workspace

### Tasks

| ID | Suggested owner | Depends on | Deliverable and acceptance |
|---|---|---|---|
| `P2-ROUTER-01` | Application Core | F1 | `ResourceRouter` resolves Markdown documents, anchors, settings, and viewer resources; all UI entry points use it instead of direct file/window navigation. |
| `P2-TABS-01` | Workspace/Navigation | `P2-ROUTER-01` | `TabStore` supports active/background open, close, dirty indicators, and multiple tabs referencing one session; reopen/reorder remain P1. |
| `P2-HISTORY-01` | Workspace/Navigation | `P2-TABS-01` | `NavigationHistory` implements per-tab back/forward stacks and restores anchor/block + pixel offset, cursor, selection, and folds. |
| `P2-INDEX-01` | Native + Workspace | `P1-FILE-01` | File watcher/index, tree, outline, quick open, rename/move notifications, stable resource identity, and capability-checked workspace root/entry reveal through the frozen `RevealTarget` (never raw path). |
| `P2-LINK-01` | Editor + Navigation | `P2-ROUTER-01`, `P2-HISTORY-01`, `P2-INDEX-01` | Relative/absolute local links, duplicate-heading anchors, current/new foreground/new background dispositions, and external URL policy. |
| `P2-E2E-01` | QA | `P2-ROUTER-01`, `P2-TABS-01`, `P2-HISTORY-01`, `P2-INDEX-01`, `P2-LINK-01` | Multi-tab shared edits, independent histories, async-layout position restore, broken links, and file move/rename tests. |

### Freeze F2: resource and navigation contracts

Freeze `ResourceRef`, open dispositions, `Tab`, `NavEntry`, `ViewState`, history mutation rules, anchor normalization, and file-move identity rules. Peek and split view must consume these contracts rather than fork them.

### Exit criteria

- A link can open in place or a new foreground/background tab on every supported OS.
- Back returns to the prior document and meaningful reading position after images/diagrams settle.
- Two tabs can share live document content while retaining independent selections and scroll positions.
- Tree, outline, quick open, search result stubs, and editor links all route through one API.
- Rename/move does not silently orphan live sessions or corrupt links.

## 7. Phase 3 — Clipboard assets and unsafe-input repair

### Tasks

| ID | Suggested owner | Depends on | Deliverable and acceptance |
|---|---|---|---|
| `P3-ASSET-01` | Native/Assets | F0, `P1-SAVE-01` | `asset_import_clipboard_v1` reads binary image data without Base64 IPC, hashes/encodes/writes atomically, applies naming policy, and returns imported/typed needsGrant outcomes with idempotent continuation. |
| `P3-STAGING-01` | Native/Assets | `P3-ASSET-01` | Untitled-document staging, first-save migration, link rewrite plan, rollback, orphan ledger, and delayed safe cleanup. |
| `P3-PASTE-01` | Editor/Assets | `P3-ASSET-01`, `P1-EDITOR-01` | Paste transaction prevents default data-URI/HTML insertion, commits Markdown link only after asset success, preserves selection, and supports undo/redo without premature deletion. |
| `P3-GUARD-01` | Native/Safety | `P1-PREFLIGHT-01` | Stream extract/delete/replace for large image data URIs into a new temporary Markdown and asset; original remains recoverable until explicit confirmation. |
| `P3-E2E-01` | QA | `P3-ASSET-01`, `P3-STAGING-01`, `P3-PASTE-01`, `P3-GUARD-01` | Clipboard formats, concurrent names, unsaved migration, disk-full/permission failures, undo/redo, cancel, crash, and multi-tab paste tests. |

### Freeze F3: assets and repair transactions

Freeze `AssetRef`, asset naming/root policy, staging lifecycle, import result/error types, paste transaction ordering, and repair-plan/commit/rollback semantics. Asset deletion is never coupled directly to editor undo.

### Exit criteria

- Screenshot paste is zero-configuration for a saved document and never inserts Base64.
- Markdown changes only after the image is durable; every failure leaves the document unchanged.
- Untitled documents migrate assets on first save without broken links.
- Large Base64 repair is streaming, cancellable, recoverable, and verified before replacement.
- Orphan cleanup is delayed, scoped, observable, and cannot delete user-owned files.

## 8. Phase 4 — Hybrid rendering and rich content

### Tasks

| ID | Suggested owner | Depends on | Deliverable and acceptance |
|---|---|---|---|
| `P4-LIVE-01` | Editor | F1 | Incremental Typora-like source reveal for headings, emphasis, links, lists, tasks, code, images, and blocks; full source mode remains available. |
| `P4-MATH-01` | Rich Render | `P4-LIVE-01` | Optional P1 inline/block math adapter behind a flag; satisfy `EDIT-MATH-001` and `AC-MATH-001`. |
| `P4-MERMAID-01` | Rich Render/Safety | `P4-LIVE-01`, F3 | Deferred/cancellable Mermaid rendering with input limits, SVG sanitization, cache, dark theme, and non-blocking errors. Prove the timeout is actually preemptible; a synchronous main-thread render wrapped in `setTimeout` fails the task, and an uncooperative renderer must move to a terminable isolated execution domain or remain disabled. |
| `P4-VIEWER-01` | Rich Render/UX | `P4-MERMAID-01`, F2 | Diagram overlay supports pointer-centered zoom, pan, fit, 100%, keyboard, and fullscreen; SVG/PNG export remains P1. |
| `P4-TABLE-01` | Editor/UX | `P4-LIVE-01` | P0 rendered table preview behind `table.renderedPreview`; keyboard can enter/exit exact pipe source, unchanged source round-trips byte-for-byte, and table/source transactions participate in the shared undo/redo acceptance matrix. |
| `P4-A11Y-01` | QA/Accessibility | `P4-LIVE-01`, `P4-MERMAID-01`, `P4-VIEWER-01`, `P4-TABLE-01`; `P4-MATH-01` only when enabled | IME, screen-reader roles, focus order, reduced motion, keyboard-only, high zoom, large diagram, and render-failure test matrix. |

### Freeze F4: render extension boundary

Freeze widget lifecycle, viewport/deferred rendering hooks, cancellation, cache keys, render error model, sanitization boundary, and source fallback. New renderers must use the extension boundary and cannot mutate document sessions directly.

### Exit criteria

- Common Markdown feels like one editable rendered surface and source mode is always recoverable.
- Parser/renderer failure degrades to editable source, never a blocked or blank document.
- Mermaid work cannot monopolize the UI thread; oversized graphs fail with an actionable card.
- Diagrams zoom and pan without raster blur.
- IME and keyboard navigation pass on target platforms.

## 9. Phase 5 — Reliability, performance, and security

### Tasks

| ID | Suggested owner | Depends on | Deliverable and acceptance |
|---|---|---|---|
| `P5-RECOVERY-01` | Session/Native | F1, F2, F3 | P0 dirty checkpoint discovery/recovery, schema migration, poison-document quarantine, and “start without previous session”; full window state remains P1. |
| `P5-CONFLICT-01` | Native/Application | `P2-INDEX-01`, F1 | External modification UX: reload, compare, save copy, or overwrite with explicit revision check. |
| `P5-LARGE-01` | Performance/Safety | Phase 4 | Large-document mode disables expensive extensions by budget; benchmark thresholds cover bytes, lines, longest line, widgets, and memory. |
| `P5-SECURITY-01` | Security | F3, F4 | Threat model and tests for paths, symlinks, HTML/SVG, links, Mermaid, IPC scope, logging, exported content, and malicious workspaces. |
| `P5-SOAK-01` | QA | `P5-RECOVERY-01`, `P5-CONFLICT-01`, `P5-LARGE-01`, `P5-SECURITY-01` | Crash injection, repeated open/close, 100-tab/session sharing, file-watch storms, long edit, memory plateau, and recovery soak suite. |

### Exit criteria

- Session restore cannot relaunch-crash-loop on one bad document.
- Conflicting disk changes are never silently overwritten.
- Performance budgets are measured in CI on a documented reference profile; regressions fail a dedicated gate.
- Fuzz/property tests cover scanners, link resolution, save transactions, and render sanitization.
- Soak tests show bounded resources and no unrecoverable document loss.

## 10. Phase 6 and later

### Phase 6 tasks

| ID | Suggested owner | Depends on | Deliverable and acceptance |
|---|---|---|---|
| `P6-SEARCH-01` | Workspace | F2, P5 | Optional product P1 incremental workspace search with cancellation and router-backed result navigation. |
| `P6-LAYOUT-01` | Workspace/UX | F2, F4 | Optional product P1 Peek uses the frozen bounded `resource_preview_v1`/provider preview port; split view reuses `ResourceRef`, sessions, `DocumentView`, and `ViewState`; no duplicate navigation or full-document preview path. |
| `P6-SESSION-01` | Workspace/Session | `P5-RECOVERY-01`, F2 | Optional product P1 Tab reorder, closed-Tab and full window session restore; satisfy `NAV-REORDER-001`, `NAV-REOPEN-001`, `RECOVERY-WINDOW-001`, `AC-NAV-005`, `AC-NAV-006`, and `AC-SESSION-001`. |
| `P6-TABLE-01` | Editor/UX | `P4-TABLE-01` | Optional product P1 structured table editing behind `table.structuredEditing`; satisfy `EDIT-TABLE-002` and `AC-TABLE-003`. |
| `P6-EXPORT-01` | Export | F4, P5 | Optional product P1 HTML and print/PDF first; optional Pandoc formats are isolated adapters and never rewrite the source document. |
| `P6-PACKAGE-01` | Release | all release-blocking product P0 tasks | Satisfy `OPS-RELEASE-001` / `RELEASE-001`: Product P0 signed/notarized packages, file associations, updates, rollback, privacy manifest, licenses, and clean-machine smoke tests. |

Phase 6 exits when supported OS packages install, upgrade, roll back, open file associations, preserve data, and pass release smoke tests. Optional P1/P2 features may remain disabled without blocking v1 if the P0 experience is complete.

### Later extension train

- Backlinks and link integrity index.
- Pluggable `ResourceRef` viewers such as image, diff, and local search pages.
- Optional AI assistance through explicit, local-first trust boundaries; document data never leaves the machine without informed user action.
- Optional publish/cloud/image-host adapters isolated from the core editor.
- Advanced Typora migration helpers and legacy diagram syntax only when real corpus evidence justifies them.

Each later capability begins with a product amendment and ADR; it cannot expand the core IPC ad hoc.

## 11. Dependency DAG and parallel batches

```text
Design docs
  ├─ P0-BOOT-01 ─┬─ P0-CI-01
  │              ├─ P0-SPIKE-01
  │              ├─ P0-SPIKE-02
  │              └─ P0-CONTRACT-01 ── P0-FLAG-01
  └─ P0-FIXTURE-01
                   │
                   └──────────── F0
                                  ├─ P1-FILE-01 ── P1-PREFLIGHT-01
                                  │       └──────── P1-SAVE-01
                                  ├─ P1-SESSION-01 ─┘
                                  └─ P1-EDITOR-01
                                           └─ P1-SHELL-01 ── P1-E2E-01 ── F1
                                                                    ├─ Phase 2 ── F2
                                                                    └─ Phase 3 ── F3
                                                                         └─ Phase 4 ── F4
                                                                                 └─ Phase 5
                                                                                         └─ Phase 6
```

Within a phase, use these parallel workstreams:

| Workstream | Primary paths | May run in parallel with | Must wait for |
|---|---|---|---|
| Contract/Domain | `src-tauri/src/domain/**`, `src/domain/**`, schema generator | Fixtures, editor spike | Design contract |
| Native Core | `src-tauri/src/{commands,application,infrastructure}/**` | Editor and workspace UI | Applicable freeze |
| Editor | `src/features/editor/**` | Native Core, fixtures | F0/F1 adapter contracts |
| Workspace/Navigation | `src/app/**`, `src/features/workspace/**` | Assets, renderer | F1, then F2 |
| Assets/Safety | `src/features/assets/**`, owned Rust asset modules | Navigation | F0/F1 and F3 proposal |
| Rich Render | `src/features/diagrams/**`, editor renderer adapters | Reliability work not touching renderer | F1/F3/F4 proposal |
| QA/Performance | `tests/**` and test harness only | All workstreams | Stable observable contract |
| Release/Integration | root configuration, CI, packaging | Feature work with disjoint files | Reviewed changes |

Suggested initial agent allocation is one owner per row. If there are fewer agents, combine QA with the relevant workstream but keep Integration separate from the largest feature branch.

## 12. Integration order

Merge narrow changes in this order; parallel completion does not imply arbitrary merge order.

1. `P0-BOOT-01` → `P0-CI-01` → `P0-CONTRACT-01` → flags/fixtures/spike results.
2. Native document open/preflight → generated bindings → session registry → editor adapter → atomic save → shell → Phase 1 E2E.
3. Router → tabs → history, while workspace index lands separately; then link integration → Phase 2 E2E.
4. Native asset import → staging → editor paste transaction → repair flow → Phase 3 E2E.
5. Live preview base → math/Mermaid/table adapters in parallel → diagram viewer → accessibility/E2E.
6. Restore/conflict/large/security branches → soak suite → release features → packages.

The integration owner rebases or merges against the current integration head, regenerates IPC once, runs the whole gate, and only then marks the task `DONE`. Feature owners do not resolve another owner's semantic conflict by guessing.

## 13. Feature flags

Flags are typed, centrally registered, dependency-aware, and observable in diagnostics. Do not scatter environment-variable checks through features.

| Flag | Initial production state | Enable gate |
|---|---|---|
| `editor.livePreview` | off during Phase 1; on for v1 | Phase 4 source-fallback and IME tests pass |
| `navigation.tabs` | off during implementation; on for v1 | `P2-TABS-01` + shared-session E2E pass |
| `navigation.history` | off during implementation; on for v1; requires tabs | `P2-HISTORY-01` position-restore E2E passes |
| `navigation.peek` | off | Phase 6 accessibility and history non-mutation tests pass |
| `layout.splitView` | off | Phase 6 shared-session/view isolation tests pass |
| `clipboard.imagePaste` | off during implementation; on for v1 | Phase 3 durability, rollback, and failure injection pass |
| `diagram.mermaidViewer` | off during implementation; on for v1 | Phase 4 timeout/sanitization/zoom tests pass |
| `table.renderedPreview` | off during implementation; on for v1 | P0 source round-trip, fallback, keyboard entry/exit and IME tests pass |
| `table.structuredEditing` | off | P1 `TABLE-010` and `AC-TABLE-003` pass; may remain experimental |
| `safety.largeInputGuard` | on once available; fail closed | Cannot be disabled in production without a developer-only escape hatch |
| `safety.base64Repair` | off during implementation; on for v1 | Phase 3 streaming repair/rollback tests pass |
| `performance.largeDocumentMode` | on once available | Phase 5 budgets and downgrade behavior pass |
| `recovery.dirty` | on once available; fail closed | P0 checkpoint, crash recovery, poison quarantine and migration tests pass; cannot be disabled in production |
| `session.restore` | off | P1 closed-Tab and full layout/history migration tests pass; never controls dirty recovery |

Removing a flag is a separate cleanup task after at least one stable release path. It includes removal of both branches, stale tests, diagnostics, and documentation.

## 14. Change, commit, and conflict constraints

- One task, one accountable owner, one narrow branch/worktree: `task/<TASK-ID>-<slug>`.
- The initial repository checkpoint inside `P0-BOOT-01` is the sole exception: its task note records base revision as `unversioned`, Integration initializes the current directory without importing unrelated/user data, commits the validated design baseline, records that commit as the first durable revision, and only then creates parallel task branches/worktrees.
- Prefix commits with the task ID, for example `P2-HISTORY-01: restore block-relative scroll position`.
- Keep mechanical formatting separate from behavior. No drive-by refactors or unrelated dependency upgrades.
- Only Integration owns root manifests, lockfiles, global CI, generated artifacts, and release configuration unless explicitly delegated.
- Never hand-edit `src/generated/**`; regenerate it from the accepted Rust schema.
- A feature branch may not change a frozen interface, persistence format, trust boundary, or performance budget without an accepted ADR.
- Cross-owner edits require a message to the owner and a recorded handoff. If two tasks need the same file, serialize them or extract the agreed contract first.
- Test fixtures are additive and uniquely named by task. Do not rewrite another task's golden file without its owner/reviewer.
- Do not update this plan for routine task progress. Use isolated task notes; the integration owner updates milestones.
- Update `docs/PROJECT_STATE.md` at task claim and every terminal/checkpoint state, but touch only your task entry and preserve concurrent entries byte-for-byte.
- Every implementation commit and task note names its task ID; behavior and tests additionally name the applicable repository requirement and test/acceptance IDs where the language permits.
- Do not commit user documents, clipboard contents, absolute personal paths, secrets, logs containing content, or giant inline Base64. Generate hazardous fixtures at test runtime.

## 15. Test gates

### Every task

- formatter and linter for touched languages;
- TypeScript typecheck and Rust `clippy` with warnings denied for touched crates;
- focused unit tests, including at least one failure/cancellation path;
- no schema or generated-binding drift;
- no unexpected file changes outside the task's declared paths.

Evidence recorded in the task note is attached to its existing test/acceptance ID and includes the exact command, execution environment/tool versions when relevant, exit code/result, failing test names, and artifact or log path. If a check was not run, record why and who must run it. Never infer verification from an earlier chat message.

### Every integration checkpoint

- all unit, contract, integration, and relevant E2E tests;
- fixture round-trip and golden-diff suite;
- atomic-save fault injection and recovery checks;
- CJK IME/composition smoke test when editor code changes;
- memory/time budget checks when parser, editor, index, or renderer code changes;
- dependency/license/security scan when dependencies change.

### Release candidate

- clean-machine install/upgrade/uninstall smoke tests on every supported OS;
- file association, deep/local link, clipboard, menu, accessibility, and updater checks;
- crash/kill during open, save, paste, repair, render, and session restore;
- malicious workspace/path/HTML/SVG/Mermaid test suite;
- privacy check that no document content leaves the machine or enters telemetry/logs;
- backup compatibility and rollback rehearsal.

Tests must assert durable state, not only UI snapshots. A screenshot cannot prove a save, rollback, conflict, or recovery contract.

## 16. ADR workflow

Create `docs/decisions/NNNN-short-title.md` when a change affects:

- a frozen contract or domain invariant;
- IPC/persistence/schema versions;
- framework, parser, renderer, storage, or security dependencies;
- filesystem/clipboard/network trust boundaries;
- save/recovery/conflict semantics;
- cross-platform behavior or published performance budgets.

An ADR contains status (`Proposed`, `Accepted`, `Superseded`, `Rejected`), context, decision, considered alternatives, consequences, migration/rollback, security/data impact, affected contracts, and test plan. The proposing owner writes it; the affected domain owner and integration owner accept it. Implementation may spike behind a disposable branch, but production code waits for acceptance. Never rewrite an accepted ADR to hide history; add a superseding ADR.

## 17. Taking over or handing off a task

### Takeover checklist

1. Follow the fixed durable context chain: `AGENTS.md` → `PROJECT_STATE.md` → `DESIGN.md` → requirements and relevant domain design/ADR/code/tests → task note.
2. Confirm every requirement/test/acceptance ID, task dependency, unresolved question, and frozen interface version; inspect the working tree before changing anything.
3. Run the recorded baseline commands and append exact evidence against the current base revision.
4. Claim only the stated paths. Contact owners before touching shared or generated files.
5. Reproduce the last known state from repository evidence, not chat history.
6. Update the task note and the task's `PROJECT_STATE.md` entry with your owner ID and takeover point; do not discard uncommitted work whose origin is unclear.

### Handoff checklist

Use this standard task-note template; do not replace it with a prose chat summary:

```markdown
# <TASK-ID> — <title>

- Status: CLAIMED | BLOCKED | REVIEW | DONE
- Owner / next owner:
- Base revision / head revision:
- Requirement IDs: DATA-... / EDIT-... / NAV-... / FILE-... / ASSET-... / ...
- Test / acceptance IDs: RT-... / EDT-... / IME-... / SAFE-... / AC-... / ...
- ADRs / contract and schema versions:
- Feature flags:
- Owned and touched paths:

## Goal and non-goals
## Acceptance criteria status
## Changes made
## Decisions and assumptions
## Verification evidence

| Test / acceptance ID | Exact command/environment | Result | Artifact or failure |
|---|---|---|---|

## Open questions and blockers

For each item: owner, decision/input needed, affected requirement/task, and safe work that may continue.

## Remaining numbered steps
## Data safety, recovery, and temporary artifacts
## Single recommended next action
```

Mirror a compact summary, link, status, revisions, verification result, and every release-blocking open question into the task's `PROJECT_STATE.md` entry at handoff. Decisions made during the task update `REQUIREMENTS.md` or an ADR as appropriate; leaving them only in the handoff note is insufficient.

A handoff saying only “mostly done” is invalid. If the branch does not build, state that at the top and provide the shortest reproduction.

## 18. First execution batch

Start only after PROJECT_STATE marks the complete design baseline reviewed:

1. Integration agent alone claims `P0-BOOT-01`. If the directory is not a Git repository, its first checkpoint initializes Git, adds the privacy-safe ignore rules, reruns the documentation gate, and commits the approved design baseline; no agent creates a branch/worktree before that checkpoint.
2. After the baseline checkpoint, QA may claim independent `P0-FIXTURE-01` without adding oversized blobs. After the directory skeleton lands, Integration starts `P0-CI-01`, Contract starts `P0-CONTRACT-01`, Editor starts `P0-SPIKE-01`, and Native/Safety starts `P0-SPIKE-02` in disjoint owned paths.
3. `P0-FLAG-01` starts only after the initial generated contract exists.
4. Integration publishes F0 only after all Phase 0 exit criteria pass.

Do not start Phase 1 feature branches before F0 is published. The few days spent freezing command, revision, error, and event semantics prevent every later workstream from inventing incompatible versions.
