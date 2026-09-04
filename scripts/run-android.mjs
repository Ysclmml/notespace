#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import console from "node:console";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const command = process.argv[2];
const commandArguments = process.argv.slice(3);

if (!command || !["init", "dev", "build"].includes(command)) {
  console.error("Usage: node scripts/run-android.mjs <init|dev|build> [...args]");
  process.exit(2);
}

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

const androidHome = firstExisting([
  process.env.ANDROID_HOME,
  process.platform === "darwin" ? join(homedir(), "Library", "Android", "sdk") : "",
  process.platform === "win32"
    ? join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk")
    : "",
  process.platform === "linux" ? join(homedir(), "Android", "Sdk") : "",
]);

if (!androidHome) {
  console.error("Android SDK was not found. Install it with Android Studio first.");
  process.exit(1);
}

const ndkRoot = join(androidHome, "ndk");
const installedNdks = existsSync(ndkRoot)
  ? readdirSync(ndkRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
  : [];
const ndkHome = firstExisting([
  process.env.NDK_HOME,
  installedNdks.length > 0 ? join(ndkRoot, installedNdks.at(-1)) : "",
]);

if (!ndkHome) {
  console.error("Android NDK was not found. Install an NDK (Side by side) version first.");
  process.exit(1);
}

const javaHome = firstExisting([
  process.env.JAVA_HOME,
  process.platform === "darwin"
    ? "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
    : "",
]);

if (!javaHome) {
  console.error("JAVA_HOME was not found. Install Android Studio or configure a JDK.");
  process.exit(1);
}

const tauriCli = join(repositoryRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
if (!existsSync(tauriCli)) {
  console.error("Tauri CLI is missing. Run pnpm install first.");
  process.exit(1);
}

const pathEntries = [
  join(androidHome, "platform-tools"),
  join(androidHome, "cmdline-tools", "latest", "bin"),
  process.env.PATH ?? "",
];
const effectiveCommandArguments = [...commandArguments];
const childEnvironment = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidHome,
  NDK_HOME: ndkHome,
  PATH: pathEntries.join(process.platform === "win32" ? ";" : ":"),
};
if (
  command === "build" &&
  commandArguments.includes("--debug") &&
  !commandArguments.some(
    (argument) => argument === "--config" || argument.startsWith("--config="),
  )
) {
  effectiveCommandArguments.push(
    "--config",
    join(repositoryRoot, "src-tauri", "tauri.android.debug.conf.json"),
  );
}
if (
  command === "build" &&
  commandArguments.includes("--debug") &&
  childEnvironment.CARGO_PROFILE_DEV_STRIP === undefined
) {
  // Installable test APKs do not need Rust DWARF sections. `android dev`
  // deliberately keeps the normal Cargo dev profile for native debugging.
  childEnvironment.CARGO_PROFILE_DEV_STRIP = "debuginfo";
}
const child = spawnSync(
  process.execPath,
  [tauriCli, "android", command, ...effectiveCommandArguments],
  {
    cwd: repositoryRoot,
    env: childEnvironment,
    stdio: "inherit",
  },
);

if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}
process.exit(child.status ?? 1);
