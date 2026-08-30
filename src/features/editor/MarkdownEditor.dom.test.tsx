import { fireEvent, render, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "./MarkdownEditor";
import { LARGE_PASTE_TEXT_THRESHOLD } from "./pasteGuard";
import { installCodeMirrorDomMeasurementStubs } from "./spike/domTestSupport";

beforeAll(() => installCodeMirrorDomMeasurementStubs());

describe("MarkdownEditor DOM integration", () => {
  it("rejects a large inline image before creating an editor transaction", () => {
    const onChange = vi.fn();
    const onPasteRejected = vi.fn();
    const { container } = render(
      <MarkdownEditor
        autofocus={false}
        documentId="paste-test"
        mode="normal"
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
    const value = `${"正文内容\n".repeat(160)}目标标题\n`;
    const selectionFrom = value.indexOf("目标标题");
    const { container, rerender } = render(
      <MarkdownEditor
        autofocus={false}
        documentId="view-state"
        initialView={{ scrollTop: 420, selectionFrom, selectionTo: selectionFrom + 2 }}
        mode="normal"
        onChange={vi.fn()}
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
      expect(onViewChange).toHaveBeenLastCalledWith({
        scrollTop: 610,
        selectionFrom,
        selectionTo: selectionFrom + 2,
      }),
    );

    const revealPosition = value.indexOf("正文内容", 30);
    rerender(
      <MarkdownEditor
        autofocus={false}
        documentId="view-state"
        initialView={{ scrollTop: 420, selectionFrom, selectionTo: selectionFrom + 2 }}
        mode="normal"
        onChange={vi.fn()}
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
  });
});
