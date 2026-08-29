# P0-CONTRACT-01 — IPC v1 契约冻结与生成绑定

- Status: REVIEW
- Owner / next owner: Contract/Domain (`/root/p0_contract_01`) / Integration + independent Contract reviewer
- Base revision / head revision: original base `576a435`; fourth-review base `556b279`; claim checkpoint `f346e83`; implementation `154d48ce2b61cf4f1db0b9d8df9df7687c6ffdfa`; handoff revision is the final REVIEW checkpoint commit containing this note
- Requirement IDs: `DATA-REVISION-001`, `SAFE-IPC-001`, `EXT-ROUTER-001`, `EXT-COMMAND-001`, `OPS-CONTEXT-001`, `OPS-HANDOFF-001`
- Product UX IDs: `UX-EXT-001`
- Test / acceptance IDs: `CORE-001`, `SEC-001`, `EXT-001`, `EXT-002`, `CONTRACT-001`–`CONTRACT-024`, `PROC-001`, `PROC-002`; supporting clean-checkout evidence for `BUILD-001`
- ADRs / contract and schema versions: `ADR-0001`–`ADR-0004`; IPC wire version `1.0`; schema status remains `1.0-draft` until Integration publishes F0
- Feature flags: none; `P0-FLAG-01` remains downstream
- Owned and touched paths: `contracts/**`, `src/generated/**`, `src/domain/ipc.contract.test.ts`, `src-tauri/src/domain/**`, `src-tauri/src/ipc_schema.rs`, `src-tauri/src/ipc_schema/**`, `src-tauri/src/bin/generate_ipc.rs`, the previously approved exact dependency edges in `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock`, this note, and only this task's `docs/PROJECT_STATE.md` row

## Goal and non-goals

The branch defines the executable Rust-owned IPC v1 wire surface, deterministic TypeScript bindings, stable command/error/event envelopes, cancellation metadata, and core models. It establishes the canonical `CONTRACT-001`–`CONTRACT-024` manifest/runner: F0 executes `CONTRACT-001`–`CONTRACT-003`; the other 21 ports remain frozen for their mapped future owners.

This fourth-review rework closes the direct/nested `AppError` parity boundary. `decodeAppError` now validates through a standalone Rust-derived schema before applying unknown-code recovery policy; the complete recovery-action registry and its read-only subset are generated from Rust rather than duplicated in TypeScript.

No Tauri command handler, frontend invoke/listener, filesystem, clipboard, renderer, real IPC transport, feature behavior, or Phase 1 implementation was added. `CONTRACT-004`–`CONTRACT-024` remain non-behavioral `frozenPort` entries.

## Acceptance criteria status

| Requirement / acceptance ID | Expected evidence | Status |
|---|---|---|
| `CONTRACT-001` | Rust regeneration reproduces committed bindings, schema artifacts, fixtures, and manifest; accepted Rust serde field changes drive runtime validation | PASS — generator drift is zero; temporary `AppError.correlationId -> correlationToken` serde mutation changed three generated artifacts and decoder behavior only after regeneration |
| `CONTRACT-002` | Every registered structural union uses concrete Rust values and mechanically complete branches | PASS — 50 fixture groups remain Rust-serialized and schema-counted; all 8 concrete `AppErrorDetails` variants pass the direct decoder |
| `CONTRACT-003` | Unknown events/errors/optional fields remain readable while malformed errors and unknown writes fail closed | PASS — direct invalid details returns `null`; unknown optional fields survive; unknown actions are stripped; unknown codes retain only the Rust-designated read-only subset; nested event errors are sanitized and malformed nested details are rejected |
| `CONTRACT-004`–`CONTRACT-024` | Freeze canonical ID, layer, fixture port, and future owner without claiming feature behavior | PASS for F0 freeze only — exactly 21 entries remain `frozenPort`; no feature behavior is implemented |
| `CORE-001`, `SEC-001`, `EXT-001`, `EXT-002` | Core models, versioned/fail-closed envelopes, router vocabulary, and complete command/event payload types exist in Rust and TypeScript | PASS — 37 commands, 8 events, 24 known errors, JS-safe integers, cancellation metadata, and all referenced payload types remain generated and validated |
| `PROC-001`, `PROC-002`, `BUILD-001` | Reproducible handoff contains revisions, commands, mutation evidence, risks, and clean-checkout proof | PASS — local and clean-clone gates below ran at implementation `154d48c` |

## Changes made

