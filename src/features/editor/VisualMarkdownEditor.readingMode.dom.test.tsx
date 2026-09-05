import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { EditorView as CodeMirrorView } from "@codemirror/view";
import { undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { beforeAll, expect, it, vi } from "vitest";
import {
  VisualMarkdownEditor,
  VISUAL_EDITOR_COMMAND_EVENT,
  type VisualMarkdownEditorProps,
} from "./VisualMarkdownEditor";
import {
  installCodeMirrorDomMeasurementStubs,
  installImmediateIntersectionObserverStub,
} from "./spike/domTestSupport";

beforeAll(() => {
  installCodeMirrorDomMeasurementStubs();
  installImmediateIntersectionObserverStub();
});

async function renderEditor(props: Partial<VisualMarkdownEditorProps> = {}) {
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
  const initial = {
    autofocus: false,
    documentId: "/fixtures/reading.md",
    value: "# Heading\n\nRead this paragraph\n",
    onChange,
    onViewChange,
    ...props,
  };
  const ui = render(<VisualMarkdownEditor {...initial} />);
  await waitFor(() => expect(onViewChange).toHaveBeenCalled());
  const view = [...views].find(
    (candidate) => candidate.dom === ui.container.querySelector(".ProseMirror"),
  )!;
  expect(view).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
  return {
    ...ui,
    view,
    onChange,
    update: (next: Partial<VisualMarkdownEditorProps>) =>
      ui.rerender(<VisualMarkdownEditor {...initial} {...next} />),
  };
}

it("keeps one visual view and its Undo while blocking local edits and accepting shared text", async () => {
  const { view, container, onChange, update } = await renderEditor({
    value: "First paragraph\n\nRead this paragraph\n",
  });
  act(() => view.dispatch(view.state.tr.insertText("!", 2)));
  const edited = onChange.mock.lastCall![0] as string;
  const beforeReading = view.state.doc;
  const selection = view.state.selection;
  const scroller = container.querySelector<HTMLElement>(".visual-markdown-editor")!;
  scroller.scrollTop = 123;
  onChange.mockClear();
  update({ readOnly: true, value: edited });
  expect(container.querySelector(".ProseMirror")).toBe(view.dom);
  expect(view.editable).toBe(false);
  expect(view.dom.getAttribute("contenteditable")).toBe("false");
  expect(view.dom.getAttribute("aria-readonly")).toBe("true");
  expect(view.dom.tabIndex).toBe(0);
  expect(view.state.selection.eq(selection)).toBe(true);
  expect(scroller.scrollTop).toBe(123);
  act(() => {
    view.dispatch(view.state.tr.insertText("accidental"));
    undo(view.state, view.dispatch);
  });
  fireEvent(
    view.dom,
    new CustomEvent(VISUAL_EDITOR_COMMAND_EVENT, {
      bubbles: true,
      cancelable: true,
      detail: { command: "blockquote" },
    }),
  );
  expect(view.state.doc.eq(beforeReading)).toBe(true);
  expect(onChange).not.toHaveBeenCalled();

  const shared = `${edited}\nShared addition\n`;
  update({ readOnly: true, value: shared });
  expect(view.state.doc.textContent).toContain("Shared addition");
  expect(onChange).not.toHaveBeenCalled();
  expect(scroller.scrollTop).toBe(123);
  update({ readOnly: false, value: shared });
  expect(container.querySelector(".ProseMirror")).toBe(view.dom);
  expect(view.editable).toBe(true);
  act(() => expect(undo(view.state, view.dispatch)).toBe(true));
  expect(view.state.doc.textContent).not.toContain("!");
  expect(view.state.doc.textContent).toContain("Shared addition");
});

it("preserves heading Undo through reading mode without reloading the document", async () => {
  const { view, container, onChange, update } = await renderEditor();
  act(() => view.dispatch(view.state.tr.insertText("!", 2)));
  const edited = onChange.mock.lastCall![0] as string;
  update({ value: edited, readOnly: true });
  act(() => undo(view.state, view.dispatch));
  expect(view.state.doc.textContent).toContain("H!eading");
  update({ value: edited, readOnly: false });
  expect(container.querySelector(".ProseMirror")).toBe(view.dom);
  act(() => expect(undo(view.state, view.dispatch)).toBe(true));
  expect(view.state.doc.textContent).toContain("Heading");
  expect(view.state.doc.textContent).not.toContain("!");
});

it("keeps a read-only code fragment focused, selected and copyable", async () => {
  const value = "```js\nconst answer = 42;\nconsole.log(answer);\n```\n";
  const { container, onChange, update } = await renderEditor({ value, readOnly: true });
  const code = await waitFor(() => {
    const element = container.querySelector<HTMLElement>(".cm-editor");
    expect(element).toBeTruthy();
    return CodeMirrorView.findFromDOM(element!)!;
  });
  const before = code.state.doc.toString();
  for (const readOnly of [true, false, true]) {
    update({ value, readOnly });
    act(() => {
      code.focus();
      code.dispatch({ selection: { anchor: 6, head: 17 } });
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(code.contentDOM);
      expect(code.hasFocus).toBe(true);
      expect(window.getSelection()?.toString()).toBe("answer = 42");
    });
    expect(code.contentDOM.getAttribute("contenteditable")).toBe(String(!readOnly));
    const setData = vi.fn();
    fireEvent.copy(code.contentDOM, {
      clipboardData: { clearData: vi.fn(), setData },
    });
    expect(setData).toHaveBeenCalledWith("text/plain", "answer = 42");
    expect(code.state.doc.toString()).toBe(before);
  }
  expect(onChange).not.toHaveBeenCalled();
});

it("keeps code copy, links and find usable while code, task and table editing are disabled", async () => {
  const onInternalLink = vi.fn();
  const value = [
    "# Heading",
    "",
    "[Other](other.md)",
    "",
    "- [ ] A task",
    "",
    "| Name | Value |",
    "| --- | --- |",
    "| Alpha | Beta |",
    "",
    "```js",
    "const answer = 42;",
    "```",
  ].join("\n");
  const { view, container, onChange, update, getByRole, queryByRole } = await renderEditor({
    value,
    onInternalLink,
  });
  const code = await waitFor(() => {
    const element = container.querySelector<HTMLElement>(".cm-editor");
    expect(element).toBeTruthy();
    return CodeMirrorView.findFromDOM(element!)!;
  });
  const codeText = code.state.doc.toString();
  update({ value, readOnly: true, findRequest: 1 });
  expect(code.state.readOnly).toBe(true);
  expect(code.contentDOM.getAttribute("contenteditable")).toBe("false");
  const before = view.state.doc;
  act(() => code.dispatch({ changes: { from: 0, insert: "wrong" } }));
  expect(code.state.doc.toString()).toBe(codeText);
  fireEvent.pointerDown(container.querySelector(".label-wrapper")!);
  const language = container.querySelector<HTMLButtonElement>(".language-button")!;
  expect(language).toBeDisabled();
  fireEvent.click(language);
  expect(container.querySelector(".language-list")).toBeNull();
  let cellPosition = 0;
  view.state.doc.descendants((node, position) => {
    if (node.isText && node.text === "Alpha") cellPosition = position;
  });
  act(() => {
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPosition)),
    );
    view.dispatch(view.state.tr.insertText("changed cell"));
  });
  expect(container.querySelector(".visual-markdown-editor__table-tools")).toBeNull();
  expect(view.state.doc.eq(before)).toBe(true);

  fireEvent.click(container.querySelector('a[href="other.md"]')!);
  expect(onInternalLink).toHaveBeenCalledWith("other.md", "current");
  const clipboard = navigator.clipboard;
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  try {
    fireEvent.click(container.querySelector(".copy-button")!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(codeText));
  } finally {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
  }
  fireEvent.change(getByRole("textbox", { name: "当前页查找" }), {
    target: { value: "Alpha" },
  });
  await waitFor(() => expect(container.querySelector(".page-find-match")).toBeTruthy());
  expect(queryByRole("button", { name: "显示替换" })).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  update({ value: value.replace("42", "84"), readOnly: true, findRequest: 1 });
  expect(code.state.doc.toString()).toContain("84");
  expect(onChange).not.toHaveBeenCalled();
  update({ value: value.replace("42", "84"), readOnly: false, findRequest: 1 });
  expect(code.state.readOnly).toBe(false);
  expect(code.contentDOM.getAttribute("contenteditable")).toBe("true");
});

