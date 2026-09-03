import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { undo } from "@codemirror/commands";
import { forceParsing } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "./MarkdownEditor";
import { LARGE_PASTE_TEXT_THRESHOLD } from "./pasteGuard";
import { installCodeMirrorDomMeasurementStubs } from "./spike/domTestSupport";

beforeAll(() => installCodeMirrorDomMeasurementStubs());

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

  it("rejects a large inline image before creating an editor transaction", () => {
    const onChange = vi.fn();
    const onPasteRejected = vi.fn();
    const { container } = render(
      <MarkdownEditor
        autofocus={false}
        documentId="paste-test"
        mode="normal"
        presentationMode="source"
        onChange={onChange}
        onPasteRejected={onPasteRejected}
        value="# 原文\n"
      />,
    );
    const content = container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("CodeMirror content was not mounted");

    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: () =>
          "data:image/png;base64," + "A".repeat(LARGE_PASTE_TEXT_THRESHOLD + 1),
        items: [],
      },
    });
    fireEvent(content, paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(onPasteRejected).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

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
});
