import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { undo as undoCode } from "@codemirror/commands";
import { EditorView as CodeView } from "@codemirror/view";
import type { EditorSelection } from "@codemirror/state";
import { undo as undoVisual } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { EditorView as VisualView } from "@milkdown/kit/prose/view";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { AppSettingsProvider, useAppSettings } from "../../app/settings";
import { CodeFilePreview } from "../code-preview/CodeFilePreview";
import { DEFAULT_SHORTCUTS } from "../shortcuts/shortcuts";
import { MarkdownEditor } from "./MarkdownEditor";
import {
  installCodeMirrorDomMeasurementStubs,
  installImmediateIntersectionObserverStub,
} from "./spike/domTestSupport";

beforeAll(() => {
  installCodeMirrorDomMeasurementStubs();
  installImmediateIntersectionObserverStub();
});

function captureVisualView() {
  const views = new Set<VisualView>();
  const originalUpdate = VisualView.prototype.updateState;
  vi.spyOn(VisualView.prototype, "updateState").mockImplementation(function (
    this: VisualView,
    state,
  ) {
    originalUpdate.call(this, state);
    views.add(this);
  });
  return async (container: HTMLElement) =>
    waitFor(() => {
      const view = [...views].find(
        (item) => item.dom === container.querySelector(".ProseMirror"),
      );
      expect(view).toBeTruthy();
      return view!;
    });
}

