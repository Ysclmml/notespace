#!/usr/bin/env node

import console from "node:console";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const utf8 = new TextDecoder("utf-8", { fatal: true });

function trackedPaths() {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "buffer",
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function readTrackedText(relativePath) {
  const fullPath = join(repositoryRoot, relativePath);

  try {
    const bytes = lstatSync(fullPath).isSymbolicLink()
      ? Buffer.from(readlinkSync(fullPath), "utf8")
      : readFileSync(fullPath);
    return utf8.decode(bytes);
  } catch {
    return null;
  }
}

function lineNumber(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function inspectTrackedText(relativePath, text) {
  const problems = [];
  const checks = [
    {
      code: "merge-marker",
      pattern: /^(?:<{7}(?: .*)?|>{7}(?: .*)?)$/gm,
      message: "unresolved merge marker",
    },
    {
      code: "personal-path",
      pattern:
        /\/Users\/[^/\s]+\/|\/var\/folders\/[^\s]+|\/home\/[^/\s]+\/|[A-Za-z]:\\Users\\[^\\\s]+\\/g,
      message: "personal absolute path",
    },
    {
      code: "embedded-image",
      pattern: /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]{128,}/gi,
      message: "embedded data:image Base64 payload",
    },
  ];

  for (const check of checks) {
    for (const match of text.matchAll(check.pattern)) {
      problems.push(
        `${relativePath}:${lineNumber(text, match.index)} [${check.code}] ${check.message}`,
      );
    }
  }

  return problems;
}

function markdownLinkProblems(relativePath, text) {
  const problems = [];
  let fence = null;

  for (const [index, sourceLine] of text.split("\n").entries()) {
    const fenceMatch = sourceLine.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) {
        fence = { character: marker[0], length: marker.length };
      } else if (marker[0] === fence.character && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }

    if (fence !== null) continue;

    const visibleLine = sourceLine.replace(/(`+).*?\1/g, "");
    for (const match of visibleLine.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const rawTarget = match[1].trim();
      const target =
        rawTarget.startsWith("<") && rawTarget.includes(">")
          ? rawTarget.slice(1, rawTarget.indexOf(">"))
          : rawTarget.split(/\s+/, 1)[0];

      if (
        !target ||
        target.startsWith("#") ||
        target.startsWith("/") ||
        /^[a-z][a-z0-9+.-]*:/i.test(target)
      ) {
        continue;
      }

      const encodedPath = target.split("#", 1)[0].split("?", 1)[0];
      let decodedPath;
      try {
        decodedPath = decodeURIComponent(encodedPath);
      } catch {
        problems.push(
          `${relativePath}:${index + 1} [markdown-link] invalid URL escaping: ${target}`,
        );
        continue;
      }

      const resolvedPath = join(repositoryRoot, dirname(relativePath), decodedPath);
      if (!existsSync(resolvedPath)) {
        problems.push(
          `${relativePath}:${index + 1} [markdown-link] missing relative target: ${target}`,
        );
      }
    }
  }

  return problems;
}

const paths = trackedPaths();
const problems = [];
let textFiles = 0;
let markdownFiles = 0;

for (const relativePath of paths) {
  const text = readTrackedText(relativePath);
  if (text === null) continue;

  textFiles += 1;
  problems.push(...inspectTrackedText(relativePath, text));

  if (relativePath.endsWith(".md")) {
    markdownFiles += 1;
    problems.push(...markdownLinkProblems(relativePath, text));
  }
}

if (problems.length > 0) {
  console.error(`repository_check=FAIL problems=${problems.length}`);
  for (const problem of problems) console.error(`ERROR ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `repository_check=PASS tracked=${paths.length} text=${textFiles} markdown=${markdownFiles}`,
  );
}
