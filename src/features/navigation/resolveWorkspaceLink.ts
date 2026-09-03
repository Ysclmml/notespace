import type { WorkspaceNode } from "../../infrastructure/tauri/desktopAdapter";

export type ResolvedWorkspaceLink =
  | { readonly kind: "internal"; readonly path: string; readonly anchor?: string }
  | { readonly kind: "external"; readonly href: string }
  | { readonly kind: "missing"; readonly target: string };

const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/iu;
const SCHEME = /^[a-z][a-z\d+.-]*:/iu;
const WINDOWS_ABSOLUTE_PATH = /^[a-z]:[\\/]/iu;

function flatten(nodes: readonly WorkspaceNode[]): WorkspaceNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

/** Lexical normalization only; the document reader owns existence/canonicalization. */
function normalizePath(path: string): string {
  const forward = path.replaceAll("\\", "/");
  const prefix =
    /^(?:[a-z]:\/|demo:\/\/[^/]+\/?|\/\/[^/]+\/[^/]+\/?|\/)/iu.exec(forward)?.[0] ?? "";
  const parts: string[] = [];
  for (const part of forward.slice(prefix.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length && parts.at(-1) !== "..") parts.pop();
      else if (!prefix) parts.push(part);
    } else parts.push(part);
  }
  return `${prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix}${parts.join("/")}`;
}

function pathKey(path: string): string {
  const normalized = normalizePath(path);
  return WINDOWS_ABSOLUTE_PATH.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}

function decodeTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function fileUrlPath(reference: string): string | null {
  try {
    const url = new URL(reference);
    const pathname = decodeTarget(url.pathname).replace(/^\/([a-z]:\/)/iu, "$1");
    if (hasControlCharacter(pathname)) return null;
    return normalizePath(
      url.hostname && url.hostname !== "localhost"
        ? `//${url.hostname}${pathname}`
        : pathname,
    );
  } catch {
    return null;
  }
}

function sourcePath(currentPath: string): string | null {
  if (/^file:/iu.test(currentPath)) return fileUrlPath(currentPath);
  if (
    hasControlCharacter(currentPath) ||
    (SCHEME.test(currentPath) &&
      !WINDOWS_ABSOLUTE_PATH.test(currentPath) &&
      !currentPath.startsWith("demo://"))
  ) {
    return null;
  }
  const normalized = normalizePath(currentPath);
  return /^(?:\/|[a-z]:\/|demo:\/\/)/iu.test(normalized) ? normalized : null;
}

function sourceWorkspaceRoot(
  currentPath: string,
  nodes: readonly WorkspaceNode[],
): string | undefined {
  const source = pathKey(currentPath);
  const roots = nodes.flatMap((node) => {
    const path = normalizePath(node.path);
    const relative = normalizePath(node.relativePath);
    const suffix = `/${relative}`;
    if (relative && path.length <= relative.length) return [];
    const root = relative ? path.slice(0, -suffix.length) || "/" : path;
    if (relative && pathKey(`${root}/${relative}`) !== pathKey(path)) return [];
    const rootKey = pathKey(root).replace(/\/$/u, "");
    return source === rootKey || source.startsWith(`${rootKey}/`) ? [root] : [];
  });
  return roots.sort((left, right) => right.length - left.length)[0];
}

export function resolveWorkspaceLink(
  currentPath: string,
  target: string,
  nodes: readonly WorkspaceNode[],
): ResolvedWorkspaceLink {
  const trimmed = target.trim().replace(/^<|>$/gu, "");
  const missing: ResolvedWorkspaceLink = { kind: "missing", target };
  if (!trimmed || hasControlCharacter(trimmed)) return missing;
  if (/^(?:https?|mailto):/iu.test(trimmed)) {
    return { kind: "external", href: trimmed };
  }

  const hash = trimmed.indexOf("#");
  const beforeAnchor = hash < 0 ? trimmed : trimmed.slice(0, hash);
  const rawAnchor = hash < 0 ? "" : trimmed.slice(hash + 1);
  const anchor = rawAnchor ? decodeTarget(rawAnchor) : undefined;
  const rawPath = beforeAnchor.split("?", 1)[0] ?? "";
  if (!rawPath) {
    return currentPath && MARKDOWN_EXTENSION.test(currentPath)
      ? { kind: "internal", path: currentPath, anchor }
      : missing;
  }

  const isFileUrl = /^file:/iu.test(rawPath);
  const decodedPath = isFileUrl ? fileUrlPath(rawPath) : decodeTarget(rawPath);
  if (
    !decodedPath ||
    hasControlCharacter(decodedPath) ||
    (!isFileUrl && decodedPath.startsWith("//")) ||
    (!isFileUrl && SCHEME.test(decodedPath) && !WINDOWS_ABSOLUTE_PATH.test(decodedPath))
  ) {
    return missing;
  }
  const path = normalizePath(decodedPath);
  const explicitMarkdown = MARKDOWN_EXTENSION.test(path);
  // Never turn code.json/code.py into code.json.md/code.py/index.md aliases.
  if (!explicitMarkdown && /\.[^/]+$/u.test(path.split("/").at(-1) ?? "")) {
    return missing;
  }

  const source = sourcePath(currentPath);
  const absolute =
    isFileUrl || /^[\\/]/u.test(decodedPath) || WINDOWS_ABSOLUTE_PATH.test(path);
  const directPath = absolute
    ? path
    : source
      ? normalizePath(`${source.slice(0, source.lastIndexOf("/"))}/${path}`)
      : null;
  if (!directPath) return missing;

  const allNodes = flatten(nodes);
  const markdownNodes = allNodes.filter(
    (node) => node.kind === "markdown" && MARKDOWN_EXTENSION.test(node.path),
  );
  const findMarkdown = (candidate: string) =>
    markdownNodes.find((node) => pathKey(node.path) === pathKey(candidate));
  const candidates = explicitMarkdown
    ? [directPath]
    : [`${directPath}.md`, `${directPath}/index.md`];
  for (const candidate of candidates) {
    const destination = findMarkdown(candidate);
    if (destination) return { kind: "internal", path: destination.path, anchor };
  }

  // Keep legacy /docs/page.md links scoped to the source's actual workspace.
  // An observed real absolute path always wins before this compatibility fallback.
  if (!isFileUrl && decodedPath.startsWith("/") && source) {
    const root = sourceWorkspaceRoot(source, allNodes);
    if (root) {
      for (const candidate of candidates) {
        const destination = findMarkdown(normalizePath(`${root}/${candidate}`));
        if (destination) return { kind: "internal", path: destination.path, anchor };
      }
    }
  }

  // A fresh/standalone Markdown file need not have appeared in a workspace scan.
  return explicitMarkdown ? { kind: "internal", path: directPath, anchor } : missing;
}
