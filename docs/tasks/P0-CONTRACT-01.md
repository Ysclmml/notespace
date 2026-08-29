# P0-CONTRACT-01 — IPC v1 契约冻结与生成绑定

- Status: CLAIMED
- Owner / next owner: Contract/Domain (`/root/p0_contract_01`) / Contract/Domain implementation
- Base revision / head revision: original base `576a435`; third-review rework base `91a2782`; head pending
- Requirement IDs: `DATA-REVISION-001`, `SAFE-IPC-001`, `EXT-ROUTER-001`, `EXT-COMMAND-001`, `OPS-CONTEXT-001`, `OPS-HANDOFF-001`
- Product UX IDs: `UX-EXT-001`
- Test / acceptance IDs: `CORE-001`, `SEC-001`, `EXT-001`, `EXT-002`, `CONTRACT-001`–`CONTRACT-024`, `PROC-001`, `PROC-002`; supporting clean-checkout evidence for `BUILD-001`
- ADRs / contract and schema versions: `ADR-0001`–`ADR-0004`; IPC wire version `1.0`; schema status remains `1.0-draft` until Integration publishes F0
- Feature flags: none; `P0-FLAG-01` remains downstream
- Owned and touched paths: `contracts/**`, `src/generated/**`, `src/domain/ipc.contract.test.ts`, `src-tauri/src/domain/**`, `src-tauri/src/ipc_schema.rs`, `src-tauri/src/ipc_schema/**`, approved narrow changes to `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`, this task note, and only this task's `docs/PROJECT_STATE.md` row

## Goal and non-goals

Define a Rust-owned executable IPC v1 schema, stable request/response/error/event envelopes, cancellation metadata, complete core wire models, and deterministic TypeScript bindings. Establish the canonical `CONTRACT-001`–`CONTRACT-024` manifest/runner, with F0 executing `CONTRACT-001`–`CONTRACT-003` and the remaining 21 ports frozen for their mapped owners.

Non-goals were preserved: no Tauri command handler, frontend `invoke`/listener, filesystem, clipboard, renderer, real IPC transport, feature-flag behavior, or Phase 1 session/editor/navigation/assets implementation was added. `CONTRACT-004`–`CONTRACT-024` remain non-behavioral `frozenPort` entries.

## Acceptance criteria status

Third independent review supersedes the prior REVIEW evidence. The four failed boundaries below are open until new local, mutation, and clean-clone evidence is recorded; unchanged passing areas remain implementation context, not current handoff evidence.

| Requirement / acceptance ID | Expected evidence | Status |
|---|---|---|
| `CONTRACT-001` | Rust generator reproduces committed TypeScript, manifest, fixture, and executable validator artifacts with zero drift | IN PROGRESS — replace the handwritten event payload validator with a Rust-serde-derived executable schema; prove a legal Rust event-field rename is accepted only after regeneration and the old field is rejected |
| `CONTRACT-002` | Every tagged, untagged, and single-variant wire union uses concrete Rust variants serialized through `serde_json`, with mechanically checked registry completeness | IN PROGRESS — remove the hard-coded `44` self-check and add missing `SaveAsTarget`, `NavigateTarget`, `AbsentDiskRevision`, and `DocumentSaveAsOutcome` concrete variants |
| `CONTRACT-003` | Unknown event/error/optional fields remain readable while unsafe values and unknown writes fail closed | IN PROGRESS — normalize every nested event `AppError` through the decoder and reject all forbidden `DocumentExternalChanged.writeId` combinations in Rust serde |
| `CONTRACT-004`–`CONTRACT-024` | Freeze canonical ID, layer, fixture port, and future owner without claiming feature behavior | PASS for F0 freeze only — exactly 21 entries remain `frozenPort`; no behavior was implemented |
| `CORE-001`, `SEC-001`, `EXT-001`, `EXT-002` | Core models, versioned/fail-closed envelopes, and router/command vocabulary are available to Rust and TypeScript | PASS — the full prior TS surface has a Rust serde/`TS` owner, including all 37 command request/response and 8 event payload types |
| `PROC-001`, `PROC-002` | Durable state and reproducible handoff include exact revisions, commands, results, risks, and next action | PASS — this note supersedes the rejected `0387139` handoff and records local plus clean-clone evidence |

