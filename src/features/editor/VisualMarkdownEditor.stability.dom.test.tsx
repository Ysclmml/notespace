import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { EditorView } from "@milkdown/kit/prose/view";
import { TextSelection } from "@milkdown/kit/prose/state";
import { beforeAll, expect, it, vi } from "vitest";
import { buildHtmlExport } from "../export/buildHtmlExport";
import { VisualMarkdownEditor, VISUAL_EDITOR_COMMAND_EVENT } from "./VisualMarkdownEditor";
import {
  installCodeMirrorDomMeasurementStubs,
  installImmediateIntersectionObserverStub,
} from "./spike/domTestSupport";

beforeAll(() => {
  installCodeMirrorDomMeasurementStubs();
  installImmediateIntersectionObserverStub();
});

it("preserves quoted math through unrelated visual edits and export without installing hover block controls", async () => {
  const source = "> \\[\n> x^2\n> \\]\n\n# After\n";
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
      documentId="/fixtures/stability.md"
      value={source}
      onChange={onChange}
      onViewChange={onViewChange}
    />,
  );
  await waitFor(() => expect(onViewChange).toHaveBeenCalled());
  const view = [...views].find(
    (candidate) => candidate.dom === container.querySelector(".ProseMirror"),
  )!;
  expect(onChange).not.toHaveBeenCalled();
  expect(container.querySelector(".milkdown-block-handle")).toBeNull();
  expect(
    view.state.plugins.some(
      (plugin) =>
        "key" in plugin &&
        typeof plugin.key === "string" &&
        plugin.key.startsWith("MILKDOWN_BLOCK"),
    ),
  ).toBe(false);
  let end = 0;
  view!.state.doc.descendants((node, position) => {
    if (node.isText && node.text === "After") end = position + node.nodeSize;
  });
  act(() => {
    const transaction = view.state.tr.insertText("!", end);
    view.dispatch(transaction.setSelection(TextSelection.create(transaction.doc, end)));
  });
  const edited = onChange.mock.lastCall?.[0] as string;
  expect(edited).toContain("> $$\n> x^2\n> $$");
  expect(edited).toContain("After!");
  const exported = new DOMParser().parseFromString(
    buildHtmlExport(edited, { title: "Review" }),
    "text/html",
  );
  expect(exported.querySelector("blockquote math annotation")?.textContent).toBe("x^2");
  expect(exported.querySelector("math mo")?.textContent).not.toBe(">");
  const command = new CustomEvent(VISUAL_EDITOR_COMMAND_EVENT, {
    bubbles: true,
    cancelable: true,
    detail: { command: "paragraph" },
  });
  fireEvent(view!.dom, command);
  expect(command.defaultPrevented).toBe(true);
  expect(onChange.mock.lastCall?.[0]).not.toContain("# After");
  expect(onChange.mock.lastCall?.[0]).toContain("> x^2");
});
