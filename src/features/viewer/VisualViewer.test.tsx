import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../editor/mermaidRenderer", () => ({
  renderMermaidSvg: vi.fn(async () =>
    Promise.resolve('<svg viewBox="0 0 120 40"><text>diagram</text></svg>'),
  ),
}));

import { VisualViewer } from "./VisualViewer";

describe("VisualViewer", () => {
  it("renders Mermaid and exposes zoom, fit and close controls", async () => {
    const onClose = vi.fn();
    const returnTarget = document.createElement("button");
    document.body.append(returnTarget);
    returnTarget.focus();
    const { unmount } = render(
      <VisualViewer
        onClose={onClose}
        visual={{ kind: "mermaid", source: "A --> B", title: "架构图" }}
      />,
    );

    expect(screen.getByRole("dialog", { name: "架构图" })).toBeVisible();
    expect(screen.getByRole("button", { name: "关闭查看器" })).toHaveFocus();
    await waitFor(() => expect(screen.getByText("diagram")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: /^放大$/u }));
    expect(screen.getByText("118%")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    expect(screen.getAllByText("100%")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "关闭查看器" }));
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(returnTarget).toHaveFocus();
    returnTarget.remove();
  });
});
