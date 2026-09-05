import type { MobileTransport } from "./transport";
import type { MobileRecentDocument, MobileWorkspace } from "./types";

export function findRecentWorkspace(
  workspaces: readonly MobileWorkspace[],
  recent: MobileRecentDocument,
) {
  const matches = workspaces.filter((workspace) =>
    recent.workspaceSyncKey
      ? workspace.syncKey === recent.workspaceSyncKey
      : workspace.name === recent.workspaceName,
  );
  // Older records only contain a display name. Never guess between namesakes.
  return matches.length === 1 ? matches[0] : undefined;
}

/** Resolve a saved relative path through current, read-only opaque directory IDs. */
export async function resolveRecentDocumentId(
  transport: MobileTransport,
  workspaces: readonly MobileWorkspace[],
  recent: MobileRecentDocument,
  isCurrent: () => boolean = () => true,
) {
  const workspace = findRecentWorkspace(workspaces, recent);
  if (!workspace) {
    throw new Error("原工作区未共享或无法唯一识别，请从工作区目录重新打开文档");
  }
  const segments = recent.relativePath.split("/");
  if (
    recent.relativePath.length > 4_096 ||
    segments.length > 256 ||
    segments.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("阅读记录中的路径无效，请从工作区目录重新打开文档");
  }
  let directoryId: string | null = null;
  for (let index = 0; index < segments.length; index += 1) {
    if (!isCurrent()) throw new Error("已取消打开旧阅读记录");
    const directory = await transport.listDirectory(workspace.id, directoryId);
    if (!isCurrent()) throw new Error("已取消打开旧阅读记录");
    if (directory.workspaceId !== workspace.id || directory.directoryId !== directoryId) {
      throw new Error("电脑返回了不属于当前路径的目录");
    }
    const kind = index === segments.length - 1 ? "document" : "directory";
    const entry = directory.entries.find(
      (item) => item.name === segments[index] && item.kind === kind,
    );
    if (!entry) {
      throw new Error(
        directory.truncated ? "电脑未能完整读取目录，请稍后重试" : "文档不存在或已停止共享",
      );
    }
    if (kind === "document") return entry.id;
    directoryId = entry.id;
  }
  throw new Error("文档不存在或已停止共享");
}
