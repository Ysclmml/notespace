import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDemoMobileTransport } from "./demoTransport";
import { MobileApp } from "./MobileApp";
import { MockMobileTransport } from "./mockTransport";
import { createMemoryMobileOfflineStore } from "./offlineWorkspace";
import { createMemoryMobileStore } from "./storage";
import type { MobileComputer, MobileDocument } from "./types";

async function connectDemo(transport = createDemoMobileTransport()) {
  const storage = createMemoryMobileStore();
  render(<MobileApp storage={storage} transport={transport} />);
  fireEvent.click(await screen.findByRole("button", { name: /NoteSpace 内置示例/ }));
  await screen.findByRole("heading", { level: 1, name: "共享工作区" });
  return { storage, transport };
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

    transport.simulateDisconnect("Wi-Fi 已断开", false);
    expect(await screen.findByText("连接已断开，当前页面仍可阅读")).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 1, name: "欢迎使用移动阅读" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "重连" })).toBeVisible();
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