- Added `appError`, `recoveryActions`, and `readOnlyRecoveryActions` to the existing generated runtime-schema artifact `contracts/generated/ipc-v1-event-schemas.json`; the same data is embedded in `src/generated/ipc.ts` and checked by the existing five-artifact generator drift gate.
- `appError` is `schemars 1.2.2` output from the actual Rust `AppError`/`RawAppError` serde wire type. It includes all required fields, non-empty `AppErrorCode`, optional/null rules, and all 8 `AppErrorDetails` variants.
- Replaced the Rust `RecoveryAction` declaration plus parallel match lists with one macro invocation that owns enum variants, wire spelling, and read-only policy. Rust serde, `ts-rs`, JSON Schema, full registry, read-only registry, parsing, and serialization all expand from that source.
- Removed the handwritten TypeScript `AppError` field validator, full action list, and read-only literal. `decodeAppError` first runs the generic schema decoder with AppError-reference policy disabled, then filters actions using the generated registries.
- Nested event `$ref: AppError` handling still returns the sanitized object. It revalidates the result against the event-local Rust schema with policy recursion disabled, preventing `decodeAppError -> AppError $ref -> decodeAppError` recursion.
- Added executable regressions for direct invalid details, all 8 concrete details variants, unknown optional preservation, direct required-field shape, generated action registries, nested sanitization, and invalid nested details.
- `package.json`, `pnpm-lock.yaml`, root CI, Cargo manifests/lock, release configuration, command handlers, and `CONTRACT-004`–`CONTRACT-024` behavior were not changed in this review iteration.

## Decisions and assumptions

- IPC remains `1.0-draft`; only Integration may publish F0 and mark this task `DONE`.
- `ts-rs 12.0.1` remains the TypeScript declaration generator; `schemars 1.2.2` remains the executable runtime-schema generator. This review adds no dependency or lockfile delta.
- The AppError schema intentionally permits future non-empty code strings and future recovery-action strings to reach the fail-closed policy. It does not permit unknown `AppErrorDetails.kind`, missing required fields, explicit null for optional fields, or wrong nested field types.
- Unknown top-level optional fields remain preserved for forward compatibility because Rust serde accepts them and the generated object schema leaves `additionalProperties` open.
- The only TypeScript recovery-policy code now performs membership checks against generated arrays. There is no production TypeScript string enumeration of the complete action set or read-only subset.
- Existing third-review fixes for exact integers, required-null, Markdown-only native targets, strict external-change provenance, union completeness, and event field drift remain unchanged.

## Verification evidence

Environment: macOS/Darwin 25.6.0 arm64; Node `v24.14.0`; pnpm `10.32.1`; Rust/Cargo `1.98.0`. `${CARGO_BIN_DIR}` denotes the local Rust toolchain directory. `${CLEAN_CLONE}` denotes the disposable system-temporary clone and contains no user documents.

