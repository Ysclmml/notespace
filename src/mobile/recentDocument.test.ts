import { describe, expect, it, vi } from "vitest";

import { MockMobileTransport } from "./mockTransport";
import { findRecentWorkspace, resolveRecentDocumentId } from "./recentDocument";
import type { MobileRecentDocument } from "./types";

const recent: MobileRecentDocument = {
  computerId: "computer",
  documentId: "old-document",
  title: "说明",
  relativePath: "设计/说明.md",
  workspaceName: "同名工作区",
  workspaceSyncKey: "stable-workspace",
  position: { scrollTop: 300, progress: 0.4, updatedAt: "2026-09-05T00:00:00Z" },
};
const workspaces = [
  { id: "other", name: "同名工作区", syncKey: "different-workspace" },
  { id: "new-workspace", name: "同名工作区", syncKey: "stable-workspace" },
];

function restartedTransport() {
  return new MockMobileTransport({
    computers: [{ id: "computer", name: "电脑", address: "fixture.local" }],
    workspaces,
    directories: {
      "new-workspace:root": {
        workspaceId: "new-workspace",
        directoryId: null,
        name: "同名工作区",
        breadcrumbs: [],
        entries: [{ id: "new-directory", name: "设计", kind: "directory" }],
      },
      "new-workspace:new-directory": {
        workspaceId: "new-workspace",
        directoryId: "new-directory",
        name: "设计",
        breadcrumbs: [],
        entries: [{ id: "new-document", name: "说明.md", kind: "document" }],
      },
    },
  });
}

describe("mobile recent document resolution", () => {
  it("resolves nested paths using the stable workspace and current opaque IDs", async () => {
    const transport = restartedTransport();
    await transport.connect("computer");
    const list = vi.spyOn(transport, "listDirectory");
    await expect(resolveRecentDocumentId(transport, workspaces, recent)).resolves.toBe(
      "new-document",
    );
    expect(list.mock.calls).toEqual([
      ["new-workspace", null],
      ["new-workspace", "new-directory"],
    ]);
  });

  it("does not guess another root for removed or ambiguous legacy workspaces", () => {
    expect(
      findRecentWorkspace(workspaces, { ...recent, workspaceSyncKey: "removed" }),
    ).toBeUndefined();
    const legacy = { ...recent, workspaceSyncKey: undefined };
    expect(findRecentWorkspace(workspaces, legacy)).toBeUndefined();
    expect(findRecentWorkspace([workspaces[1]!], legacy)?.id).toBe("new-workspace");
  });

  it("stops traversing when a newer reading action supersedes the request", async () => {
    const transport = restartedTransport();
    await transport.connect("computer");
    const original = transport.listDirectory.bind(transport);
    let current = true;
    const list = vi
      .spyOn(transport, "listDirectory")
      .mockImplementation(async (...args) => {
        const directory = await original(...args);
        current = false;
        return directory;
      });
    await expect(
      resolveRecentDocumentId(transport, workspaces, recent, () => current),
    ).rejects.toThrow("已取消");
    expect(list).toHaveBeenCalledTimes(1);
  });
});
