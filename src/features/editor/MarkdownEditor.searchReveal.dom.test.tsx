import { act, cleanup, render, waitFor } from "@testing-library/react";
import { EditorView as CodeMirrorView } from "@codemirror/view";
import { EditorView as VisualView } from "@milkdown/kit/prose/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MarkdownEditor, type EditorRevealRequest } from "./MarkdownEditor";
import { semanticPositionFromMarkdown } from "./semanticPosition";
import {
  installCodeMirrorDomMeasurementStubs,
  installImmediateIntersectionObserverStub,
} from "./spike/domTestSupport";

beforeAll(() => installCodeMirrorDomMeasurementStubs());
beforeAll(() => installImmediateIntersectionObserverStub());
afterEach(cleanup);

describe("Markdown workspace search reveal", () => {
  it.each([false, true])(
    "maps a source match past Markdown syntax without stealing another split's focus (request focus=%s)",
    async (focus) => {
      const value =
        "# Search fixture\n\n[Reference](https://example.test/a-long-url-that-is-not-visible-in-the-editor)\n\n**前文** 与目标文字在同一段落。\n";
      const sourcePosition = value.indexOf("目标文字");
      const views = new Set<VisualView>();
      const original = VisualView.prototype.updateState;
      vi.spyOn(VisualView.prototype, "updateState").mockImplementation(function (
        this: VisualView,
        state,
      ) {
        original.call(this, state);
        views.add(this);
      });
      const onChange = vi.fn();
      const consumed = vi.fn();
      const surface = (reveal?: EditorRevealRequest) => (
        <>
          <MarkdownEditor
            autofocus={false}
            documentId="/search-fixtures/visual.md"
            mode="normal"
            onChange={onChange}
            onRevealConsumed={consumed}
            value={value}
            reveal={reveal}
          />
          <button type="button">Other split</button>
        </>
      );
      const { container, getByRole, rerender } = render(surface());
      const view = await waitFor(() => {
        const element = container.querySelector(".ProseMirror");
        const result = [...views].find((candidate) => candidate.dom === element);
        expect(result).toBeDefined();
        return result!;
      });
      let target = -1;
      view.state.doc.descendants((node, position) => {
        if (node.isText && node.text?.includes("目标文字"))
          target = position + node.text.indexOf("目标文字");
      });
      expect(target).toBeGreaterThan(0);
      expect(target).not.toBe(sourcePosition);
      const otherSplit = getByRole("button", { name: "Other split" });
      act(() => otherSplit.focus());
      rerender(
        surface({
          position: sourcePosition,
          semanticPosition: semanticPositionFromMarkdown(value, sourcePosition),
          focus,
          requestId: 1,
        }),
      );
      await waitFor(() => expect(consumed).toHaveBeenCalledExactlyOnceWith(1));
      expect(view.state.selection.from).toBe(target);
      expect(otherSplit).toHaveFocus();
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("repositions source without focus when requested and retains explicit focused navigation", async () => {
    const value = "# Source search\n\nFirst line\n目标文字\n";
    const position = value.indexOf("目标文字");
    const onChange = vi.fn();
    const consumed = vi.fn();
    const surface = (reveal?: EditorRevealRequest, autofocus = false) => (
      <>
        <MarkdownEditor
          autofocus={autofocus}
          documentId="/search-fixtures/source.md"
          mode="normal"
          presentationMode="source"
          onChange={onChange}
          onRevealConsumed={consumed}
          value={value}
          reveal={reveal}
        />
        <button type="button">Other split</button>
      </>
    );
    const { container, getByRole, rerender } = render(surface());
    const view = CodeMirrorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    const otherSplit = getByRole("button", { name: "Other split" });
    act(() => otherSplit.focus());
    rerender(surface({ position, focus: false, requestId: 1 }));
    await waitFor(() => expect(consumed).toHaveBeenCalledWith(1));
    expect(view.state.selection.main.from).toBe(position);
    expect(otherSplit).toHaveFocus();
    rerender(surface({ position: 1, focus: true, requestId: 2 }));
    await waitFor(() => expect(consumed).toHaveBeenCalledWith(2));
    expect(view.state.selection.main.from).toBe(1);
    expect(otherSplit).toHaveFocus();
    rerender(surface({ position: 2, focus: true, requestId: 3 }, true));
    await waitFor(() => expect(consumed).toHaveBeenCalledWith(3));
    expect(view.state.selection.main.from).toBe(2);
    expect(view.contentDOM).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });
});
