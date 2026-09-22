import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { EditorView as SourceView } from "@codemirror/view";
import { closeHistory, redo, undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { useState } from "react";
import { beforeAll, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";
import { VISUAL_EDITOR_COMMAND_EVENT, VisualMarkdownEditor } from "./VisualMarkdownEditor";
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
  const update = EditorView.prototype.updateState;
  vi.spyOn(EditorView.prototype, "updateState").mockImplementation(function (
    this: EditorView,
    state,
  ) {
    update.call(this, state);
    views.add(this);
  });
  return (container: HTMLElement) =>
    [...views].find((view) => view.dom === container.querySelector(".ProseMirror"));
}

async function renderEditor(value: string) {
  const findView = captureView();
  const onChange = vi.fn();
  const onViewChange = vi.fn();
  const result = render(
    <VisualMarkdownEditor
      autofocus={false}
      documentId="/fixtures/asterisks.md"
      value={value}
      onChange={onChange}
      onViewChange={onViewChange}
    />,
  );
  await waitFor(() => expect(onViewChange).toHaveBeenCalled());
  expect(onChange).not.toHaveBeenCalled();
  return { ...result, view: findView(result.container)!, onChange };
}

function selectText(view: EditorView, text: string, selectAll = false) {
  let from = -1;
  view.state.doc.descendants((node, position) => {
    if (from < 0 && node.isText && node.text?.includes(text)) {
      from = position + node.text.indexOf(text);
    }
  });
  expect(from).toBeGreaterThanOrEqual(0);
  const end = from + text.length;
  act(() => {
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, selectAll ? from : end, end),
      ),
    );
  });
}

function typeText(view: EditorView, text: string) {
  for (const character of text) {
    act(() => {
      const { from, to } = view.state.selection;
      const insert = () => view.state.tr.insertText(character, from, to);
      // Exercise the real input-rule pipeline, then the browser's normal
      // insertion fallback. A direct insertText alone bypasses this bug.
      const handled = view.someProp("handleTextInput", (handler) =>
        handler(view, from, to, character, insert),
      );
      if (!handled) view.dispatch(insert());
    });
  }
}

it("opts out of automatic capitalization and correction without changing typed case", async () => {
  const { view } = await renderEditor("");
  expect(view.dom).toHaveAttribute("autocapitalize", "off");
  expect(view.dom).toHaveAttribute("autocorrect", "off");
  typeText(view, "algorithm. next MixedCASE");
  expect(view.state.doc.textContent).toBe("algorithm. next MixedCASE");
});

it.each([
  { markdown: "- Ab * a", prefix: "Ab * a", suffix: "* b * c", selector: "li p" },
  { markdown: "Ab * a", prefix: "Ab * a", suffix: "* b * c", selector: "p" },
  { markdown: "a*b", prefix: "a*b", suffix: "*c*d", selector: "p" },
  {
    markdown: "维度 = 批量 * 长度",
    prefix: "维度 = 批量 * 长度",
    suffix: " * 通道",
    selector: "p",
  },
  {
    markdown: "| Expression |\n| --- |\n| Ab * a |",
    prefix: "Ab * a",
    suffix: "* b",
    selector: "td p",
  },
  { markdown: "*literal", prefix: "*literal", suffix: "*", selector: "p" },
])(
  "keeps multiplication and literal stars while typing $markdown",
  async ({ markdown, prefix, suffix, selector }) => {
    const { view, onChange } = await renderEditor(markdown);
    selectText(view, prefix);
    let expected = prefix;
    for (const character of suffix) {
      typeText(view, character);
      expected += character;
      expect(view.dom.querySelector(selector)?.textContent).toBe(expected);
      expect(view.dom.querySelector("em, strong")).toBeNull();
      expect(view.state.selection.$from.parent.textContent).toBe(expected);
      expect(onChange).toHaveBeenCalled();
    }
  },
);

it("still creates a list from a leading star and keeps multiplication inside the item", async () => {
  const { view } = await renderEditor("");
  typeText(view, "* ");
  expect(view.dom.querySelector("li p")).toBeTruthy();
  typeText(view, "a*b*c");
  expect(view.dom.querySelector("li p")).toHaveTextContent("a*b*c");
  expect(view.dom.querySelector("em")).toBeNull();
});

