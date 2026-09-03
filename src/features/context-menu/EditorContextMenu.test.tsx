import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AppSettingsProvider } from "../../app/settings";
import { DEFAULT_SHORTCUTS } from "../shortcuts/shortcuts";
import { VisualMarkdownEditor } from "../editor/VisualMarkdownEditor";
import {
  installCodeMirrorDomMeasurementStubs,
  installImmediateIntersectionObserverStub,
} from "../editor/spike/domTestSupport";
import { EditorContextMenu } from "./EditorContextMenu";

beforeAll(() => installCodeMirrorDomMeasurementStubs());

beforeAll(() => installImmediateIntersectionObserverStub());

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      readText: vi.fn(async () => ""),
      writeText: vi.fn(async () => undefined),
    },
  });
});

describe("EditorContextMenu", () => {
  it("shows customized platform shortcuts, cleared bindings and headings through level six", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    const surface = document.createElement("div");
    surface.className = "ProseMirror";
    surface.contentEditable = "true";
    document.body.append(surface);
    render(
      <AppSettingsProvider
        storage={null}
        initialSettings={{
          shortcuts: { ...DEFAULT_SHORTCUTS, heading1: "Mod+Shift+1", heading4: null },
        }}
      >
        <EditorContextMenu
          open
          onClose={vi.fn()}
          position={{ x: 20, y: 20 }}
          target={surface}
        />
      </AppSettingsProvider>,
    );
    fireEvent.pointerEnter(screen.getByRole("menuitem", { name: "段落" }));
    expect(
      screen.getByRole("menuitem", { name: /^一级标题/ }).querySelector("kbd"),
    ).toHaveTextContent("Ctrl+Shift+1");
    expect(
      screen.getByRole("menuitem", { name: "四级标题" }).querySelector("kbd"),
    ).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: /^六级标题/ }).querySelector("kbd"),
    ).toHaveTextContent("Ctrl+6");
    surface.remove();
  });
  it("offers image-only actions with the clicked SVG image's original reference and local path", async () => {
    const surface = document.createElement("div");
    surface.className = "ProseMirror";
    const image = document.createElement("img");
    image.alt = "Original";
    image.src = "asset://localhost/fixtures/image.svg";
    image.dataset.visualImageReference = "./assets/image.svg";
    image.dataset.visualImageDocument = "/fixtures/guide.md";
    surface.append(image);
    document.body.append(surface);
    const revealImage = vi.fn();
    const onClose = vi.fn();
    render(
      <AppSettingsProvider initialSettings={{ locale: "en-US" }} storage={null}>
        <EditorContextMenu
          open
          onClose={onClose}
          position={{ x: 40, y: 40 }}
          target={image}
          actions={{ revealImage }}
        />
      </AppSettingsProvider>,
    );
    expect(screen.getByRole("menu", { name: "Image" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Preview Image" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Copy Image" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Edit Image Reference…" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Paragraph" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Select All/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy Image Address" }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("./assets/image.svg"),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Reveal Image in File Manager" }));
    await waitFor(() =>
      expect(revealImage).toHaveBeenCalledWith(
        expect.objectContaining({
          image: expect.objectContaining({
            element: image,
            localPath: "/fixtures/assets/image.svg",
          }),
        }),
      ),
    );
    surface.remove();
  });

  it("shows an explicit copy failure without switching to link text and keeps the error inside the viewport", async () => {
    const image = document.createElement("img");
    image.src = "https://example.test/remote.png";
    document.body.append(image);
    const onClose = vi.fn();
    render(
      <AppSettingsProvider storage={null}>
        <EditorContextMenu
          open
          onClose={onClose}
          position={{ x: 30, y: window.innerHeight - 5 }}
          target={image}
        />
      </AppSettingsProvider>,
    );
    const menu = screen.getByRole("menu", { name: "图片" });
    const beforeTop = parseFloat(menu.style.top);
    expect(screen.queryByRole("menuitem", { name: "打开图片所在位置" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "编辑图片引用…" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "复制图片" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("无法完成图片操作"),
    );
    expect(parseFloat(menu.style.top)).toBeLessThan(beforeTop);
    expect(onClose).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    image.remove();
  });

  it("uses Mermaid preview/source actions instead of paragraph or filesystem actions", async () => {
    const surface = document.createElement("div");
    surface.className = "ProseMirror";
    surface.innerHTML =
      '<div class="milkdown-code-block"><button class="preview-toggle-button">Edit</button><div class="codemirror-host hidden"><div class="cm-content" tabindex="0"></div></div><section class="visual-mermaid-preview"><svg><text>Diagram</text></svg><button data-visual-mermaid-id="demo">Zoom</button></section></div>';
    document.body.append(surface);
    const previewClick = vi.fn();
    surface
      .querySelector("[data-visual-mermaid-id]")
      ?.addEventListener("click", previewClick);
    const source = surface.querySelector<HTMLElement>(".codemirror-host")!;
    surface.querySelector(".preview-toggle-button")?.addEventListener("click", () => {
      queueMicrotask(() => source.classList.remove("hidden"));
    });
    const sourceEditor = surface.querySelector<HTMLElement>(".cm-content")!;
    const focus = vi.spyOn(sourceEditor, "focus").mockImplementation(() => {
      expect(source.classList.contains("hidden")).toBe(false);
    });
    render(
      <AppSettingsProvider storage={null}>
        <EditorContextMenu
          open
          onClose={vi.fn()}
          position={{ x: 30, y: 30 }}
          target={surface.querySelector("text")}
        />
      </AppSettingsProvider>,
    );
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("menuitem", { name: "预览图表" }));
    await waitFor(() => expect(previewClick).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("menuitem", { name: "编辑图表源码" }));
    await waitFor(() => expect(focus).toHaveBeenCalledOnce());
    surface.remove();
  });

  it("renders localized labels and runs a basic command", async () => {
    const input = document.createElement("input");
    input.value = "select me";
    document.body.append(input);
    const onClose = vi.fn();
    render(
      <AppSettingsProvider initialSettings={{ locale: "en-US" }} storage={null}>
        <EditorContextMenu
          onClose={onClose}
          open
          position={{ x: 20, y: 30 }}
          target={input}
        />
      </AppSettingsProvider>,
    );

    expect(screen.getByRole("menu", { name: "Edit" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /Undo/ })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /Redo/ })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /Cut/ })).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: /Select All/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    input.remove();
  });

  it("uses Chinese labels by default", () => {
    render(
      <AppSettingsProvider storage={null}>
        <EditorContextMenu onClose={vi.fn()} open position={{ x: 10, y: 10 }} />
      </AppSettingsProvider>,
    );

    expect(screen.getByRole("menuitem", { name: /剪切/ })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /粘贴/ })).toBeVisible();
  });

  it("uses a compact native-style surface and disables unavailable selection actions", () => {
    const input = document.createElement("textarea");
    input.value = "no active selection";
    input.setSelectionRange(0, 0);
    document.body.append(input);
    render(
      <AppSettingsProvider initialSettings={{ locale: "en-US" }} storage={null}>
        <EditorContextMenu
          onClose={vi.fn()}
          open
          position={{ x: 10, y: 10 }}
          target={input}
        />
      </AppSettingsProvider>,
    );

    const menu = screen.getByRole("menu", { name: "Edit" });
    const copy = screen.getByRole("menuitem", { name: /Copy/ });
    expect(getComputedStyle(menu).width).toBe("224px");
    expect(getComputedStyle(menu).fontSize).toBe("13px");
    expect(getComputedStyle(copy).minHeight).toBe("27px");
    expect(copy).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /Select All/ })).toBeEnabled();
    input.remove();
  });

  it("offers link actions through callbacks without navigating the browser", async () => {
    const anchor = document.createElement("a");
    anchor.href = "./guide.md#start";
    const label = document.createElement("span");
    label.textContent = "guide";
    anchor.append(label);
    document.body.append(anchor);
    const openLink = vi.fn();
    const openLinkNewTab = vi.fn();
    const copyLink = vi.fn();
    render(
      <AppSettingsProvider storage={null}>
        <EditorContextMenu
          actions={{ openLink, openLinkNewTab, copyLink }}
          onClose={vi.fn()}
          open
          position={{ x: 10, y: 10 }}
          target={label}
        />
      </AppSettingsProvider>,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "打开链接" }));
    await waitFor(() => expect(openLink).toHaveBeenCalledOnce());
    expect(openLink).toHaveBeenCalledWith(
      expect.objectContaining({ href: "./guide.md#start", target: label }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "在新标签页打开链接" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "复制链接" }));
    await waitFor(() => {
      expect(openLinkNewTab).toHaveBeenCalledOnce();
      expect(copyLink).toHaveBeenCalledOnce();
    });
    anchor.remove();
  });

  it("only offers copy and select-all for a read-only code preview", () => {
    const preview = document.createElement("section");
    preview.className = "code-file-preview";
    preview.dataset.editable = "false";
    const code = document.createElement("div");
    code.className = "cm-content";
    code.contentEditable = "false";
    code.textContent = "readonly";
    preview.append(code);
    document.body.append(preview);
    render(
      <AppSettingsProvider storage={null}>
        <EditorContextMenu
          onClose={vi.fn()}
          open
          position={{ x: 10, y: 10 }}
          target={code}
        />
      </AppSettingsProvider>,
    );

    expect(screen.getByRole("menuitem", { name: /复制/ })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /全选/ })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: /剪切/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /粘贴/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /撤销/ })).not.toBeInTheDocument();
    preview.remove();
  });

  it("shows localized paragraph, format and insert submenus on visual Markdown", () => {
    const editor = document.createElement("div");
    editor.className = "ProseMirror";
    editor.contentEditable = "true";
    const paragraph = document.createElement("p");
    paragraph.textContent = "正文";
    editor.append(paragraph);
    document.body.append(editor);
    render(
      <AppSettingsProvider storage={null}>
        <EditorContextMenu
          onClose={vi.fn()}
          open
          position={{ x: 10, y: 10 }}
          target={paragraph}
        />
      </AppSettingsProvider>,
    );

    expect(screen.getByRole("menuitem", { name: "段落" })).toBeVisible();
    fireEvent.pointerEnter(screen.getByRole("menuitem", { name: "插入" }));
    expect(screen.getByRole("menuitem", { name: "表格…" })).toBeVisible();
    editor.remove();
  });

  it("dispatches paragraph and table commands into the mounted visual editor", async () => {
    const paragraphChange = vi.fn();
    const paragraphEditor = render(
      <AppSettingsProvider storage={null}>
        <VisualMarkdownEditor
          autofocus={false}
          documentId="/tmp/context-paragraph.md"
          onChange={paragraphChange}
          value="右键正文"
        />
      </AppSettingsProvider>,
    );
    const paragraph = await waitFor(() => {
      const mounted =
        paragraphEditor.container.querySelector<HTMLElement>(".ProseMirror p");
      expect(mounted).toHaveTextContent("右键正文");
      return mounted!;
    });
    const paragraphMenu = render(
      <AppSettingsProvider storage={null}>
        <EditorContextMenu
          onClose={vi.fn()}
          open
          position={{ x: 10, y: 10 }}
          target={paragraph}
        />
      </AppSettingsProvider>,
    );
    fireEvent.pointerEnter(screen.getByRole("menuitem", { name: "段落" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^二级标题/ }));
    await waitFor(() =>
      expect(paragraphEditor.container.querySelector(".ProseMirror h2")).toHaveTextContent(
        "右键正文",
      ),
    );
    expect(paragraphChange).toHaveBeenLastCalledWith(
      expect.stringContaining("## 右键正文"),
    );
    paragraphMenu.unmount();
    paragraphEditor.unmount();

    const tableChange = vi.fn();
    const tableEditor = render(
      <AppSettingsProvider storage={null}>
        <VisualMarkdownEditor
          autofocus={false}
          documentId="/tmp/context-table.md"
          onChange={tableChange}
          value={["| 阶段 | 时间 |", "| --- | --- |", "| 起稿 | 15 分钟 |"].join("\n")}
        />
      </AppSettingsProvider>,
    );
    const tableTarget = await waitFor(() => {
      const mounted = tableEditor.container.querySelector<HTMLElement>(
        ".milkdown-table-block th p",
      );
      expect(mounted).toHaveTextContent("阶段");
      return mounted!;
    });
    const table = () => {
      const mounted = tableEditor.container.querySelector<HTMLTableElement>(
        ".milkdown-table-block table",
      );
      if (!mounted) throw new Error("Visual table was not mounted");
      return mounted;
    };
    const rowMenu = render(
      <AppSettingsProvider storage={null}>
        <EditorContextMenu
          onClose={vi.fn()}
          open
          position={{ x: 10, y: 10 }}
          target={tableTarget}
        />
      </AppSettingsProvider>,
    );
    fireEvent.pointerEnter(screen.getByRole("menuitem", { name: "表格" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "在下方插入行" }));
    await waitFor(() => expect(table().querySelectorAll("tr")).toHaveLength(3));
    rowMenu.unmount();

    const columnMenu = render(
      <AppSettingsProvider storage={null}>
        <EditorContextMenu
          onClose={vi.fn()}
          open
          position={{ x: 10, y: 10 }}
          target={table().querySelector("th p")}
        />
      </AppSettingsProvider>,
    );
    fireEvent.pointerEnter(screen.getByRole("menuitem", { name: "表格" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "在右侧插入列" }));
    await waitFor(() =>
      expect(table().querySelectorAll("tr:first-child th")).toHaveLength(3),
    );
    expect(tableEditor.container.querySelector(".ProseMirror")?.textContent).not.toContain(
      "| ---",
    );
    expect(tableChange).toHaveBeenCalled();
    columnMenu.unmount();
  });
});
