import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { undo } from "@codemirror/commands";
import { forceParsing } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { undo as undoVisual } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { EditorView as VisualEditorView } from "@milkdown/kit/prose/view";
import { StrictMode, useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "./MarkdownEditor";
import { LARGE_PASTE_TEXT_THRESHOLD } from "./pasteGuard";
import { installCodeMirrorDomMeasurementStubs } from "./spike/domTestSupport";

beforeAll(() => installCodeMirrorDomMeasurementStubs());

function dispatchClipboardPaste(target: HTMLElement, data: Partial<DataTransfer>) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: () => "", items: [], files: [], types: [], ...data },
  });
  fireEvent(target, event);
  return event;
}

describe("MarkdownEditor DOM integration", () => {
  it("routes relative and fragment links exactly once from source pointer gestures", async () => {
    const onInternalLink = vi.fn();
    const onChange = vi.fn();
    const value =
      "[Next](../guide/My%20Note.md#start)\n\n[Section](#本节)\n\n[Website](https://example.test/docs?q=hello#section)\n";
    const { container } = render(
      <MarkdownEditor
        autofocus={false}
        documentId="/fixtures/source-links.md"
        mode="sourceOnly"
        onChange={onChange}
        onInternalLink={onInternalLink}
        value={value}
      />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    // Initial parsing has a 20 ms budget and can leave later links pending under
    // suite load. Finish the real parser before testing synchronous gestures.
    await waitFor(() => expect(forceParsing(view, view.state.doc.length)).toBe(true));
    // jsdom has no text layout. Only coordinate lookup is stubbed; the actual
    // CodeMirror DOM handler and Markdown syntax-tree lookup remain in use.
    const position = vi.spyOn(view, "posAtCoords").mockReturnValue(value.indexOf("Next"));
    const originalLocation = window.location.href;
    const gestures = [
      { type: "click", button: 0, disposition: "current" },
      { type: "click", button: 0, metaKey: true, disposition: "newBackground" },
      { type: "click", button: 0, ctrlKey: true, disposition: "newBackground" },
      {
        type: "click",
        button: 0,
        metaKey: true,
        shiftKey: true,
        disposition: "newForeground",
      },
      { type: "auxclick", button: 1, disposition: "newBackground" },
    ];

    for (const { type, disposition, ...pointer } of gestures) {
      onInternalLink.mockClear();
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...pointer });
      fireEvent(view.contentDOM, event);
      expect(event.defaultPrevented).toBe(true);
      expect(onInternalLink).toHaveBeenCalledExactlyOnceWith(
        "../guide/My%20Note.md#start",
        disposition,
      );
    }

    position.mockReturnValue(value.indexOf("Section"));
    onInternalLink.mockClear();
    fireEvent.click(view.contentDOM);
    expect(onInternalLink).toHaveBeenCalledExactlyOnceWith("#本节", "current");
    position.mockReturnValue(value.indexOf("Website"));
    onInternalLink.mockClear();
    fireEvent.click(view.contentDOM);
    expect(onInternalLink).toHaveBeenCalledExactlyOnceWith(
      "https://example.test/docs?q=hello#section",
      "current",
    );
    onInternalLink.mockClear();
    fireEvent(view.contentDOM, new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    expect(onInternalLink).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(window.location.href).toBe(originalLocation);
  });

  it("keeps source link callbacks attached to their instance after a split-focus update", () => {
    const opened = vi.fn();
    const value = "[Next](./next.md#detail)";
    function SourceSplit() {
      const [focused, setFocused] = useState("right");
      return (
        <>
          {["left", "right"].map((id) => (
            <section key={id} onPointerDownCapture={() => setFocused(id)}>
              <MarkdownEditor
                autofocus={focused === id}
                documentId="/fixtures/shared-source.md"
                instanceId={id}
                mode="sourceOnly"
                onChange={vi.fn()}
                onInternalLink={(target, disposition) =>
                  opened(id, focused, target, disposition)
                }
                value={value}
              />
            </section>
          ))}
        </>
      );
    }
    const { container } = render(<SourceSplit />);
    const editors = [...container.querySelectorAll<HTMLElement>(".cm-editor")];
    const left = EditorView.findFromDOM(editors[0]!)!;
    const right = EditorView.findFromDOM(editors[1]!)!;
    vi.spyOn(left, "posAtCoords").mockReturnValue(value.indexOf("Next"));
    vi.spyOn(right, "posAtCoords").mockReturnValue(value.indexOf("Next"));

    fireEvent.pointerDown(left.contentDOM, { button: 0 });
    fireEvent.click(left.contentDOM);
    expect(opened).toHaveBeenCalledExactlyOnceWith(
      "left",
      "left",
      "./next.md#detail",
      "current",
    );
    expect(EditorView.findFromDOM(editors[0]!)).toBe(left);
    expect(EditorView.findFromDOM(editors[1]!)).toBe(right);
    opened.mockClear();
    fireEvent.pointerDown(right.contentDOM, { button: 1 });
    fireEvent(right.contentDOM, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(opened).toHaveBeenCalledExactlyOnceWith(
      "right",
      "right",
      "./next.md#detail",
      "newBackground",
    );
  });

  it("maps shared source updates without echoing them, changing focus, or adding Undo entries", async () => {
    const onChange = vi.fn();
    const onViewChange = vi.fn();
    const props = {
      autofocus: false,
      documentId: "shared-source",
      mode: "sourceOnly" as const,
      onChange,
      onViewChange,
    };
    const { container, rerender } = render(
      <>
        <button type="button">outside</button>
        <MarkdownEditor {...props} value={"first\nsecond"} />
      </>,
    );
    const editor = container.querySelector<HTMLElement>(".cm-editor")!;
    const view = EditorView.findFromDOM(editor)!;
    await waitFor(() => expect(onViewChange).toHaveBeenCalled());
    act(() =>
      view.dispatch({
        changes: { from: view.state.doc.length, insert: "!" },
        selection: { anchor: 8 },
      }),
    );
    view.scrollDOM.scrollTop = 180;
    const outside = container.querySelector("button")!;
    outside.focus();
    onChange.mockClear();

    rerender(
      <>
        <button type="button">outside</button>
        <MarkdownEditor {...props} value={"new first\nsecond!"} />
      </>,
    );

    expect(EditorView.findFromDOM(editor)).toBe(view);
    expect(view.state.selection.main.from).toBe(12);
    expect(view.scrollDOM.scrollTop).toBe(180);
    expect(document.activeElement).toBe(outside);
    expect(onChange).not.toHaveBeenCalled();
    act(() => expect(undo(view)).toBe(true));
    expect(view.state.doc.toString()).toBe("new first\nsecond");
    act(() => expect(undo(view)).toBe(false));
  });

  it("shares text between source instances while keeping each instance's own selection", async () => {
    const callbacks = [vi.fn(), vi.fn()];
    function SharedSource() {
      const [value, setValue] = useState("first\nsecond");
      return (
        <>
          {callbacks.map((callback, index) => (
            <MarkdownEditor
              key={index}
              autofocus={false}
              documentId="same-source"
              instanceId={`source-${index}`}
              mode="sourceOnly"
              value={value}
              onChange={(next) => {
                callback(next);
                setValue(next);
              }}
            />
          ))}
        </>
      );
    }
    const { container } = render(<SharedSource />);
    const views = [...container.querySelectorAll<HTMLElement>(".cm-editor")].map((editor) =>
      EditorView.findFromDOM(editor)!,
    );
    const first = views[0]!;
    const second = views[1]!;
    act(() => second.dispatch({ selection: { anchor: 8 } }));
    act(() =>
      first.dispatch({ changes: { from: 0, insert: "left " }, selection: { anchor: 5 } }),
    );
    await waitFor(() => expect(second.state.doc.toString()).toBe("left first\nsecond"));
    expect(first.state.selection.main.from).toBe(5);
    expect(second.state.selection.main.from).toBe(13);
    expect(callbacks[0]).toHaveBeenCalledOnce();
    expect(callbacks[1]).not.toHaveBeenCalled();
    act(() => expect(undo(second)).toBe(false));
  });

  it("defers shared source updates during IME and publishes only the merged final text", async () => {
    const onChange = vi.fn();
    const props = {
      autofocus: false,
      documentId: "source-ime",
      mode: "sourceOnly" as const,
      onChange,
    };
    const { container, rerender } = render(
      <MarkdownEditor {...props} value={"first\nsecond"} />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    fireEvent.compositionStart(view.contentDOM);
    rerender(<MarkdownEditor {...props} value={"new first\nsecond"} />);
    expect(view.state.doc.toString()).toBe("first\nsecond");
    act(() => view.dispatch({ changes: { from: 6, insert: "中文" } }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.compositionEnd(view.contentDOM);
    await waitFor(() => expect(view.state.doc.toString()).toBe("new first\n中文second"));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenLastCalledWith("new first\n中文second");
  });

  it("synchronizes visual and source instances without serialization feedback", async () => {
    const onVisualChange = vi.fn();
    const onSourceChange = vi.fn();
    function MixedSurfaces() {
      const [value, setValue] = useState("original\n");
      return (
        <>
          <MarkdownEditor
            autofocus={false}
            documentId="mixed-document"
            instanceId="visual"
            mode="normal"
            presentationMode="visual"
            value={value}
            onChange={(next) => {
              onVisualChange(next);
              setValue(next);
            }}
          />
          <MarkdownEditor
            autofocus={false}
            documentId="mixed-document"
            instanceId="source"
            mode="normal"
            presentationMode="source"
            value={value}
            onChange={(next) => {
              onSourceChange(next);
              setValue(next);
            }}
          />
        </>
      );
    }
    const { container } = render(<MixedSurfaces />);
    const paragraph = await waitFor(() => {
      const node = container.querySelector<HTMLElement>(".ProseMirror p");
      expect(node).toHaveTextContent("original");
      return node!;
    });
    paragraph.textContent = "visual edit";
    fireEvent.input(paragraph, { inputType: "insertText", data: "visual edit" });
    const source = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".markdown-editor--source .cm-editor")!,
    )!;
    await waitFor(() => expect(source.state.doc.toString()).toBe("visual edit\n"));
    expect(onVisualChange).toHaveBeenCalledOnce();
    expect(onSourceChange).not.toHaveBeenCalled();

    act(() =>
      source.dispatch({
        changes: { from: source.state.doc.length, insert: "\n# Source heading\n" },
      }),
    );
    await waitFor(() =>
      expect(container.querySelector(".ProseMirror h1")).toHaveTextContent(
        "Source heading",
      ),
    );
    expect(onSourceChange).toHaveBeenCalledOnce();
    expect(onVisualChange).toHaveBeenCalledOnce();
  });

  it("keeps source selection clearly stronger than the active line", async () => {
    const { container } = render(
      <MarkdownEditor
        autofocus={false}
        documentId="selection-contrast"
        mode="sourceOnly"
        presentationMode="source"
        onChange={vi.fn()}
        value={"first line\nsecond line"}
      />,
    );
    const editor = container.querySelector<HTMLElement>(".cm-editor");
    if (!editor) throw new Error("CodeMirror editor was not mounted");
    const view = EditorView.findFromDOM(editor);
    if (!view) throw new Error("CodeMirror view was not found");

    view.focus();
    view.dispatch({ selection: { anchor: 0, head: 5 } });

    expect(view.state.selection.main).toMatchObject({ from: 0, to: 5 });
    const selectionLayer = container.querySelector<HTMLElement>(".cm-selectionLayer");
    if (!selectionLayer) throw new Error("CodeMirror selection layer was not mounted");
    const selection = document.createElement("div");
    selection.className = "cm-selectionBackground";
    selectionLayer.append(selection);
    const activeLine = container.querySelector<HTMLElement>(".cm-activeLine");
    expect(activeLine).toBeTruthy();
    expect(getComputedStyle(selection).backgroundColor).toBe("rgb(184, 207, 248)");
    expect(getComputedStyle(activeLine!).backgroundColor).toBe("rgba(65, 105, 180, 0.12)");
    expect(getComputedStyle(selection).backgroundColor).not.toBe("rgb(0, 0, 0)");
  });

  it.each(["text/plain", "text/html"])(
    "rejects a large inline image in %s before creating an editor transaction",
    (type) => {
      const onChange = vi.fn();
      const onPasteRejected = vi.fn();
      const onImagePaste = vi.fn(async () => "![](./capture.png)");
      const { container } = render(
        <MarkdownEditor
          autofocus={false}
          documentId="paste-test"
          mode="normal"
          presentationMode="source"
          onChange={onChange}
          onPasteRejected={onPasteRejected}
          onImagePaste={onImagePaste}
          value="# 原文\n"
        />,
      );
      const content = container.querySelector<HTMLElement>(".cm-content");
      if (!content) throw new Error("CodeMirror content was not mounted");

      const paste = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", {
        value: {
          getData: (requested: string) =>
            requested === type
              ? "data:image/png;base64," + "A".repeat(LARGE_PASTE_TEXT_THRESHOLD + 1)
              : "",
          items: [],
          types: [type, "image/png"],
        },
      });
      fireEvent(content, paste);

      expect(paste.defaultPrevented).toBe(true);
      expect(onPasteRejected).toHaveBeenCalledOnce();
      expect(onChange).not.toHaveBeenCalled();
      expect(onImagePaste).not.toHaveBeenCalled();
    },
  );

  it("inserts a relative image link only after the desktop write succeeds", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        autofocus={false}
        documentId="image-success"
        mode="normal"
        presentationMode="source"
        onChange={onChange}
        onImagePaste={() => Promise.resolve("![](./assets/paste.png)")}
        value=""
      />,
    );
    const content = container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("CodeMirror content was not mounted");

    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: () => "",
        items: [{ type: "image/png", getAsFile: () => new File(["png"], "paste.png") }],
      },
    });
    fireEvent(content, paste);

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith("![](./assets/paste.png)"),
    );
  });

  it("leaves the document unchanged when the desktop image write fails", async () => {
    const onChange = vi.fn();
    const onPasteError = vi.fn();
    const { container } = render(
      <MarkdownEditor
        autofocus={false}
        documentId="image-failure"
        mode="normal"
        presentationMode="source"
        onChange={onChange}
        onImagePaste={() => Promise.reject(new Error("disk full"))}
        onPasteError={onPasteError}
        value="原文"
      />,
    );
    const content = container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("CodeMirror content was not mounted");

    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: () => "",
        items: [{ type: "image/png", getAsFile: () => new File(["png"], "paste.png") }],
      },
    });
    fireEvent(content, paste);

    await waitFor(() => expect(onPasteError).toHaveBeenCalledWith("disk full"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(["files", "types", "Files", "empty"])(
    "pastes source screenshots with a %s-only WebKit representation after writing",
    async (representation) => {
      let finish!: (markdown: string) => void;
      const onChange = vi.fn();
      const onImagePaste = vi.fn(
        () => new Promise<string>((resolve) => (finish = resolve)),
      );
      const { container } = render(
        <MarkdownEditor
          autofocus={false}
          documentId="/fixtures/paste.md"
          mode="sourceOnly"
          onChange={onChange}
          onImagePaste={onImagePaste}
          value=""
        />,
      );
      const view = EditorView.findFromDOM(
        container.querySelector<HTMLElement>(".cm-editor")!,
      )!;
      const data: Partial<DataTransfer> =
        representation === "files"
          ? {
              files: [
                new File(["fixture"], "capture.png", { type: "image/png" }),
              ] as unknown as FileList,
            }
          : {
              types:
                representation === "types"
                  ? ["image/tiff"]
                  : representation === "Files"
                    ? ["Files"]
                    : [],
            };
      const event = dispatchClipboardPaste(view.contentDOM, data);
      expect(event.defaultPrevented).toBe(true);
      expect(onImagePaste).toHaveBeenCalledExactlyOnceWith(
        { from: 0, to: 0 },
        representation === "files" || representation === "types"
          ? "image"
          : "native-fallback",
      );
      expect(view.state.doc.toString()).toBe("");
      expect(onChange).not.toHaveBeenCalled();
      await act(async () => finish("![](./capture.png)"));
      expect(view.state.doc.toString()).toBe("![](./capture.png)");
      act(() => {
        undo(view);
      });
      expect(view.state.doc.toString()).toBe("");
    },
  );

  it("keeps normal text paste and ignores image handling when no host callback exists", async () => {
    const onImagePaste = vi.fn();
    const onChange = vi.fn();
    const { container, rerender } = render(
      <MarkdownEditor
        documentId="/fixtures/plain.md"
        mode="sourceOnly"
        value=""
        onChange={onChange}
        onImagePaste={onImagePaste}
      />,
    );
    const content = container.querySelector<HTMLElement>(".cm-content")!;
    dispatchClipboardPaste(content, {
      types: ["text/plain", "image/png"],
      getData: (type) => (type === "text/plain" ? "ordinary text" : ""),
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("ordinary text"));
    expect(onImagePaste).not.toHaveBeenCalled();
    rerender(
      <MarkdownEditor
        documentId="/fixtures/plain.md"
        mode="sourceOnly"
        value="ordinary text"
        onChange={onChange}
      />,
    );
    dispatchClipboardPaste(content, { types: ["Files"] });
    expect(onImagePaste).not.toHaveBeenCalled();
    expect(content.textContent).toBe("ordinary text");
  });

  it("pastes a screenshot with image-only HTML and unknown item MIME after source selection changes", async () => {
    let finish!: (markdown: string) => void;
    const onChange = vi.fn();
    const onPasteError = vi.fn();
    const onImagePaste = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    const { container } = render(
      <MarkdownEditor
        documentId="/fixtures/image.md"
        mode="sourceOnly"
        value="original"
        autofocus={false}
        onChange={onChange}
        onImagePaste={onImagePaste}
        onPasteError={onPasteError}
      />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    const original = view.state.doc;
    const event = dispatchClipboardPaste(view.contentDOM, {
      items: [{ kind: "file", type: "" }] as unknown as DataTransferItemList,
      types: ["image/png", "text/html"],
      getData: (type) =>
        type === "text/html" ? '<img src="file:///fixtures/capture.png">' : "",
    });
    expect(event.defaultPrevented).toBe(true);
    expect(onImagePaste).toHaveBeenCalledExactlyOnceWith({ from: 0, to: 0 }, "image");
    act(() => view.dispatch({ selection: { anchor: 6 } }));
    expect(view.state.doc).toBe(original);
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => finish("![](./capture.png)"));
    expect(view.state.doc.toString()).toBe("![](./capture.png)original");
    expect(onPasteError).not.toHaveBeenCalled();
    act(() => undo(view));
    expect(view.state.doc.toString()).toBe("original");
  });

  it("does not erase selected source text when Save As is cancelled", async () => {
    const onChange = vi.fn();
    const onPasteError = vi.fn();
    const { container } = render(
      <MarkdownEditor
        documentId="/fixtures/cancel.md"
        mode="sourceOnly"
        value="keep this"
        onChange={onChange}
        onImagePaste={async () => ""}
        onPasteError={onPasteError}
      />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    act(() => view.dispatch({ selection: { anchor: 0, head: 9 } }));
    await act(async () => {
      dispatchClipboardPaste(view.contentDOM, { types: ["image/png"] });
    });
    expect(view.state.doc.toString()).toBe("keep this");
    expect(onChange).not.toHaveBeenCalled();
    expect(onPasteError).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "inserts a saved image once after source Save As remount and supports Undo (Strict Mode: %s)",
    async (strictMode) => {
      const onChange = vi.fn();
      const onImageInsertConsumed = vi.fn();
      const request = {
        id: 1,
        documentId: "/fixtures/saved.md",
        editorMode: "source" as const,
        markdown: "![](./capture.png)",
        expectedText: "original",
        selection: { from: 8, to: 8 },
      };
      const { container, rerender } = render(
        <MarkdownEditor
          documentId={request.documentId}
          mode="sourceOnly"
          value="original"
          onChange={onChange}
          imageInsertRequest={request}
          onImageInsertConsumed={onImageInsertConsumed}
        />,
        { wrapper: strictMode ? StrictMode : undefined },
      );
      const view = EditorView.findFromDOM(
        container.querySelector<HTMLElement>(".cm-editor")!,
      )!;
      await waitFor(() =>
        expect(view.state.doc.toString()).toBe("original![](./capture.png)"),
      );
      expect(onImageInsertConsumed).toHaveBeenCalledExactlyOnceWith(1);
      rerender(
        <MarkdownEditor
          documentId={request.documentId}
          mode="sourceOnly"
          value="original![](./capture.png)"
          onChange={onChange}
          imageInsertRequest={{ ...request }}
          onImageInsertConsumed={onImageInsertConsumed}
        />,
      );
      expect(onImageInsertConsumed).toHaveBeenCalledTimes(1);
      act(() => {
        undo(view);
      });
      expect(view.state.doc.toString()).toBe("original");
      onChange.mockClear();
      rerender(
        <MarkdownEditor
          documentId={request.documentId}
          mode="sourceOnly"
          value="new edit"
          onChange={onChange}
          imageInsertRequest={{ ...request, id: 2 }}
          onImageInsertConsumed={onImageInsertConsumed}
        />,
      );
      expect(onImageInsertConsumed).toHaveBeenLastCalledWith(2);
      expect(view.state.doc.toString()).toBe("new edit");
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("rejects a late source insertion after editing and drops results after changing documents", async () => {
    let finish!: (markdown: string) => void;
    const onImagePaste = () => new Promise<string>((resolve) => (finish = resolve));
    const onChange = vi.fn();
    const onPasteError = vi.fn();
    const { container, rerender } = render(
      <MarkdownEditor
        documentId="/fixtures/first.md"
        locale="en-US"
        mode="sourceOnly"
        value="old"
        onChange={onChange}
        onImagePaste={onImagePaste}
        onPasteError={onPasteError}
      />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    dispatchClipboardPaste(view.contentDOM, { types: ["image/png"] });
    act(() => view.dispatch({ changes: { from: 0, to: 3, insert: "new text" } }));
    await act(async () => finish("![](./capture.png)"));
    expect(view.state.doc.toString()).toBe("new text");
    expect(onPasteError).toHaveBeenCalledWith(expect.stringContaining("document changed"));
    onChange.mockClear();
    onPasteError.mockClear();
    dispatchClipboardPaste(view.contentDOM, { types: ["image/png"] });
    rerender(
      <MarkdownEditor
        documentId="/fixtures/second.md"
        mode="sourceOnly"
        value="second"
        onChange={onChange}
        onImagePaste={onImagePaste}
        onPasteError={onPasteError}
      />,
    );
    await act(async () => finish("![](./capture.png)"));
    expect(container.querySelector(".cm-content")?.textContent).toBe("second");
    expect(onChange).not.toHaveBeenCalled();
    expect(onPasteError).not.toHaveBeenCalled();
  });

  it("restores and reports the tab-specific selection and scroll position", async () => {
    const onViewChange = vi.fn();
    const onRevealConsumed = vi.fn();
    const value = `${"正文内容\n".repeat(160)}目标标题\n`;
    const selectionFrom = value.indexOf("目标标题");
    const { container, rerender } = render(
      <MarkdownEditor
        autofocus={false}
        documentId="view-state"
        initialView={{ scrollTop: 420, selectionFrom, selectionTo: selectionFrom + 2 }}
        mode="normal"
        presentationMode="source"
        onChange={vi.fn()}
        onRevealConsumed={onRevealConsumed}
        onViewChange={onViewChange}
        value={value}
      />,
    );
    const editor = container.querySelector<HTMLElement>(".cm-editor");
    if (!editor) throw new Error("CodeMirror editor was not mounted");
    const view = EditorView.findFromDOM(editor);
    if (!view) throw new Error("CodeMirror view was not found");

    await waitFor(() => expect(view.scrollDOM.scrollTop).toBe(420));
    expect(view.state.selection.main).toMatchObject({
      from: selectionFrom,
      to: selectionFrom + 2,
    });

    view.scrollDOM.scrollTop = 610;
    fireEvent.scroll(view.scrollDOM);
    await waitFor(() =>
      expect(onViewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scrollTop: 610,
          selectionFrom,
          selectionTo: selectionFrom + 2,
        }),
      ),
    );
    const revealPosition = value.indexOf("正文内容", 30);
    rerender(
      <MarkdownEditor
        autofocus={false}
        documentId="view-state"
        initialView={{ scrollTop: 420, selectionFrom, selectionTo: selectionFrom + 2 }}
        mode="normal"
        presentationMode="source"
        onChange={vi.fn()}
        onRevealConsumed={onRevealConsumed}
        onViewChange={onViewChange}
        reveal={{ position: revealPosition, requestId: 1 }}
        value={value}
      />,
    );
    await waitFor(() =>
      expect(view.state.selection.main).toMatchObject({
        from: revealPosition,
        to: revealPosition,
      }),
    );
    expect(onRevealConsumed).toHaveBeenCalledOnce();
    expect(onRevealConsumed).toHaveBeenCalledWith(1);

    view.scrollDOM.scrollTop = 735;
    rerender(
      <MarkdownEditor
        autofocus={false}
        documentId="view-state"
        initialView={{ scrollTop: 420, selectionFrom, selectionTo: selectionFrom + 2 }}
        mode="normal"
        presentationMode="source"
        onChange={vi.fn()}
        onRevealConsumed={onRevealConsumed}
        onViewChange={onViewChange}
        reveal={{ position: revealPosition, requestId: 1 }}
        value={value}
      />,
    );
    expect(view.scrollDOM.scrollTop).toBe(735);
    expect(onRevealConsumed).toHaveBeenCalledOnce();
  });

  it("uses a stable visual surface by default and source only when requested", async () => {
    const value = [
      "# 标题",
      "",
      "| 阶段 | 时间 |",
      "| --- | --- |",
      "| 起稿 | 15 分钟 |",
    ].join("\n");
    const { container, rerender } = render(
      <MarkdownEditor
        autofocus={false}
        documentId="mode-switch"
        mode="normal"
        onChange={vi.fn()}
        value={value}
      />,
    );

    await waitFor(() =>
      expect(container.querySelector(".milkdown-table-block table")).toBeTruthy(),
    );
    expect(container.querySelector(".cm-editor")).toBeNull();

    rerender(
      <MarkdownEditor
        autofocus={false}
        documentId="mode-switch"
        mode="normal"
        onChange={vi.fn()}
        presentationMode="source"
        value={value}
      />,
    );
    expect(container.querySelector(".cm-editor")).toBeTruthy();

    rerender(
      <MarkdownEditor
        autofocus={false}
        documentId="mode-switch"
        mode="sourceOnly"
        onChange={vi.fn()}
        presentationMode="visual"
        value={value}
      />,
    );
    expect(container.querySelector(".cm-editor")).toBeTruthy();
  });

  it("carries a semantic reading position across explicit source and visual switches", async () => {
    const value = Array.from({ length: 90 }, (_, index) =>
      index === 72
        ? "## 目标章节\n\n这里是切换模式后仍应看到的目标内容。"
        : `## 章节 ${index}\n\n第 ${index} 段普通正文。`,
    ).join("\n\n");
    const target = value.indexOf("切换模式后仍应看到");
    const onViewChange = vi.fn();
    const { container, rerender } = render(
      <MarkdownEditor
        autofocus={false}
        documentId="semantic-mode-switch"
        initialView={{ scrollTop: 0, selectionFrom: target, selectionTo: target }}
        mode="normal"
        onChange={vi.fn()}
        onViewChange={onViewChange}
        presentationMode="source"
        value={value}
      />,
    );

    await waitFor(() =>
      expect(onViewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          semanticPosition: expect.objectContaining({
            headingText: "目标章节",
          }),
        }),
      ),
    );
    const sourceReportCount = onViewChange.mock.calls.length;

    rerender(
      <MarkdownEditor
        autofocus={false}
        documentId="semantic-mode-switch"
        initialView={{ scrollTop: 0, selectionFrom: 0, selectionTo: 0 }}
        mode="normal"
        onChange={vi.fn()}
        onViewChange={onViewChange}
        presentationMode="visual"
        value={value}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector(".visual-markdown-editor .ProseMirror")).toBeTruthy(),
    );
    await waitFor(() => {
      expect(onViewChange.mock.calls.length).toBeGreaterThan(sourceReportCount);
      const snapshot = onViewChange.mock.calls.at(-1)?.[0];
      expect(snapshot.selectionFrom).toBeGreaterThan(100);
      expect(snapshot.semanticPosition.headingText).toBe("目标章节");
    });

    rerender(
      <MarkdownEditor
        autofocus={false}
        documentId="semantic-mode-switch"
        initialView={{ scrollTop: 0, selectionFrom: 0, selectionTo: 0 }}
        mode="normal"
        onChange={vi.fn()}
        onViewChange={onViewChange}
        presentationMode="source"
        value={value}
      />,
    );
    const source = await waitFor(() => {
      const mounted = container.querySelector<HTMLElement>(".cm-editor");
      expect(mounted).toBeTruthy();
      return mounted!;
    });
    const sourceView = EditorView.findFromDOM(source);
    if (!sourceView) throw new Error("Source editor was not mounted");
    await waitFor(() => expect(sourceView.state.selection.main.from).toBeGreaterThan(100));
  }, 20_000);

  it.each([
    { firstMode: "visual" as const, strict: false },
    { firstMode: "source" as const, strict: false },
    { firstMode: "visual" as const, strict: true },
    { firstMode: "source" as const, strict: true },
  ])(
    "restores the original $firstMode reading position and range after a mode round trip (Strict Mode: $strict)",
    async ({ firstMode, strict }) => {
      const value = Array.from(
        { length: 40 },
        (_, index) => `## Section ${index}\n\nParagraph ${index} has distinctive content.`,
      ).join("\n\n");
      const visualViews = new Set<VisualEditorView>();
      const updateState = VisualEditorView.prototype.updateState;
      vi.spyOn(VisualEditorView.prototype, "updateState").mockImplementation(function (
        this: VisualEditorView,
        state,
      ) {
        updateState.call(this, state);
        visualViews.add(this);
      });
      const onChange = vi.fn();
      const onViewChange = vi.fn();
      const renderMode = (presentationMode: "visual" | "source") => (
        <MarkdownEditor
          autofocus={false}
          documentId="/fixtures/mode-round-trip.md"
          initialView={{ scrollTop: 0, selectionFrom: 0, selectionTo: 0 }}
          mode="normal"
          onChange={onChange}
          onViewChange={onViewChange}
          presentationMode={presentationMode}
          value={value}
        />
      );
      const { container, rerender } = render(renderMode(firstMode), {
        wrapper: strict ? StrictMode : undefined,
      });
      const findVisual = () => {
        const dom = container.querySelector(".ProseMirror");
        return [...visualViews].find((view) => view.dom === dom);
      };
      const findSource = () => {
        const dom = container.querySelector<HTMLElement>(".cm-editor");
        return dom ? EditorView.findFromDOM(dom) : null;
      };
      await waitFor(() => expect(onViewChange).toHaveBeenCalled());
      let from = value.indexOf("Paragraph 30") + 3;
      if (firstMode === "visual") {
        const view = findVisual()!;
        view.state.doc.descendants((node, position) => {
          if (node.isText && node.text?.includes("Paragraph 30")) from = position + 3;
        });
        act(() =>
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(view.state.doc, from, from + 6),
            ),
          ),
        );
      } else {
        act(() => findSource()!.dispatch({ selection: { anchor: from, head: from + 6 } }));
      }
      const scroller =
        firstMode === "source"
          ? findSource()!.scrollDOM
          : container.querySelector<HTMLElement>(".visual-markdown-editor")!;
      scroller.scrollTop = 740;
      fireEvent.scroll(scroller);
      await waitFor(() =>
        expect(onViewChange).toHaveBeenLastCalledWith(
          expect.objectContaining({
            scrollTop: 740,
            selectionFrom: from,
            selectionTo: from + 6,
          }),
        ),
      );
      const initialCount = onViewChange.mock.calls.length;
      rerender(renderMode(firstMode === "visual" ? "source" : "visual"));
      await waitFor(() =>
        expect(onViewChange.mock.calls.length).toBeGreaterThan(initialCount),
      );
      rerender(renderMode(firstMode));
      await waitFor(() => {
        const view = firstMode === "source" ? findSource() : findVisual();
        expect(view).toBeTruthy();
        const selection =
          view instanceof EditorView ? view.state.selection.main : view!.state.selection;
        expect(selection).toMatchObject({ from, to: from + 6 });
        const restoredScroll =
          view instanceof EditorView
            ? view.scrollDOM
            : container.querySelector<HTMLElement>(".visual-markdown-editor")!;
        expect(restoredScroll.scrollTop).toBe(740);
      });
      expect(onChange).not.toHaveBeenCalled();
      const source = findSource();
      if (source) act(() => expect(undo(source)).toBe(false));
      else {
        const visual = findVisual()!;
        act(() => expect(undoVisual(visual.state, visual.dispatch)).toBe(false));
      }
    },
    20_000,
  );

  it.each([
    { strict: false, destinationReady: false },
    { strict: false, destinationReady: true },
    { strict: true, destinationReady: false },
    { strict: true, destinationReady: true },
  ])(
    "captures the last visual scroll and range before an immediate mode switch (Strict Mode: $strict, destination ready: $destinationReady)",
    async ({ strict, destinationReady }) => {
      const value = "# Start\n\nfirst\n\n## Destination\n\ncontinue reading here\n";
      const visual: { current?: VisualEditorView } = {};
      const updateState = VisualEditorView.prototype.updateState;
      vi.spyOn(VisualEditorView.prototype, "updateState").mockImplementation(function (
        this: VisualEditorView,
        state,
      ) {
        updateState.call(this, state);
        visual.current = this;
      });
      const onChange = vi.fn();
      const onViewChange = vi.fn();
      const renderMode = (presentationMode: "visual" | "source") => (
        <MarkdownEditor
          autofocus={false}
          documentId="/fixtures/rapid-mode-switch.md"
          mode="normal"
          onChange={onChange}
          onViewChange={onViewChange}
          presentationMode={presentationMode}
          value={value}
        />
      );
      const { container, rerender } = render(renderMode("visual"), {
        wrapper: strict ? StrictMode : undefined,
      });
      await waitFor(() => expect(onViewChange).toHaveBeenCalled());
      const from = visual.current!.state.doc.content.size - "continue reading here".length;
      const frames = new Map<number, FrameRequestCallback>();
      let frameId = 0;
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
        frames.set(++frameId, callback);
        return frameId;
      });
      vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) =>
        frames.delete(id),
      );
      const scroller = container.querySelector<HTMLElement>(".visual-markdown-editor")!;
      act(() => {
        visual.current!.dispatch(
          visual.current!.state.tr.setSelection(
            TextSelection.create(visual.current!.state.doc, from, from + 4),
          ),
        );
        scroller.scrollTop = 915;
        scroller.dispatchEvent(new Event("scroll"));
      });
      // No animation frame has run: a toolbar click may unmount this view now.
      expect(onViewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scrollTop: 915,
          selectionFrom: from,
          selectionTo: from + 4,
        }),
      );
      rerender(renderMode("source"));
      const source = EditorView.findFromDOM(
        container.querySelector<HTMLElement>(".cm-editor")!,
      )!;
      expect(source.state.selection.main.from).toBeGreaterThan(
        value.indexOf("## Destination"),
      );
      if (destinationReady) {
        act(() => {
          for (const [id, callback] of [...frames]) {
            frames.delete(id);
            callback(performance.now());
          }
        });
      }
      rerender(renderMode("visual"));
      await waitFor(() => expect(container.querySelector(".ProseMirror")).toBeTruthy());
      act(() => {
        for (const [id, callback] of [...frames]) {
          frames.delete(id);
          callback(performance.now());
        }
      });
      expect(visual.current!.state.selection).toMatchObject({ from, to: from + 4 });
      expect(
        container.querySelector<HTMLElement>(".visual-markdown-editor")!.scrollTop,
      ).toBe(915);
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("invalidates old surface positions after the Markdown changes in the other mode", async () => {
    const original =
      "# Beginning\n\nold position\n\n## Destination\n\nnew reading location\n";
    const onChange = vi.fn();
    const onViewChange = vi.fn();
    const visual: { current?: VisualEditorView } = {};
    const updateState = VisualEditorView.prototype.updateState;
    vi.spyOn(VisualEditorView.prototype, "updateState").mockImplementation(function (
      this: VisualEditorView,
      state,
    ) {
      updateState.call(this, state);
      visual.current = this;
    });
    function ControlledEditor({ mode }: { mode: "visual" | "source" }) {
      const [value, setValue] = useState(original);
      return (
        <MarkdownEditor
          autofocus={false}
          documentId="/fixtures/changed-mode-position.md"
          initialView={{ scrollTop: 0, selectionFrom: 1, selectionTo: 1 }}
          mode="normal"
          presentationMode={mode}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
          onViewChange={onViewChange}
          value={value}
        />
      );
    }
    const { container, rerender } = render(<ControlledEditor mode="visual" />);
    await waitFor(() => expect(onViewChange).toHaveBeenCalled());
    rerender(<ControlledEditor mode="source" />);
    const source = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    await waitFor(() => expect(onViewChange).toHaveBeenCalledTimes(2));
    const prefix = "A newly added paragraph before the existing content.\n\n";
    const position = original.indexOf("new reading location") + prefix.length;
    act(() =>
      source.dispatch({
        changes: { from: 0, insert: prefix },
        selection: { anchor: position },
      }),
    );
    expect(onChange).toHaveBeenCalledOnce();
    const count = onViewChange.mock.calls.length;
    rerender(<ControlledEditor mode="visual" />);
    await waitFor(() => expect(onViewChange.mock.calls.length).toBeGreaterThan(count));
    expect(visual.current!.state.selection.$from.parent.textContent).toBe(
      "new reading location",
    );
    expect(onViewChange.mock.calls.at(-1)?.[0].semanticPosition.headingText).toBe(
      "Destination",
    );
    expect(onChange).toHaveBeenCalledOnce();
    act(() =>
      expect(undoVisual(visual.current!.state, visual.current!.dispatch)).toBe(false),
    );
  });

  it("uses the visible source reading point rather than CodeMirror's overscan midpoint", async () => {
    const value = Array.from(
      { length: 50 },
      (_, index) => `## Section ${index}\n\nParagraph ${index}.`,
    ).join("\n\n");
    const onViewChange = vi.fn();
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        autofocus={false}
        documentId="/fixtures/source-viewport.md"
        mode="normal"
        presentationMode="source"
        onChange={onChange}
        onViewChange={onViewChange}
        value={value}
      />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    await waitFor(() => expect(onViewChange).toHaveBeenCalled());
    act(() => view.dispatch({ selection: { anchor: 3, head: 6 } }));
    vi.spyOn(view.scrollDOM, "getBoundingClientRect").mockReturnValue(
      new DOMRect(40, 80, 700, 500),
    );
    const position = value.indexOf("Paragraph 35");
    const coordinates = vi.spyOn(view, "posAtCoords").mockReturnValue(position);
    view.scrollDOM.scrollTop = 950;
    fireEvent.scroll(view.scrollDOM);
    expect(coordinates).toHaveBeenCalledWith({ x: 390, y: 260 });
    expect(onViewChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scrollTop: 950,
        selectionFrom: 3,
        selectionTo: 6,
        semanticPosition: expect.objectContaining({ headingText: "Section 35" }),
      }),
    );
    expect(onChange).not.toHaveBeenCalled();
    act(() => expect(undo(view)).toBe(false));
  });
});
