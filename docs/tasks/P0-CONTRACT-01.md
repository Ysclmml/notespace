# P0-CONTRACT-01 — IPC v1 契约冻结与生成绑定

- Status: REVIEW
- Owner / next owner: Contract/Domain (`/root/p0_contract_01`) / Integration + independent Contract reviewer
- Base revision / head revision: original base `576a435`; third-review rework base `91a2782`; implementation head `af6302e98580368db34eddbdd3caa313567ed669`; handoff revision is the final REVIEW checkpoint commit containing this note
- Requirement IDs: `DATA-REVISION-001`, `SAFE-IPC-001`, `EXT-ROUTER-001`, `EXT-COMMAND-001`, `OPS-CONTEXT-001`, `OPS-HANDOFF-001`
- Product UX IDs: `UX-EXT-001`
- Test / acceptance IDs: `CORE-001`, `SEC-001`, `EXT-001`, `EXT-002`, `CONTRACT-001`–`CONTRACT-024`, `PROC-001`, `PROC-002`; supporting clean-checkout evidence for `BUILD-001`
- ADRs / contract and schema versions: `ADR-0001`–`ADR-0004`; IPC wire version `1.0`; schema status remains `1.0-draft` until Integration publishes F0
- Feature flags: none; `P0-FLAG-01` remains downstream
- Owned and touched paths: `contracts/**`, `src/generated/**`, `src/domain/ipc.contract.test.ts`, `src-tauri/src/domain/**`, `src-tauri/src/ipc_schema.rs`, `src-tauri/src/ipc_schema/**`, `src-tauri/src/bin/generate_ipc.rs`, approved narrow `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` changes, this note, and only this task's `docs/PROJECT_STATE.md` row

## Goal and non-goals

The branch defines the executable Rust-owned IPC v1 wire surface, deterministic TypeScript bindings, stable command/error/event envelopes, cancellation metadata, and core models. It establishes the canonical `CONTRACT-001`–`CONTRACT-024` manifest/runner: F0 executes `CONTRACT-001`–`CONTRACT-003`; the other 21 ports remain frozen for their mapped future owners.

No Tauri command handler, frontend invoke/listener, filesystem, clipboard, renderer, real IPC transport, feature behavior, or Phase 1 implementation was added. `CONTRACT-004`–`CONTRACT-024` remain non-behavioral `frozenPort` entries.

## Acceptance criteria status

| Requirement / acceptance ID | Expected evidence | Status |
|---|---|---|
| `CONTRACT-001` | Rust regeneration reproduces every committed TypeScript/manifest/fixture/schema artifact; legal Rust serde changes drive runtime validation | PASS — five generated artifacts are drift-gated; the 8 event specs, payload Rust types, and schemas share one registry; the field-rename mutation changed decoder behavior only after regeneration |
| `CONTRACT-002` | Every structural tagged, untagged, and single-variant wire union has concrete Rust variants serialized through `serde_json`, with mechanical completeness | PASS — 50 groups are derived from the wire registry/schema, including `SaveAsTarget`, `NavigateTarget`, `AbsentDiskRevision`, `DocumentSaveAsOutcome`, `ResourceResolutionWithoutGrant`, and `MarkdownResourceRef`; branch coverage detects duplicate/missing variants |
| `CONTRACT-003` | Unknown events/errors/optional fields remain readable while unsafe values and unknown writes fail closed | PASS — nested event `AppError` values are returned sanitized; unknown non-empty codes retain only read-only recovery actions; empty codes, unsafe integers, invalid scope/payload, null optional fields, non-Markdown native targets, unknown Rust write actions, and illegal external `writeId` states are rejected |
| `CONTRACT-004`–`CONTRACT-024` | Freeze canonical ID, layer, fixture port, and future owner without claiming feature behavior | PASS for F0 freeze only — exactly 21 entries remain `frozenPort`; no feature behavior is implemented |
| `CORE-001`, `SEC-001`, `EXT-001`, `EXT-002` | Core models, versioned/fail-closed envelopes, router vocabulary, and complete command/event payload types exist in Rust and TypeScript | PASS — 37 commands, 8 events, 24 known errors, cancellation metadata, safe integers, and all referenced request/response/event types are generated and validated |
| `PROC-001`, `PROC-002`, `BUILD-001` | Reproducible handoff includes exact revisions, commands, risks, and clean-checkout evidence | PASS — local and clean-clone gates below were run at the implementation head |

