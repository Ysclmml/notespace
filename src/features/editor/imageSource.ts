import { convertFileSrc, isTauri } from "@tauri-apps/api/core";

const SCHEME = /^[a-z][a-z\d+.-]*:/iu;
const WINDOWS_ABSOLUTE_PATH = /^[a-z]:[\\/]/iu;

function decodeTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function normalizeAbsolutePath(path: string): string {
  const drive = /^[a-z]:/iu.exec(path)?.[0] ?? "";
  const remainder = drive ? path.slice(drive.length) : path;
  const absolute = remainder.startsWith("/");
  const parts: string[] = [];
  for (const part of remainder.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${drive}${absolute ? "/" : ""}${parts.join("/")}`;
}

export function markdownImagePath(documentPath: string, target: string): string | null {
  const reference = target.trim().replace(/^<|>$/gu, "");
  if (/^file:/iu.test(reference)) {
    try {
      const url = new URL(reference);
      if (url.hostname && url.hostname !== "localhost") return null;
      const pathname = decodeTarget(url.pathname).replace(/^\/([a-z]:\/)/iu, "$1");
      return normalizeAbsolutePath(pathname);
    } catch {
      return null;
    }
  }
  const clean = decodeTarget(reference.split(/[?#]/u)[0] ?? "").replace(/\\/gu, "/");
  if (!clean || clean.startsWith("//")) return null;
  if (WINDOWS_ABSOLUTE_PATH.test(clean)) return normalizeAbsolutePath(clean);
  if (SCHEME.test(clean)) return null;
  if (clean.startsWith("/")) return normalizeAbsolutePath(clean);
  if (documentPath.startsWith("demo://")) return null;
  const documentLocalPath = /^file:/iu.test(documentPath)
    ? markdownImagePath("", documentPath)
    : documentPath.replace(/\\/gu, "/");
  if (!documentLocalPath) return null;
  const separator = documentLocalPath.lastIndexOf("/");
  if (separator < 0) return null;
  return normalizeAbsolutePath(`${documentLocalPath.slice(0, separator)}/${clean}`);
}

export function resolveMarkdownImageSource(documentPath: string, target: string): string {
  const localPath = markdownImagePath(documentPath, target);
  if (!localPath) return target;
  return isTauri() ? convertFileSrc(localPath) : localPath;
}
