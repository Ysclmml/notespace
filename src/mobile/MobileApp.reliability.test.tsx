import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DebugHttpMobileTransport } from "./httpTransport";
import { MobileApp } from "./MobileApp";
import { MockMobileTransport } from "./mockTransport";
import { createMemoryMobileOfflineStore } from "./offlineWorkspace";
import { createMemoryMobileStore } from "./storage";

const computer = { id: "computer", name: "测试电脑", address: "fixture.local:49920" };

function restartedTransport(era: string) {
  const workspaceId = `${era}-workspace`;
  const directoryId = `${era}-directory`;
  const documentId = `${era}-document`;
  return new MockMobileTransport({
    computers: [computer],
    workspaces: [{ id: workspaceId, name: "笔记", syncKey: "stable-workspace" }],
    directories: {
      [`${workspaceId}:root`]: {
        workspaceId,
        directoryId: null,
        name: "笔记",
        breadcrumbs: [],
        entries: [{ id: directoryId, kind: "directory", name: "设计" }],
      },
      [`${workspaceId}:${directoryId}`]: {
        workspaceId,
        directoryId,
        name: "设计",
        breadcrumbs: [],
        entries: [{ id: documentId, kind: "document", name: "说明.md" }],
      },
    },
    documents: {
      [documentId]: {
        id: documentId,
        workspaceId,
        workspaceName: "笔记",
        title: "说明",
        relativePath: "设计/说明.md",
        markdown: `# ${era} 正文`,
      },
    },
  });
}

async function openFromDirectory() {
  fireEvent.click(await screen.findByRole("button", { name: /笔记.*工作区/ }));
  fireEvent.click(await screen.findByRole("button", { name: "设计" }));
  fireEvent.click(await screen.findByRole("button", { name: /说明.md/ }));
}

describe("mobile reliable refresh and recent reading", () => {
  it.each(["recent", "directory", "legacy"])(
    "restores reading position after desktop restart through %s",
    async (entryPoint) => {
      const storage = createMemoryMobileStore();
      const offlineStorage = createMemoryMobileOfflineStore();
      const first = restartedTransport("old");
      await first.connect(computer.id);
      const view = render(
        <MobileApp transport={first} storage={storage} offlineStorage={offlineStorage} />,
      );
      await openFromDirectory();
      await screen.findByRole("heading", { name: "old 正文" });
      const scroller = screen.getByTestId("mobile-reader-scroller");
      Object.defineProperties(scroller, {
        scrollHeight: { value: 1_500, configurable: true },
        clientHeight: { value: 500, configurable: true },
      });
      fireEvent.scroll(scroller, { target: { scrollTop: 500 } });
      expect(storage.load().recentDocuments[0]).toMatchObject({
        documentId: "old-document",
        workspaceSyncKey: "stable-workspace",
        position: { scrollTop: 500, progress: 0.5 },
      });
      view.unmount();
      if (entryPoint === "legacy") {
        const previous = storage.load();
        storage.save({
          ...previous,
          recentDocuments: previous.recentDocuments.map((item) => ({
            ...item,
            workspaceSyncKey: undefined,
          })),
        });
      }

      const restarted = restartedTransport("new");
      const read = vi.spyOn(restarted, "readDocument");
      await restarted.connect(computer.id);
      render(
        <MobileApp
          transport={restarted}
          storage={storage}
          offlineStorage={offlineStorage}
        />,
      );
      await screen.findByRole("heading", { name: "共享工作区" });
      if (entryPoint === "directory") {
        await openFromDirectory();
      } else {
        fireEvent.click(screen.getByRole("button", { name: "最近" }));
        fireEvent.click(await screen.findByRole("button", { name: /说明.*已读 50%/ }));
      }
      await screen.findByRole("heading", { name: "new 正文" });
      expect(read).toHaveBeenCalledWith("new-document");
      expect(read).not.toHaveBeenCalledWith("old-document");
      expect(screen.getByTestId("mobile-reader-scroller").scrollTop).toBe(500);
      expect(storage.load().recentDocuments).toHaveLength(1);
      expect(storage.load().recentDocuments[0]).toMatchObject({
        documentId: "new-document",
        workspaceSyncKey: "stable-workspace",
        position: { scrollTop: 500, progress: 0.5 },
      });
    },
  );

  it("preserves the full offline snapshot and warns online when HTTP directories are incomplete", async () => {
    let incomplete = false;
    const response = (data: unknown) =>
      new Response(JSON.stringify({ protocolVersion: 1, data }));
    const transport = new DebugHttpMobileTransport({
      storage: null,
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith("/status"))
          return response({
            protocolVersion: 1,
            serviceName: "测试电脑",
            activeRequestCount: 0,
          });
        if (url.endsWith("/workspaces"))
          return response([{ id: "workspace", syncKey: "stable-workspace", name: "笔记" }]);
        if (url.endsWith("/favorites")) return response([]);
        if (url.endsWith("/directories/root")) {
          return response({
            workspaceId: "workspace",
            directoryId: null,
            name: "笔记",
            breadcrumbs: [],
            entries: (incomplete ? ["a"] : ["a", "b"]).map((id) => ({
              id,
              name: `${id}.md`,
              kind: "document",
            })),
            scannedEntries: 2,
            truncated: incomplete,
          });
        }
        const id = url.split("/").at(-1)!;
        return response({
          id,
          workspaceId: "workspace",
          workspaceName: "笔记",
          title: id,
          relativePath: `${id}.md`,
          markdown: `# ${id}`,
          sizeBytes: 3,
        });
      },
    });
    const connected = await transport.pair({
      address: computer.address,
      pairingCode: "",
      certificateFingerprint: "",
    });
    await transport.connect(connected.id);
    const offlineStorage = createMemoryMobileOfflineStore();
    render(
      <MobileApp
        transport={transport}
        storage={createMemoryMobileStore()}
        offlineStorage={offlineStorage}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "保存离线" }));
    await screen.findByText("笔记 已保存到手机，断开电脑后仍可阅读。");
    const previous = await offlineStorage.list();
    expect(previous[0]?.documents).toHaveLength(2);
    incomplete = true;
    fireEvent.click(screen.getByRole("button", { name: "立即更新" }));
    await screen.findByText(/电脑未能完整读取工作区目录.*已保留手机上上一版离线内容/);
    expect(await offlineStorage.list()).toEqual(previous);
    fireEvent.click(screen.getByRole("button", { name: /笔记.*可离线阅读/ }));
    await screen.findByText(/目录未完整读取，部分内容可能未显示/);
    expect(screen.getByRole("button", { name: /a.md/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /b.md/ })).toBeNull();
  });
});
