import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderMermaidSvg } from "../features/editor/mermaidRenderer";
import { SafeMarkdown } from "./SafeMarkdown";
import { MobileReader } from "./MobileReader";
import { MobileVisualViewer } from "./MobileVisualViewer";
import { dispatchMobileBack } from "./mobileBack";

vi.mock("../features/editor/mermaidRenderer", () => ({
  renderMermaidSvg: vi.fn(
    async () =>
      '<svg viewBox="0 0 400 200"><rect width="400" height="200" fill="#eef3ff"/></svg>',
  ),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function pointerEvents() {
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      readonly pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    },
  );
}

const note = {
  id: "note",
  workspaceId: "root",
  workspaceName: "阅读",
  title: "阅读笔记",
  relativePath: "note.md",
  markdown: "# 阅读笔记\n\n正文\n\n![示例图片](image.svg)",
};

describe("mobile rich reading", () => {
  it("renders diagrams only when near the reader, and retains the rendered vector", async () => {
    let enter: IntersectionObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          enter = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const { container, rerender } = render(
      <SafeMarkdown markdown={"```mermaid\nflowchart LR\nA-->B\n```"} />,
    );
    expect(renderMermaidSvg).not.toHaveBeenCalled();
    act(() =>
      enter?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    await screen.findByRole("button", { name: "放大 Mermaid 图表" });
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 400 200");
    rerender(
      <SafeMarkdown
        markdown={"```mermaid\nflowchart LR\nA-->B\n```"}
        onOpenLink={vi.fn()}
      />,
    );
    expect(renderMermaidSvg).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalled();
  });

  it("keeps failed diagram source available and renders formulas, tables, tasks and references", async () => {
    vi.mocked(renderMermaidSvg).mockRejectedValueOnce(new Error("invalid diagram"));
    const onOpenLink = vi.fn();
    const { container } = render(
      <SafeMarkdown
        onOpenLink={onOpenLink}
        markdown={
          "$x^2$\n\n| 左 | 右 |\n| :-- | --: |\n| 内容 | 20 |\n\n- [x] 已完成\n\n[下一篇][next]\n\n[next]: child.md#标题\n\n脚注[^1]\n\n[^1]: 说明\n\n```mermaid\ninvalid\n```"
        }
      />,
    );
    expect(await screen.findByText("图表无法渲染，请查看源码")).toBeVisible();
    expect(screen.getByText("invalid")).toBeInTheDocument();
    expect(container.querySelectorAll(".katex")).toHaveLength(1);
    expect(screen.getByRole("columnheader", { name: "右" })).toHaveStyle({
      textAlign: "right",
    });
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "下一篇" }));
    expect(onOpenLink).toHaveBeenCalledWith("child.md#标题");
    expect(container.querySelector("#mobile-footnote-1")).toHaveTextContent("说明");
  });

  it("opens an inert SVG image and closes its viewer without changing the document position", async () => {
    pointerEvents();
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = vi.fn(() => "blob:reading-image");
        static revokeObjectURL = revoke;
      },
    );
    const loadImage = vi.fn(
      async () => new Blob(['<svg viewBox="0 0 400 200"/>'], { type: "image/svg+xml" }),
    );
    const { container, unmount } = render(
      <MobileReader
        document={note}
        loadImage={loadImage}
        onBack={vi.fn()}
        onPositionChange={vi.fn()}
      />,
    );
    const image = await screen.findByRole("img", { name: "示例图片" });
    Object.defineProperties(image, {
      naturalWidth: { value: 400 },
      naturalHeight: { value: 200 },
    });
    const scroller = screen.getByTestId("mobile-reader-scroller");
    scroller.scrollTop = 420;
    fireEvent.pointerDown(screen.getByRole("button", { name: "放大图片：示例图片" }));
    // Browsers may reveal a focused trigger by a few pixels before click.
    scroller.scrollTop = 417;
    fireEvent.click(screen.getByRole("button", { name: "放大图片：示例图片" }));
    const viewer = screen.getByRole("dialog");
    fireEvent.click(within(viewer).getByRole("button", { name: "放大图像" }));
    act(() => {
      expect(dispatchMobileBack()).toBe(true);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(scroller.scrollTop).toBe(420);
    expect(loadImage).toHaveBeenCalledOnce();
    expect(container.querySelector(".mobile-markdown__image svg")).toBeNull();
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:reading-image");
  });

  it("does not fetch images offline and can still render Mermaid locally", async () => {
    const loadImage = vi.fn();
    render(
      <SafeMarkdown
        offline
        loadImage={loadImage}
        markdown={
          "![离线图片][pic]\n\n[pic]: photo.png\n\n```mermaid\nmindmap\n root((学习))\n  阅读\n```"
        }
      />,
    );
    expect(screen.getByText("这张图片未保存在手机，连接电脑后可查看")).toBeVisible();
    expect(loadImage).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "放大 Mermaid 图表" })).toBeVisible();
  });

  it("follows an image link without also opening a viewer or nesting buttons", async () => {
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = vi.fn(() => "blob:linked-image");
        static revokeObjectURL = vi.fn();
      },
    );
    const openLink = vi.fn();
    const openVisual = vi.fn();
    const { container, unmount } = render(
      <SafeMarkdown
        loadImage={async () => new Blob(["image"], { type: "image/png" })}
        onOpenLink={openLink}
        onOpenVisual={openVisual}
        markdown={"[**![下一篇封面](cover.png)**](下一篇.md)"}
      />,
    );
    const image = await screen.findByRole("img", { name: "下一篇封面" });
    expect(container.querySelector("button button")).toBeNull();
    fireEvent.click(image);
    expect(openLink).toHaveBeenCalledExactlyOnceWith("下一篇.md");
    expect(openVisual).not.toHaveBeenCalled();
    fireEvent.error(image);
    expect(screen.getByRole("status")).toHaveTextContent("图片无法解码");
    expect(container.querySelector("button button")).toBeNull();
    unmount();
  });

  it("recognizes center taps while ignoring swipes and closes menus before leaving the reader", () => {
    pointerEvents();
    const back = vi.fn();
    render(
      <MobileReader
        document={{ ...note, markdown: "# 标题\n\n正文" }}
        onBack={back}
        onPositionChange={vi.fn()}
      />,
    );
    const scroller = screen.getByTestId("mobile-reader-scroller");
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
      top: 50,
      height: 600,
    } as DOMRect);
    fireEvent.pointerDown(scroller, { clientX: 150, clientY: 300 });
    fireEvent.pointerUp(scroller, { clientX: 150, clientY: 450 });
    expect(screen.queryByRole("navigation", { name: "阅读菜单" })).not.toBeInTheDocument();
    fireEvent.pointerDown(scroller, { clientX: 150, clientY: 300 });
    fireEvent.pointerUp(scroller, { clientX: 150, clientY: 300 });
    expect(screen.getByRole("navigation", { name: "阅读菜单" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "阅读设置" }));
    act(() => {
      dispatchMobileBack();
    });
    expect(screen.queryByRole("button", { name: "放大字号" })).not.toBeInTheDocument();
    act(() => {
      dispatchMobileBack();
    });
    expect(screen.queryByRole("navigation", { name: "阅读菜单" })).not.toBeInTheDocument();
    expect(back).not.toHaveBeenCalled();
    act(() => {
      dispatchMobileBack();
    });
    expect(back).toHaveBeenCalledOnce();
  });

  it("supports two-finger zoom with crisp explicit SVG dimensions", () => {
    pointerEvents();
    const { container } = render(
      <MobileVisualViewer
        visual={{
          kind: "svg",
          title: "图表",
          source: '<svg viewBox="0 0 400 200"/>',
          width: 400,
          height: 200,
        }}
        onClose={vi.fn()}
      />,
    );
    const stage = container.querySelector(".mobile-visual-viewer__stage") as HTMLElement;
    Object.defineProperties(stage, {
      clientWidth: { value: 400 },
      clientHeight: { value: 600 },
    });
    stage.setPointerCapture = vi.fn();
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 200 });
    fireEvent.pointerDown(stage, { pointerId: 2, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 300, clientY: 200 });
    expect(container.querySelector(".mobile-visual-viewer__content")).toHaveStyle({
      width: "800px",
      height: "400px",
    });
    expect(
      container.querySelector(".mobile-visual-viewer__content")?.getAttribute("style"),
    ).not.toContain("scale(");
    fireEvent.pointerUp(stage, { pointerId: 2 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 120, clientY: 230 });
    expect(screen.getByText("200%")).toBeVisible();
  });

  it("copies the original code text and keeps it selectable", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { container } = render(
      <SafeMarkdown markdown={'```ts\nconst a = "中文";\n```'} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const a = "中文";'));
    expect(await screen.findByRole("button", { name: "已复制" })).toBeVisible();
    expect(container.querySelector("pre code")).toHaveTextContent('const a = "中文";');
  });
});