## Changes made

Third-review implementation has not started. The prior change list below describes the rejected `42563ee` implementation and will be rewritten before REVIEW.

- Deleted the 1,121-line handwritten `src-tauri/src/ipc_schema/typescript.rs` declaration source. `src-tauri/src/ipc_schema/rust_typescript.rs` now invokes `ts-rs` declarations from real Rust serde types; only policy helpers that Rust explicitly maps to—brands, required-nullable, and open/known error-code aliases—are emitted around those declarations.
- Added the complete command/event payload model in `src-tauri/src/domain/payloads.rs`. A systematic exported-name comparison against the rejected TS surface found no missing prior exported declaration; the new output additionally names mechanically factored enums/value objects.
- Added JS-safe integer wrappers for every exact Rust wire integer. Serialization and deserialization reject values outside `Number.MAX_SAFE_INTEGER`; `SessionRevision` remains a branded JSON number, and generated bindings contain no `bigint`.
- Made `missing.lastKnown` required and nullable, modeled `DocumentExternalChanged` as its legal `change`/provenance union, and constrained `NativeOpenTarget.document` to a Markdown `ResourceRef` on both decode and encode paths.
- Made unknown `AppError.code` forward-readable while filtering both inbound and outbound recovery actions to read-only `openSafetyPage`, `compare`, or `openExternal`. Known event decoders now validate envelope shape, scope kind and identity, event-to-payload mapping, non-negative safe-integer sequence/counters, document provenance, and nested Markdown locator/anchor shape. Unknown events remain readable only after a valid base envelope.
- Routed an unknown destructive conflict action through `CommandRequest<ConflictResolutionRequest>` so the real Rust enum decoder rejects it; no synthetic action-only predicate substitutes for the request boundary.
- Replaced required-field/placeholder fixture metadata with 44 groups of concrete Rust enum variants serialized by `serde_json`. The same serialized fixture set is embedded into generated TypeScript and compared with the committed JSON artifact in Vitest.
- Preserved the exact 37 command, 8 event, 24 known-error, and `CONTRACT-001`–`CONTRACT-024` catalogs. Event specs gained generated `scopeKind` metadata used by the strict decoder; `004`–`024` semantics and ownership mappings did not change.
- Added exact `ts-rs = 12.0.1` with `default-features = false` and only `serde-compat`. `Cargo.lock` adds `ts-rs 12.0.1`, `ts-rs-macros 12.0.1`, and `termcolor 1.4.1`; `package.json` and `pnpm-lock.yaml` are unchanged.

## Decisions and assumptions

- The schema stays `1.0-draft`; this branch proves the F0 contract gate but does not publish F0. Only Integration may publish the schema and mark this task `DONE`.
- Rust serde models are the sole wire-shape source. The explicit `ts-rs` registry selects types to render but does not restate fields, variants, tags, optionality, or nullability. `serde-compat` warnings remain enabled; no global warning suppression was introduced.
- Branded string IDs and `SessionRevision` use explicit `ts-rs` type mappings. `JsSafeU64`/`JsSafeI64` combine a TypeScript `number` mapping with Rust range-checked serde, so the mapping cannot silently serialize a JavaScript-unsafe integer.
- `RequiredNullable<T>` is a Rust newtype whose field is not optional; its TypeScript helper is `T | null`. Regression tests require explicit `lastKnown: null` and reject an omitted field.
- Forward compatibility is asymmetric by design: a syntactically valid unknown event/error remains readable, but unknown or write-capable recovery actions on an unknown error are removed, and unknown command actions fail Rust deserialization.
- `ts-rs` is a build/code-generation dependency, not a runtime parser, renderer, storage, network, or security subsystem. Integration approved the exact pin and narrow lock delta; no ADR or product behavior changed.

## Verification evidence

Prior evidence below is retained only as historical diagnostic context and is not sufficient for the current claim. Third-review evidence will replace it before handoff.

Environment: macOS/Darwin 25.6.0 arm64; `pnpm exec node v24.14.0`; pnpm `10.32.1`; Rust/Cargo `1.98.0`. `${CARGO_BIN_DIR}` denotes the local Rust toolchain bin directory; `${CLEAN_CLONE}` denotes the validated system-temporary clone and does not persist a personal path.