it("rejects native mutation events and a pending image paste without swallowing tab drops", async () => {
  let finishPaste!: (value: string) => void;
  const onImagePaste = vi.fn(
    () => new Promise<string>((resolve) => (finishPaste = resolve)),
  );
  const { view, container, onChange, update } = await renderEditor({ onImagePaste });
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: {
      getData: () => "",
      types: ["Files"],
      items: [{ kind: "file", type: "image/png" }],
      files: [],
    },
  });
  fireEvent(view.dom, paste);
  expect(onImagePaste).toHaveBeenCalledOnce();
  update({ readOnly: true });
  await act(async () => finishPaste("![saved](saved.png)"));
  expect(view.state.doc.textContent).not.toContain("saved");
  const before = view.state.doc;
  for (const type of ["beforeinput", "cut", "paste", "drop"]) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    fireEvent(view.dom, event);
    expect(event.defaultPrevented).toBe(true);
  }
  fireEvent.compositionStart(view.dom);
  fireEvent.compositionEnd(view.dom);
  expect(view.state.doc.eq(before)).toBe(true);
  const dropped = vi.fn();
  container.addEventListener("drop", dropped);
  fireEvent(view.dom, new Event("drop", { bubbles: true, cancelable: true }));
  expect(dropped).toHaveBeenCalledOnce();
  container.removeEventListener("drop", dropped);
  // The native drop indicator finishes its own 30 ms hide callback while the
  // editor still exists, just as it does after a real tab drop.
  await act(async () => new Promise<void>((resolve) => window.setTimeout(resolve, 40)));
  expect(onImagePaste).toHaveBeenCalledOnce();
  expect(onChange).not.toHaveBeenCalled();
});

