# P0-CONTRACT-01 — IPC v1 契约冻结与生成绑定

- Status: CLAIMED — independent-review rework
- Owner / next owner: Contract/Domain (`/root/p0_contract_01`) / same owner until REVIEW
- Base revision / head revision: original base `576a435`; rework base `0387139` / working tree
- Requirement IDs: `DATA-REVISION-001`, `SAFE-IPC-001`, `EXT-ROUTER-001`, `EXT-COMMAND-001`, `OPS-CONTEXT-001`, `OPS-HANDOFF-001`
- Product UX IDs: `UX-EXT-001`
- Test / acceptance IDs: `CORE-001`, `SEC-001`, `EXT-001`, `EXT-002`, `CONTRACT-001`–`CONTRACT-024`, `PROC-001`, `PROC-002`; supporting clean-checkout evidence for `BUILD-001`
- ADRs / contract and schema versions: `ADR-0001`–`ADR-0004`; IPC wire version `1.0`; schema status remains `1.0-draft` until Integration publishes F0
- Feature flags: none; `P0-FLAG-01` remains downstream
- Owned and touched paths: `contracts/**`, `src/generated/**`, `src/domain/ipc.contract.test.ts`, `src-tauri/src/domain/**`, `src-tauri/src/ipc_schema.rs`, `src-tauri/src/ipc_schema/**`, `src-tauri/src/bin/generate_ipc.rs`, `src-tauri/src/lib.rs`, approved narrow changes to `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`, this task note, and only this task's `docs/PROJECT_STATE.md` row

## Goal and non-goals

Define an executable Rust-owned IPC v1 schema, stable request/response/error/event envelopes, cancellation and core wire models, and deterministic TypeScript bindings. Establish the canonical `CONTRACT-001`–`CONTRACT-024` manifest/runner and make F0 gates `CONTRACT-001`–`CONTRACT-003` executable.

Non-goals remain unchanged: no Tauri command handlers, filesystem or clipboard access, real IPC invocation, Phase 1 sessions/editor/navigation/assets, feature-flag behavior, or behavioral implementations for `CONTRACT-004`–`CONTRACT-024`.

## Dependencies and baseline

- `P0-BOOT-01` was `DONE` on base `576a435`; the implementation copied command names, fields, variants, events, error codes, cancellation policy, and payload budgets from canonical chapter 03 rather than reconstructing them from memory.
- Baseline validator PASS: `design_snapshot_sha256=e0905a48147eee7c3264b382aeab2a8c2c2e40dab2ef6b7f5b9963a96cca8509`.
- The first fresh-worktree `pnpm verify` correctly failed because `node_modules` did not exist. `pnpm install --frozen-lockfile` introduced no lockfile change, after which the same baseline command passed.

## Independent-review rework checkpoint

Integration recorded a NO-MERGE review against `0387139`. All earlier completion evidence below is historical and revoked for merge purposes until the replacement generator and regression gates pass. Confirmed findings:

- `src-tauri/src/ipc_schema/typescript.rs` is a second handwritten type source; substring checks do not make Rust serde models authoritative.
- Generated union fixtures describe required fields instead of serializing concrete Rust variants, so discriminator/tag/nullability drift can remain green.
- The Rust model set does not cover the complete generated TypeScript surface, including `AppCapabilities`, `AppReconcileOutcome`, `WorkspaceOpenRequest`, `AppCloseRequest`, and `RecoverySnapshotFailed`.
- Safe-integer, `missing.lastKnown`, external-change state, event scope/payload/sequence, unknown-error recovery action, and real Rust write-request validation are incomplete.

The rework will use mechanically generated TypeScript from complete Rust serde wire types, concrete serde JSON fixtures, and mutation-style regressions. It will not implement handlers or `CONTRACT-004`–`CONTRACT-024` behavior.

## Acceptance criteria status

