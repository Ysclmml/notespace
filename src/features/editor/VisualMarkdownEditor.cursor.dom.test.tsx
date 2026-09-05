import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { GapCursor } from "@milkdown/kit/prose/gapcursor";
import { closeHistory, redo, undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { beforeAll, expect, it, vi } from "vitest";
import { VisualMarkdownEditor } from "./VisualMarkdownEditor";
import {
  installCodeMirrorDomMeasurementStubs,
  installImmediateIntersectionObserverStub,
} from "./spike/domTestSupport";

beforeAll(() => {
  installCodeMirrorDomMeasurementStubs();
  installImmediateIntersectionObserverStub();
});

async function renderEditor(value: string) {
  const views = new Set<EditorView>();
  const update = EditorView.prototype.updateState;
  vi.spyOn(EditorView.prototype, "updateState").mockImplementation(function (
    this: EditorView,
    state,
  ) {
    update.call(this, state);
    views.add(this);
  });
  const onChange = vi.fn();
  const onViewChange = vi.fn();
  const { container } = render(
    <VisualMarkdownEditor
      autofocus={false}
      documentId="/fixtures/native-cursor.md"
      value={value}
      onChange={onChange}
      onViewChange={onViewChange}
    />,
  );
  await waitFor(() => expect(onViewChange).toHaveBeenCalled());
  const view = [...views].find(
    (candidate) => candidate.dom === container.querySelector(".ProseMirror"),
  )!;
  expect(view).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
  return { view, onChange };
}

it("keeps the first content block stable when composition selections expand and collapse", async () => {
  const { view, onChange } = await renderEditor("# Heading\n\nTyping paragraph\n");
  const heading = view.dom.querySelector("h1")!;
  const firstBlockMargin = getComputedStyle(heading).marginTop;
  let from = -1;
  view.state.doc.descendants((node, position) => {
    if (node.isText && node.text === "Typing paragraph") from = position;
  });
  expect(from).toBeGreaterThan(0);
  const expectStableFirstBlock = () => {
    // A widget at document position zero used to toggle this CSS relationship.
    // Removing it for a nonempty preedit selection changed the heading margin
    // and moved every later paragraph before PM restored the scroll position.
    expect(view.dom.firstElementChild).toBe(heading);
    expect(heading.matches(":first-child")).toBe(true);
    expect(getComputedStyle(heading).marginTop).toBe(firstBlockMargin);
    expect(view.dom.querySelector(".prosemirror-virtual-cursor")).toBeNull();
    expect(view.dom.classList.contains("virtual-cursor-enabled")).toBe(false);
  };
  expectStableFirstBlock();
  fireEvent.compositionStart(view.dom);
  expect(view.composing).toBe(true);
  // This exercises the PM selection/decorations path observed during Sogou
  // preedit. Actual operating-system marked-text scrolling needs a native test.
  for (const [anchor, head] of [
    [from, from + 2],
    [from + 2, from + 2],
    [from + 2, from + 5],
    [from + 5, from + 5],
  ] as const) {
    act(() => {
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)),
      );
      view.updateState(view.state);
    });
    expectStableFirstBlock();
  }
  fireEvent.compositionEnd(view.dom);
  await act(
    async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expectStableFirstBlock();
  expect(onChange).not.toHaveBeenCalled();
});

it("retains native mark insertion, Undo/Redo, gap cursor and drop support", async () => {
  const { view } = await renderEditor(
    "left **bold** right\n\nleft *italic* right\n\nleft `code` right\n\n---\n\n---\n",
  );
  expect(
    view.state.plugins.some(
      (plugin) =>
        "key" in plugin &&
        typeof plugin.key === "string" &&
        plugin.key.startsWith("prosemirror-drop-indicator"),
    ),
  ).toBe(true);
  const original = view.state.doc;
  for (const { text, mark, endKeepsMark } of [
    { text: "bold", mark: "strong", endKeepsMark: true },
    { text: "italic", mark: "emphasis", endKeepsMark: true },
    { text: "code", mark: "inlineCode", endKeepsMark: false },
  ]) {
    let from = -1;
    view.state.doc.descendants((node, position) => {
      if (node.isText && node.text === text) from = position;
    });
    expect(from).toBeGreaterThan(0);
    for (const boundary of ["inside", "end"] as const) {
      const position = from + (boundary === "inside" ? 1 : text.length);
      act(() => {
        view.dispatch(
          view.state.tr
            .setSelection(TextSelection.create(view.state.doc, position))
            .setStoredMarks(null),
        );
        view.dispatch(closeHistory(view.state.tr).insertText("X"));
      });
      const marks = view.state.doc.nodeAt(position)!.marks.map((item) => item.type.name);
      expect(marks.includes(mark)).toBe(boundary === "inside" || endKeepsMark);
      act(() => expect(undo(view.state, view.dispatch)).toBe(true));
      expect(view.state.doc.eq(original)).toBe(true);
      act(() => expect(redo(view.state, view.dispatch)).toBe(true));
      expect(view.state.doc.nodeAt(position)!.text?.includes("X")).toBe(true);
      act(() => expect(undo(view.state, view.dispatch)).toBe(true));
    }
  }
  const rules: number[] = [];
  view.state.doc.descendants((node, position) => {
    if (node.type.name === "hr") rules.push(position);
  });
  expect(rules).toHaveLength(2);
  const gap = view.state.doc.resolve(rules[1]!);
  act(() => view.dispatch(view.state.tr.setSelection(new GapCursor(gap))));
  expect(view.dom.querySelector(".ProseMirror-gapcursor")).toBeTruthy();
});
