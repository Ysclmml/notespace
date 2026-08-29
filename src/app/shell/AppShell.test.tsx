import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppShell } from "./AppShell";

describe("AppShell [BUILD-001]", () => {
  it("renders an honest empty shell with unavailable product actions disabled", () => {
    render(<AppShell />);

    expect(
      screen.getByRole("heading", { name: "把本地文档，当作可以编辑的浏览器。" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "打开工作区" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "打开 Markdown" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "后退" })).toBeDisabled();
    expect(
      screen.getByText("此页面不会读取或上传本地文档。", { exact: false }),
    ).toBeVisible();
  });

  it("switches between the synthetic file and outline empty states", () => {
    render(<AppShell />);

    expect(screen.getByText("尚未打开工作区")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "大纲" }));
    expect(screen.getByText("当前没有可用大纲")).toBeVisible();
    expect(screen.getByRole("tab", { name: "大纲" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("collapses and restores the sidebar without invoking a product capability", () => {
    render(<AppShell />);

    fireEvent.click(screen.getByRole("button", { name: "收起侧栏" }));
    expect(
      screen.queryByRole("complementary", { name: "工作区侧栏" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开侧栏" }));
    expect(screen.getByRole("complementary", { name: "工作区侧栏" })).toBeVisible();
  });
});