## Changes made

- Rust serde/`ts-rs` types remain the sole declaration source. The renderer registry calls `TS::decl`; it contains type ownership/classification but no duplicated fields, tags, optionality, or nullability.
- Added exact `schemars = 1.2.2` with `default-features = false` and only `derive`. Rust serde derives now mechanically produce executable JSON Schemas. The generator commits and drift-checks `ipc-v1-event-schemas.json` and `ipc-v1-union-schemas.json` alongside `ipc.ts`, the manifest, and concrete fixtures.
- Replaced the handwritten event-field validator with a generic TypeScript JSON Schema evaluator. A generation-time vocabulary gate rejects unsupported assertion keywords. The evaluator preserves `$ref` sibling semantics, validates safe integers/objects/arrays/unions, and returns normalized nested values rather than the original envelope.
- A single `event_registry!` binds all 8 event IDs/names/Rust payload types/scope policies. It expands both `EVENTS` and the Rust-derived schema map; generated schema titles are checked against generated payload type names.
- `decodeAppError` is applied recursively through `$ref` resolution. The `recovery.snapshotFailed` regression proves an unknown error entering through `decodeEventEnvelope` loses `overwrite` and unknown actions while retaining `openSafetyPage` in the returned payload.
- `AppErrorCode` now rejects empty strings in both Rust serialization and deserialization; its generated schema carries `minLength: 1`, matching the canonical non-empty rule and the TypeScript event decoder. Unknown non-empty strings remain forward-readable.
- `DocumentExternalChanged` and standalone `DocumentChangeProvenance` use rejecting Rust deserialization for every present `writeId` on external/permission states, including `null`. Matching generated schema constraints reject the same combinations in TypeScript.
- Exact integer helpers expose JSON integer bounds of `±Number.MAX_SAFE_INTEGER`; event optional properties remove explicit-null acceptance while `RequiredNullable<T>` preserves required `null`. The Markdown-only wrapper schema is selected mechanically from `ResourceRef`; the open `AppError` schema permits future strings to reach the fail-closed policy.
- The union registry classifies all exported wire types. Structural unions marked plain fail catalog validation; each registered union's variant count comes from its schema. Concrete Rust variants are serialized through `serde_json`, and TypeScript checks every fixture against its root plus every `oneOf`/`anyOf`/single branch.
- `package.json`, `pnpm-lock.yaml`, global CI, release configuration, command handlers, and `CONTRACT-004`–`CONTRACT-024` behavior were not changed.

## Decisions and assumptions

- IPC remains `1.0-draft`; only Integration may publish F0 and mark the task `DONE`.
- `ts-rs` remains responsible for TypeScript declarations; `schemars 1.2.2` is an executable validator/test artifact derived from the same serde types. It was selected because it honors `serde(rename_all_fields)` and has explicit schema helpers for branded safe integers, `AppError`, Markdown-only references, and rejecting external provenance.
- Optional event properties use the frozen TypeScript meaning `field?: T`, so the generated decoder schema removes `null` only from non-required properties. Required-nullable fields remain required and accept explicit `null`.
- JSON Schema `format` is annotation-only under the generated Draft 2020-12 vocabulary; numeric type/finite checks remain assertions. Any newly emitted unsupported assertion keyword fails Rust catalog generation instead of being silently ignored.
- Forward compatibility is asymmetric: unknown read-only events and optional fields remain readable; unknown error codes retain only `openSafetyPage`, `compare`, or `openExternal`; unknown write actions fail the real Rust request decoder.
- The generated union-schema artifact is intentionally comprehensive and review-heavy; it is test-only contract data, not loaded by the production application. The smaller event-schema artifact is embedded into generated TypeScript for runtime decoding.

