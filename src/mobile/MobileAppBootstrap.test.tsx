import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MobileAppBootstrap } from "./MobileAppBootstrap";
import { MockMobileTransport } from "./mockTransport";

describe("MobileAppBootstrap", () => {
  it("creates the real LAN HTTP transport by default in a native mobile app", async () => {
    render(
      <MobileAppBootstrap
        discovery={{ list: async () => [] }}
        lanHttpOptions={{ fetch: vi.fn(), storage: null }}
        nativeMobileRuntime
      />,
    );

    expect(
      await screen.findByPlaceholderText("例如 192.168.1.20（默认端口 49920）"),
    ).toBeVisible();
    expect(screen.queryByText(/Debug|调试模式|无认证/)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "电脑地址" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "配对码" })).not.toBeInTheDocument();
    expect(screen.queryByText(/演示预览/)).not.toBeInTheDocument();
  });

  it("keeps the built-in demo fallback when LAN HTTP is explicitly disabled", async () => {
    render(<MobileAppBootstrap enableLanHttp={false} nativeMobileRuntime />);

    expect(await screen.findByText(/演示预览/)).toBeVisible();
    expect(screen.getByRole("button", { name: /NoteSpace 内置示例/ })).toBeVisible();
    expect(screen.queryByText(/HTTP 无加密/)).not.toBeInTheDocument();
  });

  it("does not replace an explicitly injected transport", async () => {
    const transport = new MockMobileTransport({
      computers: [{ id: "secure-computer", name: "安全传输电脑", address: "已配对设备" }],
    });
    render(<MobileAppBootstrap nativeMobileRuntime transport={transport} />);

    expect(await screen.findByRole("button", { name: /安全传输电脑/ })).toBeVisible();
    expect(screen.queryByText(/HTTP 无加密/)).not.toBeInTheDocument();
    expect(screen.queryByText(/演示预览/)).not.toBeInTheDocument();
  });

  it("keeps the browser preview in demo mode by default", async () => {
    render(<MobileAppBootstrap nativeMobileRuntime={false} />);

    expect(await screen.findByText(/演示预览/)).toBeVisible();
    expect(screen.getByRole("button", { name: /NoteSpace 内置示例/ })).toBeVisible();
  });
});
