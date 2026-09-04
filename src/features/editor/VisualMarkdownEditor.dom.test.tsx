import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView as CodeMirrorView } from "@codemirror/view";
import { StateEffect } from "@codemirror/state";
import { Editor } from "@milkdown/kit/core";
import { linkTooltipAPI } from "@milkdown/kit/component/link-tooltip";
import { undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { EditorView as ProseMirrorEditorView } from "@milkdown/kit/prose/view";
import { StrictMode, useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { LARGE_PASTE_TEXT_THRESHOLD } from "./pasteGuard";
import { MarkdownEditor } from "./MarkdownEditor";
import * as imageSources from "./imageSource";
import { AppSettingsProvider } from "../../app/settings";
import { EditorContextMenu, useEditorContextMenu } from "../context-menu";
import {
  installCodeMirrorDomMeasurementStubs,
  installImmediateIntersectionObserverStub,
} from "./spike/domTestSupport";
import {
  VISUAL_EDITOR_COMMAND_EVENT,
  VisualMarkdownEditor,
  type VisualEditorCommandDetail,
} from "./VisualMarkdownEditor";

beforeAll(() => installCodeMirrorDomMeasurementStubs());

beforeAll(() => installImmediateIntersectionObserverStub());

function dispatchClipboardPaste(target: HTMLElement, data: Partial<DataTransfer>) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: () => "", items: [], files: [], types: [], ...data },
  });
  fireEvent(target, event);
  return event;
}

function dispatchEditorCommand(
  target: HTMLElement,
  detail: VisualEditorCommandDetail,
): CustomEvent<VisualEditorCommandDetail> {
  const event = new CustomEvent<VisualEditorCommandDetail>(VISUAL_EDITOR_COMMAND_EVENT, {
    bubbles: true,
    cancelable: true,
    detail,
  });
  fireEvent(target, event);
  return event;
}

function dispatchDragMouseMove(target: Window, clientX: number): MouseEvent {
  const event = new MouseEvent("mousemove", {
    bubbles: true,
    buttons: 1,
    cancelable: true,
    clientX,
  });
  Object.defineProperty(event, "which", { configurable: true, value: 1 });
  target.dispatchEvent(event);
  return event;
}

function captureVisualViews() {
  const views = new Set<ProseMirrorEditorView>();
  const updateState = ProseMirrorEditorView.prototype.updateState;
  vi.spyOn(ProseMirrorEditorView.prototype, "updateState").mockImplementation(function (
    this: ProseMirrorEditorView,
    state,
  ) {
    updateState.call(this, state);
    views.add(this);
  });
  return (container: HTMLElement, index = 0) =>
    waitFor(() => {
      const element = container.querySelectorAll(".ProseMirror")[index];
      const view = [...views].find((candidate) => candidate.dom === element);
      expect(view).toBeTruthy();
      return view!;
    });
}

function visualTextPosition(view: ProseMirrorEditorView, text: string): number {
  let position = -1;
  view.state.doc.descendants((node, offset) => {
    if (position === -1 && node.isText && node.text?.includes(text)) {
      position = offset + node.text.indexOf(text);
    }
  });
  if (position < 0) throw new Error(`Visual text not found: ${text}`);
  return position;
}