## Verification evidence

Environment: macOS/Darwin 25.6.0 arm64; Node `v24.14.0`; pnpm `10.32.1`; Rust/Cargo `1.98.0`. `${CARGO_BIN_DIR}` denotes the local Rust toolchain directory; `${CLEAN_CLONE}` denotes the disposable system-temporary clone and contains no user documents.

| Test / acceptance ID | Exact command and environment | Result | Artifact or failure |
|---|---|---|---|
| `CONTRACT-001`–`CONTRACT-003` | `PATH="${CARGO_BIN_DIR}:$PATH" pnpm exec node contracts/run.mjs` at `af6302e` | PASS; exit 0; generator drift 0; Rust contract 14/14; TypeScript contract 24/24 | `src/generated/ipc.ts`, `contracts/ipc-v1.manifest.json`, `contracts/generated/ipc-v1-{union-fixtures,union-schemas,event-schemas}.json`; terminal ended `CONTRACT-001..003 PASS` |
| `CONTRACT-001`, event-field mutation | With `apply_patch`, rename Rust `WorkspaceFilesChanged.generation_hint` to `generation_counter`, update only the dedicated expectation, run generator `--write`, then `pnpm exec vitest run src/domain/ipc.contract.test.ts -t "accepts exactly the Rust-derived workspace.filesChanged payload shape"`; restore with `apply_patch` and regenerate | PASS mutation evidence; regenerated schema keys were `changes,generationCounter,overflow`; decoder accepted `generationCounter` and rejected old `generationHint`; restored test also PASS | Proves runtime event fields are not a second handwritten source |
| `CONTRACT-002`, branch-completeness mutation | With `apply_patch`, replace `SaveAsTarget::Grant` fixture by a second `Prompt`; regenerate; run `pnpm exec vitest run src/domain/ipc.contract.test.ts -t "mechanically covers every branch"`; restore with `apply_patch` and regenerate | EXPECTED FAIL; exit 1; exact failure `SaveAsTarget branch 1 has no concrete Rust fixture`; restored branch test PASS | Proves equal-length/magic-count fixtures cannot hide a missing variant |
| `CONTRACT-002`, serde/schema alignment | `PATH="${CARGO_BIN_DIR}:$PATH" cargo test --manifest-path src-tauri/Cargo.toml contract_ -- --nocapture` | PASS; 14/14 focused tests | Includes strict external/permission `writeId`, required-nullable, safe integer, non-empty `AppErrorCode`, Markdown-only, schema helper, event registry, and concrete fixture tests |
| `CONTRACT-003`, `CORE-001`, `SEC-001` | `pnpm exec vitest run src/domain/ipc.contract.test.ts` | PASS; 24/24 | Includes nested `AppError` normalization, empty error-code rejection, negative/fractional/unsafe sequence, unsafe payload counter, optional-null, invalid scope/identity/payload/provenance, and generated field-shape regressions |
| Documentation gate | `ruby scripts/validate_design_docs.rb` | PASS; 22 Markdown files, 37 IPC commands, no link/fence/ID/privacy violations | Final clean-clone validator snapshot `8f90b91beb6ec3cc465327b501d78a831328725018944e29469980efdfe55cce` |
| Formatting, lint, type, Rust, build | `PATH="${CARGO_BIN_DIR}:$PATH" pnpm verify` at `af6302e` | PASS; exit 0; Prettier, ESLint, TypeScript, Vitest 27/27, Rust fmt, Clippy `-D warnings`, Rust 16/16, Vite production build, Tauri debug no-bundle build | Local ignored build output under `dist/` and `src-tauri/target/debug/markdown-workspace` |
| `BUILD-001`, `PROC-001` clean checkout | `git clone --local --branch task/P0-CONTRACT-01-ipc-v1 --single-branch <source> "${CLEAN_CLONE}"`; then `pnpm install --frozen-lockfile && ruby scripts/validate_design_docs.rb && PATH="${CARGO_BIN_DIR}:$PATH" pnpm exec node contracts/run.mjs && PATH="${CARGO_BIN_DIR}:$PATH" pnpm verify` | PASS; every command exit 0 at `af6302e`; contract Rust 14/14 + TS 24/24; full Vitest 27/27 + Rust 16/16; Tauri debug build succeeded | Final clean clone was moved recoverably to system Trash after verification |
| Dependency/license/security | `cargo metadata --locked --manifest-path src-tauri/Cargo.toml --format-version 1`; `cargo tree --locked --manifest-path src-tauri/Cargo.toml -e features -i schemars@1.2.2`; `cargo audit --file src-tauri/Cargo.lock` | PASS; direct edge exact `1.2.2`, default features false, only `derive`; audit exit 0 with 17 pre-existing allowed warnings and no vulnerability finding | `schemars`/derive MIT, MSRV 1.74; `serde_derive_internals 0.30.0` MIT OR Apache-2.0, MSRV 1.71; checksums locked; no npm manifest/lock diff |
| Scope/privacy guard | Reject personal paths, embedded Base64, private keys, Tauri commands, `invoke`, and `listen` with scoped `rg`; inspect `git diff --name-only` and `git diff -- package.json pnpm-lock.yaml` | PASS; no match and no package/lock diff | Only declared task paths changed; no user document or binary content |
| Patch hygiene | `git diff --check 7763960..af6302e` and generator `--check` | PASS; exit 0 | No whitespace errors or generated drift |

