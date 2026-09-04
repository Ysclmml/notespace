import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDemoMobileTransport } from "./demoTransport";
import { MobileApp } from "./MobileApp";
import { MockMobileTransport } from "./mockTransport";
import {
  createMemoryMobileOfflineStore,
  type MobileOfflineWorkspaceSnapshot,
} from "./offlineWorkspace";
import { createMemoryMobileStore } from "./storage";
import type { MobileComputer, MobileDocument } from "./types";

async function connectDemo(transport = createDemoMobileTransport()) {
  const storage = createMemoryMobileStore();
  render(<MobileApp storage={storage} transport={transport} />);
  fireEvent.click(await screen.findByRole("button", { name: /NoteSpace 内置示例/ }));
  await screen.findByRole("heading", { level: 1, name: "共享工作区" });
  return { storage, transport };
}

function offlineSnapshot(
  computer: MobileComputer,
  workspaceId: string,
  workspaceName: string,
): MobileOfflineWorkspaceSnapshot {
  return {
    schemaVersion: 1,
    key: `${computer.id}:${workspaceId}`,
    computer,
    workspace: { id: workspaceId, name: workspaceName, documentCount: 1 },
    directories: [
      {
        workspaceId,
        directoryId: null,
        name: workspaceName,
        breadcrumbs: [{ id: null, name: workspaceName }],
        entries: [{ id: `${workspaceId}-document`, name: "离线笔记.md", kind: "document" }],
      },
    ],
    documents: [
      {
        id: `${workspaceId}-document`,
        workspaceId,
        workspaceName,
        title: "离线笔记",
        relativePath: "离线笔记.md",
        markdown: "# 离线笔记",
      },
    ],
    syncedAt: "2026-09-04T08:00:00.000Z",
    totalBytes: 15,
  };
}