| Requirement / acceptance ID | Expected evidence | Status |
|---|---|---|
| `CONTRACT-001` | Rust generator reproduces committed TypeScript, manifest, and fixture artifacts with zero drift | REWORK — replace handwritten template and prove serde discriminator mutation fails the gate |
| `CONTRACT-002` | Concrete Rust variants serialize to fixtures and validate across TypeScript | REWORK — replace required-field placeholders with nested serde JSON values |
| `CONTRACT-003` | Unknown event/error/optional fields remain readable while unknown writes fail closed | REWORK — add safe-integer, scope, payload, recovery-action, and Rust request-decoder regressions |
| `CONTRACT-004`–`CONTRACT-024` | Canonical manifest freezes ID, layer, fixture port, and mapped future task without pretending behavior is implemented | RETAIN — keep all 21 entries `frozenPort`; do not add behavior |
| `CORE-001`, `SEC-001`, `EXT-001`, `EXT-002` | Core models, versioned/fail-closed envelopes, router/command vocabulary are available to both languages | REWORK — complete Rust surface and regenerate TypeScript |
| `PROC-001`, `PROC-002` | Durable task state and reproducible handoff contain exact commands, revisions, risks, and next action | IN PROGRESS — this claim checkpoint supersedes the rejected REVIEW handoff |

## Changes made

- Reopened the task at `0387139` after independent review and revoked the prior merge recommendation.
- Added pure serde wire/domain models for opaque IDs, `Workspace`, `Resource`, `DocumentSession`, `Tab`, `NavEntry`, `ViewState`, `Asset`, `AppError`, requests/responses, cancellation metadata, and events. Literal success/failure discriminators are enforced rather than represented as arbitrary booleans.
- Added the Rust-owned canonical catalog for 37 commands, 8 events, 24 known error codes, payload budgets, cancellability, known write actions, union specifications, and `CONTRACT-001`–`CONTRACT-024` mappings.
- Added mechanical consistency validation against the canonical command/event/error tables and generated TypeScript declarations in `docs/design/03-domain-model-and-contracts.md`.
- Added a deterministic Rust generator and committed outputs: `src/generated/ipc.ts`, `contracts/ipc-v1.manifest.json`, and synthetic cross-language union fixtures. Generated TypeScript is formatted with the already pinned repository Prettier and is never hand-edited.
- Added `contracts/run.mjs` as the F0 contract gate. It requires the exact ordered `CONTRACT-001`–`CONTRACT-024` set, permits only `001`–`003` to be executable, verifies all `004`–`024` frozen ports, checks generated drift, and runs focused Rust and TypeScript tests.
- Added fail-open-read/fail-closed-write TypeScript decoder tests plus Rust serialization/catalog tests. No handler, `invoke`, listener, filesystem, clipboard, renderer, or network implementation was added.
- Added exact direct `serde = 1.0.229` with `derive` and `serde_json = 1.0.151` dependencies with Integration approval. `Cargo.lock` only adds those two already-resolved crates to the root package dependency list; no package/version/checksum entry changed. `package.json` and `pnpm-lock.yaml` are untouched.
- Set Cargo `default-run = "markdown-workspace"` so adding the generator binary cannot change which desktop executable `tauri build` produces.

## Decisions and assumptions

- The schema stays `1.0-draft`; this branch proves F0 contract stability but does not publish it. Integration owns publication after all required Phase 0 gates.
- `AppError.code` remains an open string for forward-compatible reads, while `KNOWN_APP_ERROR_CODES` is the closed current vocabulary. Runtime decoders preserve an unknown error code but reject an unknown event name or write action.
- The TypeScript binding is a deterministic Rust-owned template backed by canonical-table parsing, declaration-shape checks, generated fixtures, and a zero-drift gate. This avoids introducing a new code-generation dependency in F0. A future generator replacement must preserve the same artifacts and contract gates.
- No frozen architecture or product behavior changed, so no new ADR is required. The direct serialization dependencies and Cargo default target are narrow build implementation details, not new contract semantics.

## Verification evidence

Environment for implementation and clean-checkout runs: macOS/Darwin arm64; `pnpm exec node v24.14.0`; pnpm `10.32.1`; Rust/Cargo `1.98.0`. `${CARGO_BIN_DIR}` below denotes the machine-local Rust 1.98 toolchain bin directory and is intentionally not persisted as a personal path.

