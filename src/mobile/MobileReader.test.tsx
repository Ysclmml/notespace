import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MobileReader } from "./MobileReader";

describe("MobileReader math", () => {
  it("renders saved Markdown formulas through the safe reader surface", () => {
    const { container } = render(
      <MobileReader
        document={{
          id: "document-1",
          workspaceId: "workspace-1",
          workspaceName: "公式笔记",
          title: "旋转位置编码",
          relativePath: "notes/formula.md",
          markdown: String.raw`正文中的 \(q'_t = R_t q_t\)。`,
        }}
        onBack={vi.fn()}
        onPositionChange={vi.fn()}
      />,
    );

    expect(container.querySelector(".mobile-reader .katex")).toBeVisible();
    expect(container.querySelector("script")).toBeNull();
  });

  it("keeps offline status and reconnect in the header after the notice disappears", () => {
    const onReconnect = vi.fn();
    const { rerender } = render(
      <MobileReader
        document={{
          id: "document-1",
          workspaceId: "workspace-1",
          workspaceName: "离线工作区",
          title: "离线笔记",
          relativePath: "offline.md",
          markdown: "# 离线笔记",
        }}
        offline
        offlineNotice={{
          title: "正在使用离线内容",
          detail: "重新连接后会自动更新",
        }}
        onBack={vi.fn()}
        onPositionChange={vi.fn()}
        onReconnect={onReconnect}
      />,
    );

    expect(screen.getByText("正在使用离线内容")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "离线，重新连接电脑" }));
    expect(onReconnect).toHaveBeenCalledOnce();

    rerender(
      <MobileReader
        document={{
          id: "document-2",
          workspaceId: "workspace-1",
          workspaceName: "离线工作区",
          title: "另一篇笔记",
          relativePath: "another.md",
          markdown: "# 另一篇笔记",
        }}
        offline
        onBack={vi.fn()}
        onPositionChange={vi.fn()}
        onReconnect={onReconnect}
      />,
    );

    expect(screen.queryByText("正在使用离线内容")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "离线，重新连接电脑" })).toBeVisible();
  });
});
