/* global console, process */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(resolve(repositoryRoot, "contracts/ipc-v1.manifest.json"), "utf8"),
);
const expectedIds = Array.from(
  { length: 24 },
  (_, index) => `CONTRACT-${String(index + 1).padStart(3, "0")}`,
);
const actualIds = manifest.contracts.map((contract) => contract.id);

if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
  throw new Error("canonical CONTRACT-001..024 manifest is incomplete or out of order");
}

const f0Contracts = manifest.contracts.filter((contract) => contract.gate === "f0");
if (
  JSON.stringify(f0Contracts.map((contract) => contract.id)) !==
    JSON.stringify(["CONTRACT-001", "CONTRACT-002", "CONTRACT-003"]) ||
  f0Contracts.some((contract) => contract.status !== "executable")
) {
  throw new Error("F0 executable gate must contain exactly CONTRACT-001..003");
}

if (
  manifest.commands.length !== 37 ||
  manifest.events.length !== 8 ||
  manifest.knownAppErrorCodes.length !== 24
) {
  throw new Error("IPC manifest must preserve the canonical 37 commands, 8 events and 24 errors");
}

const deferredContracts = manifest.contracts.filter((contract) => contract.gate === "feature");
if (
  deferredContracts.some(
    (contract) =>
      contract.status !== "frozenPort" ||
      !contract.path.startsWith("tests/contract/") ||
      contract.futureTasks.length === 0,
  )
) {
  throw new Error("CONTRACT-004..024 must freeze a test port and at least one future owner");
}

const commands = [
  [
    "cargo",
    [
      "run",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--bin",
      "generate_ipc",
      "--",
      "--check",
    ],
  ],
  [
    "cargo",
    [
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--all-targets",
      "--all-features",
      "contract_",
    ],
  ],
  ["pnpm", ["vitest", "run", "src/domain/ipc.contract.test.ts"]],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("CONTRACT-001..003 PASS; CONTRACT-004..024 canonical ports are frozen");