describe("MobileApp", () => {
  it("saves a whole workspace for offline reading and refreshes it after reconnecting", async () => {
    const transport = createDemoMobileTransport();
    const offlineStorage = createMemoryMobileOfflineStore();
    const readDocument = vi.spyOn(transport, "readDocument");
    render(<MobileApp offlineStorage={offlineStorage} transport={transport} />);
    fireEvent.click(await screen.findByRole("button", { name: /NoteSpace 内置示例/ }));
    await screen.findByRole("heading", { level: 1, name: "共享工作区" });
    const productCard = screen
      .getByText("产品笔记")
      .closest(".mobile-workspace-card-shell");
    expect(productCard).not.toBeNull();
    fireEvent.click(
      within(productCard as HTMLElement).getByRole("button", { name: "保存离线" }),
    );
    expect(
      await screen.findByText("产品笔记 已保存到手机，断开电脑后仍可阅读。"),
    ).toBeVisible();
    expect((await offlineStorage.list("demo-computer"))[0]?.documents).toHaveLength(3);
    expect(within(productCard as HTMLElement).getByText(/3 篇 · .+B ·/)).toBeVisible();
    expect(
      within(productCard as HTMLElement).getByRole("button", { name: "立即更新" }),
    ).toBeVisible();

    transport.simulateDisconnect("Wi-Fi 已断开", true);
    expect(await screen.findByText("正在使用离线内容")).toBeVisible();
    const shell = globalThis.document.querySelector(".mobile-shell");
    const shellChrome = shell?.querySelector(".mobile-shell__chrome");
    expect(shell?.children).toHaveLength(3);
    expect(shellChrome?.querySelector(".mobile-offline-banner")).toBeVisible();
    expect(shellChrome?.querySelector(".mobile-notice")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /产品笔记.*可离线阅读/ }));
    fireEvent.click(await screen.findByRole("button", { name: /设计.*2 篇文档/ }));
    fireEvent.click(screen.getByRole("button", { name: "产品笔记" }));
    expect(await screen.findByRole("heading", { name: "产品笔记" })).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: /移动阅读说明\.md/ }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "欢迎使用移动阅读" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    fireEvent.click(screen.getByRole("button", { name: "重连" }));

    await waitFor(() => expect(readDocument.mock.calls.length).toBeGreaterThan(3));
    expect((await offlineStorage.list("demo-computer"))[0]?.documents).toHaveLength(3);
  });

  it("briefly announces offline reading without returning on navigation", async () => {
    const computerA = {
      id: "offline-computer-a",
      name: "离线电脑 A",
      address: "192.168.1.20:49920",
    };
    const computerB = {
      id: "offline-computer-b",
      name: "离线电脑 B",
      address: "192.168.1.21:49920",
    };
    const offlineStorage = createMemoryMobileOfflineStore([
      offlineSnapshot(computerA, "workspace-a", "工作区 A"),
      offlineSnapshot(computerB, "workspace-b", "工作区 B"),
    ]);
    const transport = new MockMobileTransport({ computers: [computerA, computerB] });
    render(<MobileApp offlineStorage={offlineStorage} transport={transport} />);

    await screen.findByText("离线电脑 A");
    const computerACard = screen
      .getByText("离线电脑 A")
      .closest(".mobile-connect__computer-card");
    expect(computerACard).not.toBeNull();

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(
          within(computerACard as HTMLElement).getByRole("button", {
            name: "离线阅读",
          }),
        );
        await Promise.resolve();
      });
      expect(screen.getByText("正在使用离线内容")).toBeVisible();
      expect(
        screen.getByText("正在使用离线内容").closest(".mobile-offline-banner"),
      ).toHaveClass("mobile-offline-banner--transient");

      act(() => vi.advanceTimersByTime(1_000));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "断开并切换电脑" }));
        await Promise.resolve();
      });
      const reopenedComputerACard = screen
        .getByText("离线电脑 A")
        .closest(".mobile-connect__computer-card");
      expect(reopenedComputerACard).not.toBeNull();
      await act(async () => {
        fireEvent.click(
          within(reopenedComputerACard as HTMLElement).getByRole("button", {
            name: "离线阅读",
          }),
        );
        await Promise.resolve();
      });
      act(() => vi.advanceTimersByTime(2_500));
      expect(screen.getByText("正在使用离线内容")).toBeVisible();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /工作区 A.*可离线阅读/ }));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /离线笔记\.md/ }));
        await Promise.resolve();
      });
      expect(screen.getByRole("heading", { level: 1, name: "离线笔记" })).toBeVisible();
      expect(screen.getByText("正在使用离线内容")).toBeVisible();

      act(() => vi.advanceTimersByTime(501));
      expect(screen.queryByText("正在使用离线内容")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "离线，重新连接电脑" })).toBeVisible();

      fireEvent.click(screen.getByRole("button", { name: "返回" }));
      fireEvent.click(screen.getByRole("button", { name: "搜索" }));
      fireEvent.click(screen.getByRole("button", { name: "浏览" }));
      expect(screen.queryByText("正在使用离线内容")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "离线，重新连接电脑" })).toBeVisible();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "断开并切换电脑" }));
        await Promise.resolve();
      });
      const computerBCard = screen
        .getByText("离线电脑 B")
        .closest(".mobile-connect__computer-card");
      expect(computerBCard).not.toBeNull();
      await act(async () => {
        fireEvent.click(
          within(computerBCard as HTMLElement).getByRole("button", {
            name: "离线阅读",
          }),
        );
        await Promise.resolve();
      });
      expect(screen.getByText("正在使用离线内容")).toBeVisible();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "离线，重新连接电脑" }));
        await Promise.resolve();
      });
      expect(screen.queryByText("正在使用离线内容")).not.toBeInTheDocument();
      expect(transport.getConnectionState().kind).toBe("connected");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the LAN connection screen compact and explains the default port", async () => {
    render(<MobileApp insecureDebugMode transport={new MockMobileTransport()} />);

    expect(
      await screen.findByPlaceholderText("例如 192.168.1.20（默认端口 49920）"),
    ).toBeVisible();
    expect(screen.queryByText(/Debug|调试模式|无认证/)).not.toBeInTheDocument();
    expect(
      screen.getByText("电脑和手机连接同一个局域网，并在桌面端开启“移动访问”。"),
    ).toBeVisible();
  });

  it("briefly reports an uncached shell disconnect without changing the three-row layout", async () => {
    const transport = createDemoMobileTransport();
    await connectDemo(transport);
    const shell = globalThis.document.querySelector(".mobile-shell");
    expect(shell?.children).toHaveLength(3);
    expect(shell?.children[0]).toHaveClass("mobile-shell__chrome");
    expect(shell?.children[1]).toHaveClass("mobile-shell__content");
    expect(shell?.children[2]).toHaveClass("mobile-bottom-nav");

    vi.useFakeTimers();
    try {
      act(() => transport.simulateDisconnect("Wi-Fi 已断开", true));
      const offlineBanner = screen
        .getByText("与电脑的连接已断开")
        .closest(".mobile-offline-banner");
      expect(offlineBanner).toHaveClass("mobile-offline-banner--transient");
      expect(offlineBanner?.parentElement).toHaveClass("mobile-shell__chrome");

      act(() => vi.advanceTimersByTime(3_001));
      expect(screen.queryByText("与电脑的连接已断开")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "离线，重新连接电脑" })).toBeVisible();
      expect(shell?.children).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("connects to a saved computer and browses directories into a read-only document", async () => {
    await connectDemo();
    fireEvent.click(screen.getByRole("button", { name: /产品笔记.*3 篇文档/ }));
    await screen.findByRole("heading", { level: 1, name: "产品笔记" });
    fireEvent.click(screen.getByRole("button", { name: /设计.*2 篇文档/ }));
    await screen.findByRole("heading", { level: 1, name: "设计" });
    fireEvent.click(screen.getByRole("button", { name: /移动端阅读设计\.md/ }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "移动端阅读设计" }),
    ).toBeVisible();
    expect(
      screen.getByText("手机端采用逐层目录和沉浸阅读，不照搬桌面端的永久文件树。"),
    ).toBeVisible();
    expect(screen.getByRole("figure", { name: "Mermaid 图表占位" })).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps search state while a result is opened and records a local reading position", async () => {
    const { storage } = await connectDemo();
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    const searchInput = screen.getByRole("searchbox", { name: "搜索内容" });
    fireEvent.change(searchInput, { target: { value: "局域网" } });
    const searchForm = searchInput.closest("form");
    expect(searchForm).not.toBeNull();
    fireEvent.submit(searchForm!);
    const results = await screen.findByLabelText("搜索结果");
    fireEvent.click(within(results).getByRole("button", { name: /局域网访问边界/ }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "局域网访问边界" }),
    ).toBeVisible();

    const scroller = screen.getByTestId("mobile-reader-scroller");
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_400 },
    });
    scroller.scrollTop = 500;
    fireEvent.scroll(scroller);
    expect(storage.load().positions["demo-computer:demo-security"]?.progress).toBe(0.5);

    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByRole("searchbox", { name: "搜索内容" })).toHaveValue("局域网");
    expect(screen.getByLabelText("搜索结果")).toBeVisible();
  });

  it("keeps the current document visible and offers reconnect after the LAN connection drops", async () => {
    const transport = createDemoMobileTransport();
    await connectDemo(transport);
    fireEvent.click(screen.getByRole("button", { name: /产品笔记.*3 篇文档/ }));
    fireEvent.click(await screen.findByRole("button", { name: /移动阅读说明\.md/ }));
    await screen.findByRole("heading", { level: 1, name: "欢迎使用移动阅读" });

    vi.useFakeTimers();
    try {
      act(() => transport.simulateDisconnect("Wi-Fi 已断开", false));
      expect(screen.getByText("连接已断开，当前页面仍可阅读")).toBeVisible();
      expect(
        screen.getByText("连接已断开，当前页面仍可阅读").closest(".mobile-offline-banner"),
      ).toHaveClass("mobile-offline-banner--transient");

      act(() => vi.advanceTimersByTime(3_001));
      expect(screen.queryByText("连接已断开，当前页面仍可阅读")).not.toBeInTheDocument();
      expect(
        screen.getByRole("heading", { level: 1, name: "欢迎使用移动阅读" }),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "离线，重新连接电脑" })).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows link feedback inside the reader instead of deferring it until back", async () => {
    await connectDemo();
    fireEvent.click(screen.getByRole("button", { name: /产品笔记.*3 篇文档/ }));
    fireEvent.click(await screen.findByRole("button", { name: /移动阅读说明\.md/ }));
    fireEvent.click(await screen.findByRole("button", { name: "链接导航示例" }));

    expect(screen.getByText("链接导航将在真实局域网连接完成后开放。")).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 1, name: "欢迎使用移动阅读" }),
    ).toBeVisible();
  });

  it("accepts an injected QR scanner and pairs without exposing scanner details to the UI", async () => {
    const transport = new MockMobileTransport();
    const onScanPairingCode = vi.fn(async () => ({
      address: "192.168.1.9:43127",
      pairingCode: "PAIR-1234",
      certificateFingerprint: "demo-fingerprint",
    }));
    render(<MobileApp onScanPairingCode={onScanPairingCode} transport={transport} />);

    fireEvent.click(await screen.findByRole("button", { name: "扫码连接" }));
    await waitFor(() => expect(onScanPairingCode).toHaveBeenCalledOnce());
    expect(
      await screen.findByRole("heading", { level: 1, name: "共享工作区" }),
    ).toBeVisible();
  });

  it("does not let the initial saved-computer request erase a newly paired computer", async () => {
    const transport = new MockMobileTransport();
    let resolveInitial: ((computers: MobileComputer[]) => void) | undefined;
    vi.spyOn(transport, "listSavedComputers").mockImplementationOnce(
      () =>
        new Promise<MobileComputer[]>((resolve) => {
          resolveInitial = resolve;
        }),
    );
    render(
      <MobileApp
        onScanPairingCode={async () => ({
          address: "192.168.1.9:43127",
          pairingCode: "PAIR-1234",
          certificateFingerprint: "demo-fingerprint",
        })}
        transport={transport}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "扫码连接" }));
    await screen.findByRole("heading", { level: 1, name: "共享工作区" });
    await act(async () => {
      resolveInitial?.([]);
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "断开并切换电脑" }));

    expect(await screen.findByRole("button", { name: /我的电脑/ })).toBeVisible();
  });

  it("drops a document response that arrives after the user disconnects", async () => {
    const transport = createDemoMobileTransport();
    let resolveDocument: ((document: MobileDocument) => void) | undefined;
    vi.spyOn(transport, "readDocument").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDocument = resolve;
        }),
    );
    await connectDemo(transport);
    fireEvent.click(screen.getByRole("button", { name: /产品笔记.*3 篇文档/ }));
    fireEvent.click(await screen.findByRole("button", { name: /移动阅读说明\.md/ }));
    fireEvent.click(screen.getByRole("button", { name: "断开并切换电脑" }));
    await screen.findByRole("heading", { level: 1, name: "在手机上阅读电脑里的笔记" });

    await act(async () => {
      resolveDocument?.({
        id: "late-document",
        workspaceId: "demo-workspace",
        workspaceName: "产品笔记",
        title: "不应出现的迟到文档",
        relativePath: "late.md",
        markdown: "# 不应出现的迟到文档",
      });
      await Promise.resolve();
    });

    expect(screen.queryByText("不应出现的迟到文档")).not.toBeInTheDocument();
  });
});