describe("VisualMarkdownEditor DOM integration", () => {
  it("does not steal split focus when autofocus changes before the initial restore frame", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const creations: ReturnType<Editor["create"]>[] = [];
    const make = Editor.make;
    vi.spyOn(Editor, "make").mockImplementation(() => {
      const editor = make();
      const create = editor.create;
      vi.spyOn(editor, "create").mockImplementation(() => {
        const creation = create();
        creations.push(creation);
        return creation;
      });
      return editor;
    });
    const onChange = vi.fn();
    const surface = (autofocus: boolean) => (
      <>
        <MarkdownEditor
          autofocus={autofocus}
          documentId="/fixtures/late-visual-focus.md"
          mode="normal"
          onChange={onChange}
          value="# Background tab\n"
        />
        <button type="button">Other split</button>
      </>
    );
    const { container, rerender, getByRole } = render(surface(true));
    await act(async () => {
      await Promise.all(creations);
    });
    expect(container.querySelector(".ProseMirror")).toBeTruthy();
    expect(frames.size).toBeGreaterThan(0);
    rerender(surface(false));
    const otherSplit = getByRole("button", { name: "Other split" });
    otherSplit.focus();
    act(() => {
      for (const id of [...frames.keys()]) {
        const callback = frames.get(id);
        frames.delete(id);
        callback?.(performance.now());
      }
    });
    expect(otherSplit).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  // Mounting real Crepe plus embedded CodeMirror dominates jsdom CSS work;
  // allow parallel-suite headroom without changing the global test timeout.
  it("hides stale fenced-code selection after focus moves to prose, preserving the code range and Undo", async () => {
    const findView = captureVisualViews();
    const onChange = vi.fn();
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/fixtures/blur.md"
        value={"before\n\n```text\nalpha beta alpha\n```\n\nafter\n"}
        onChange={onChange}
      />,
    );
    const prose = await findView(container);
    const element = await waitFor(() => {
      const found = container.querySelector<HTMLElement>(".cm-editor");
      expect(found).toBeTruthy();
      return found!;
    });
    const code = CodeMirrorView.findFromDOM(element)!;
    act(() => {
      code.focus();
      code.dispatch({ selection: { anchor: 0, head: 5 } });
    });
    const layer = element.querySelector(".cm-selectionLayer")!;
    const background = document.createElement("div");
    background.className = "cm-selectionBackground";
    layer.append(background);
    expect(getComputedStyle(background).backgroundColor).toBe("rgb(184, 207, 248)");
    const before = prose.state.doc;
    act(() => {
      prose.dispatch(prose.state.tr.setSelection(TextSelection.create(prose.state.doc, 2)));
      prose.focus();
    });
    await waitFor(() => expect(element).not.toHaveClass("cm-focused"));
    expect(getComputedStyle(background).visibility).toBe("hidden");
    expect(code.state.selection.main).toMatchObject({ from: 0, to: 5 });
    expect(code.state.sliceDoc(0, 5)).toBe("alpha");
    expect(prose.state.doc.eq(before)).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(undo(prose.state, prose.dispatch)).toBe(false);
  }, 15_000);

  it("edits a complete long URL in a wrapping field with native confirm, cancel and Undo semantics", async () => {
    // Floating UI otherwise retries every placement against jsdom's all-zero
    // boxes. Real wrapping/viewport geometry is separately checked in-browser.
    // Both real floating-edit placements are intentionally exercised; their
    // jsdom style measurements need an explicit integration-test budget.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
      x: 20,
      y: 20,
      left: 20,
      top: 20,
      right: 520,
      bottom: 140,
      width: 500,
      height: 120,
      toJSON: () => ({}),
    }));
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(120);
    let editor: Editor | undefined;
    const make = Editor.make;
    vi.spyOn(Editor, "make").mockImplementation(() => {
      editor = make();
      return editor;
    });
    const findView = captureVisualViews();
    const onChange = vi.fn();
    const url = `https://example.test/reference/${"long-segment/".repeat(18)}?query=中文#details`;
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/fixtures/long-link.md"
        value={`[参考](${url})\n`}
        onChange={onChange}
      />,
    );
    const view = await findView(container);
    const start = visualTextPosition(view, "参考");
    const mark = view.state.doc.nodeAt(start)!.marks[0]!;
    act(() =>
      editor!.action((ctx) => ctx.get(linkTooltipAPI.key).editLink(mark, start, start + 2)),
    );
    const area = await waitFor(() => {
      const field = container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="链接地址"]',
      )!;
      expect(field).toBeTruthy();
      expect(field).toHaveValue(url);
      expect(field).toHaveFocus();
      return field;
    });
    expect(area.tagName).toBe("TEXTAREA");
    expect(area.wrap).toBe("soft");
    expect(getComputedStyle(area).whiteSpace).toBe("pre-wrap");
    expect(getComputedStyle(area).overflowWrap).toBe("anywhere");
    const replacement = `${url}&new=value`;
    fireEvent.input(area, { target: { value: replacement } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(area, { key: "Escape" });
    expect(container.querySelector(".ProseMirror a")).toHaveAttribute("href", url);
    expect(onChange).not.toHaveBeenCalled();
    act(() =>
      editor!.action((ctx) => ctx.get(linkTooltipAPI.key).editLink(mark, start, start + 2)),
    );
    await waitFor(() => expect(area).toHaveValue(url));
    fireEvent.input(area, { target: { value: replacement } });
    fireEvent.keyDown(area, { key: "Enter" });
    await waitFor(() =>
      expect(container.querySelector(".ProseMirror a")).toHaveAttribute(
        "href",
        replacement,
      ),
    );
    expect(onChange).toHaveBeenCalledOnce();
    act(() => {
      expect(undo(view.state, view.dispatch)).toBe(true);
    });
    expect(container.querySelector(".ProseMirror a")).toHaveAttribute("href", url);
  }, 90_000);

  it.each([false, true])(
    "applies only the latest anchor after initial view restoration (Strict Mode: %s)",
    async (strictMode) => {
      // Hold the initial restore frame while Crepe finishes creating its view.
      // This is the interval in which a link click used to be consumed and then
      // overwritten by the saved scroll position on the next frame.
      const frames = new Map<number, FrameRequestCallback>();
      let nextFrame = 0;
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
        frames.set(++nextFrame, callback);
        return nextFrame;
      });
      vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
        frames.delete(id);
      });
      const flushFrame = () => {
        for (const id of [...frames.keys()]) {
          const callback = frames.get(id);
          frames.delete(id);
          callback?.(performance.now());
        }
      };
      const creations: ReturnType<Editor["create"]>[] = [];
      const make = Editor.make;
      vi.spyOn(Editor, "make").mockImplementation(() => {
        const editor = make();
        const create = editor.create;
        vi.spyOn(editor, "create").mockImplementation(() => {
          const creation = create();
          creations.push(creation);
          return creation;
        });
        return editor;
      });
      const onChange = vi.fn();
      const onRevealConsumed = vi.fn();
      const props = {
        autofocus: false,
        documentId: "/fixtures/initial-anchor.md",
        initialView: { scrollTop: 37, selectionFrom: 1, selectionTo: 1 },
        onChange,
        onRevealConsumed,
        value: "# First\n\nbody\n\n## Destination\n",
      };
      const { container, rerender, unmount } = render(<VisualMarkdownEditor {...props} />, {
        wrapper: strictMode ? StrictMode : undefined,
      });
      await act(async () => {
        await Promise.all(creations);
      });
      expect(creations.length).toBeGreaterThan(0);
      expect(frames.size).toBeGreaterThan(0);
      const scroller = container.querySelector<HTMLElement>(".visual-markdown-editor")!;
      expect(scroller.querySelector(".ProseMirror h2")).toHaveTextContent("Destination");

      rerender(
        <VisualMarkdownEditor
          {...props}
          reveal={{ requestId: 1, anchor: "#first", scrollTop: 164 }}
        />,
      );
      const updated = { ...props, value: props.value.replace("body", "shared body") };
      const latestReveal = { requestId: 2, anchor: "#destination", scrollTop: 275 };
      rerender(<VisualMarkdownEditor {...updated} reveal={latestReveal} />);
      expect(scroller.querySelector(".ProseMirror p")).toHaveTextContent("shared body");
      expect(onChange).not.toHaveBeenCalled();
      expect(onRevealConsumed).not.toHaveBeenCalled();

      act(flushFrame);
      expect(onRevealConsumed).toHaveBeenCalledExactlyOnceWith(2);
      expect(scroller.scrollTop).toBe(275);
      // The parent clears consumed requests; later frames must not reset the view
      // or reapply that request over a subsequent user scroll.
      rerender(<VisualMarkdownEditor {...updated} />);
      scroller.scrollTop = 777;
      act(flushFrame);
      expect(scroller.scrollTop).toBe(777);
      expect(onRevealConsumed).toHaveBeenCalledOnce();
      rerender(
        <VisualMarkdownEditor
          {...updated}
          reveal={{ requestId: 3, anchor: "#first", scrollTop: 164 }}
        />,
      );
      expect(onRevealConsumed.mock.calls).toEqual([[2], [3]]);
      expect(scroller.scrollTop).toBe(164);
      unmount();
      act(flushFrame);
      expect(onRevealConsumed.mock.calls).toEqual([[2], [3]]);
    },
  );

  it("routes relative and fragment links exactly once from visual pointer gestures", async () => {
    const onInternalLink = vi.fn();
    const onChange = vi.fn();
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/fixtures/visual-links.md"
        onChange={onChange}
        onInternalLink={onInternalLink}
        value={
          "[**Next**](../guide/My%20Note.md#start)\n\n[Section](#本节)\n\n[Website](https://example.test/docs?q=hello#section)\n"
        }
      />,
    );
    const label = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(".ProseMirror strong a");
      expect(element).toHaveTextContent("Next");
      return element!;
    });
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
      fireEvent(label, event);
      expect(event.defaultPrevented).toBe(true);
      expect(onInternalLink).toHaveBeenCalledExactlyOnceWith(
        "../guide/My%20Note.md#start",
        disposition,
      );
    }

    onInternalLink.mockClear();
    fireEvent.click(
      container.querySelector<HTMLAnchorElement>('.ProseMirror a[href="#本节"]')!,
    );
    expect(onInternalLink).toHaveBeenCalledExactlyOnceWith("#本节", "current");
    onInternalLink.mockClear();
    fireEvent.click(
      container.querySelector<HTMLAnchorElement>(
        '.ProseMirror a[href="https://example.test/docs?q=hello#section"]',
      )!,
    );
    expect(onInternalLink).toHaveBeenCalledExactlyOnceWith(
      "https://example.test/docs?q=hello#section",
      "current",
    );
    onInternalLink.mockClear();
    fireEvent(label, new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    expect(onInternalLink).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(window.location.href).toBe(originalLocation);
  });

  it("keeps visual link callbacks attached to their instance after a split-focus update", async () => {
    const opened = vi.fn();
    function VisualSplit() {
      const [focused, setFocused] = useState("right");
      return (
        <>
          {["left", "right"].map((id) => (
            <section key={id} onPointerDownCapture={() => setFocused(id)}>
              <VisualMarkdownEditor
                autofocus={focused === id}
                documentId="/fixtures/shared-visual.md"
                instanceId={id}
                onChange={vi.fn()}
                onInternalLink={(target, disposition) =>
                  opened(id, focused, target, disposition)
                }
                value="[Next](./next.md#detail)"
              />
            </section>
          ))}
        </>
      );
    }
    const { container } = render(<VisualSplit />);
    const links = await waitFor(() => {
      const nodes = [...container.querySelectorAll<HTMLAnchorElement>(".ProseMirror a")];
      expect(nodes).toHaveLength(2);
      return nodes;
    });
    const originalEditors = [...container.querySelectorAll(".ProseMirror")];
    fireEvent.pointerDown(links[0]!, { button: 0 });
    fireEvent.click(links[0]!);
    expect(opened).toHaveBeenCalledExactlyOnceWith(
      "left",
      "left",
      "./next.md#detail",
      "current",
    );
    expect([...container.querySelectorAll(".ProseMirror")]).toEqual(originalEditors);
    opened.mockClear();
    fireEvent.pointerDown(links[1]!, { button: 1 });
    fireEvent(links[1]!, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(opened).toHaveBeenCalledExactlyOnceWith(
      "right",
      "right",
      "./next.md#detail",
      "newBackground",
    );
  });

  it.each([
    "./next.md#detail",
    "http://localhost:8080/docs",
    "https://example.test/docs?q=hello#section",
  ])(
    "routes Milkdown's mounted hover-preview link %s through the application",
    async (target) => {
      const onInternalLink = vi.fn();
      const onChange = vi.fn();
      const { container } = render(
        <VisualMarkdownEditor
          autofocus={false}
          documentId="/fixtures/preview-link.md"
          onChange={onChange}
          onInternalLink={onInternalLink}
          value={`[Next](${target})`}
        />,
      );
      const previewLink = await waitFor(() => {
        const anchor = container.querySelector<HTMLAnchorElement>(
          ".milkdown-link-preview a.link-display",
        );
        expect(anchor).toBeTruthy();
        return anchor!;
      });
      // Use Crepe's actual mounted anchor. Set the hover target directly because
      // jsdom cannot provide the text geometry needed by Floating UI positioning.
      previewLink.setAttribute("href", target);
      expect(previewLink.closest(".ProseMirror")).toBeNull();
      expect(onInternalLink).not.toHaveBeenCalled();

      for (const gesture of [
        { type: "click", button: 0, disposition: "current" },
        { type: "click", button: 0, metaKey: true, disposition: "newBackground" },
        { type: "auxclick", button: 1, disposition: "newBackground" },
      ]) {
        onInternalLink.mockClear();
        const event = new MouseEvent(gesture.type, {
          bubbles: true,
          cancelable: true,
          ...gesture,
        });
        fireEvent(previewLink, event);
        expect(event.defaultPrevented).toBe(true);
        expect(onInternalLink).toHaveBeenCalledExactlyOnceWith(target, gesture.disposition);
      }
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("maps passive visual updates while preserving focus, scroll, and the local Undo history", async () => {
    const findView = captureVisualViews();
    const onChange = vi.fn();
    const onViewChange = vi.fn();
    const props = {
      autofocus: false,
      documentId: "/tmp/shared-visual.md",
      onChange,
      onViewChange,
    };
    const { container, rerender } = render(
      <>
        <button type="button">outside</button>
        <VisualMarkdownEditor {...props} value={"first\n\nsecond\n"} />
      </>,
    );
    const view = await findView(container);
    await waitFor(() => expect(onViewChange).toHaveBeenCalled());
    const second = visualTextPosition(view, "second");
    act(() => {
      const transaction = view.state.tr.insertText("!", second + 6);
      view.dispatch(
        transaction.setSelection(TextSelection.create(transaction.doc, second + 2)),
      );
    });
    const scroller = container.querySelector<HTMLElement>(".visual-markdown-editor")!;
    scroller.scrollTop = 190;
    const outside = container.querySelector("button")!;
    outside.focus();
    onChange.mockClear();

    rerender(
      <>
        <button type="button">outside</button>
        <VisualMarkdownEditor {...props} value={"new first\n\nsecond!\n"} />
      </>,
    );

    expect(await findView(container)).toBe(view);
    expect(view.state.selection.from).toBe(second + 6);
    expect(scroller.scrollTop).toBe(190);
    expect(document.activeElement).toBe(outside);
    expect(onChange).not.toHaveBeenCalled();
    act(() => expect(undo(view.state, view.dispatch)).toBe(true));
    expect(view.state.doc.textContent).toBe("new firstsecond");
    act(() => expect(undo(view.state, view.dispatch)).toBe(false));
  });

  it("shares visual text across instances without broadcasting a passive synchronization", async () => {
    const findView = captureVisualViews();
    const callbacks = [vi.fn(), vi.fn()];
    const reports = [vi.fn(), vi.fn()];
    function SharedVisual() {
      const [value, setValue] = useState("first\n\nsecond\n");
      return (
        <>
          {callbacks.map((callback, index) => (
            <VisualMarkdownEditor
              key={index}
              autofocus={false}
              documentId="/tmp/same-visual.md"
              instanceId={`visual-${index}`}
              value={value}
              onViewChange={reports[index]}
              onChange={(next) => {
                callback(next);
                setValue(next);
              }}
            />
          ))}
        </>
      );
    }
    const { container } = render(<SharedVisual />);
    const first = await findView(container);
    const second = await findView(container, 1);
    await waitFor(() => expect(reports[1]).toHaveBeenCalled());
    const position = visualTextPosition(second, "second") + 2;
    act(() =>
      second.dispatch(
        second.state.tr.setSelection(TextSelection.create(second.state.doc, position)),
      ),
    );
    act(() => first.dispatch(first.state.tr.insertText("left ", 1)));
    await waitFor(() => expect(second.state.doc.textContent).toBe("left firstsecond"));
    expect(second.state.selection.from).toBe(position + 5);
    expect(callbacks[0]).toHaveBeenCalledOnce();
    expect(callbacks[1]).not.toHaveBeenCalled();
    act(() => expect(undo(second.state, second.dispatch)).toBe(false));
  });

  it("defers visual synchronization during IME and publishes a merged final draft", async () => {
    const findView = captureVisualViews();
    const onChange = vi.fn();
    const onViewChange = vi.fn();
    const props = {
      autofocus: false,
      documentId: "/tmp/visual-ime.md",
      onChange,
      onViewChange,
    };
    const { container, rerender } = render(
      <VisualMarkdownEditor {...props} value={"first\n\nsecond\n"} />,
    );
    const view = await findView(container);
    await waitFor(() => expect(onViewChange).toHaveBeenCalled());
    fireEvent.compositionStart(view.dom);
    rerender(<VisualMarkdownEditor {...props} value={"new first\n\nsecond\n"} />);
    expect(view.state.doc.textContent).toBe("firstsecond");
    act(() =>
      view.dispatch(view.state.tr.insertText("中文", visualTextPosition(view, "second"))),
    );
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.compositionEnd(view.dom);
    await waitFor(() => expect(view.state.doc.textContent).toBe("new first中文second"));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenLastCalledWith("new first\n\n中文second\n");
  });

  it("accepts external structural Markdown changes without adding an Undo step", async () => {
    const findView = captureVisualViews();
    const onChange = vi.fn();
    const onViewChange = vi.fn();
    const props = {
      autofocus: false,
      documentId: "/tmp/visual-structure.md",
      onChange,
      onViewChange,
    };
    const { container, rerender } = render(
      <VisualMarkdownEditor {...props} value={"# Heading\n\nbody\n"} />,
    );
    const view = await findView(container);
    await waitFor(() => expect(onViewChange).toHaveBeenCalled());

    rerender(<VisualMarkdownEditor {...props} value={"## Heading\n\n**body**\n"} />);

    expect(container.querySelector(".ProseMirror h2")).toHaveTextContent("Heading");
    expect(container.querySelector(".ProseMirror strong")).toHaveTextContent("body");
    expect(onChange).not.toHaveBeenCalled();
    act(() => expect(undo(view.state, view.dispatch)).toBe(false));

    rerender(
      <VisualMarkdownEditor
        {...props}
        value={"| Column | Value |\n| --- | --- |\n| one | two |\n"}
      />,
    );
    expect(container.querySelector(".ProseMirror table")).toHaveTextContent("one");
    expect(onChange).not.toHaveBeenCalled();
    act(() => expect(undo(view.state, view.dispatch)).toBe(false));

    rerender(<VisualMarkdownEditor {...props} value={"```text\nfirst\n```\n"} />);
    const codeView = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(
        ".milkdown-code-block .cm-editor",
      );
      expect(element).toBeTruthy();
      return CodeMirrorView.findFromDOM(element!)!;
    });
    const scrollRequests: boolean[] = [];
    codeView.dispatch({
      effects: StateEffect.appendConfig.of(
        CodeMirrorView.updateListener.of((update) => {
          for (const transaction of update.transactions) {
            if (transaction.docChanged) scrollRequests.push(transaction.scrollIntoView);
          }
        }),
      ),
    });
    const scroller = container.querySelector<HTMLElement>(".visual-markdown-editor")!;
    scroller.scrollTop = 280;

    rerender(<VisualMarkdownEditor {...props} value={"```text\nnew first\n```\n"} />);

    expect(codeView.state.doc.toString()).toBe("new first");
    expect(scrollRequests).toEqual([false]);
    expect(scroller.scrollTop).toBe(280);
    expect(onChange).not.toHaveBeenCalled();
    act(() => expect(undo(view.state, view.dispatch)).toBe(false));
  }, 15_000);

  it("renders TeX bracket math without converting code literals or changing on mount", async () => {
    const findView = captureVisualViews();
    const onChange = vi.fn();
    const source = [
      String.raw`Inline \(a_t + b_t\), existing $c_t$.`,
      "",
      String.raw`\[`,
      String.raw`q'_t = R_t q_t, \qquad k'_s = R_s k_s`,
      String.raw`\]`,
      "",
      "$$",
      "z = 1",
      "$$",
      "",
      "Inline code: `\\(literal\\)`.",
      "",
      "```text",
      String.raw`\[fenced\]`,
      "```",
      "",
      String.raw`    \(indented\)`,
      "",
      String.raw`Unclosed \(not math`,
      "",
    ].join("\n");
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/tmp/bracket-math.md"
        onChange={onChange}
        value={source}
      />,
    );
    const view = await findView(container);

    await waitFor(() => {
      const values = Array.from(
        container.querySelectorAll<HTMLElement>('[data-type="math_inline"]'),
      ).map((element) => element.dataset.value);
      expect(values).toEqual(expect.arrayContaining(["a_t + b_t", "c_t"]));
      expect(values).toHaveLength(2);
      expect(container.querySelectorAll(".katex-display")).toHaveLength(2);
    });

    const codeSources = Array.from(container.querySelectorAll<HTMLElement>(".cm-editor"))
      .map((element) => CodeMirrorView.findFromDOM(element)?.state.doc.toString())
      .filter((value): value is string => value !== undefined);
    expect(codeSources).toEqual(
      expect.arrayContaining([String.raw`\[fenced\]`, String.raw`\(indented\)`]),
    );
    expect(container.querySelector("code")).toHaveTextContent(String.raw`\(literal\)`);
    expect(container).toHaveTextContent("Unclosed (not math");
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      view.dispatch(
        view.state.tr.insertText("Changed ", visualTextPosition(view, "Inline")),
      );
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    const serialized = onChange.mock.lastCall?.[0] as string;
    expect(serialized).toContain("Changed Inline $a_t + b_t$, existing $c_t$.");
    expect(serialized).toContain(
      ["$$", String.raw`q'_t = R_t q_t, \qquad k'_s = R_s k_s`, "$$"].join("\n"),
    );
    expect(serialized).toContain(["$$", "z = 1", "$$"].join("\n"));
    expect(serialized).toContain(String.raw`\(literal\)`);
    expect(serialized).toContain(String.raw`\[fenced\]`);
    expect(serialized).toContain(String.raw`\(indented\)`);
    expect(serialized).not.toContain("$$fenced$$");
    expect(serialized).not.toContain("$$indented$$");

    act(() => expect(undo(view.state, view.dispatch)).toBe(true));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    const undone = onChange.mock.lastCall?.[0] as string;
    expect(undone).not.toContain("Changed Inline");
    expect(undone).toContain("Inline $a_t + b_t$, existing $c_t$.");
  }, 30_000);

  it("keeps an empty visual document free of Crepe's English placeholder", async () => {
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/tmp/empty.md"
        onChange={vi.fn()}
        value=""
      />,
    );

    await waitFor(() => expect(container.querySelector(".ProseMirror")).toBeTruthy());
    expect(container.querySelector("[data-placeholder]")).toBeNull();
    expect(container).not.toHaveTextContent("Please enter");
  });

  it("executes semantic block commands without exposing Markdown source", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/tmp/semantic-commands.md"
        onChange={onChange}
        value="可视化正文"
      />,
    );

    const editor = await waitFor(() => {
      const mounted = container.querySelector<HTMLElement>(".visual-markdown-editor");
      expect(mounted?.querySelector(".ProseMirror p")).toHaveTextContent("可视化正文");
      return mounted!;
    });
    const headingEvent = dispatchEditorCommand(editor, { command: "heading2" });
    expect(headingEvent.defaultPrevented).toBe(true);
    await waitFor(() => {
      const mounted = container.querySelector<HTMLElement>(".ProseMirror h2");
      expect(mounted).toHaveTextContent("可视化正文");
      return mounted!;
    });
    expect(container.querySelector(".ProseMirror")?.textContent).not.toContain("##");
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining("## 可视化正文")),
    );

    const paragraphEvent = dispatchEditorCommand(editor, { command: "paragraph" });
    expect(paragraphEvent.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(container.querySelector(".ProseMirror p")).toHaveTextContent("可视化正文"),
    );
  });

  it("does not mark a Mermaid document changed while components initialize", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/tmp/diagram.md"
        onChange={onChange}
        value={["# 图表", "", "```mermaid", "flowchart LR", "  A --> B", "```"].join("\n")}
      />,
    );

    await waitFor(() => expect(container.querySelector(".ProseMirror")).toBeTruthy());
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    expect(onChange).not.toHaveBeenCalled();
  }, 15_000);

  it("keeps tables visual, routes links, and rejects a pathological paste", async () => {
    const onChange = vi.fn();
    const onInternalLink = vi.fn();
    const onPasteRejected = vi.fn();
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/tmp/current.md"
        onChange={onChange}
        onInternalLink={onInternalLink}
        onPasteRejected={onPasteRejected}
        value={[
          "| 阶段 | 时间 |",
          "| --- | ---: |",
          "| 起稿 | 15 分钟 |",
          "",
          "[打开下一篇](./next.md)",
        ].join("\n")}
      />,
    );

    await waitFor(() =>
      expect(container.querySelector(".milkdown-table-block table")).toBeTruthy(),
    );
    expect(container.querySelector(".ProseMirror")?.textContent).not.toContain("| ---");

    const link = container.querySelector<HTMLAnchorElement>(
      '.ProseMirror a[href="./next.md"]',
    );
    if (!link) throw new Error("Visual Markdown link was not mounted");
    fireEvent.click(link);
    expect(onInternalLink).toHaveBeenCalledWith("./next.md", "current");

    const editor = container.querySelector<HTMLElement>(".ProseMirror");
    if (!editor) throw new Error("Visual Markdown editor was not mounted");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: () =>
          "data:image/png;base64," + "A".repeat(LARGE_PASTE_TEXT_THRESHOLD + 1),
      },
    });
    fireEvent(editor, paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(onPasteRejected).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();

    const firstCell = container.querySelector<HTMLElement>(
      ".milkdown-table-block tbody td p",
    );
    if (!firstCell) throw new Error("Editable table cell was not mounted");
    firstCell.textContent = "完成起稿";
    fireEvent.input(firstCell, { data: "完成", inputType: "insertText" });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.stringContaining("完成起稿")),
    );
  });

  it("inserts and edits a table through a visual grid and semantic commands", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/tmp/table-grid.md"
        onChange={onChange}
        value=""
      />,
    );

    const editor = await waitFor(() => {
      const mounted = container.querySelector<HTMLElement>(".visual-markdown-editor");
      expect(mounted?.querySelector(".ProseMirror")).toBeTruthy();
      return mounted!;
    });
    expect(container.querySelector('button[title="插入表格"]')).toBeNull();
    expect(container.querySelector('[data-testid="table-grid-popover"]')).toBeNull();
    const insertEvent = dispatchEditorCommand(editor, { command: "insertTable" });
    expect(insertEvent.defaultPrevented).toBe(true);
    expect(container.querySelector(".workspace-table-scroll")).toBeNull();
    let gridCell = await waitFor(() => {
      const mounted = container.querySelector<HTMLButtonElement>(
        'button[aria-label="4 行 × 5 列"]',
      );
      expect(mounted).toBeTruthy();
      return mounted!;
    });
    fireEvent.mouseEnter(gridCell);
    expect(container.querySelector('[data-testid="table-grid-popover"]')).toHaveTextContent(
      "4 行 × 5 列",
    );
    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(container.querySelector('[data-testid="table-grid-popover"]')).toBeNull(),
    );
    const reopenEvent = dispatchEditorCommand(editor, { command: "insertTable" });
    expect(reopenEvent.defaultPrevented).toBe(true);
    gridCell = await waitFor(() => {
      const mounted = container.querySelector<HTMLButtonElement>(
        'button[aria-label="4 行 × 5 列"]',
      );
      expect(mounted).toBeTruthy();
      return mounted!;
    });
    fireEvent.click(gridCell);

    await waitFor(() => {
      const mounted = container.querySelector<HTMLTableElement>(
        '.workspace-table-scroll[data-table-view="resizable"] table',
      );
      expect(mounted).toBeTruthy();
      return mounted!;
    });
    const currentTable = () => {
      const mounted = container.querySelector<HTMLTableElement>(
        '.workspace-table-scroll[data-table-view="resizable"] table',
      );
      if (!mounted) throw new Error("Visual table was not mounted");
      return mounted;
    };
    expect(currentTable().querySelectorAll("tr")).toHaveLength(4);
    expect(currentTable().querySelectorAll("tr:first-child th")).toHaveLength(5);
    expect(container.querySelector(".ProseMirror")?.textContent).not.toContain("| ---");
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toMatch(/^\|.*\|/u);
    const firstHeaderParagraph = currentTable().querySelector<HTMLElement>("th p");
    if (!firstHeaderParagraph) throw new Error("Editable table header was not mounted");
    firstHeaderParagraph.textContent = "标题";
    fireEvent.input(firstHeaderParagraph, { data: "标题", inputType: "insertText" });
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("标题"));

    const centerColumn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="居中对齐当前列"]',
    );
    if (!centerColumn) throw new Error("Table alignment tools were not mounted");
    fireEvent.click(centerColumn);
    await waitFor(() =>
      expect(currentTable().querySelector("th")?.style.textAlign).toBe("center"),
    );
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toMatch(/\|\s*:-+:\s*\|/u));

    const resizeButton = container.querySelector<HTMLButtonElement>(
      'button[title="调整表格大小"]',
    );
    if (!resizeButton) throw new Error("Table resize control was not mounted");
    expect(resizeButton).toHaveTextContent("4 × 5");
    fireEvent.click(resizeButton);
    const resizePopover = await waitFor(() => {
      const mounted = container.querySelector<HTMLElement>(
        '[data-testid="table-resize-popover"]',
      );
      expect(mounted).toBeTruthy();
      return mounted!;
    });
    fireEvent.change(resizePopover.querySelector('input[aria-label="行数"]')!, {
      target: { value: "3" },
    });
    fireEvent.change(resizePopover.querySelector('input[aria-label="列数"]')!, {
      target: { value: "4" },
    });
    fireEvent.click(
      resizePopover.querySelector(".visual-markdown-editor__table-size-apply")!,
    );
    await waitFor(() => expect(currentTable().querySelectorAll("tr")).toHaveLength(3));
    await waitFor(() =>
      expect(currentTable().querySelectorAll("tr:first-child th")).toHaveLength(4),
    );
    expect(currentTable().querySelector("th")?.style.textAlign).toBe("center");

    const proseMirror = container.querySelector<HTMLElement>(".ProseMirror");
    if (!proseMirror) throw new Error("Visual editor was not mounted");
    fireEvent.keyDown(proseMirror, { ctrlKey: true, key: "z" });
    await waitFor(() => expect(currentTable().querySelectorAll("tr")).toHaveLength(4));
    await waitFor(() =>
      expect(currentTable().querySelectorAll("tr:first-child th")).toHaveLength(5),
    );

    const addRow = container.querySelector<HTMLButtonElement>(
      'button[aria-label="在下方添加行"]',
    );
    const addColumn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="在右侧添加列"]',
    );
    if (!addRow || !addColumn) throw new Error("Selected-table tools were not mounted");
    fireEvent.click(addRow);
    await waitFor(() => expect(currentTable().querySelectorAll("tr")).toHaveLength(5));
    fireEvent.click(addColumn);
    await waitFor(() =>
      expect(currentTable().querySelectorAll("tr:first-child th")).toHaveLength(6),
    );

    const addRowBeforeEvent = dispatchEditorCommand(editor, {
      command: "addRowBefore",
    });
    expect(addRowBeforeEvent.defaultPrevented).toBe(true);
    await waitFor(() => expect(currentTable().querySelectorAll("tr")).toHaveLength(6));
    const deleteRowEvent = dispatchEditorCommand(editor, { command: "deleteRow" });
    expect(deleteRowEvent.defaultPrevented).toBe(true);
    await waitFor(() => expect(currentTable().querySelectorAll("tr")).toHaveLength(5));

    const addColumnBeforeEvent = dispatchEditorCommand(editor, {
      command: "addColumnBefore",
    });
    expect(addColumnBeforeEvent.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(currentTable().querySelectorAll("tr:first-child th")).toHaveLength(7),
    );
    const deleteColumnEvent = dispatchEditorCommand(editor, {
      command: "deleteColumn",
    });
    expect(deleteColumnEvent.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(currentTable().querySelectorAll("tr:first-child th")).toHaveLength(6),
    );

    const deleteTableEvent = dispatchEditorCommand(editor, { command: "deleteTable" });
    expect(deleteTableEvent.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(container.querySelector(".workspace-table-scroll")).toBeNull(),
    );
  });

  it("keeps wide table columns readable and column widths out of Markdown", async () => {
    const onChange = vi.fn();
    const positionSpy = vi
      .spyOn(ProseMirrorEditorView.prototype, "posAtCoords")
      .mockReturnValue({ inside: 2, pos: 4 });
    try {
      const { container } = render(
        <VisualMarkdownEditor
          autofocus={false}
          documentId="/tmp/wide-table.md"
          onChange={onChange}
          value={[
            "| 阶段 | 时间 | 要求 | 负责人 | 状态 | 备注 |",
            "| --- | --- | --- | --- | --- | --- |",
            "| 闭卷起稿 | 15 分钟 | 不询问 AI、先写自己的答案 | 个人 | 进行中 | 保留完整证据 |",
          ].join("\n")}
        />,
      );

      const viewport = await waitFor(() => {
        const mounted = container.querySelector<HTMLElement>(".workspace-table-scroll");
        expect(mounted).toBeTruthy();
        return mounted!;
      });
      const table = viewport.querySelector<HTMLTableElement>("table");
      const firstCell = viewport.querySelector<HTMLTableCellElement>("th");
      if (!table || !firstCell) throw new Error("Resizable table cells were not mounted");
      const editorScroller = container.querySelector<HTMLElement>(
        ".visual-markdown-editor",
      );
      expect(getComputedStyle(viewport).overflowX).toBe("auto");
      expect(getComputedStyle(editorScroller!).overflowX).toBe("hidden");
      expect(getComputedStyle(table).tableLayout).toBe("fixed");
      expect(table.style.getPropertyValue("--default-cell-min-width")).toBe("152px");
      expect(getComputedStyle(firstCell).wordBreak).toBe("normal");
      expect(getComputedStyle(firstCell).overflowWrap).toBe("break-word");
      expect(onChange).not.toHaveBeenCalled();

      Object.defineProperty(firstCell, "offsetWidth", {
        configurable: true,
        value: 152,
      });
      firstCell.getBoundingClientRect = () =>
        ({
          bottom: 40,
          height: 40,
          left: 0,
          right: 200,
          toJSON: () => ({}),
          top: 0,
          width: 200,
          x: 0,
          y: 0,
        }) as DOMRect;
      fireEvent.mouseMove(firstCell, { clientX: 198, clientY: 20 });
      const resizeHandle = await waitFor(() => {
        const mounted = firstCell.querySelector<HTMLElement>(".column-resize-handle");
        expect(mounted).toBeTruthy();
        return mounted!;
      });
      expect(getComputedStyle(resizeHandle).pointerEvents).toBe("auto");
      const mouseDown = fireEvent.mouseDown(firstCell, {
        button: 0,
        clientX: 200,
      });
      expect(mouseDown).toBe(false);
      dispatchDragMouseMove(window, 260);
      fireEvent.mouseUp(window, { button: 0, clientX: 260 });
      await waitFor(() =>
        expect(
          viewport.querySelector<HTMLTableCellElement>("th")?.getAttribute("data-colwidth"),
        ).toBe("212"),
      );
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      positionSpy.mockRestore();
    }
  });

  it("preserves CommonMark image alt text after visual edits and opens the resolved image", async () => {
    const onChange = vi.fn();
    const onOpenVisual = vi.fn();
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/workspace/guide/current.md"
        onChange={onChange}
        onOpenVisual={onOpenVisual}
        value={["![架构图说明](../assets/flow.png)", "", "编辑这段正文。"].join("\n")}
      />,
    );

    const image = await waitFor(() => {
      const mounted = container.querySelector<HTMLImageElement>('img[alt="架构图说明"]');
      expect(mounted).toBeTruthy();
      return mounted!;
    });
    expect(image.getAttribute("src")).toBe("/workspace/assets/flow.png");
    expect(container.querySelector(".milkdown-image-block")).toBeNull();

    fireEvent.click(image);
    expect(onOpenVisual).toHaveBeenCalledWith({
      kind: "image",
      source: "/workspace/assets/flow.png",
      title: "架构图说明",
      reference: "../assets/flow.png",
      documentPath: "/workspace/guide/current.md",
      imageAlt: "架构图说明",
      imageTitle: "",
    });

    const paragraph = Array.from(
      container.querySelectorAll<HTMLElement>(".ProseMirror p"),
    ).find((element) => element.textContent?.includes("编辑这段正文"));
    if (!paragraph) throw new Error("Editable paragraph was not mounted");
    paragraph.textContent = "已编辑正文。";
    fireEvent.input(paragraph, { data: "已", inputType: "insertText" });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const serialized = onChange.mock.calls.at(-1)?.[0] as string;
    expect(serialized).toContain("![架构图说明](../assets/flow.png)");
    expect(serialized).toContain("已编辑正文。");
  });

  it("edits the right-clicked image reference, not the caret target, and restores it with Undo", async () => {
    const findView = captureVisualViews();
    const onChange = vi.fn();
    const onOpenVisual = vi.fn();
    function Harness() {
      const context = useEditorContextMenu();
      return (
        <AppSettingsProvider storage={null}>
          <div
            onContextMenu={context.onContextMenu}
            onPointerDownCapture={context.onPointerDownCapture}
          >
            <VisualMarkdownEditor
              autofocus={false}
              documentId="/fixtures/guide.md"
              onChange={onChange}
              onOpenVisual={onOpenVisual}
              value={
                '![First](./first.png "First title")\n\n![Second](./second.png)\n\nCaret stays here.'
              }
            />
            <EditorContextMenu
              {...context.contextMenu}
              onClose={context.closeContextMenu}
            />
          </div>
        </AppSettingsProvider>
      );
    }
    const { container } = render(<Harness />);
    const view = await findView(container);
    const caret = visualTextPosition(view, "Caret stays here");
    act(() =>
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, caret)),
      ),
    );
    const image = container.querySelector<HTMLImageElement>('img[alt="First"]')!;
    expect(getComputedStyle(image).userSelect).toBe("none");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent(
      image,
      new MouseEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: true }),
    );
    fireEvent.mouseDown(image, { button: 0, ctrlKey: true });
    fireEvent.contextMenu(image, { ctrlKey: true, clientX: 50, clientY: 60 });
    expect(view.state.selection.from).toBe(caret);
    expect(screen.queryByRole("menuitem", { name: "段落" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "编辑图片引用…" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑图片引用" });
    expect(onChange).not.toHaveBeenCalled();
    expect(onOpenVisual).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "图片地址" }), {
      target: { value: "../assets/updated.png" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "替代文字" }), {
      target: { value: "新说明" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "标题（可选）" }), {
      target: { value: "新标题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls.at(-1)?.[0]).toContain(
      '![新说明](../assets/updated.png "新标题")',
    );
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("![Second](./second.png)");
    expect(view.state.selection.from).toBe(caret);
    act(() => expect(undo(view.state, view.dispatch)).toBe(true));
    expect(onChange.mock.calls.at(-1)?.[0]).toContain(
      '![First](./first.png "First title")',
    );
    act(() => expect(undo(view.state, view.dispatch)).toBe(false));
  });

  it("cancels image-reference editing without dirty, blocks unsafe addresses and rejects stale nodes", async () => {
    const findView = captureVisualViews();
    const onChange = vi.fn();
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/fixtures/image.md"
        locale="en-US"
        onChange={onChange}
        value='![Image](./before.png "Original")'
      />,
    );
    const view = await findView(container);
    const image = container.querySelector<HTMLImageElement>("img")!;
    const open = () => {
      expect(
        dispatchEditorCommand(view.dom, { command: "editImage", target: image })
          .defaultPrevented,
      ).toBe(true);
    };
    open();
    fireEvent.change(screen.getByRole("textbox", { name: "Image Address" }), {
      target: { value: "./cancelled.png" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Image Address" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    open();
    const leakedShortcut = vi.fn();
    window.addEventListener("keydown", leakedShortcut);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Image Address" }), {
      key: "w",
      metaKey: true,
    });
    window.removeEventListener("keydown", leakedShortcut);
    expect(leakedShortcut).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Image Address" }), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Embedded data is not supported");
    fireEvent.change(screen.getByRole("textbox", { name: "Image Address" }), {
      target: {
        value: "data:image/png;base64," + "A".repeat(LARGE_PASTE_TEXT_THRESHOLD + 1),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Image Address" }), {
      target: { value: "./edited.png" },
    });
    let imagePosition = -1;
    view.state.doc.descendants((node, position) => {
      if (node.type.name === "image") imagePosition = position;
    });
    act(() =>
      view.dispatch(
        view.state.tr.setNodeMarkup(imagePosition, undefined, {
          ...view.state.doc.nodeAt(imagePosition)!.attrs,
          src: "./changed-elsewhere.png",
        }),
      ),
    );
    onChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toHaveTextContent("image reference changed");
    expect(onChange).not.toHaveBeenCalled();
    expect(image.isConnected).toBe(false);
    expect(
      container.querySelector<HTMLImageElement>("img")!.dataset.visualImageReference,
    ).toBe("./changed-elsewhere.png");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });

  it("persists a visual clipboard image before inserting a CommonMark image node", async () => {
    const onChange = vi.fn();
    const onImagePaste = vi.fn(async () => "![剪贴板截图](./assets/paste.png)");
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/workspace/current.md"
        onChange={onChange}
        onImagePaste={onImagePaste}
        value=""
      />,
    );

    const editor = await waitFor(() => {
      const mounted = container.querySelector<HTMLElement>(".ProseMirror");
      expect(mounted).toBeTruthy();
      return mounted!;
    });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: () => "",
        items: [{ type: "image/png", getAsFile: () => new File(["png"], "paste.png") }],
      },
    });
    fireEvent(editor, paste);

    expect(paste.defaultPrevented).toBe(true);
    await waitFor(() => expect(onImagePaste).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.stringContaining("![剪贴板截图](./assets/paste.png)"),
      ),
    );
    expect(
      container.querySelector<HTMLImageElement>(
        'img[alt="剪贴板截图"][src="/workspace/assets/paste.png"]',
      ),
    ).toBeTruthy();
  });

  it.each([false, true])(
    "keeps the capture paste listener above a dirty empty paragraph after controlled rerenders (Strict Mode: %s)",
    async (strictMode) => {
      const findView = captureVisualViews();
      const onImagePaste = vi.fn<
        (selection: { from: number; to: number }, kind?: string) => Promise<string>
      >(async () => "![capture](./capture.png)");
      const onChange = vi.fn();
      function ControlledEditor({ revision }: { revision: number }) {
        const [value, setValue] = useState("seed");
        return (
          <VisualMarkdownEditor
            autofocus={false}
            documentId="/fixtures/capture-lifecycle.md"
            value={value}
            onChange={(next) => {
              setValue(next);
              onChange(next);
            }}
            onImagePaste={(selection, kind) => {
              void revision;
              return onImagePaste(selection, kind);
            }}
          />
        );
      }
      const { container, rerender } = render(<ControlledEditor revision={0} />, {
        wrapper: strictMode ? StrictMode : undefined,
      });
      const view = await findView(container);
      act(() => view.dispatch(view.state.tr.delete(1, 5)));
      expect(onChange).toHaveBeenCalledOnce();
      expect(view.state.doc.textContent).toBe("");
      rerender(<ControlledEditor revision={1} />);
      expect(container.querySelector(".ProseMirror")).toBe(view.dom);
      const scroller = container.querySelector(".visual-markdown-editor")!;
      const root = scroller.querySelector(".visual-markdown-editor__root")!;
      const paragraph = view.dom.querySelector<HTMLElement>("p")!;
      expect(root.contains(view.dom)).toBe(true);
      expect(scroller.contains(paragraph)).toBe(true);
      const key = new KeyboardEvent("keydown", {
        key: "v",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      fireEvent(paragraph, key);
      expect(key.defaultPrevented).toBe(false);
      const observedPaths: EventTarget[][] = [];
      const observe = (event: Event) => observedPaths.push(event.composedPath());
      const innerHandler = vi.fn();
      window.addEventListener("paste", observe, true);
      view.dom.addEventListener("paste", innerHandler);
      try {
        let paste!: Event;
        await act(async () => {
          paste = dispatchClipboardPaste(paragraph, { types: ["image/png"] });
        });
        expect(observedPaths).toHaveLength(1);
        expect(observedPaths[0]).toEqual(
          expect.arrayContaining([paragraph, view.dom, root, scroller]),
        );
        expect(paste.defaultPrevented).toBe(true);
        expect(onImagePaste).toHaveBeenCalledExactlyOnceWith({ from: 1, to: 1 }, "image");
        expect(innerHandler).not.toHaveBeenCalled();
        expect(view.dom.querySelector('img[alt="capture"]')).toBeTruthy();
        expect(onChange).toHaveBeenLastCalledWith(
          expect.stringContaining("![capture](./capture.png)"),
        );
      } finally {
        window.removeEventListener("paste", observe, true);
        view.dom.removeEventListener("paste", innerHandler);
      }
    },
  );

  it.each(["files", "types", "Files", "image-html", "empty-mime"])(
    "pastes visual screenshots with %s-only clipboard metadata after the host saves",
    async (representation) => {
      const findView = captureVisualViews();
      let finish!: (markdown: string) => void;
      const onChange = vi.fn();
      const onImagePaste = vi.fn(
        () => new Promise<string>((resolve) => (finish = resolve)),
      );
      const { container } = render(
        <VisualMarkdownEditor
          autofocus={false}
          documentId="/fixtures/capture.md"
          value="original"
          onChange={onChange}
          onImagePaste={onImagePaste}
        />,
      );
      const view = await findView(container);
      const original = view.state.doc;
      const event = dispatchClipboardPaste(
        view.dom,
        representation === "files"
          ? {
              files: [
                new File(["fixture"], "capture.png", { type: "image/png" }),
              ] as unknown as FileList,
            }
          : representation === "image-html"
            ? {
                types: ["image/png", "text/html", "text/plain"],
                getData: (type) =>
                  type === "text/html"
                    ? '<div><img src="file:///fixtures/capture.png"></div>'
                    : type === "text/plain"
                      ? "\n\uFFFC\n"
                      : "",
              }
            : representation === "empty-mime"
              ? {
                  types: ["image/png"],
                  items: [{ kind: "file", type: "" }] as unknown as DataTransferItemList,
                }
              : { types: representation === "types" ? ["image/tiff"] : ["Files"] },
      );
      expect(event.defaultPrevented).toBe(true);
      expect(onImagePaste).toHaveBeenCalledOnce();
      expect(onImagePaste).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: expect.any(Number), to: expect.any(Number) }),
        representation === "Files" ? "native-fallback" : "image",
      );
      expect(onChange).not.toHaveBeenCalled();
      expect(view.state.doc).toBe(original);
      // Ordinary focus/selection transactions must not invalidate the pending
      // image or change its insertion point; only actual document edits do.
      act(() =>
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6))),
      );
      expect(view.state.doc).toBe(original);
      await act(async () => finish("![test capture](./capture.png)"));
      expect(container.querySelector('img[alt="test capture"]')).toBeTruthy();
      expect(view.state.doc.firstChild?.firstChild?.type.name).toBe("image");
      expect(onChange).toHaveBeenLastCalledWith(
        expect.stringContaining("![test capture](./capture.png)"),
      );
      act(() => {
        undo(view.state, view.dispatch);
      });
      expect(view.state.doc.eq(original)).toBe(true);
    },
  );

  it("keeps mixed rich text paste normal and preserves visual text on image cancel or failure", async () => {
    const findView = captureVisualViews();
    const onChange = vi.fn();
    const onPasteError = vi.fn();
    const onImagePaste = vi.fn(async () => "");
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/fixtures/cancel.md"
        value="original"
        onChange={onChange}
        onImagePaste={onImagePaste}
        onPasteError={onPasteError}
      />,
    );
    const view = await findView(container);
    act(() =>
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 9))),
    );
    await act(async () => {
      dispatchClipboardPaste(view.dom, { types: ["image/png"] });
    });
    expect(view.state.doc.textContent).toBe("original");
    expect(onChange).not.toHaveBeenCalled();
    expect(onPasteError).not.toHaveBeenCalled();
    onImagePaste.mockRejectedValueOnce(new Error("disk full"));
    await act(async () => {
      dispatchClipboardPaste(view.dom, { types: ["image/tiff"] });
    });
    expect(view.state.doc.textContent).toBe("original");
    expect(onChange).not.toHaveBeenCalled();
    expect(onPasteError).toHaveBeenCalledWith("disk full");
    onImagePaste.mockClear();
    dispatchClipboardPaste(view.dom, {
      types: ["text/html", "text/plain", "image/png"],
      getData: (type) =>
        type === "text/html"
          ? "<p><strong>copied text</strong></p>"
          : type === "text/plain"
            ? "copied text"
            : "",
    });
    await waitFor(() => expect(view.state.doc.textContent).toContain("copied text"));
    expect(onImagePaste).not.toHaveBeenCalled();
  });

  it("rejects old visual paste positions after editing and discards results after a document switch", async () => {
    const findView = captureVisualViews();
    let finish!: (markdown: string) => void;
    const onImagePaste = () => new Promise<string>((resolve) => (finish = resolve));
    const onChange = vi.fn();
    const onPasteError = vi.fn();
    const { container, rerender } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/fixtures/first.md"
        locale="en-US"
        value="old"
        onChange={onChange}
        onImagePaste={onImagePaste}
        onPasteError={onPasteError}
      />,
    );
    const view = await findView(container);
    dispatchClipboardPaste(view.dom, { types: ["image/png"] });
    act(() => view.dispatch(view.state.tr.insertText("new ", 1)));
    await act(async () => finish("![](./capture.png)"));
    expect(view.state.doc.textContent).toBe("new old");
    expect(container.querySelector("img")).toBeNull();
    expect(onPasteError).toHaveBeenCalledWith(expect.stringContaining("document changed"));
    onChange.mockClear();
    onPasteError.mockClear();
    dispatchClipboardPaste(view.dom, { types: ["image/png"] });
    rerender(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/fixtures/second.md"
        value="second"
        onChange={onChange}
        onImagePaste={onImagePaste}
        onPasteError={onPasteError}
      />,
    );
    await act(async () => finish("![](./capture.png)"));
    const newView = await findView(container);
    expect(newView.state.doc.textContent).toBe("second");
    expect(container.querySelector("img")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(onPasteError).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "inserts a saved image once after visual Save As initialization and supports Undo (Strict Mode: %s)",
    async (strictMode) => {
      const findView = captureVisualViews();
      const onChange = vi.fn();
      const onImageInsertConsumed = vi.fn();
      const request = {
        id: 1,
        documentId: "/fixtures/saved.md",
        editorMode: "visual" as const,
        markdown: "![capture](./capture.png)",
        expectedText: "original",
        selection: { from: 9, to: 9 },
      };
      const { container, rerender } = render(
        <VisualMarkdownEditor
          autofocus={false}
          documentId={request.documentId}
          value="original"
          onChange={onChange}
          imageInsertRequest={request}
          onImageInsertConsumed={onImageInsertConsumed}
        />,
        { wrapper: strictMode ? StrictMode : undefined },
      );
      const view = await findView(container);
      await waitFor(() => expect(onImageInsertConsumed).toHaveBeenCalledExactlyOnceWith(1));
      expect(container.querySelector('img[alt="capture"]')).toBeTruthy();
      const serialized = onChange.mock.lastCall?.[0] as string;
      rerender(
        <VisualMarkdownEditor
          autofocus={false}
          documentId={request.documentId}
          value={serialized}
          onChange={onChange}
          imageInsertRequest={{ ...request }}
          onImageInsertConsumed={onImageInsertConsumed}
        />,
      );
      expect(onImageInsertConsumed).toHaveBeenCalledTimes(1);
      act(() => {
        undo(view.state, view.dispatch);
      });
      expect(container.querySelector("img")).toBeNull();
      expect(view.state.doc.textContent).toBe("original");
      onChange.mockClear();
      rerender(
        <VisualMarkdownEditor
          autofocus={false}
          documentId={request.documentId}
          value="new edit"
          onChange={onChange}
          imageInsertRequest={{ ...request, id: 2 }}
          onImageInsertConsumed={onImageInsertConsumed}
        />,
      );
      expect(onImageInsertConsumed).toHaveBeenLastCalledWith(2);
      expect(view.state.doc.textContent).toBe("new edit");
      expect(container.querySelector("img")).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("rejects large embedded-image HTML before a visual paste transaction", async () => {
    const findView = captureVisualViews();
    const onChange = vi.fn();
    const onPasteRejected = vi.fn();
    const onImagePaste = vi.fn(async () => "![](./capture.png)");
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/fixtures/html.md"
        value="original"
        onChange={onChange}
        onImagePaste={onImagePaste}
        onPasteRejected={onPasteRejected}
      />,
    );
    const view = await findView(container);
    const original = view.state.doc;
    const event = dispatchClipboardPaste(view.dom, {
      types: ["text/html", "image/png"],
      getData: (type) =>
        type === "text/html"
          ? '<img src="data:image/png;base64,' +
            "A".repeat(LARGE_PASTE_TEXT_THRESHOLD + 1) +
            '">'
          : "",
    });
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc).toBe(original);
    expect(onPasteRejected).toHaveBeenCalledOnce();
    expect(onImagePaste).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(["source", "visual"] as const)(
    "discards a queued %s image insertion when the surface changes before initialization finishes",
    async (editorMode) => {
      const frames = new Map<number, FrameRequestCallback>();
      let nextFrame = 0;
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
        frames.set(++nextFrame, callback);
        return nextFrame;
      });
      vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
        frames.delete(id);
      });
      const flushFrame = () => {
        for (const id of [...frames.keys()]) {
          const callback = frames.get(id);
          frames.delete(id);
          callback?.(performance.now());
        }
      };
      const creations: ReturnType<Editor["create"]>[] = [];
      const make = Editor.make;
      vi.spyOn(Editor, "make").mockImplementation(() => {
        const editor = make();
        const create = editor.create;
        vi.spyOn(editor, "create").mockImplementation(() => {
          const creation = create();
          creations.push(creation);
          return creation;
        });
        return editor;
      });
      const onChange = vi.fn();
      const onImageInsertConsumed = vi.fn();
      const request = {
        id: 1,
        documentId: "/fixtures/saved.md",
        editorMode,
        markdown: "![capture](./capture.png)",
        expectedText: "original",
        selection: { from: 2, to: 4 },
      };
      const props = {
        autofocus: false,
        documentId: request.documentId,
        mode: "normal" as const,
        value: request.expectedText,
        onChange,
        onImageInsertConsumed,
      };
      const { container, rerender } = render(
        <MarkdownEditor
          {...props}
          presentationMode={editorMode}
          imageInsertRequest={request}
        />,
      );
      await act(async () => {
        await Promise.all(creations);
      });
      expect(onImageInsertConsumed).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
      const nextMode = editorMode === "source" ? "visual" : "source";
      rerender(
        <MarkdownEditor
          {...props}
          presentationMode={nextMode}
          imageInsertRequest={request}
        />,
      );
      await act(async () => {
        await Promise.all(creations);
      });
      act(flushFrame);
      expect(onImageInsertConsumed).toHaveBeenCalledExactlyOnceWith(request.id);
      expect(onChange).not.toHaveBeenCalled();
      expect(container.querySelector("img")).toBeNull();
      expect(
        container.querySelector(nextMode === "visual" ? ".ProseMirror" : ".cm-content")
          ?.textContent,
      ).toBe("original");
      // The host removes a consumed request; returning to the original surface
      // must not replay its old ProseMirror/CodeMirror offsets.
      rerender(<MarkdownEditor {...props} presentationMode={editorMode} />);
      await act(async () => {
        await Promise.all(creations);
      });
      act(flushFrame);
      expect(onChange).not.toHaveBeenCalled();
      expect(onImageInsertConsumed).toHaveBeenCalledTimes(1);
      expect(container.querySelector("img")).toBeNull();
    },
  );

  it("preserves fenced-code selections for image and ambiguous empty pastes without a native read", async () => {
    const findView = captureVisualViews();
    const onChange = vi.fn();
    const onImagePaste = vi.fn(async () => "![capture](./capture.png)");
    const onPasteError = vi.fn();
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/fixtures/code.md"
        locale="en-US"
        value={"```text\nkeep the code\n```\n\nparagraph"}
        onChange={onChange}
        onImagePaste={onImagePaste}
        onPasteError={onPasteError}
      />,
    );
    const view = await findView(container);
    const code = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(".cm-content");
      expect(element).toBeTruthy();
      return element!;
    });
    const codeView = CodeMirrorView.findFromDOM(code)!;
    act(() => codeView.dispatch({ selection: { anchor: 0, head: 4 } }));
    const codeSelection = codeView.state.selection.main;
    const codeText = codeView.state.doc.toString();
    const original = view.state.doc;
    const event = dispatchClipboardPaste(code, { types: ["image/png"] });
    expect(event.defaultPrevented).toBe(true);
    expect(onPasteError).toHaveBeenCalledExactlyOnceWith(
      "Move the cursor outside the code block to paste an image.",
    );
    expect(onImagePaste).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(view.state.doc).toBe(original);
    onPasteError.mockClear();
    const emptyEvent = dispatchClipboardPaste(code, { types: ["Files"] });
    expect(emptyEvent.defaultPrevented).toBe(true);
    expect(onPasteError).not.toHaveBeenCalled();
    expect(onImagePaste).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(view.state.doc).toBe(original);
    expect(codeView.state.doc.toString()).toBe(codeText);
    expect(codeView.state.selection.main).toEqual(codeSelection);
    dispatchClipboardPaste(code, {
      types: ["text/plain"],
      getData: (type) => (type === "text/plain" ? "edit" : ""),
    });
    expect(codeView.state.doc.toString()).toBe("edit the code");
    expect(onImagePaste).not.toHaveBeenCalled();
    expect(onPasteError).not.toHaveBeenCalled();
  }, 15_000);

  it("prepares local image scopes before loading and ignores stale source or destroyed-node results", async () => {
    const findView = captureVisualViews();
    const pending = new Map<string, (source: string) => void>();
    vi.spyOn(imageSources, "resolveMarkdownImageSource").mockImplementation(
      (_document, source) => `asset://localhost/${source}`,
    );
    const prepare = vi
      .spyOn(imageSources, "prepareMarkdownImageSource")
      .mockImplementation(
        (_document, source) =>
          new Promise<string>((resolve) => pending.set(source, resolve)),
      );
    const onChange = vi.fn();
    const { container, unmount } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/fixtures/images.md"
        value="![test](./first.png)"
        onChange={onChange}
      />,
    );
    const view = await findView(container);
    const image = container.querySelector("img")!;
    expect(prepare).toHaveBeenCalledWith("/fixtures/images.md", "./first.png");
    expect(image.hasAttribute("src")).toBe(false);
    let position = -1;
    view.state.doc.descendants((node, offset) => {
      if (node.type.name === "image") position = offset;
    });
    act(() =>
      view.dispatch(
        view.state.tr.setNodeMarkup(position, undefined, {
          src: "./second.png",
          alt: "second",
          title: "",
        }),
      ),
    );
    const updated = container.querySelector("img")!;
    expect(updated.getAttribute("alt")).toBe("second");
    expect(updated.hasAttribute("src")).toBe(false);
    await act(async () => pending.get("./first.png")?.("asset://localhost/first.png"));
    expect(updated.hasAttribute("src")).toBe(false);
    await act(async () => pending.get("./second.png")?.("asset://localhost/second.png"));
    expect(updated.getAttribute("src")).toBe("asset://localhost/second.png");
    expect(updated.dataset.visualImageReference).toBe("./second.png");
    act(() =>
      view.dispatch(
        view.state.tr.setNodeMarkup(position, undefined, {
          src: "./third.png",
          alt: "third",
          title: "",
        }),
      ),
    );
    const thirdImage = container.querySelector("img")!;
    expect(thirdImage.hasAttribute("src")).toBe(false);
    unmount();
    await act(async () => pending.get("./third.png")?.("asset://localhost/third.png"));
    expect(thirdImage.hasAttribute("src")).toBe(false);
  });

  it("uses a localized light code-block theme with persistent controls and an unclipped picker", async () => {
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/tmp/code.md"
        onChange={vi.fn()}
        value={["```", "const answer = 42;", "", "console.log(answer);", "```"].join("\n")}
      />,
    );

    const codeMirror = await waitFor(() => {
      const mounted = container.querySelector<HTMLElement>(
        ".milkdown-code-block .cm-editor",
      );
      expect(mounted).toBeTruthy();
      return mounted!;
    });
    const view = CodeMirrorView.findFromDOM(codeMirror);
    if (!view) throw new Error("CodeMirror code-block view was not found");
    expect(view.state.facet(CodeMirrorView.darkTheme)).toBe(false);
    const gutters = codeMirror.querySelector<HTMLElement>(".cm-gutters");
    const activeGutter = codeMirror.querySelector<HTMLElement>(".cm-activeLineGutter");
    expect(gutters).toBeTruthy();
    expect(getComputedStyle(gutters!).display).not.toBe("none");
    expect(activeGutter).toBeTruthy();
    expect(getComputedStyle(activeGutter!).backgroundColor).toBe("rgb(219, 229, 245)");

    view.focus();
    view.dispatch({ selection: { anchor: 0, head: 5 } });
    expect(view.state.selection.main).toMatchObject({ from: 0, to: 5 });
    const selectionLayer = codeMirror.querySelector<HTMLElement>(".cm-selectionLayer");
    if (!selectionLayer) throw new Error("CodeMirror selection layer was not mounted");
    const selection = document.createElement("div");
    selection.className = "cm-selectionBackground";
    selectionLayer.append(selection);
    const activeLine = codeMirror.querySelector<HTMLElement>(".cm-activeLine");
    expect(activeLine).toBeTruthy();
    expect(getComputedStyle(selection).backgroundColor).toBe("rgb(184, 207, 248)");
    expect(getComputedStyle(activeLine!).backgroundColor).toBe("rgba(65, 105, 180, 0.12)");

    const codeBlock = codeMirror.closest<HTMLElement>(".milkdown-code-block");
    const copyButton = codeBlock?.querySelector<HTMLButtonElement>(".copy-button");
    const languageButton = codeBlock?.querySelector<HTMLButtonElement>(".language-button");
    if (!codeBlock || !copyButton || !languageButton) {
      throw new Error("Code-block controls were not mounted");
    }
    expect(copyButton).toHaveTextContent("复制");
    expect(getComputedStyle(copyButton).opacity).toBe("1");
    const writeText = vi.fn(async () => undefined);
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    fireEvent.click(copyButton);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("const answer = 42;\n\nconsole.log(answer);"),
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });
    await waitFor(() => expect(languageButton).toHaveTextContent("纯文本"));
    expect(getComputedStyle(codeBlock).overflow).toBe("visible");

    fireEvent.click(languageButton);
    const search = await waitFor(() => {
      const mounted = codeBlock.querySelector<HTMLInputElement>(
        'input[placeholder="搜索代码语言"]',
      );
      expect(mounted).toBeTruthy();
      return mounted!;
    });
    const languageList = codeBlock.querySelector<HTMLElement>(".language-list");
    expect(languageList).toBeTruthy();
    expect(getComputedStyle(languageList!).overflowY).toBe("auto");

    fireEvent.input(search, { target: { value: "not-a-real-language-value" } });
    await waitFor(() =>
      expect(codeBlock.querySelector(".language-list-item.no-result")).toHaveTextContent(
        "未找到匹配语言",
      ),
    );
  }, 15_000);

  it("localizes English code controls and honors code layout preferences", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        codeWrap
        documentId="/tmp/code-en.md"
        locale="en-US"
        onChange={onChange}
        showCodeLineNumbers={false}
        value={["```mermaid", "flowchart LR", "  A --> B", "```"].join("\n")}
      />,
    );

    const root = container.querySelector<HTMLElement>(".visual-markdown-editor");
    expect(root).toHaveAttribute("aria-label", "Markdown visual editor");
    expect(root).toHaveAttribute("data-code-line-numbers", "false");
    expect(root).toHaveAttribute("data-code-wrap", "true");

    const codeMirror = await waitFor(() => {
      const mounted = container.querySelector<HTMLElement>(
        ".milkdown-code-block .cm-editor",
      );
      expect(mounted).toBeTruthy();
      return mounted!;
    });
    expect(onChange).not.toHaveBeenCalled();
    const copyButton = container.querySelector<HTMLButtonElement>(".copy-button");
    const languageButton = container.querySelector<HTMLButtonElement>(".language-button");
    expect(copyButton).toHaveTextContent("Copy");
    const previewToggle = await waitFor(() => {
      const mounted = container.querySelector<HTMLButtonElement>(".preview-toggle-button");
      expect(mounted).toBeTruthy();
      return mounted!;
    });
    expect(previewToggle).toHaveTextContent("Edit diagram source");
    fireEvent.click(previewToggle);
    await waitFor(() => {
      expect(container.querySelector(".preview-label")).toHaveTextContent("Preview");
      expect(previewToggle).toHaveTextContent("Hide diagram source");
    });
    expect(onChange).not.toHaveBeenCalled();
    if (!languageButton) throw new Error("Language selector was not mounted");
    fireEvent.click(languageButton);
    await waitFor(() =>
      expect(
        container.querySelector<HTMLInputElement>(
          'input[placeholder="Search code languages"]',
        ),
      ).toBeTruthy(),
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(
      getComputedStyle(codeMirror.querySelector(".cm-content")! as Element).whiteSpace,
    ).toBe("break-spaces");
    expect(
      getComputedStyle(codeMirror.querySelector(".cm-gutters")! as Element).display,
    ).toBe("none");
    expect(onChange).not.toHaveBeenCalled();

    const codeView = CodeMirrorView.findFromDOM(codeMirror);
    if (!codeView) throw new Error("CodeMirror code-block view was not found");
    codeView.focus();
    codeView.dispatch({
      changes: {
        from: codeView.state.doc.length,
        insert: "\n  B --> C",
      },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    const editedMarkdown = onChange.mock.calls[0]?.[0] as string;
    expect(editedMarkdown).toContain("B --> C");
    expect(editedMarkdown).not.toContain("<br />");
  }, 15_000);

  it("completes a typed code-fence language with keyboard selection without polluting history", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/tmp/fence-hint.md"
        onChange={onChange}
        value="正文"
      />,
    );

    const paragraph = await waitFor(() => {
      const mounted = container.querySelector<HTMLElement>(".ProseMirror p");
      expect(mounted).toBeTruthy();
      return mounted!;
    });
    paragraph.focus();
    paragraph.textContent = "```p";
    const browserSelection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    browserSelection?.removeAllRanges();
    browserSelection?.addRange(range);
    fireEvent.input(paragraph, { data: "p", inputType: "insertText" });

    const completion = await waitFor(() => {
      const mounted = container.querySelector<HTMLElement>(
        '[data-testid="code-fence-completion"]',
      );
      expect(mounted).toBeTruthy();
      return mounted!;
    });
    expect(completion).toHaveTextContent("python");
    expect(completion).toHaveTextContent("php");
    expect(completion).toHaveTextContent("perl");
    expect(completion).toHaveTextContent("pascal");
    expect(completion).toHaveTextContent("Enter/Tab 创建");
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const changeCount = onChange.mock.calls.length;
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    expect(onChange).toHaveBeenCalledTimes(changeCount);

    fireEvent.keyDown(paragraph, { key: "ArrowDown" });
    expect(completion.querySelector('[data-selected="true"]')).toHaveTextContent("php");
    fireEvent.keyDown(paragraph, { key: "Enter" });

    await waitFor(() =>
      expect(container.querySelector(".milkdown-code-block .cm-editor")).toBeTruthy(),
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining("```php")),
    );
    expect(container.querySelector('[data-testid="code-fence-completion"]')).toBeNull();

    const editor = container.querySelector<HTMLElement>(".ProseMirror");
    if (!editor) throw new Error("Visual Markdown editor was not mounted");
    fireEvent.keyDown(editor, { key: "z", metaKey: true });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining("```p")),
    );
    const keyboard = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/tmp/fence-keyboard.md"
        onChange={vi.fn()}
        value="正文"
      />,
    );
    const keyboardParagraph = await waitFor(() => {
      const mounted = keyboard.container.querySelector<HTMLElement>(".ProseMirror p");
      expect(mounted).toBeTruthy();
      return mounted!;
    });
    keyboardParagraph.focus();
    keyboardParagraph.textContent = "```p";
    const keyboardSelection = window.getSelection();
    const keyboardRange = document.createRange();
    keyboardRange.selectNodeContents(keyboardParagraph);
    keyboardRange.collapse(false);
    keyboardSelection?.removeAllRanges();
    keyboardSelection?.addRange(keyboardRange);
    fireEvent.input(keyboardParagraph, { data: "p", inputType: "insertText" });
    await waitFor(() =>
      expect(
        keyboard.container.querySelector('[data-testid="code-fence-completion"]'),
      ).toBeTruthy(),
    );
    fireEvent.keyDown(keyboardParagraph, { key: "Escape" });
    expect(
      keyboard.container.querySelector('[data-testid="code-fence-completion"]'),
    ).toBeNull();

    keyboardParagraph.textContent = "```py";
    const changedRange = document.createRange();
    changedRange.selectNodeContents(keyboardParagraph);
    changedRange.collapse(false);
    keyboardSelection?.removeAllRanges();
    keyboardSelection?.addRange(changedRange);
    fireEvent.input(keyboardParagraph, { data: "y", inputType: "insertText" });
    await waitFor(() =>
      expect(
        keyboard.container.querySelector('[data-testid="code-fence-completion"]'),
      ).toHaveTextContent("python"),
    );
    fireEvent.keyDown(keyboardParagraph, { key: "Tab" });
    await waitFor(() =>
      expect(
        keyboard.container.querySelector(".milkdown-code-block .language-button"),
      ).toHaveTextContent("python"),
    );

    const disabled = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/tmp/fence-hint-disabled.md"
        onChange={vi.fn()}
        showTypingHints={false}
        value="正文"
      />,
    );
    const disabledParagraph = await waitFor(() => {
      const mounted = disabled.container.querySelector<HTMLElement>(".ProseMirror p");
      expect(mounted).toBeTruthy();
      return mounted!;
    });
    disabledParagraph.textContent = "```py";
    fireEvent.input(disabledParagraph, { data: "y", inputType: "insertText" });
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    expect(
      disabled.container.querySelector('[data-testid="code-fence-completion"]'),
    ).toBeNull();
  }, 15_000);

  it("aligns ordered and unordered list labels with the first text line", async () => {
    const { container } = render(
      <VisualMarkdownEditor
        autofocus={false}
        documentId="/tmp/lists.md"
        onChange={vi.fn()}
        value={["1. 第一项", "2. 第二项", "", "- 无序项目的正文会自然换行"].join("\n")}
      />,
    );

    const listItem = await waitFor(() => {
      const mounted = container.querySelector<HTMLElement>(
        ".milkdown-list-item-block > .list-item",
      );
      expect(mounted).toBeTruthy();
      return mounted!;
    });
    const labelWrapper = listItem.querySelector<HTMLElement>(".label-wrapper");
    const label = listItem.querySelector<HTMLElement>(".label");
    const firstParagraph = listItem.querySelector<HTMLElement>(".children p");
    if (!labelWrapper || !label || !firstParagraph) {
      throw new Error("Structured list item was not mounted");
    }
    expect(getComputedStyle(listItem).alignItems).toBe("flex-start");
    expect(getComputedStyle(label).paddingTop).toBe("0px");
    expect(getComputedStyle(firstParagraph).marginTop).toBe("0px");
    expect(getComputedStyle(labelWrapper).flexGrow).toBe("0");
  });
});