| Test / acceptance ID | Exact command/environment | Result | Artifact or failure |
|---|---|---|---|
| `CONTRACT-001`–`CONTRACT-003` | `PATH="${CARGO_BIN_DIR}:$PATH" pnpm exec node contracts/run.mjs` at `42563ee` | PASS; exit 0; generated drift 0; Rust contract 11/11; TypeScript 16/16 | `src/generated/ipc.ts`, `contracts/ipc-v1.manifest.json`, `contracts/generated/ipc-v1-union-fixtures.json`; terminal: `CONTRACT-001..003 PASS` |
| `CONTRACT-001`, discriminator mutation | Using `apply_patch`, change only `WorkspaceState` serde `tag = "kind"` to `tag = "type"`; run `PATH="${CARGO_BIN_DIR}:$PATH" cargo run --manifest-path src-tauri/Cargo.toml --bin generate_ipc -- --check`; restore with `apply_patch` | EXPECTED FAIL; exit 1; drift named both `src/generated/ipc.ts` and fixture JSON. Restored tree then passed `--check` | Proves a serde discriminator mutation cannot remain green or be hidden by a substring-only test |
| `CONTRACT-002` | Rust `contract_002_*` tests plus `pnpm vitest run src/domain/ipc.contract.test.ts` inside the runner | PASS; concrete 44-group Rust fixture serialization, required-nullable semantics, generated discriminator/optionality assertions, and JSON-to-TS artifact equality | Nested fixtures include Markdown locator/anchor, disk revision, error, external-change provenance, recovery, and Save As values |
| `CONTRACT-003`, `CORE-001`, `SEC-001` | `PATH="${CARGO_BIN_DIR}:$PATH" cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features` and full Vitest through `pnpm verify` | PASS; Rust 13/13; Vitest 19/19 | Regressions cover unsafe/negative/fractional sequence, unsafe revision/counter, missing vs null, unknown error + overwrite, unknown Rust write action, invalid scope/payload/identity/provenance, and non-Markdown native open |
| `EXT-001`, `EXT-002`, full generated surface | `comm -23 <(git show 0387139:src-tauri/src/ipc_schema/typescript.rs \| rg -o '^export (type\|interface) [A-Za-z0-9_]+' \| sed -E 's/^export (type\|interface) //' \| sort -u) <(rg -o '^export (type\|interface) [A-Za-z0-9_]+' src/generated/ipc.ts \| sed -E 's/^export (type\|interface) //' \| sort -u)` | PASS; empty output, so no exported declaration from the rejected surface is missing | Generated output additionally exposes mechanically factored safe-integer, literal, enum, and wrapper types |
| `CONTRACT-004`–`CONTRACT-024` | Same canonical runner | PASS for catalog freeze; exactly 21 `frozenPort` entries and no missing/extra contract ID | `contracts/ipc-v1.manifest.json`; feature behavior explicitly not executed |
| Formatting, lint, type, Rust, build | `PATH="${CARGO_BIN_DIR}:$PATH" pnpm verify` at `42563ee` | PASS; exit 0; Prettier, ESLint, TypeScript, Vitest 19, Rust fmt, Clippy `-D warnings`, Rust 13, Vite production build, and Tauri debug no-bundle build | Local executable: `src-tauri/target/debug/markdown-workspace` |
| `BUILD-001`, `PROC-001` clean checkout | `git clone --local --branch task/P0-CONTRACT-01-ipc-v1 --single-branch . "${CLEAN_CLONE}"`; in clone run `pnpm install --frozen-lockfile && ruby scripts/validate_design_docs.rb && PATH="${CARGO_BIN_DIR}:$PATH" pnpm exec node contracts/run.mjs && PATH="${CARGO_BIN_DIR}:$PATH" pnpm verify` | PASS; every command exit 0 at `42563ee`; validator reported 22 Markdown files, 37 IPC commands, snapshot `28af204e18b4336787d5c7f831bffdf1ca2c5f4ce57172a6a7a0bd94feec175a` | Clean clone Tauri executable under `${CLEAN_CLONE}/src-tauri/target/debug/markdown-workspace`; clone moved recoverably to system Trash afterward |
| Dependency/license/security | `PATH="${CARGO_BIN_DIR}:$PATH" cargo metadata --locked --manifest-path src-tauri/Cargo.toml --format-version 1` filtered to the 3 new lock packages; `cargo tree -p ts-rs@12.0.1`; `cargo audit --file src-tauri/Cargo.lock` | PASS for introduced dependency: `ts-rs`/macros MIT, `termcolor` Unlicense OR MIT; audit exit 0 with no vulnerability finding. Audit printed 17 allowed warnings, none for the three added packages | Exact pin and minimal `serde-compat` feature in `src-tauri/Cargo.toml`; no npm manifest/lock diff |
| Scope/privacy guard | `! rg -n '/(Users|home)/|data:image/[^;]+;base64,|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY' contracts src/generated src/domain/ipc.contract.test.ts src-tauri/src/domain src-tauri/src/ipc_schema.rs src-tauri/src/ipc_schema` and `! rg -n '#\[tauri::command\]|tauri::command|\binvoke\s*\(|\blisten\s*\(' src-tauri/src/domain src-tauri/src/ipc_schema.rs src-tauri/src/ipc_schema src/domain/ipc.contract.test.ts src/generated/ipc.ts` | PASS; no match | No user content, personal absolute path, Base64 fixture, secret, command handler, frontend IPC call, or listener committed |
| Patch hygiene | `git diff --check 0387139..42563ee` | PASS; exit 0 | No whitespace errors or files outside declared task scope |