| Test / acceptance ID | Exact command and environment | Result | Artifact or failure |
|---|---|---|---|
| `CONTRACT-001`–`CONTRACT-003` | `PATH="${CARGO_BIN_DIR}:$PATH" pnpm exec node contracts/run.mjs` at `bfe1dd5` | PASS; exit 0; generated drift 0; Rust 4/4; TypeScript 6/6 | Generated artifacts under `src/generated/` and `contracts/`; terminal summary: `CONTRACT-001..003 PASS` |
| `CONTRACT-004`–`CONTRACT-024` | Same canonical runner command | PASS for F0 freeze; exactly 21 `frozenPort` entries and no extra/missing contract ID | `contracts/ipc-v1.manifest.json`; behavior explicitly not executed |
| `CORE-001`, `SEC-001`, `EXT-001`, `EXT-002` contract surface | `PATH="${CARGO_BIN_DIR}:$PATH" cargo test --manifest-path src-tauri/Cargo.toml` as part of the runner/full gate | PASS; full Rust suite 6/6 | Typed wire/catalog unit tests in `src-tauri/src/domain/wire.rs` and `src-tauri/src/ipc_schema.rs` |
| `PROC-001`, documentation/schema consistency | `ruby scripts/validate_design_docs.rb` at `bfe1dd5` | PASS; exit 0 | `markdown_files=22`, `ipc_commands=37`, final snapshot `c1ef8dc594bd5e98700c2ab45bad6b649886a18508abe7073a5b5794c6368bd8` |
| Formatting, lint, type, Rust, unit, build | `PATH="${CARGO_BIN_DIR}:$PATH" pnpm verify` at `bfe1dd5` | PASS; exit 0 | Prettier, ESLint, TypeScript, Vitest 2 files/9 tests, Rust fmt, Clippy `-D warnings`, Rust 6 tests, Vite build, and Tauri debug no-bundle build all pass; output executable is `markdown-workspace` |
| `BUILD-001` supporting clean-checkout proof | Fresh single-branch clone of `task/P0-CONTRACT-01-ipc-v1`, then `pnpm install --frozen-lockfile && ruby scripts/validate_design_docs.rb && PATH="${CARGO_BIN_DIR}:$PATH" pnpm exec node contracts/run.mjs && PATH="${CARGO_BIN_DIR}:$PATH" pnpm verify` | PASS; every command exit 0 at `bfe1dd5` | Ephemeral clone under `/private/tmp`; moved to system Trash after evidence capture |
| Dependency/lock scope | `git diff 576a435..bfe1dd5 -- src-tauri/Cargo.toml src-tauri/Cargo.lock package.json pnpm-lock.yaml` | PASS; only Cargo manifest plus two direct root dependency lines changed | No npm manifest/lock diff and no new Cargo package resolution |
| Scope/privacy guard | `! rg -n '/(Users|home)/|data:image/[^;]+;base64,|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY' contracts src/generated src/domain/ipc.contract.test.ts src-tauri/src docs/tasks/P0-CONTRACT-01.md` and handler/API scan over the same implementation scope | PASS; no match | No personal path, embedded image payload, private-key marker, Tauri command handler, frontend `invoke`, or listener added |
| Patch hygiene | `git diff --check 576a435..bfe1dd5` | PASS; exit 0 | No whitespace errors |

## Open questions and blockers

No external dependency blocks safe rework. The NO-MERGE findings above are active implementation blockers; Contract/Domain owns resolving them before returning to REVIEW.

- Integration owns the planned decision point to publish schema status beyond `1.0-draft`; affected tasks are `P0-CONTRACT-01` and downstream `P0-FLAG-01`. Safe work may continue only against the generated draft contract until Integration records F0 publication.
- Known maintenance risk: the generator uses an audited Rust-owned TypeScript template rather than a third-party derive generator. Canonical table parsing, per-union declaration checks, cross-language fixtures, and `--check` mitigate drift; Contract/Domain owns updating all four surfaces together when a future accepted contract change occurs.
- `CONTRACT-004`–`CONTRACT-024` are deliberately frozen ports, not passing feature implementations. Their `futureTasks` mappings are the authoritative owners for later behavior.

## Remaining numbered steps

1. Replace the handwritten TypeScript source with mechanically generated declarations from the complete Rust serde model set.
2. Generate concrete nested fixtures from Rust variants and implement fail-closed Rust/TypeScript decoders plus mutation regressions.
3. Audit the exact dependency/lock delta, rerun all local and clean-clone gates, then rewrite this note and the ledger row to REVIEW.

## Data safety, recovery, and temporary artifacts

No user document, clipboard content, personal absolute path, Base64 image, secret, recovery state, or full external file content was read into or committed by this task. Union fixtures contain only synthetic contract metadata. Build products remain ignored under `dist/`, `node_modules/`, and `src-tauri/target/`. The explicit clean-checkout directory under `/private/tmp` was moved to the system Trash after the gate completed and remains recoverable until the Trash is emptied; no project recovery action is required.

## Single recommended next action

Contract/Domain should replace the dual-source generator with Rust-derived TypeScript and concrete serde fixtures, then make the reviewer regressions fail before the fix and pass after it.
