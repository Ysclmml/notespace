import { convertFileSrc, isTauri } from "@tauri-apps/api/core";

const SCHEME = /^[a-z][a-z\d+.-]*:/iu;

function decodeTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function normalizeAbsolutePath(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}

export function markdownImagePath(documentPath: string, target: string): string | null {
  const clean = decodeTarget(target.trim().replace(/^<|>$/gu, ""));
  if (!clean || clean.startsWith("#") || SCHEME.test(clean)) return null;
  if (clean.startsWith("/")) return normalizeAbsolutePath(clean);
  if (documentPath.startsWith("demo://")) return null;
  const separator = documentPath.lastIndexOf("/");
  if (separator < 0) return null;
  return normalizeAbsolutePath(`${documentPath.slice(0, separator)}/${clean}`);
}

export function resolveMarkdownImageSource(documentPath: string, target: string): string {
  const localPath = markdownImagePath(documentPath, target);
  if (!localPath) return target;
  return isTauri() ? convertFileSrc(localPath) : localPath;
}