| Test / acceptance ID | Exact command and environment | Result | Artifact or failure |
|---|---|---|---|
| Baseline / `PROC-001` | `ruby scripts/validate_design_docs.rb`; `PATH="${CARGO_BIN_DIR}:$PATH" pnpm exec node contracts/run.mjs` at `556b279` | PASS; docs gate and canonical Rust 14/14 + TS 24/24 | Confirmed the review base before CLAIMED checkpoint `f346e83` |
| `CONTRACT-001`–`CONTRACT-003` | `PATH="${CARGO_BIN_DIR}:$PATH" pnpm exec node contracts/run.mjs` at `154d48c` | PASS; generator drift 0; Rust contract 15/15; TypeScript contract 29/29 | Terminal ended `CONTRACT-001..003 PASS`; 004–024 remained frozen |
| `CONTRACT-003`, direct/nested parity | `pnpm exec vitest run src/domain/ipc.contract.test.ts`; `PATH="${CARGO_BIN_DIR}:$PATH" cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features contract_ -- --nocapture` | PASS; TS 29/29; Rust 15/15 | Direct invalid details `null`; all 8 variants accepted; unknown optional retained; nested unknown code sanitized; invalid nested details rejected |
| `CONTRACT-001` / `CONTRACT-003`, AppError field mutation | With `apply_patch`, add `#[serde(rename = "correlationToken")]` to Rust `RawAppError.correlation_id`; run generator `--check`, generator `--write`, then targeted Vitest `-t "accepts exactly the Rust-derived required AppError field shape"`; restore both patches and regenerate | EXPECTED drift failure then PASS 1/1; pre-generation check named `src/generated/ipc.ts`, union schemas, and runtime/event schemas; generated standalone schema required `correlationToken`, decoder accepted it and rejected `correlationId` | Proves direct decoder follows the Rust field schema rather than a handwritten field list; restored canonical runner PASS |
| `CONTRACT-002`, registry completeness | Rust `contract_003_app_error_details_and_recovery_registry_follow_serde` plus `contract_002_registry_drives_event_payload_types_and_decoder_schemas` under the canonical runner | PASS | Rust schema enum equals generated full registry; read-only registry is derived from Rust policy; invalid details fail real serde |
| Full formatter/lint/type/Rust/build | `PATH="${CARGO_BIN_DIR}:$PATH" pnpm verify` at `154d48c` | PASS; Prettier, ESLint, TypeScript, Vitest 32/32, Rust fmt, Clippy `-D warnings`, Rust 17/17, Vite build, Tauri debug no-bundle build | Local ignored output under `dist/` and `src-tauri/target/` |
| `BUILD-001`, clean checkout | `git clone --local --branch task/P0-CONTRACT-01-ipc-v1 --single-branch <source> "${CLEAN_CLONE}"`; `pnpm install --frozen-lockfile`; docs validator; canonical runner; `PATH="${CARGO_BIN_DIR}:$PATH" pnpm verify` | PASS at `154d48c`; canonical Rust 15/15 + TS 29/29; full Vitest 32/32 + Rust 17/17; Tauri debug build succeeded | Clean clone moved recoverably to system Trash after verification |
| Documentation gate | `ruby scripts/validate_design_docs.rb` | PASS; 22 Markdown files, 37 IPC commands, no link/fence/ID/privacy violation | Final checkpoint snapshot is emitted by the validator run immediately before handoff commit |
| Dependency/license/security | `cargo metadata --locked ...`; `cargo tree --locked ... -i schemars@1.2.2`; `cargo audit --file src-tauri/Cargo.lock`; `git diff --exit-code f346e83 -- package.json pnpm-lock.yaml src-tauri/Cargo.toml src-tauri/Cargo.lock` | PASS; no dependency/lock delta; exact direct `schemars 1.2.2` edge remains derive-only; audit exit 0 with 17 pre-existing allowed warnings and no vulnerability finding | Existing licenses remain `schemars`/derive MIT and serde internals MIT OR Apache-2.0; no npm manifest/lock diff |
| Scope/privacy guard | Scoped `rg` for personal absolute paths, embedded Base64, private keys, Tauri commands, `invoke`, and `listen`; `git diff --check` | PASS; no match and no whitespace failure | No user document, clipboard data, secret, binary, handler, or Phase 1 code added |

## Open questions and blockers

There is no Contract/Domain implementation blocker.

- Owner: Integration + independent Contract reviewer. Action: review `154d48c` and the final REVIEW checkpoint, rerun the canonical runner, then connect `contracts/run.mjs` to the Integration-owned global verify/CI path. Affected tasks: `P0-CONTRACT-01`, `P0-CI-01`, downstream `P0-FLAG-01`. Only Integration may mark `DONE` or publish F0.
- Owner: Integration/Release dependency policy. Action: disposition the 17 allowed pre-existing RustSec warnings in the Tauri lock graph before release. None is introduced by this iteration or names `schemars 1.2.2`/`schemars_derive 1.2.2`.
- Owner: future Contract/Domain schema owners. Maintenance rule: accepted `AppError`, `AppErrorDetails`, or `RecoveryAction` changes must be made in Rust and regenerated. Editing generated TypeScript or adding a parallel runtime field/action list is forbidden.

## Remaining numbered steps

1. Integration and an independent Contract reviewer inspect implementation `154d48c` plus the final REVIEW checkpoint and rerun `pnpm exec node contracts/run.mjs`.
2. Integration wires the canonical runner into its owned global verify/CI entry point without changing contract semantics.
3. If every Phase 0 gate passes, Integration merges the branch, publishes F0, marks this task `DONE`, and releases `P0-FLAG-01`.
4. Future feature owners implement only their mapped `CONTRACT-004`–`CONTRACT-024` ports after F0; no Phase 1 work starts from this branch.

## Data safety, recovery, and temporary artifacts

No user Markdown, clipboard content, personal absolute path, Base64 image, secret, recovery state, or external full file content was read or committed. Fixtures contain only small deterministic values. Build output remains ignored under `dist/` and `src-tauri/target/`.

The clean verification clone was moved to system Trash rather than recursively deleted and remains recoverable until Trash is emptied. The AppError mutation was applied and restored only with `apply_patch`, followed by canonical regeneration and drift verification. No user/project recovery action is required.

## Single recommended next action

Integration should assign an independent Contract reviewer to `154d48c`, rerun `pnpm exec node contracts/run.mjs`, and merge only if the direct/nested AppError schema-parity review passes.