it("keeps the star through Undo/Redo and the composition-end input rules", async () => {
  const { view } = await renderEditor("- Ab * a");
  selectText(view, "Ab * a");
  const original = view.state.doc;
  act(() => view.dispatch(closeHistory(view.state.tr)));
  typeText(view, "*");
  const edited = view.state.doc;
  expect(edited.textContent).toBe("Ab * a*");
  act(() => expect(undo(view.state, view.dispatch)).toBe(true));
  expect(view.state.doc.eq(original)).toBe(true);
  act(() => expect(redo(view.state, view.dispatch)).toBe(true));
  expect(view.state.doc.eq(edited)).toBe(true);
  fireEvent.compositionStart(view.dom);
  fireEvent.compositionEnd(view.dom);
  await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 50)));
  expect(view.state.doc.eq(edited)).toBe(true);
  expect(view.dom.querySelector("em")).toBeNull();
});

it("preserves explicit italic commands, existing Markdown emphasis and bold input", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const { view } = await renderEditor("*existing italic*\n\nformat me\n\n**bold");
  expect(view.dom.querySelector("em")).toHaveTextContent("existing italic");
  selectText(view, "format me", true);
  act(() => view.focus());
  fireEvent.keyDown(view.dom, { key: "i", code: "KeyI", metaKey: true });
  expect([...view.dom.querySelectorAll("em")].map((node) => node.textContent)).toEqual([
    "existing italic",
    "format me",
  ]);
  fireEvent(
    view.dom,
    new CustomEvent(VISUAL_EDITOR_COMMAND_EVENT, {
      bubbles: true,
      cancelable: true,
      detail: { command: "toggleItalic" },
    }),
  );
  expect(view.dom.querySelectorAll("em")).toHaveLength(1);
  selectText(view, "**bold");
  typeText(view, "**");
  expect(view.dom.querySelector("strong")).toHaveTextContent("bold");
});

it("preserves typed stars through source mode and reopening serialized Markdown", async () => {
  const findView = captureView();
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState("- a*b");
    const [mode, setMode] = useState<"visual" | "source">("visual");
    return (
      <>
        <button onClick={() => setMode(mode === "visual" ? "source" : "visual")}>
          Toggle
        </button>
        <MarkdownEditor
          autofocus={false}
          documentId="/fixtures/roundtrip-stars.md"
          mode="normal"
          presentationMode={mode}
          value={value}
          onChange={(text) => {
            setValue(text);
            onChange(text);
          }}
        />
      </>
    );
  }
  const { container, getByText, unmount } = render(<Harness />);
  await waitFor(() => expect(findView(container)).toBeTruthy());
  await act(
    async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(onChange).not.toHaveBeenCalled();
  const view = findView(container)!;
  selectText(view, "a*b");
  typeText(view, "*c");
  expect(view.dom.querySelector("li p")).toHaveTextContent("a*b*c");
  const serialized = onChange.mock.lastCall![0] as string;
  fireEvent.click(getByText("Toggle"));
  const source = SourceView.findFromDOM(
    container.querySelector<HTMLElement>(".cm-editor")!,
  )!;
  expect(source.state.doc.toString()).toBe(serialized);
  expect(source.contentDOM).toHaveAttribute("autocapitalize", "off");
  expect(source.contentDOM).toHaveAttribute("autocorrect", "off");
  onChange.mockClear();
  fireEvent.click(getByText("Toggle"));
  expect(findView(container)).toBe(view);
  expect(view.dom).toHaveAttribute("autocapitalize", "off");
  expect(view.dom.querySelector("li p")).toHaveTextContent("a*b*c");
  expect(view.dom.querySelector("em")).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  unmount();
  const reopened = await renderEditor(serialized);
  expect(reopened.view.dom.querySelector("li p")).toHaveTextContent("a*b*c");
  expect(reopened.view.dom.querySelector("em")).toBeNull();
});
