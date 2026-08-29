import type { WorkspaceNode } from "../../infrastructure/tauri/desktopAdapter";

export type ResolvedWorkspaceLink =
  | { readonly kind: "internal"; readonly path: string; readonly anchor?: string }
  | { readonly kind: "external"; readonly href: string }
  | { readonly kind: "missing"; readonly target: string };

function flatten(nodes: readonly WorkspaceNode[]): WorkspaceNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

function normalizeRelativePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function decodeTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

export function resolveWorkspaceLink(
  currentPath: string,
  target: string,
  nodes: readonly WorkspaceNode[],
): ResolvedWorkspaceLink {
  const trimmed = target.trim();
  if (/^(?:https?|mailto):/i.test(trimmed)) {
    return { kind: "external", href: trimmed };
  }

  const [rawPath = "", rawAnchor] = trimmed.split("#", 2);
  const anchor = rawAnchor ? decodeTarget(rawAnchor) : undefined;
  if (!rawPath) return { kind: "internal", path: currentPath, anchor };

  const allNodes = flatten(nodes);
  const current = allNodes.find((node) => node.path === currentPath);
  if (!current) return { kind: "missing", target };

  const currentDirectory = current.relativePath.includes("/")
    ? current.relativePath.slice(0, current.relativePath.lastIndexOf("/"))
    : "";
  const decodedPath = decodeTarget(rawPath);
  const joined = normalizeRelativePath(
    decodedPath.startsWith("/") ? decodedPath : `${currentDirectory}/${decodedPath}`,
  );
  const candidates = [joined];
  if (!/\.(?:md|markdown)$/i.test(joined)) {
    candidates.push(`${joined}.md`, `${joined}/index.md`);
  }

  const destination = allNodes.find(
    (node) => node.kind === "markdown" && candidates.includes(node.relativePath),
  );
  return destination
    ? { kind: "internal", path: destination.path, anchor }
    : { kind: "missing", target };
}
