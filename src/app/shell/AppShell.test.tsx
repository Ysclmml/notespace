import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { DemoDesktopAdapter } from "../../infrastructure/tauri/desktopAdapter";
import { installCodeMirrorDomMeasurementStubs } from "../../features/editor/spike/domTestSupport";
import { AppShell } from "./AppShell";

beforeAll(() => installCodeMirrorDomMeasurementStubs());

describe("AppShell", () => {
  it("renders an actionable local-first welcome screen", () => {
    render(<AppShell adapter={new DemoDesktopAdapter()} />);

    expect(
      screen.getByRole("heading", { name: "把本地文档，当作可以编辑的浏览器。" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "打开演示工作区" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "后退" })).toBeDisabled();
    expect(screen.getByText("单画面编辑 Markdown", { exact: false })).toBeVisible();
  });

  it("opens the browser demo workspace and exposes its Markdown tree", async () => {
    render(<AppShell adapter={new DemoDesktopAdapter()} />);

    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));

    expect(await screen.findByRole("button", { name: /00-阅读导航\.md/ })).toBeVisible();
    expect(screen.getByText("3 篇文档")).toBeVisible();
    expect(
      screen.getAllByText("Paper & Ink 示例", { exact: false }).length,
    ).toBeGreaterThan(0);
  });

  it("switches to the empty outline and collapses the sidebar", () => {
    render(<AppShell adapter={new DemoDesktopAdapter()} />);

    fireEvent.click(screen.getByRole("tab", { name: "大纲" }));
    expect(screen.getByText("当前没有可用大纲")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "收起侧栏" }));
    expect(screen.queryByRole("complementary", { name: "工作区侧栏" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "展开侧栏" }));
    expect(screen.getByRole("complementary", { name: "工作区侧栏" })).toBeVisible();
  });

  it("opens documents in one tab and enables browser-style back navigation", async () => {
    render(<AppShell adapter={new DemoDesktopAdapter()} />);
    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));

    fireEvent.click(await screen.findByRole("button", { name: /00-阅读导航\.md/ }));
    expect(await screen.findByLabelText("Markdown 编辑器")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /01-产品设计\.md/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "后退" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "后退" }));
    await waitFor(() =>
      expect(screen.getByTitle("demo://paper-and-ink/00-阅读导航.md")).toBeVisible(),
    );
  });
});
