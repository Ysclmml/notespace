import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppSettingsProvider } from "../../app/settings";
import { EditorContextMenu, useEditorContextMenu } from "../context-menu";

vi.mock("../editor/mermaidRenderer", () => ({
  renderMermaidSvg: vi.fn(async () =>
    Promise.resolve('<svg viewBox="0 0 120 40"><text>diagram</text></svg>'),
  ),
}));

import { VisualViewer } from "./VisualViewer";
import { renderMermaidSvg } from "../editor/mermaidRenderer";

describe("VisualViewer", () => {
  it("provides read-only image copy/reference actions in the viewer and keeps Escape scoped to the menu", async () => {
    const onClose = vi.fn();
    const revealImage = vi.fn();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    function Harness() {
      const context = useEditorContextMenu();
      return (
        <AppSettingsProvider storage={null}>
          <div
            onPointerDownCapture={context.onPointerDownCapture}
            onContextMenu={context.onContextMenu}
          >
            <VisualViewer
              onClose={onClose}
              visual={{
                kind: "image",
                source: "asset://localhost/fixtures/photo.png",
                title: "Display caption",
                reference: "./assets/photo.png",
                documentPath: "/fixtures/guide.md",
                imageAlt: "",
                imageTitle: "Original tooltip",
              }}
            />
            <EditorContextMenu
              {...context.contextMenu}
              onClose={context.closeContextMenu}
              actions={{ revealImage }}
            />
          </div>
        </AppSettingsProvider>
      );
    }
    const { container } = render(<Harness />);
    const image = container.querySelector<HTMLImageElement>("img")!;
    expect(image).toHaveAttribute("crossorigin", "anonymous");
    const stage = container.querySelector<HTMLElement>(".visual-viewer__stage")!;
    stage.setPointerCapture = vi.fn();
    fireEvent(
      image,
      new MouseEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: true }),
    );
    expect(stage.setPointerCapture).not.toHaveBeenCalled();
    fireEvent.contextMenu(image, { ctrlKey: true, clientX: 40, clientY: 50 });
    expect(screen.getByRole("menuitem", { name: "复制图片" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "编辑图片引用…" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "预览图片" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "复制图片 Markdown" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        '![](<./assets/photo.png> "Original tooltip")',
      ),
    );
    fireEvent.contextMenu(image, { clientX: 40, clientY: 50 });
    fireEvent.click(screen.getByRole("menuitem", { name: "打开图片所在位置" }));
    await waitFor(() =>
      expect(revealImage).toHaveBeenCalledWith(
        expect.objectContaining({
          image: expect.objectContaining({
            localPath: "/fixtures/assets/photo.png",
            editable: false,
          }),
        }),
      ),
    );
    fireEvent.contextMenu(image, { clientX: 40, clientY: 50 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows an explicitly opened image with fit, actual-size, and pan controls", () => {
    const { container } = render(
      <AppSettingsProvider storage={null}>
        <VisualViewer
          onClose={vi.fn()}
          visual={{
            kind: "image",
            source: "https://example.test/image.png",
            title: "图片预览",
          }}
        />
      </AppSettingsProvider>,
    );
    const image = screen.getByRole("img", { name: "图片预览" });
    const stage = container.querySelector<HTMLElement>(".visual-viewer__stage")!;
    Object.defineProperties(stage, {
      clientWidth: { value: 900 },
      clientHeight: { value: 600 },
    });
    Object.defineProperties(image, {
      naturalWidth: { value: 400 },
      naturalHeight: { value: 200 },
    });
    fireEvent.load(image);
    expect(screen.getByText("189%")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    expect(screen.getAllByText("100%")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /^放大$/u }));
    expect(screen.getByText("118%")).toBeVisible();
    expect(image).toHaveAttribute("src", "https://example.test/image.png");
    expect(image).toHaveAttribute("draggable", "false");
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(image).not.toHaveAttribute("crossorigin");
    const content = container.querySelector<HTMLElement>(".visual-viewer__content")!;
    const beforeDrag = content.style.transform;
    stage.setPointerCapture = vi.fn();
    const pointerEvent = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: y,
      });
      Object.defineProperty(event, "pointerId", { value: 1 });
      fireEvent(stage, event);
    };
    pointerEvent("pointerdown", 100, 100);
    pointerEvent("pointermove", 150, 120);
    pointerEvent("pointerup", 150, 120);
    expect(content.style.transform).not.toBe(beforeDrag);
    expect(vi.mocked(renderMermaidSvg)).not.toHaveBeenCalled();
  });

  it.each([
    { locale: "zh-CN" as const, title: "图片未能加载", close: "关闭查看器" },
    { locale: "en-US" as const, title: "Image could not be loaded", close: "Close Viewer" },
  ])(
    "shows a localized image failure state in $locale and still closes safely",
    ({ locale, title, close }) => {
      const onClose = vi.fn();
      const returnTarget = document.createElement("button");
      document.body.append(returnTarget);
      returnTarget.focus();
      const source =
        "/workspace/images/a very long path/" + "目录/".repeat(15) + "broken.svg";
      const { container, unmount } = render(
        <AppSettingsProvider initialSettings={{ locale }} storage={null}>
          <VisualViewer
            onClose={onClose}
            visual={{ kind: "image", source, title: "broken.svg" }}
          />
        </AppSettingsProvider>,
      );
      fireEvent.error(screen.getByRole("img", { name: "broken.svg" }));
      expect(screen.getByRole("status")).toHaveTextContent(title);
      expect(screen.queryByRole("img")).toBeNull();
      expect(screen.getByText(source)).toHaveTextContent(source);
      expect(getComputedStyle(screen.getByRole("status")).overflowWrap).toBe("anywhere");
      expect(
        container.querySelector("object, iframe, script, .visual-viewer__diagram"),
      ).toBeNull();
      expect(screen.getByRole("button", { name: "100%" })).toBeDisabled();
      expect(screen.getByRole("button", { name: close })).toBeEnabled();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledOnce();
      unmount();
      expect(returnTarget).toHaveFocus();
      returnTarget.remove();
    },
  );

  it("resets a failed image when another source is opened and keeps SVG in image mode", () => {
    const onClose = vi.fn();
    const { container, rerender } = render(
      <AppSettingsProvider storage={null}>
        <VisualViewer
          onClose={onClose}
          visual={{ kind: "image", source: "/tmp/missing.png", title: "missing" }}
        />
      </AppSettingsProvider>,
    );
    fireEvent.error(screen.getByRole("img", { name: "missing" }));
    expect(screen.getByRole("status")).toBeVisible();

    rerender(
      <AppSettingsProvider storage={null}>
        <VisualViewer
          onClose={onClose}
          visual={{ kind: "image", source: "/tmp/diagram.svg", title: "SVG diagram" }}
        />
      </AppSettingsProvider>,
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("img", { name: "SVG diagram" })).toHaveAttribute(
      "src",
      "/tmp/diagram.svg",
    );
    expect(
      container.querySelector("svg, object, iframe, script, .visual-viewer__diagram"),
    ).toBeNull();
  });

  it("renders Mermaid and exposes zoom, fit and close controls", async () => {
    const onClose = vi.fn();
    const returnTarget = document.createElement("button");
    document.body.append(returnTarget);
    returnTarget.focus();
    const { unmount } = render(
      <AppSettingsProvider storage={null}>
        <VisualViewer
          onClose={onClose}
          visual={{ kind: "mermaid", source: "A --> B", title: "架构图" }}
        />
      </AppSettingsProvider>,
    );

    expect(screen.getByRole("dialog", { name: "架构图" })).toBeVisible();
    expect(screen.getByRole("button", { name: "关闭查看器" })).toHaveFocus();
    await waitFor(() => expect(screen.getByText("diagram")).toBeVisible());
    const scaleLabel = screen.getByText("架构图").nextElementSibling;
    await waitFor(() => expect(scaleLabel).not.toHaveTextContent("100%"));
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    await waitFor(() => expect(screen.getAllByText("100%")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: /^放大$/u }));
    expect(screen.getByText("118%")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "关闭查看器" }));
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(returnTarget).toHaveFocus();
    returnTarget.remove();
  });
});