it("settles an already queued composition before reading mode locks new input", async () => {
  const { view, onChange, update } = await renderEditor();
  view.focus();
  const paragraph = view.dom.querySelector("p")!;
  const text = paragraph.firstChild!;
  const selection = window.getSelection()!;
  selection.collapse(text, text.textContent!.length);
  fireEvent.compositionStart(view.dom);
  expect(view.composing).toBe(true);
  // Simulate the already committed DOM text whose observer read is queued by
  // compositionend; this is a lifecycle check, not an OS IME acceptance test.
  text.textContent += "中文";
  selection.collapse(text, text.textContent!.length);
  fireEvent.compositionEnd(view.dom);
  update({ readOnly: true });
  await waitFor(() => {
    expect(view.state.doc.textContent).toContain("中文");
    expect(onChange.mock.lastCall?.[0]).toContain("中文");
    expect(view.editable).toBe(false);
    expect(view.composing).toBe(false);
  });
  await act(
    async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  const settled = view.state.doc;
  act(() => view.dispatch(view.state.tr.insertText("new input")));
  expect(view.state.doc.eq(settled)).toBe(true);
});

it("settles embedded code composition and a pending shared update in both editor models", async () => {
  const value = "# Heading\n\n```text\nbase text\n```\n";
  const { view, container, onChange, update } = await renderEditor({ value });
  const code = await waitFor(() => {
    const element = container.querySelector<HTMLElement>(".cm-editor");
    expect(element).toBeTruthy();
    return CodeMirrorView.findFromDOM(element!)!;
  });
  act(() => {
    code.focus();
    code.dispatch({ selection: { anchor: 9 } });
  });
  fireEvent.compositionStart(code.contentDOM);
  const shared = value.replace("base text", "shared base text");
  update({ value: shared });
  const line = code.contentDOM.querySelector(".cm-line")!;
  line.textContent = "base text中文";
  window.getSelection()!.collapse(line.firstChild!, 11);
  update({ value: shared, readOnly: true });
  await waitFor(() => expect(code.state.doc.toString()).toBe("shared base text中文"));
  expect(view.state.doc.textContent).toContain("shared base text中文");
  expect(onChange.mock.lastCall?.[0]).toContain("shared base text中文");
  await waitFor(() => expect(code.state.readOnly).toBe(true));
  expect(view.editable).toBe(false);
  const settled = view.state.doc;
  act(() => code.dispatch({ changes: { from: 0, insert: "new input" } }));
  expect(view.state.doc.eq(settled)).toBe(true);
  expect(code.state.doc.toString()).toBe("shared base text中文");
});
