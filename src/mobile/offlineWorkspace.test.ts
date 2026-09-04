import { describe, expect, it, vi } from "vitest";

import { MockMobileTransport } from "./mockTransport";
import {
  createMemoryMobileOfflineStore,
  downloadOfflineWorkspace,
  findOfflineDirectory,
  findOfflineDocument,
  findOfflineWorkspace,
  mobileOfflineWorkspaceKey,
  searchOfflineWorkspaces,
} from "./offlineWorkspace";
import type { MobileComputer, MobileWorkspace } from "./types";

const computer: MobileComputer = {
  id: "computer-1",
  name: "我的电脑",
  address: "192.168.1.20:49920",
};
const workspace: MobileWorkspace = {
  id: "workspace-1",
  syncKey: "stable-workspace",
  name: "产品文档",
};

describe("mobile offline workspaces", () => {
  it("downloads a complete directory and document snapshot before persisting it", async () => {
    const transport = new MockMobileTransport({
      computers: [computer],
      workspaces: [workspace],
      directories: {
        "workspace-1:root": {
          workspaceId: "workspace-1",
          directoryId: null,
          name: "产品文档",
          breadcrumbs: [{ id: null, name: "产品文档" }],
          entries: [
            { id: "directory-1", name: "设计", kind: "directory" },
            { id: "document-1", name: "首页.md", kind: "document" },
          ],
        },
        "workspace-1:directory-1": {
          workspaceId: "workspace-1",
          directoryId: "directory-1",
          name: "设计",
          breadcrumbs: [
            { id: null, name: "产品文档" },
            { id: "directory-1", name: "设计" },
          ],
          entries: [{ id: "document-2", name: "离线.md", kind: "document" }],
        },
      },
      documents: {
        "document-1": {
          id: "document-1",
          workspaceId: "workspace-1",
          workspaceName: "产品文档",
          title: "首页",
          relativePath: "首页.md",
          markdown: "# 首页\n\n局域网阅读",
        },
        "document-2": {
          id: "document-2",
          workspaceId: "workspace-1",
          workspaceName: "产品文档",
          title: "离线",
          relativePath: "设计/离线.md",
          markdown: "# 离线\n\n重连后更新",
        },
      },
    });
    await transport.connect("computer-1");
    const progress = vi.fn();

    const snapshot = await downloadOfflineWorkspace({
      transport,
      computer,
      workspace,
      now: () => new Date("2026-09-04T12:00:00.000Z"),
      onProgress: progress,
    });

    expect(snapshot.workspace.documentCount).toBe(2);
    expect(snapshot.directories).toHaveLength(2);
    expect(snapshot.documents.map(({ id }) => id)).toEqual(["document-1", "document-2"]);
    expect(snapshot.syncedAt).toBe("2026-09-04T12:00:00.000Z");
    expect(snapshot.totalBytes).toBeGreaterThan(0);
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ directories: 2, documents: 2 }),
    );
    expect(findOfflineDirectory([snapshot], "workspace-1", "directory-1")?.name).toBe(
      "设计",
    );
    expect(findOfflineDocument([snapshot], "document-2")?.title).toBe("离线");
  });

  it("replaces a snapshot atomically by its stable computer and workspace key", async () => {
    const store = createMemoryMobileOfflineStore();
    const key = mobileOfflineWorkspaceKey(computer.id, workspace);
    const first = {
      schemaVersion: 1 as const,
      key,
      computer,
      workspace,
      directories: [],
      documents: [],
      syncedAt: "2026-09-04T10:00:00.000Z",
      totalBytes: 0,
    };
    await store.put(first);
    await store.put({
      ...first,
      workspace: { ...workspace, id: "new-session-id" },
      syncedAt: "2026-09-04T11:00:00.000Z",
    });

    const snapshots = await store.list(computer.id);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.workspace.id).toBe("new-session-id");
    expect(
      findOfflineWorkspace(snapshots, { ...workspace, id: "another-session-id" }),
    ).toBe(snapshots[0]);
  });

  it("searches cached Markdown while the computer is unavailable", () => {
    const snapshot = {
      schemaVersion: 1 as const,
      key: mobileOfflineWorkspaceKey(computer.id, workspace),
      computer,
      workspace,
      directories: [],
      documents: [
        {
          id: "document-1",
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          title: "离线说明",
          relativePath: "guide/offline.md",
          markdown: "# 阅读\n\n断网时仍可以阅读这篇笔记。",
        },
      ],
      syncedAt: "2026-09-04T10:00:00.000Z",
      totalBytes: 32,
    };

    expect(
      searchOfflineWorkspaces([snapshot], {
        query: "断网",
        fileFilter: "offline\\.md$",
      }),
    ).toEqual([
      expect.objectContaining({
        documentId: "document-1",
        snippet: "断网时仍可以阅读这篇笔记。",
      }),
    ]);
  });

  it("keeps the previous snapshot when a refresh exceeds the offline budget", async () => {
    const transport = new MockMobileTransport({
      computers: [computer],
      workspaces: [workspace],
      directories: {
        "workspace-1:root": {
          workspaceId: "workspace-1",
          directoryId: null,
          name: workspace.name,
          breadcrumbs: [{ id: null, name: workspace.name }],
          entries: [{ id: "document-1", name: "large.md", kind: "document" }],
        },
      },
      documents: {
        "document-1": {
          id: "document-1",
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          title: "large",
          relativePath: "large.md",
          markdown: "0123456789",
        },
      },
    });
    const store = createMemoryMobileOfflineStore();
    await transport.connect(computer.id);
    const previous = {
      schemaVersion: 1 as const,
      key: mobileOfflineWorkspaceKey(computer.id, workspace),
      computer,
      workspace,
      directories: [],
      documents: [],
      syncedAt: "2026-09-04T10:00:00.000Z",
      totalBytes: 0,
    };
    await store.put(previous);

    await expect(
      downloadOfflineWorkspace({
        transport,
        computer,
        workspace,
        limits: { maxBytes: 3 },
      }),
    ).rejects.toThrow("已保留手机上上一版离线内容");
    expect(await store.list(computer.id)).toEqual([previous]);
  });
});
