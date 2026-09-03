import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { redo, undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { VisualMarkdownEditor } from "./VisualMarkdownEditor";
import * as imageSources from "./imageSource";
import {
  installCodeMirrorDomMeasurementStubs,
  installImmediateIntersectionObserverStub,
} from "./spike/domTestSupport";

beforeAll(() => {
  installCodeMirrorDomMeasurementStubs();
  installImmediateIntersectionObserverStub();
});

function captureView() {
  const views = new Set<EditorView>();
  const updateState = EditorView.prototype.updateState;
  vi.spyOn(EditorView.prototype, "updateState").mockImplementation(function (
    this: EditorView,
    state,
  ) {
    updateState.call(this, state);
    views.add(this);
  });
  return (container: HTMLElement) =>
    waitFor(() => {
      const view = [...views].find(
        (candidate) => candidate.dom === container.querySelector(".ProseMirror"),
      );
      expect(view).toBeTruthy();
      return view!;
    });
}

function imagePosition(view: EditorView, source: string): number {
  let result = -1;
  view.state.doc.descendants((node, position) => {
    if (node.type.name === "image" && node.attrs.src === source) result = position;
  });
  if (result < 0) throw new Error("Test image not found");
  return result;
}

describe("unavailable visual images", () => {
  it.each([
    ["zh-CN", "图片不存在或无法加载", "编辑引用…", "删除引用"],
    ["en-US", "Image missing or unavailable", "Edit reference…", "Remove reference"],
  ] as const)(
    "shows an actionable %s placeholder for a missing local image without alt text or document edits",
    async (locale, message, editLabel, removeLabel) => {
      vi.spyOn(imageSources, "resolveMarkdownImageSource").mockReturnValue(
        "asset://localhost/missing.png",
      );
      vi.spyOn(imageSources, "prepareMarkdownImageSource").mockRejectedValue(
        new Error("File does not exist"),
      );
      const onChange = vi.fn();
      const { container } = render(
        <VisualMarkdownEditor
          autofocus={false}
          documentId="/fixtures/missing-image.md"
          locale={locale}
          onChange={onChange}
          value={'![](./missing.png "Original title")\n\nFollowing paragraph.'}
        />,
      );
      expect(await screen.findByText(message)).toBeVisible();
      const placeholder = container.querySelector<HTMLElement>(
        ".visual-markdown-image__placeholder",
      )!;
      expect(placeholder).toBeVisible();
      expect(placeholder).toHaveTextContent("./missing.png");
      expect(within(placeholder).getByRole("button", { name: editLabel })).toBeEnabled();
      expect(within(placeholder).getByRole("button", { name: removeLabel })).toBeEnabled();
      const image = container.querySelector("img")!;
      expect(image.getAttribute("alt")).toBe("");
      expect(image.getAttribute("title")).toBe("Original title");
      expect(image.hasAttribute("src")).toBe(false);
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("removes only the failed inline image reference, independent of the caret, with Undo and Redo", async () => {
    const findView = captureView();
    const onChange = vi.fn();
    const onOpenVisual = vi.fn();
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/fixtures/inline-image.md"
        onChange={onChange}
        onOpenVisual={onOpenVisual}
        value={
          "Before ![](./missing.png) after.\n\n![Keep](./keep.png)\n\nCaret elsewhere."
        }
      />,
    );
    const view = await findView(container);
    const original = view.state.doc;
    act(() => {
      view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    });
    const failedImage = container.querySelector<HTMLImageElement>(
      '[data-visual-image-reference="./missing.png"]',
    )!;
    fireEvent.error(failedImage);
    expect(
      await screen.findByRole("group", { name: "图片不存在或无法加载" }),
    ).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
    const remove = screen.getByRole("button", { name: "删除引用" });
    fireEvent.mouseDown(remove);
    fireEvent.click(remove);
    expect(onOpenVisual).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls.at(-1)?.[0]).not.toContain("./missing.png");
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("Before  after.");
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("![Keep](./keep.png)");
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("Caret elsewhere.");
    expect(screen.queryByRole("button", { name: "删除引用" })).toBeNull();
    act(() => expect(undo(view.state, view.dispatch)).toBe(true));
    expect(view.state.doc.eq(original)).toBe(true);
    act(() => expect(undo(view.state, view.dispatch)).toBe(false));
    act(() => expect(redo(view.state, view.dispatch)).toBe(true));
    expect(onChange.mock.calls.at(-1)?.[0]).not.toContain("./missing.png");
  });

  it("edits a failed reference from its placeholder and clears the error after changing the source", async () => {
    const findView = captureView();
    const onChange = vi.fn();
    const onOpenVisual = vi.fn();
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/fixtures/edit-image.md"
        onChange={onChange}
        onOpenVisual={onOpenVisual}
        value={'![Original](./missing.png "Original title")\n\nParagraph.'}
      />,
    );
    const view = await findView(container);
    const image = container.querySelector("img")!;
    fireEvent.error(image);
    const edit = await screen.findByRole("button", { name: "编辑引用…" });
    fireEvent.mouseDown(edit);
    fireEvent.click(edit);
    expect(await screen.findByRole("dialog", { name: "编辑图片引用" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "图片地址" })).toHaveValue("./missing.png");
    expect(onOpenVisual).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "图片地址" }), {
      target: { value: "./restored.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const restored = container.querySelector("img")!;
    expect(restored.getAttribute("src")).toBe("/fixtures/restored.png");
    fireEvent.load(restored);
    expect(screen.queryByRole("button", { name: "删除引用" })).toBeNull();
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0]?.[0]).toContain(
      '![Original](./restored.png "Original title")',
    );
    act(() => expect(undo(view.state, view.dispatch)).toBe(true));
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("./missing.png");
  });

  it("ignores stale local preparation failures after a new source and after unmount", async () => {
    const findView = captureView();
    const pending = new Map<
      string,
      { resolve: (value: string) => void; reject: (error: Error) => void }
    >();
    vi.spyOn(imageSources, "resolveMarkdownImageSource").mockImplementation(
      (_document, source) => `asset://localhost/${source}`,
    );
    vi.spyOn(imageSources, "prepareMarkdownImageSource").mockImplementation(
      (_document, source) =>
        new Promise<string>((resolve, reject) => pending.set(source, { resolve, reject })),
    );
    const onChange = vi.fn();
    const { container, unmount } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/fixtures/late-image.md"
        onChange={onChange}
        value="![](./first.png)"
      />,
    );
    const view = await findView(container);
    const position = imagePosition(view, "./first.png");
    act(() =>
      view.dispatch(
        view.state.tr.setNodeMarkup(position, undefined, {
          src: "./second.png",
          alt: "",
          title: "",
        }),
      ),
    );
    onChange.mockClear();
    await act(async () => {
      pending.get("./first.png")!.reject(new Error("Old image missing"));
      pending.get("./second.png")!.resolve("asset://localhost/second.png");
    });
    const image = container.querySelector("img")!;
    fireEvent.load(image);
    expect(image.getAttribute("src")).toBe("asset://localhost/second.png");
    expect(screen.queryByRole("button", { name: "删除引用" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    act(() =>
      view.dispatch(
        view.state.tr.setNodeMarkup(position, undefined, {
          src: "./third.png",
          alt: "",
          title: "",
        }),
      ),
    );
    onChange.mockClear();
    unmount();
    await act(async () => pending.get("./third.png")!.reject(new Error("Unmounted image")));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps successfully loaded images free of placeholder controls and preserves preview behavior", async () => {
    const onChange = vi.fn();
    const onOpenVisual = vi.fn();
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/fixtures/loaded-image.md"
        onChange={onChange}
        onOpenVisual={onOpenVisual}
        value="![Loaded](./loaded.png)"
      />,
    );
    const image = await waitFor(() => {
      const node = container.querySelector("img");
      expect(node).toBeTruthy();
      return node!;
    });
    fireEvent.load(image);
    expect(screen.queryByRole("button", { name: "删除引用" })).toBeNull();
    expect(image).toBeVisible();
    fireEvent.click(image);
    expect(onOpenVisual).toHaveBeenCalledWith(
      expect.objectContaining({ source: "/fixtures/loaded.png", kind: "image" }),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the failure visible while editing other text or the image description", async () => {
    const findView = captureView();
    vi.spyOn(imageSources, "resolveMarkdownImageSource").mockReturnValue(
      "asset://localhost/missing.png",
    );
    const prepare = vi
      .spyOn(imageSources, "prepareMarkdownImageSource")
      .mockRejectedValue(new Error("Missing fixture"));
    const onChange = vi.fn();
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/fixtures/still-missing.md"
        onChange={onChange}
        value="![](./missing.png)\n\nEditable paragraph."
      />,
    );
    const view = await findView(container);
    expect(await screen.findByText("图片不存在或无法加载")).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
    act(() =>
      view.dispatch(view.state.tr.insertText(" Added", view.state.doc.content.size - 1)),
    );
    const position = imagePosition(view, "./missing.png");
    act(() =>
      view.dispatch(
        view.state.tr.setNodeMarkup(position, undefined, {
          ...view.state.doc.nodeAt(position)!.attrs,
          alt: "Updated description",
        }),
      ),
    );
    expect(screen.getByText("图片不存在或无法加载")).toBeVisible();
    expect(prepare).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls.at(-1)?.[0]).toContain(
      "![Updated description](./missing.png)",
    );
    expect(onChange.mock.calls.at(-1)?.[0]).not.toContain("图片不存在");
  });
});