## Open questions and blockers

There is no Contract/Domain implementation blocker.

- Owner: Integration. Input/action: independently review the implementation and handoff commits, connect `contracts/run.mjs` to the global verify/CI path owned by `P0-CI-01`, then decide whether F0 may publish IPC `1.0-draft`. Affected tasks: `P0-CONTRACT-01`, `P0-CI-01`, downstream `P0-FLAG-01`. Safe work: read-only review and Integration gate execution; only Integration marks `DONE`.
- Owner: Integration/Release dependency policy. Input: disposition of the 17 allowed pre-existing RustSec warnings in the Tauri lock graph before release. None names `schemars`, `schemars_derive`, or `serde_derive_internals`; this does not block the contract review.
- Owner: future Contract/Domain schema owners. Maintenance requirement: add every accepted wire type to the explicit declaration registry and regenerate all artifacts. Structural-union classification, event registry/schema title checks, canonical catalogs, branch matrix, and generator drift fail omissions within the registered surface; accepted schema changes still require normal contract review.

## Remaining numbered steps

1. Integration and an independent Contract reviewer inspect `af6302e` plus the final REVIEW checkpoint commit and rerun the canonical runner.
2. Integration wires `contracts/run.mjs` into its owned global verify/CI entry point without changing contract semantics.
3. If Phase 0 gates pass, Integration merges the branch, publishes F0, marks this task `DONE`, and releases `P0-FLAG-01`.
4. Future feature owners implement only their mapped `CONTRACT-004`–`CONTRACT-024` ports after F0; no Phase 1 work starts from this branch.

## Data safety, recovery, and temporary artifacts

No user Markdown, clipboard content, personal absolute path, Base64 image, secret, recovery state, or external full file content was read or committed. Fixtures contain only small deterministic `fixture-*` values and harmless sample text. Build output remains ignored under `dist/` and `src-tauri/target/`.

The clean verification clone was moved to system Trash rather than recursively deleted and remains recoverable until Trash is emptied. The two temporary mutation states were restored only with `apply_patch`, followed by regeneration and passing drift/tests. No user/project recovery action is required.

## Single recommended next action

Integration should independently review `af6302e`, rerun `pnpm exec node contracts/run.mjs`, and—only if that review passes—merge it through the Integration branch, connect the runner to CI, and publish F0.