## Open questions and blockers

There is no external blocker. Current implementation findings owned by Contract/Domain:

- `CONTRACT-003`: `decodeEventEnvelope` validates nested `AppError` but returns the original payload, so unknown codes can retain write-capable recovery actions.
- `CONTRACT-003`: Rust serde accepts forbidden `external + writeId` forms for `DocumentExternalChanged`.
- `CONTRACT-001`: `runtime.rs` restates event payload fields and can drift from accepted Rust serde wire shapes.
- `CONTRACT-002`: the hard-coded fixture count is self-consistent and omits four confirmed union groups.

- Owner: Integration. Decision/input: independently review `42563ee`, then publish or keep IPC schema status `1.0-draft` as part of the F0 decision. Affected task: `P0-CONTRACT-01` and downstream `P0-FLAG-01`. Safe work: read-only review and Integration gate execution may proceed; only Integration marks `DONE`.
- Owner: mapped future feature owners. Decision/input: implement `CONTRACT-004`–`CONTRACT-024` only in their listed tasks. Affected requirements/tasks: manifest `futureTasks`. Safe work: use the frozen ports; do not interpret their presence as passing behavior.
- Owner: Integration/Release dependency policy. Input: disposition of the 17 allowed unmaintained/unsound warnings reported elsewhere in the pre-existing Tauri lock graph before release. None names `ts-rs`, `ts-rs-macros`, or `termcolor`, and `cargo audit` returned success, so this does not block the contract review.
- Maintenance risk: future wire types must be added to the explicit `ts-rs` render registry. Command/event catalog validation, generated drift, concrete fixtures, and full exported-surface tests make omissions visible, but the owning contract task must still regenerate artifacts on an accepted schema change.

## Remaining numbered steps

1. Commit this third-review CLAIMED checkpoint.
2. Replace the handwritten payload validator with a Rust-derived executable schema and normalize nested errors.
3. Enforce strict `DocumentExternalChanged` serde and add negative tests.
4. Make union fixture completeness mechanical and cover all confirmed omissions.
5. Run local gates, independent mutations, full clean-clone verification, then update this note and the single ledger row to REVIEW.

## Data safety, recovery, and temporary artifacts

No user Markdown, clipboard content, personal absolute path, Base64 image, secret, recovery state, or external full file content was read or committed. All fixtures are small deterministic contract values containing only `fixture-*` identifiers and harmless sample text. Build output remains ignored under `dist/` and `src-tauri/target/`.

The clean verification clone was moved to the system Trash rather than recursively deleted; it is recoverable until Trash is emptied. No user/project recovery action is required.

## Single recommended next action

Contract/Domain should commit this claim checkpoint, then implement the Rust-derived event schema boundary before touching fixture coverage.
