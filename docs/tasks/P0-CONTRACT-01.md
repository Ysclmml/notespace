# P0-CONTRACT-01 — IPC v1 契约冻结与生成绑定

- Status: CLAIMED
- Owner / next owner: Contract/Domain (`/root/p0_contract_01`) / same owner until REVIEW
- Base revision / head revision: `576a435` / working tree
- Requirement IDs: `DATA-REVISION-001`, `SAFE-IPC-001`, `EXT-ROUTER-001`, `EXT-COMMAND-001`, `OPS-CONTEXT-001`, `OPS-HANDOFF-001`
- Product UX IDs: `UX-EXT-001`
- Test / acceptance IDs: `CORE-001`, `SEC-001`, `EXT-001`, `EXT-002`, `CONTRACT-001`–`CONTRACT-024`, `PROC-001`, `PROC-002`
- ADRs / contract and schema versions: `ADR-0001`–`ADR-0004`; IPC `1.0-draft` copied from `docs/design/03-domain-model-and-contracts.md`, target F0 wire version `1.0`
- Feature flags: none; `P0-FLAG-01` remains downstream
- Owned and touched paths: `contracts/**`, `src/generated/**`, `src-tauri/src/ipc_schema.rs`, `src-tauri/src/domain/**`, `tests/contract/**`, this task note, and only this task's `docs/PROJECT_STATE.md` ledger row; crate manifest only if the schema implementation cannot compile without direct serialization dependencies

## Goal and non-goals

Define the executable Rust IPC v1 schema, stable command/error/event envelopes, cancellation/core wire models, and deterministically generate `src/generated/ipc.ts`. Establish the canonical `CONTRACT-001`–`CONTRACT-024` manifest/runner and execute F0 gates `CONTRACT-001`–`CONTRACT-003`.

Non-goals: no Tauri command handlers, filesystem access, real IPC invocation, Phase 1 sessions/editor/navigation/assets, feature flags, or behavior implementations for `CONTRACT-004`–`CONTRACT-024`.

## Dependencies and baseline

- Dependency task/freeze status: approved design baseline 0.1; `P0-BOOT-01` is `DONE`; schema remains `1.0-draft` until Integration publishes F0.
- Baseline commands: `ruby scripts/validate_design_docs.rb`; first `PATH="${CARGO_BIN_DIR}:$PATH" pnpm verify` exposed a fresh-worktree dependency prerequisite; then `pnpm install --frozen-lockfile` and the same `pnpm verify` command. `CARGO_BIN_DIR` denotes the local rustup bin directory and its machine-specific value is intentionally not persisted.
- Baseline result: design validator PASS (`design_snapshot_sha256=e0905a48147eee7c3264b382aeab2a8c2c2e40dab2ef6b7f5b9963a96cca8509`); initial verify exited 1 because `node_modules` was absent; frozen install succeeded without lockfile changes; rerun verify exited 0, including 3 frontend tests, Rust fmt/clippy/tests, Vite build, and Tauri debug no-bundle build.

## Acceptance criteria status

| Requirement / acceptance ID | Expected evidence | Status |
|---|---|---|
| `CONTRACT-001` | Rust schema regenerates committed TypeScript binding with zero diff | pending |
| `CONTRACT-002` | Rust serde JSON fixtures round-trip through TypeScript union validators with matching tags/fields | pending |
| `CONTRACT-003` | Unknown event/error/optional fields remain readable while unknown write actions fail closed | pending |
| `CONTRACT-004`–`CONTRACT-024` | Canonical manifest freezes ID, layer, fixture port, and mapped future task without pretending behavior is implemented | pending |
| `CORE-001`, `SEC-001`, `EXT-001`, `EXT-002` | Core wire models, versioned/fail-closed envelopes, resource/command vocabulary compile and are exposed in generated bindings | pending |

## Changes made

- Claimed isolated branch/worktree and recorded clean baseline evidence.

## Decisions and assumptions

- Exact command names, fields, variants, known error codes, and events will be copied from canonical design chapter 03 and mechanically compared with it; no semantic cleanup is authorized in this task.
- `CONTRACT-004`–`CONTRACT-024` are manifest-only F0 ports per implementation plan and test design; their behavioral implementations remain owned by mapped feature tasks.

## Verification evidence

| Test / acceptance ID | Exact command and environment | Result | Artifact or failure |
|---|---|---|---|
| `PROC-001`, documentation baseline | `ruby scripts/validate_design_docs.rb` on macOS arm64, base `576a435` | PASS | stdout; snapshot `e0905a...` |
| `BUILD-001`, baseline | `pnpm install --frozen-lockfile && PATH="${CARGO_BIN_DIR}:$PATH" pnpm verify`; Node 24.14.0, pnpm 10.32.1, Rust 1.98.0 | PASS | stdout; debug binary under ignored `src-tauri/target/` |

## Open questions and blockers

None at claim. Direct Rust serialization dependencies may require a narrow `src-tauri/Cargo.toml` change; the owner will coordinate with Integration before doing so.

## Remaining numbered steps

1. Materialize canonical Rust schema and deterministic TypeScript generator.
2. Establish the 24-entry contract manifest and validate its mapping against chapter 09.
3. Implement and gate `CONTRACT-001`–`CONTRACT-003` without implementing feature behavior.
4. Run all required format/lint/type/Rust/contract/schema-drift/document gates.
5. Update this note and the single ledger row to `REVIEW`, commit, and hand off to Integration.

## Data safety, recovery, and temporary artifacts

No user document, clipboard data, raw path, Base64 fixture, or recovery content is read or written. Generated fixtures are synthetic contract metadata only. `node_modules`, build output, and Rust target output remain ignored.

## Single recommended next action

Implement the Rust schema/generator from chapter 03 and make `CONTRACT-001` the first executable drift gate.
