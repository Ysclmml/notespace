import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { undo } from "@codemirror/commands";
import { language as codeMirrorLanguage } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { installCodeMirrorDomMeasurementStubs } from "../editor/spike/domTestSupport";
import { CodeFilePreview } from "./CodeFilePreview";

beforeAll(() => installCodeMirrorDomMeasurementStubs());

describe("CodeFilePreview", () => {
  it("restores independent code-tab snapshots and rebuilds only for a different instance", async () => {
    const onViewChange = vi.fn();
    const props = {
      content: "first\nsecond\nthird",
      editable: true,
      language: "text",
      path: "/tmp/snapshot.txt",
      onViewChange,
    };
    const { container, rerender } = render(
      <CodeFilePreview
        {...props}
        instanceId="left"
        initialView={{ scrollTop: 140, selectionFrom: 7, selectionTo: 9 }}
      />,
    );
    const firstEditor = container.querySelector<HTMLElement>(".cm-editor")!;
    const first = EditorView.findFromDOM(firstEditor)!;
    await waitFor(() => expect(first.scrollDOM.scrollTop).toBe(140));
    expect(first.state.selection.main).toMatchObject({ from: 7, to: 9 });
    first.scrollDOM.scrollTop = 250;
    fireEvent.scroll(first.scrollDOM);
    expect(onViewChange).toHaveBeenLastCalledWith({
      scrollTop: 250,
      selectionFrom: 7,
      selectionTo: 9,
    });

    rerender(
      <CodeFilePreview
        {...props}
        instanceId="left"
        initialView={{ scrollTop: 0, selectionFrom: 0, selectionTo: 0 }}
      />,
    );
    expect(EditorView.findFromDOM(firstEditor)).toBe(first);
    expect(first.scrollDOM.scrollTop).toBe(250);
    expect(first.state.selection.main.from).toBe(7);

    rerender(
      <CodeFilePreview
        {...props}
        instanceId="right"
        initialView={{ scrollTop: 320, selectionFrom: 1, selectionTo: 3 }}
      />,
    );
    const second = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    expect(second).not.toBe(first);
    await waitFor(() => expect(second.scrollDOM.scrollTop).toBe(320));
    expect(second.state.selection.main).toMatchObject({ from: 1, to: 3 });
  });

  it("gives explicit target-line navigation priority without jumping again on passive updates", async () => {
    const onViewChange = vi.fn();
    const props = {
      editable: true,
      language: "text",
      path: "/tmp/target.txt",
      onViewChange,
      targetLine: 2,
      initialView: { scrollTop: 340, selectionFrom: 0, selectionTo: 0 },
    };
    const { container, rerender } = render(
      <CodeFilePreview {...props} content={"first\nsecond\nthird"} />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    await waitFor(() => expect(onViewChange).toHaveBeenCalled());
    expect(view.state.selection.main.from).toBe(6);
    expect(view.scrollDOM.scrollTop).not.toBe(340);
    act(() => view.dispatch({ selection: { anchor: 15 } }));
    view.scrollDOM.scrollTop = 275;

    rerender(<CodeFilePreview {...props} content={"new first\nsecond\nthird"} />);

    expect(view.state.selection.main.from).toBe(19);
    expect(view.scrollDOM.scrollTop).toBe(275);
  });

  it("maps passive code changes without feedback, stolen focus, or extra Undo entries", async () => {
    const onChange = vi.fn();
    const onViewChange = vi.fn();
    const props = {
      editable: true,
      language: "text",
      path: "/tmp/undo.txt",
      onChange,
      onViewChange,
    };
    const { container, rerender } = render(
      <>
        <button type="button">outside</button>
        <CodeFilePreview {...props} content={"first\nsecond"} />
      </>,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    await waitFor(() => expect(onViewChange).toHaveBeenCalled());
    act(() =>
      view.dispatch({
        changes: { from: view.state.doc.length, insert: "!" },
        selection: { anchor: 8 },
      }),
    );
    view.scrollDOM.scrollTop = 210;
    const outside = container.querySelector("button")!;
    outside.focus();
    onChange.mockClear();

    rerender(
      <>
        <button type="button">outside</button>
        <CodeFilePreview {...props} content={"new first\nsecond!"} />
      </>,
    );

    expect(view.state.selection.main.from).toBe(12);
    expect(view.scrollDOM.scrollTop).toBe(210);
    expect(document.activeElement).toBe(outside);
    expect(onChange).not.toHaveBeenCalled();
    act(() => expect(undo(view)).toBe(true));
    expect(view.state.doc.toString()).toBe("new first\nsecond");
    act(() => expect(undo(view)).toBe(false));
  });

  it("shares code text between two instances while keeping local history separate", async () => {
    const callbacks = [vi.fn(), vi.fn()];
    function SharedCode() {
      const [content, setContent] = useState("first\nsecond");
      return (
        <>
          {callbacks.map((callback, index) => (
            <CodeFilePreview
              key={index}
              content={content}
              editable
              instanceId={`code-${index}`}
              language="text"
              path="/tmp/shared.txt"
              onChange={(next) => {
                callback(next);
                setContent(next);
              }}
            />
          ))}
        </>
      );
    }
    const { container } = render(<SharedCode />);
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

  it("defers code synchronization during composition and merges the completed draft", async () => {
    const onChange = vi.fn();
    const props = { editable: true, language: "text", path: "/tmp/ime.txt", onChange };
    const { container, rerender } = render(
      <CodeFilePreview {...props} content={"first\nsecond"} />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    fireEvent.compositionStart(view.contentDOM);
    rerender(<CodeFilePreview {...props} content={"new first\nsecond"} />);
    expect(view.state.doc.toString()).toBe("first\nsecond");
    act(() => view.dispatch({ changes: { from: 6, insert: "中文" } }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.compositionEnd(view.contentDOM);
    await waitFor(() => expect(view.state.doc.toString()).toBe("new first\n中文second"));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenLastCalledWith("new first\n中文second");
  });

  it("coalesces deferred shared updates even when the newest update returns to the original text", async () => {
    const onChange = vi.fn();
    const props = {
      editable: true,
      language: "text",
      path: "/tmp/coalesced-ime.txt",
      onChange,
    };
    const { container, rerender } = render(
      <CodeFilePreview {...props} content="original" />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    fireEvent.compositionStart(view.contentDOM);
    rerender(<CodeFilePreview {...props} content="obsolete shared change" />);
    rerender(<CodeFilePreview {...props} content="original" />);
    act(() => view.dispatch({ changes: { from: 0, insert: "中文" } }));
    fireEvent.compositionEnd(view.contentDOM);
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(view.state.doc.toString()).toBe("中文original");
    expect(onChange).toHaveBeenLastCalledWith("中文original");
  });

  it.each([
    {
      content: '{\n  "name": "workspace",\n  "enabled": true\n}',
      expectedLanguage: "json",
      language: "json",
      path: "/tmp/settings.json",
    },
    {
      content: '#!/bin/sh\necho "ready"\nexit 0',
      expectedLanguage: "shell",
      language: "shell",
      path: "/tmp/start.sh",
    },
    {
      content: "def run():\n    return True",
      expectedLanguage: "python",
      language: "python",
      path: "/tmp/run.py",
    },
    {
      content: "const ready = true;\nconsole.log(ready);",
      expectedLanguage: "javascript",
      language: "javascript",
      path: "/tmp/run.js",
    },
    {
      content: "const ready: boolean = true;\nexport { ready };",
      expectedLanguage: "typescript",
      language: "typescript",
      path: "/tmp/run.ts",
    },
    {
      content: ".panel {\n  display: grid;\n}",
      expectedLanguage: "css",
      language: "css",
      path: "/tmp/app.css",
    },
    {
      content: 'fn main() {\n    println!("ready");\n}',
      expectedLanguage: "rust",
      language: "rust",
      path: "/tmp/main.rs",
    },
    {
      content: "class Main {\n  boolean ready = true;\n}",
      expectedLanguage: "java",
      language: "java",
      path: "/tmp/Main.java",
    },
    {
      content: "class Main {\n  bool ready = true;\n}",
      expectedLanguage: "csharp",
      language: "csharp",
      path: "/tmp/Main.cs",
    },
  ])(
    "loads $language as a line-numbered CodeMirror language instead of rich text",
    async ({ content, expectedLanguage, language, path }) => {
      const { container } = render(
        <CodeFilePreview content={content} language={language} path={path} variant="tab" />,
      );
      const editor = container.querySelector<HTMLElement>(".cm-editor");
      if (!editor) throw new Error("CodeMirror editor was not mounted");
      const view = EditorView.findFromDOM(editor);
      if (!view) throw new Error("CodeMirror view was not found");

      await waitFor(() =>
        expect(view.state.facet(codeMirrorLanguage)?.name).toBe(expectedLanguage),
      );
      await waitFor(() =>
        expect(container.querySelector(".cm-line span")).toBeInTheDocument(),
      );
      expect(view.state.doc.toString()).toBe(content);
      expect(container.querySelector(".ProseMirror")).not.toBeInTheDocument();
      expect(container.querySelector(".cm-content")).toBeInTheDocument();
      expect(getComputedStyle(container.querySelector(".cm-scroller")!).overflow).toBe(
        "auto",
      );
      expect(
        [...container.querySelectorAll(".cm-gutterElement")].some(
          (element) => element.textContent === "1",
        ),
      ).toBe(true);
    },
  );

  it("keeps an unsupported language in a clean plain-text CodeMirror surface", () => {
    const { container } = render(
      <CodeFilePreview
        content={"key=value\nnext=true"}
        language="config"
        path="/tmp/.env"
        variant="tab"
      />,
    );
    const editor = container.querySelector<HTMLElement>(".cm-editor");
    if (!editor) throw new Error("CodeMirror editor was not mounted");
    const view = EditorView.findFromDOM(editor);
    if (!view) throw new Error("CodeMirror view was not found");

    expect(view.state.facet(codeMirrorLanguage)).toBeNull();
    expect(view.state.doc.toString()).toBe("key=value\nnext=true");
    expect(container.querySelector(".ProseMirror")).not.toBeInTheDocument();
  });

  it.each(["tab", "popover", "split"] as const)(
    "keeps selection and the active line distinct in the %s code surface",
    async (variant) => {
      const { container } = render(
        <CodeFilePreview
          content={"const selected = true;\nconst next = false;"}
          language="javascript"
          path="/tmp/selection.js"
          variant={variant}
        />,
      );
      const editor = container.querySelector<HTMLElement>(".cm-editor");
      if (!editor) throw new Error("CodeMirror editor was not mounted");
      const view = EditorView.findFromDOM(editor);
      if (!view) throw new Error("CodeMirror view was not found");

      view.focus();
      view.dispatch({ selection: { anchor: 6, head: 14 } });

      expect(view.state.selection.main).toMatchObject({ from: 6, to: 14 });
      // jsdom has no text geometry, so CodeMirror cannot draw a real selection
      // rectangle. Mount the same layer node to verify the live surface theme.
      const selectionLayer = container.querySelector<HTMLElement>(".cm-selectionLayer");
      if (!selectionLayer) throw new Error("CodeMirror selection layer was not mounted");
      const selection = document.createElement("div");
      selection.className = "cm-selectionBackground";
      selectionLayer.append(selection);
      const activeLine = container.querySelector<HTMLElement>(".cm-activeLine");
      const activeGutter = container.querySelector<HTMLElement>(".cm-activeLineGutter");
      expect(activeLine).toBeTruthy();
      expect(activeGutter).toBeTruthy();
      expect(getComputedStyle(selection).backgroundColor).toBe("rgb(184, 207, 248)");
      expect(getComputedStyle(activeLine!).backgroundColor).toBe(
        "rgba(65, 105, 180, 0.12)",
      );
      expect(getComputedStyle(activeGutter!).backgroundColor).toBe("rgb(219, 229, 245)");
      expect(getComputedStyle(selection).backgroundColor).not.toBe(
        getComputedStyle(activeLine!).backgroundColor,
      );
    },
  );

  it("restores syntax highlighting when a preview is replaced by another file of the same language", async () => {
    const firstContent = "def first():\n    return True";
    const secondContent = "def second():\n    return False";
    const { container, rerender } = render(
      <CodeFilePreview
        content={firstContent}
        language="python"
        path="/tmp/first.py"
        variant="split"
      />,
    );
    const firstEditor = container.querySelector<HTMLElement>(".cm-editor");
    if (!firstEditor) throw new Error("The first CodeMirror editor was not mounted");
    const firstView = EditorView.findFromDOM(firstEditor);
    if (!firstView) throw new Error("The first CodeMirror view was not found");
    await waitFor(() =>
      expect(firstView.state.facet(codeMirrorLanguage)?.name).toBe("python"),
    );

    rerender(
      <CodeFilePreview
        content={secondContent}
        language="python"
        path="/tmp/second.py"
        variant="split"
      />,
    );

    await waitFor(() => {
      const secondEditor = container.querySelector<HTMLElement>(".cm-editor");
      if (!secondEditor)
        throw new Error("The replacement CodeMirror editor was not mounted");
      const secondView = EditorView.findFromDOM(secondEditor);
      if (!secondView) throw new Error("The replacement CodeMirror view was not found");
      expect(secondView).not.toBe(firstView);
      expect(secondView.state.doc.toString()).toBe(secondContent);
      expect(secondView.state.facet(codeMirrorLanguage)?.name).toBe("python");
      expect(container.querySelector(".cm-line span")).toBeInTheDocument();
    });
  });

  it("shows real file line context and exposes open/copy actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const onOpenFile = vi.fn();
    const onOpenSide = vi.fn();
    render(
      <CodeFilePreview
        compact
        content={"first\nsecond\nthird"}
        language="python"
        onOpenFile={onOpenFile}
        onOpenSide={onOpenSide}
        path="/tmp/worker.py"
        startLine={40}
        targetLine={41}
      />,
    );

    expect(screen.getByText("Python")).toBeInTheDocument();
    expect(screen.getByText("第 41 行")).toBeInTheDocument();
    const openButton = screen.getByRole("button", { name: "打开文件" });
    expect(getComputedStyle(openButton).whiteSpace).toBe("nowrap");
    fireEvent.click(openButton);
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "在右侧打开" }));
    expect(onOpenSide).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("first\nsecond\nthird"));
  });

  it("renders a longer context without truncating it and marks the popover layout", () => {
    const content = Array.from({ length: 36 }, (_, index) => `line ${index + 1}`).join(
      "\n",
    );
    const { container } = render(
      <CodeFilePreview
        content={content}
        language="rust"
        path="/tmp/worker.rs"
        startLine={80}
        targetLine={104}
        variant="popover"
      />,
    );

    expect(screen.getByTestId("code-file-preview")).toHaveAttribute(
      "data-variant",
      "popover",
    );
    expect(container.querySelector(".cm-content")?.textContent).toContain("line 36");
    expect(screen.getByText(104)).toBeInTheDocument();
  });

  it("supports an explicitly editable main-tab surface without rebuilding the view", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <CodeFilePreview
        content="const answer = 41;"
        editable
        language="javascript"
        onChange={onChange}
        path="/tmp/answer.js"
        variant="tab"
      />,
    );
    const editor = container.querySelector<HTMLElement>(".cm-editor");
    if (!editor) throw new Error("CodeMirror editor was not mounted");
    const view = EditorView.findFromDOM(editor);
    if (!view) throw new Error("CodeMirror view was not found");
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\nanswer += 1;" } });

    expect(onChange).toHaveBeenLastCalledWith("const answer = 41;\nanswer += 1;");
    const originalView = view;
    rerender(
      <CodeFilePreview
        content="const answer = 42;"
        editable
        language="javascript"
        onChange={onChange}
        path="/tmp/answer.js"
        variant="tab"
      />,
    );
    expect(EditorView.findFromDOM(editor)).toBe(originalView);
    expect(originalView.state.doc.toString()).toBe("const answer = 42;");
  });

  it("keeps split and popover previews read-only by default", () => {
    const onClose = vi.fn();
    const { container } = render(
      <CodeFilePreview
        content="fn main() {}"
        language="rust"
        onClose={onClose}
        path="/tmp/main.rs"
        variant="split"
      />,
    );
    const editor = container.querySelector<HTMLElement>(".cm-editor");
    if (!editor) throw new Error("CodeMirror editor was not mounted");
    const view = EditorView.findFromDOM(editor);
    if (!view) throw new Error("CodeMirror view was not found");

    expect(screen.getByTestId("code-file-preview")).toHaveAttribute(
      "data-editable",
      "false",
    );
    expect(view.state.readOnly).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "关闭右侧预览" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