describe("configurable Markdown formatting keys", () => {
  it.each(["MacIntel", "Win32"])(
    "uses the %s primary modifier for H1–H6 and paragraph on both surfaces",
    async (platform) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      const visualView = captureVisualView();
      const { container } = render(
        <>
          <section data-surface="visual">
            <MarkdownEditor
              documentId="/fixtures/visual.md"
              mode="normal"
              autofocus={false}
              value="中文"
              onChange={vi.fn()}
            />
          </section>
          <section data-surface="source">
            <MarkdownEditor
              documentId="/fixtures/source.md"
              mode="normal"
              presentationMode="source"
              autofocus={false}
              value="中文"
              onChange={vi.fn()}
            />
          </section>
        </>,
      );
      const visual = await visualView(container);
      const source = CodeView.findFromDOM(
        container.querySelector<HTMLElement>('[data-surface="source"] .cm-editor')!,
      )!;
      const modifiers = platform === "MacIntel" ? { metaKey: true } : { ctrlKey: true };
      act(() => visual.focus());
      fireEvent.keyDown(visual.dom, {
        key: "1",
        code: "Digit1",
        altKey: true,
        ...modifiers,
      });
      expect(visual.state.doc.firstChild?.type.name).toBe("paragraph");
      for (const level of [1, 2, 3, 4, 5, 6, 0]) {
        act(() => visual.focus());
        fireEvent.keyDown(visual.dom, {
          key: String(level),
          code: `Digit${level}`,
          ...modifiers,
        });
        expect(visual.state.doc.firstChild?.type.name).toBe(
          level ? "heading" : "paragraph",
        );
        if (level) expect(visual.state.doc.firstChild?.attrs.level).toBe(level);
        act(() => source.focus());
        fireEvent.keyDown(source.contentDOM, {
          key: String(level),
          code: `Digit${level}`,
          ...modifiers,
        });
        expect(source.state.doc.toString()).toBe(
          level ? `${"#".repeat(level)} 中文` : "中文",
        );
      }
      act(() => {
        expect(undoCode(source)).toBe(true);
      });
      expect(source.state.doc.toString()).toBe("###### 中文");
      act(() => {
        expect(undoVisual(visual.state, visual.dispatch)).toBe(true);
      });
      expect(visual.state.doc.firstChild?.attrs.level).toBe(6);
    },
  );

  it.each(["visual", "source"] as const)(
    "remaps and clears %s keys live without remounting or leaving old defaults active",
    async (surface) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
      const visualView = captureVisualView();
      function Controls() {
        const { updateSettings, settings } = useAppSettings();
        return (
          <>
            <button
              onClick={() =>
                updateSettings({
                  shortcuts: { ...settings.shortcuts, toggleBold: "Mod+Shift+G" },
                })
              }
            >
              remap
            </button>
            <button
              onClick={() =>
                updateSettings({
                  shortcuts: {
                    ...settings.shortcuts,
                    toggleBold: null,
                    toggleItalic: null,
                  },
                })
              }
            >
              clear
            </button>
          </>
        );
      }
      const { container, getByRole } = render(
        <AppSettingsProvider storage={null}>
          <Controls />
          <MarkdownEditor
            documentId="/fixtures/remap.md"
            mode="normal"
            presentationMode={surface}
            autofocus={false}
            value="中文"
            onChange={vi.fn()}
          />
        </AppSettingsProvider>,
      );
      const visual = surface === "visual" ? await visualView(container) : null;
      const source =
        surface === "source"
          ? CodeView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!
          : null;
      const target = visual?.dom ?? source!.contentDOM;
      const focusSelection = () =>
        act(() => {
          if (visual) {
            visual.dispatch(
              visual.state.tr.setSelection(TextSelection.create(visual.state.doc, 1, 3)),
            );
            visual.focus();
          } else {
            source!.dispatch({ selection: { anchor: 0, head: 2 } });
            source!.focus();
          }
        });
      fireEvent.click(getByRole("button", { name: "remap" }));
      focusSelection();
      fireEvent.keyDown(target, { key: "b", metaKey: true });
      expect(container.querySelector(".ProseMirror strong")).toBeNull();
      if (source) expect(source.state.doc.toString()).toBe("中文");
      fireEvent.keyDown(target, { key: "G", code: "KeyG", metaKey: true, shiftKey: true });
      if (visual)
        expect(container.querySelector(".ProseMirror strong")).toHaveTextContent("中文");
      if (source) expect(source.state.doc.toString()).toBe("**中文**");
      act(() => {
        if (visual) undoVisual(visual.state, visual.dispatch);
        else undoCode(source!);
      });
      fireEvent.click(getByRole("button", { name: "clear" }));
      focusSelection();
      const before = visual?.state.selection ?? source!.state.selection;
      for (const key of ["b", "i"]) fireEvent.keyDown(target, { key, metaKey: true });
      fireEvent.keyDown(target, { key: "G", code: "KeyG", metaKey: true, shiftKey: true });
      if (visual) {
        expect(visual.state.doc.textContent).toBe("中文");
        expect(container.querySelector(".ProseMirror strong, .ProseMirror em")).toBeNull();
        expect(container.querySelector(".ProseMirror")).toBe(target);
      } else {
        expect(source!.state.doc.toString()).toBe("中文");
        expect(source!.state.selection.eq(before as EditorSelection)).toBe(true);
        expect(container.querySelector(".cm-content")).toBe(target);
      }
    },
  );

  it("ignores extra modifiers, composition, modal dialogs, find inputs and ordinary code", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const onChange = vi.fn();
    const { container, getByRole, rerender } = render(
      <MarkdownEditor
        documentId="/fixtures/scope.md"
        mode="normal"
        presentationMode="source"
        value="中文"
        onChange={onChange}
        findRequest={1}
      />,
    );
    const source = CodeView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    const input = getByRole("textbox", { name: "当前页查找" });
    fireEvent.keyDown(input, { key: "1", metaKey: true });
    expect(onChange).not.toHaveBeenCalled();
    act(() => source.focus());
    for (const extra of [
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { isComposing: true },
    ]) {
      fireEvent.keyDown(source.contentDOM, {
        key: "1",
        code: "Digit1",
        metaKey: true,
        ...extra,
      });
    }
    expect(source.state.doc.toString()).toBe("中文");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    fireEvent.keyDown(source.contentDOM, { key: "1", metaKey: true });
    expect(source.state.doc.toString()).toBe("中文");
    dialog.remove();
    rerender(
      <CodeFilePreview
        path="/fixtures/code.txt"
        language="text"
        content="中文"
        editable
        onChange={onChange}
      />,
    );
    const code = CodeView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
    act(() => code.focus());
    fireEvent.keyDown(code.contentDOM, { key: "1", metaKey: true });
    fireEvent.keyDown(code.contentDOM, { key: "b", metaKey: true });
    expect(code.state.doc.toString()).toBe("中文");
    expect(DEFAULT_SHORTCUTS.heading1).toBe("Mod+1");
  });
});
