import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { undo as undoSource, redo as redoSource } from "@codemirror/commands";
import { EditorView as SourceView } from "@codemirror/view";
import { Editor } from "@milkdown/kit/core";
import { undo as undoVisual, redo as redoVisual } from "@milkdown/kit/prose/history";
import { EditorView as VisualView } from "@milkdown/kit/prose/view";
import { useState } from "react";
import { beforeAll, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";
import {
  installCodeMirrorDomMeasurementStubs,
  installImmediateIntersectionObserverStub,
} from "./spike/domTestSupport";

beforeAll(() => {
  installCodeMirrorDomMeasurementStubs();
  installImmediateIntersectionObserverStub();
});

function captureVisualViews() {
  const views = new Set<VisualView>();
  const update = VisualView.prototype.updateState;
  vi.spyOn(VisualView.prototype, "updateState").mockImplementation(function (
    this: VisualView,
    state,
  ) {
    update.call(this, state);
    views.add(this);
  });
  return (container: HTMLElement) =>
    [...views].find((view) => view.dom === container.querySelector(".ProseMirror"));
}

function Harness({
  initialMode = "source",
  findRequest,
  onImagePaste,
}: {
  initialMode?: "source" | "visual";
  findRequest?: number;
  onImagePaste?: () => Promise<string>;
}) {
  const [mode, setMode] = useState(initialMode);
  const [value, setValue] = useState("first\n\nsecond\n");
  return (
    <>
      <button onClick={() => setMode(mode === "source" ? "visual" : "source")}>
        Toggle
      </button>
      <output>{value}</output>
      <button onClick={() => setValue("REMOTE\n\nsecond\n")}>External</button>
      <MarkdownEditor
        autofocus={false}
        documentId="/fixtures/history.md"
        mode="normal"
        presentationMode={mode}
        value={value}
        onChange={setValue}
        findRequest={findRequest}
        onImagePaste={onImagePaste}
      />
    </>
  );
}

it.each(["source", "visual"] as const)(
  "retains %s Undo/Redo across an unedited mode round trip",
  async (initialMode) => {
    const findVisual = captureVisualViews();
    const { container, getByText, unmount } = render(<Harness initialMode={initialMode} />);
    await waitFor(() =>
      expect(
        initialMode === "visual"
          ? findVisual(container)
          : container.querySelector(".cm-editor"),
      ).toBeTruthy(),
    );
    // Wait for the first view snapshot before beginning the actual editing step.
    await act(
      async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    const initial =
      initialMode === "source"
        ? SourceView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!
        : findVisual(container)!;
    act(() => {
      if (initial instanceof SourceView)
        initial.dispatch({ changes: { from: 0, insert: "new " } });
      else initial.dispatch(initial.state.tr.insertText("new ", 1));
    });
    expect(container.querySelector("output")).toHaveTextContent("new first");
    fireEvent.click(getByText("Toggle"));
    await waitFor(() =>
      expect(
        initialMode === "source"
          ? findVisual(container)
          : container.querySelector(".cm-editor"),
      ).toBeTruthy(),
    );
    fireEvent.click(getByText("Toggle"));
    const returned =
      initialMode === "source"
        ? SourceView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!
        : findVisual(container)!;
    expect(returned).toBe(initial);
    act(() =>
      expect(
        returned instanceof SourceView
          ? undoSource(returned)
          : undoVisual(returned.state, returned.dispatch),
      ).toBe(true),
    );
    expect(container.querySelector("output")).not.toHaveTextContent("new first");
    act(() =>
      expect(
        returned instanceof SourceView
          ? redoSource(returned)
          : redoVisual(returned.state, returned.dispatch),
      ).toBe(true),
    );
    expect(container.querySelector("output")).toHaveTextContent("new first");
    const destroy = vi.spyOn(initial, "destroy");
    unmount();
    await waitFor(() => expect(destroy).toHaveBeenCalledOnce());
  },
);

it("freezes detached visual work, reuses its view, and maps Undo around edits in the other surface", async () => {
  const findVisual = captureVisualViews();
  const creations = vi.spyOn(Editor, "make");
  const { container, getByText, getByRole } = render(<Harness findRequest={1} />);
  expect(creations).not.toHaveBeenCalled();
  const source = SourceView.findFromDOM(
    container.querySelector<HTMLElement>(".cm-editor")!,
  )!;
  act(() => source.dispatch({ changes: { from: 0, insert: "SOURCE " } }));
  fireEvent.click(getByText("Toggle"));
  await waitFor(() => expect(findVisual(container)).toBeTruthy());
  await act(
    async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  const visual = findVisual(container)!;
  fireEvent.change(getByRole("textbox", { name: "当前页查找" }), {
    target: { value: "first" },
  });
  fireEvent.click(getByRole("button", { name: "显示替换" }));
  fireEvent.change(getByRole("textbox", { name: "替换为" }), {
    target: { value: "HIDDEN" },
  });
  const before = visual.state.doc;
  fireEvent.click(getByText("Toggle"));
  expect(visual.dom.isConnected).toBe(false);
  const hiddenDispatch = vi.spyOn(visual, "dispatch");
  act(() => {
    for (let i = 0; i < 25; i++)
      source.dispatch({ changes: { from: source.state.doc.length, insert: "x" } });
  });
  expect(visual.state.doc).toBe(before);
  expect(hiddenDispatch).not.toHaveBeenCalled();
  // The detached find/replace controls are absent from document focus/queries;
  // Enter in the active surface cannot trigger their replacement.
  fireEvent.keyDown(source.contentDOM, { key: "Enter" });
  expect(visual.state.doc).toBe(before);
  const afterTyping = source.state.doc.toString();
  fireEvent.click(getByText("Toggle"));
  expect(findVisual(container)).toBe(visual);
  expect(visual.state.doc.textContent).toContain("x".repeat(25));
  expect(container.querySelector("output")?.textContent).toBe(afterTyping);
  let secondEnd = 0;
  visual.state.doc.descendants((node, position) => {
    if (node.isText && node.text === "second") secondEnd = position + node.nodeSize;
  });
  act(() => visual.dispatch(visual.state.tr.insertText(" VISUAL", secondEnd)));
  fireEvent.click(getByText("Toggle"));
  expect(source.state.doc.toString()).toContain("second VISUAL");
  fireEvent.click(getByText("Toggle"));
  act(() => expect(undoVisual(visual.state, visual.dispatch)).toBe(true));
  expect(container.querySelector("output")).not.toHaveTextContent("VISUAL");
  expect(container.querySelector("output")).toHaveTextContent("SOURCE");
  expect(container.querySelector("output")).toHaveTextContent("x".repeat(25));
  expect(creations).toHaveBeenCalledTimes(1);
});

it.each(["source", "visual"] as const)(
  "ignores an image result after its %s surface is detached",
  async (initialMode) => {
    const findVisual = captureVisualViews();
    let complete!: (value: string) => void;
    const image = new Promise<string>((resolve) => {
      complete = resolve;
    });
    const onImagePaste = vi.fn(() => image);
    const { container, getByText } = render(
      <Harness initialMode={initialMode} onImagePaste={onImagePaste} />,
    );
    await waitFor(() =>
      expect(
        initialMode === "visual"
          ? findVisual(container)
          : container.querySelector(".cm-editor"),
      ).toBeTruthy(),
    );
    await act(
      async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    const source =
      initialMode === "source"
        ? SourceView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!
        : null;
    const initial = source?.contentDOM ?? findVisual(container)!.dom;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: () => "",
        types: ["image/png"],
        items: [{ kind: "file", type: "image/png", getAsFile: () => null }],
        files: [],
      },
    });
    fireEvent(initial, paste);
    expect(onImagePaste).toHaveBeenCalledOnce();
    fireEvent.click(getByText("Toggle"));
    await waitFor(() =>
      expect(
        initialMode === "source"
          ? findVisual(container)
          : container.querySelector(".cm-editor"),
      ).toBeTruthy(),
    );
    await act(
      async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    act(() => {
      if (initialMode === "source") {
        const visual = findVisual(container)!;
        visual.dispatch(visual.state.tr.insertText("KEEP ", 1));
      } else {
        const code = SourceView.findFromDOM(
          container.querySelector<HTMLElement>(".cm-editor")!,
        )!;
        code.dispatch({ changes: { from: 0, insert: "KEEP " } });
      }
    });
    const current = container.querySelector("output")?.textContent;
    await act(async () => {
      complete("![old](./image.png)");
      await image;
    });
    expect(container.querySelector("output")?.textContent).toBe(current);
    expect(container.querySelector("output")).toHaveTextContent("KEEP");
    expect(container.querySelector("output")).not.toHaveTextContent("image.png");
  },
);

it.each(["source", "visual"] as const)(
  "discards a deferred %s IME merge when switching surfaces",
  async (initialMode) => {
    const findVisual = captureVisualViews();
    const { container, getByText } = render(<Harness initialMode={initialMode} />);
    await waitFor(() =>
      expect(
        initialMode === "visual"
          ? findVisual(container)
          : container.querySelector(".cm-editor"),
      ).toBeTruthy(),
    );
    await act(
      async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    const source =
      initialMode === "source"
        ? SourceView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!
        : null;
    const visual = initialMode === "visual" ? findVisual(container)! : null;
    const content = source?.contentDOM ?? visual!.dom;
    fireEvent.compositionStart(content);
    fireEvent.click(getByText("External"));
    act(() => {
      if (source) source.dispatch({ changes: { from: 0, insert: "STALE " } });
      else visual!.dispatch(visual!.state.tr.insertText("STALE ", 1));
    });
    fireEvent.compositionEnd(content);
    fireEvent.click(getByText("Toggle"));
    await waitFor(() =>
      expect(
        initialMode === "source"
          ? findVisual(container)
          : container.querySelector(".cm-editor"),
      ).toBeTruthy(),
    );
    await act(
      async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect(container.querySelector("output")).toHaveTextContent("REMOTE");
    expect(container.querySelector("output")).not.toHaveTextContent("STALE");
    fireEvent.click(getByText("Toggle"));
    const currentText = source
      ? source.state.doc.toString()
      : visual!.state.doc.textContent;
    expect(currentText).toContain("REMOTE");
    expect(currentText).not.toContain("STALE");
  },
);

it("does not restore stale visual text when Undo follows a source edit", async () => {
  const findVisual = captureVisualViews();
  const { container, getByText } = render(<Harness initialMode="visual" />);
  await waitFor(() => expect(findVisual(container)).toBeTruthy());
  await act(
    async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  const visual = findVisual(container)!;
  act(() => visual.dispatch(visual.state.tr.insertText("VISUAL ", 1)));
  fireEvent.click(getByText("Toggle"));
  const source = SourceView.findFromDOM(
    container.querySelector<HTMLElement>(".cm-editor")!,
  )!;
  act(() =>
    source.dispatch({ changes: { from: source.state.doc.length, insert: "SOURCE" } }),
  );
  fireEvent.click(getByText("Toggle"));
  act(() => expect(undoVisual(visual.state, visual.dispatch)).toBe(true));
  expect(container.querySelector("output")).not.toHaveTextContent("VISUAL");
  expect(container.querySelector("output")).toHaveTextContent("SOURCE");
  fireEvent.click(getByText("Toggle"));
  expect(source.state.doc.toString()).toContain("SOURCE");
  expect(source.state.doc.toString()).not.toContain("VISUAL");
});
