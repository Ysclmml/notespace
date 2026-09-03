import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executeEditorContextMenuCommand } from "./editorCommands";
import { clipboardImagePasteKind } from "../editor/clipboardImage";
import {
  isOversizedInlineImagePaste,
  LARGE_PASTE_TEXT_THRESHOLD,
} from "../editor/pasteGuard";

const readText = vi.fn<() => Promise<string>>();
const writeText = vi.fn<(text: string) => Promise<void>>();
const originalExecCommand = document.execCommand;

function mockExecCommand(implementation: (command: string) => boolean = () => false) {
  const command = vi.fn(implementation);
  Object.defineProperty(document, "execCommand", { configurable: true, value: command });
  return command;
}

function editableSurface(className = "ProseMirror") {
  const editor = document.createElement("div");
  editor.className = className;
  editor.contentEditable = "true";
  editor.setAttribute("contenteditable", "true");
  editor.textContent = "keep this selection";
  document.body.append(editor);
  const range = document.createRange();
  range.setStart(editor.firstChild!, 0);
  range.setEnd(editor.firstChild!, 4);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return editor;
}

afterEach(() => {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: originalExecCommand,
  });
  vi.unstubAllGlobals();
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

beforeEach(() => {
  readText.mockReset();
  writeText.mockReset();
  readText.mockResolvedValue("pasted");
  writeText.mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { readText, writeText },
  });
});

describe("editor context-menu commands", () => {
  it("copies and cuts the selected text from a text control", async () => {
    const input = document.createElement("textarea");
    input.value = "alpha beta";
    document.body.append(input);
    input.setSelectionRange(0, 5);

    await expect(executeEditorContextMenuCommand("copy", input)).resolves.toBe(true);
    expect(writeText).toHaveBeenLastCalledWith("alpha");

    input.setSelectionRange(6, 10);
    await expect(executeEditorContextMenuCommand("cut", input)).resolves.toBe(true);
    expect(writeText).toHaveBeenLastCalledWith("beta");
    expect(input.value).toBe("alpha ");
    input.remove();
  });

  it("pastes and selects all in a text control", async () => {
    const input = document.createElement("input");
    input.value = "before after";
    document.body.append(input);
    input.setSelectionRange(7, 12);

    await expect(executeEditorContextMenuCommand("paste", input)).resolves.toBe(true);
    expect(input.value).toBe("before pasted");
    await expect(executeEditorContextMenuCommand("selectAll", input)).resolves.toBe(true);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    input.remove();
  });

  it("routes an image-only clipboard to the editor's native image handler once", async () => {
    readText.mockResolvedValue("");
    const native = mockExecCommand();
    const editor = editableSurface();
    const imagePaste = vi.fn();
    editor.addEventListener("paste", (event) => {
      const paste = event as ClipboardEvent;
      expect(paste.bubbles).toBe(true);
      expect(paste.cancelable).toBe(true);
      expect(clipboardImagePasteKind(paste.clipboardData)).toBe("native-fallback");
      paste.preventDefault();
      imagePaste();
    });

    await expect(executeEditorContextMenuCommand("paste", editor)).resolves.toBe(true);
    expect(imagePaste).toHaveBeenCalledTimes(1);
    expect(native).toHaveBeenCalledExactlyOnceWith("paste", false, undefined);
    expect(editor.textContent).toBe("keep this selection");
    expect(window.getSelection()?.toString()).toBe("keep");
  });

  it("does not replace the selection when an empty clipboard has no image handler", async () => {
    readText.mockResolvedValue("");
    const native = mockExecCommand();
    const editor = editableSurface();

    await expect(executeEditorContextMenuCommand("paste", editor)).resolves.toBe(false);
    expect(editor.textContent).toBe("keep this selection");
    expect(window.getSelection()?.toString()).toBe("keep");
    expect(native).toHaveBeenCalledExactlyOnceWith("paste", false, undefined);
  });

  it("does not synthesize another paste if native paste emitted an editor-consumed event", async () => {
    readText.mockResolvedValue("");
    const editor = editableSurface();
    const received = vi.fn((event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    });
    editor.addEventListener("paste", received, true);
    const native = mockExecCommand(() => {
      editor.dispatchEvent(new Event("paste", { bubbles: true, cancelable: true }));
      return false;
    });

    await expect(executeEditorContextMenuCommand("paste", editor)).resolves.toBe(true);
    expect(native).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledTimes(1);
    expect(editor.textContent).toBe("keep this selection");
  });

  it("preserves the native fallback after clipboard text permission is denied", async () => {
    readText.mockRejectedValue(new Error("clipboard access denied"));
    const editor = editableSurface();
    const received = vi.fn();
    editor.addEventListener("paste", received);
    const native = mockExecCommand(() => true);

    await expect(executeEditorContextMenuCommand("paste", editor)).resolves.toBe(true);
    expect(native).toHaveBeenCalledExactlyOnceWith("paste", false, undefined);
    expect(received).not.toHaveBeenCalled();
  });

  it("tries the native image handler when text access and native paste are unavailable", async () => {
    readText.mockRejectedValue(new Error("clipboard access denied"));
    mockExecCommand();
    const editor = editableSurface("cm-content");
    const imagePaste = vi.fn();
    editor.addEventListener("paste", (event) => {
      expect(clipboardImagePasteKind((event as ClipboardEvent).clipboardData)).toBe(
        "native-fallback",
      );
      event.preventDefault();
      imagePaste();
    });

    await expect(executeEditorContextMenuCommand("paste", editor)).resolves.toBe(true);
    expect(imagePaste).toHaveBeenCalledTimes(1);
  });

  it.each(["ProseMirror", "cm-content", "ordinary-contenteditable"])(
    "hands ordinary text to the %s paste handler before attempting any direct insertion",
    async (className) => {
      const native = mockExecCommand();
      const editor = editableSurface(className);
      const received: string[] = [];
      // A bubbling event lets the editor's ancestor capture guard intercept it.
      const guard = (event: Event) => {
        received.push((event as ClipboardEvent).clipboardData!.getData("text/plain"));
        event.preventDefault();
      };
      document.body.addEventListener("paste", guard);
      try {
        await expect(executeEditorContextMenuCommand("paste", editor)).resolves.toBe(true);
        expect(received).toEqual(["pasted"]);
        expect(native).not.toHaveBeenCalled();
        expect(editor.textContent).toBe("keep this selection");
      } finally {
        document.body.removeEventListener("paste", guard);
      }
    },
  );

  it("uses CodeMirror's normal paste transaction and Undo", async () => {
    const native = mockExecCommand();
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "before after",
        selection: { anchor: 7, head: 12 },
        extensions: [history()],
      }),
    });
    try {
      await expect(executeEditorContextMenuCommand("paste", view.contentDOM)).resolves.toBe(
        true,
      );
      expect(view.state.doc.toString()).toBe("before pasted");
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("before after");
      expect(native).not.toHaveBeenCalled();
    } finally {
      view.destroy();
    }
  });

  it("lets the oversized-image guard cancel the paste without an insertText bypass", async () => {
    readText.mockResolvedValue(
      `data:image/png;base64,${"A".repeat(LARGE_PASTE_TEXT_THRESHOLD + 1)}`,
    );
    const native = mockExecCommand();
    const editor = editableSurface();
    const rejected = vi.fn();
    editor.addEventListener("paste", (event) => {
      const value = (event as ClipboardEvent).clipboardData!.getData("text/plain");
      if (isOversizedInlineImagePaste(value)) {
        event.preventDefault();
        rejected();
      }
    });

    await expect(executeEditorContextMenuCommand("paste", editor)).resolves.toBe(true);
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(native).not.toHaveBeenCalled();
    expect(editor.textContent).toBe("keep this selection");
    expect(window.getSelection()?.toString()).toBe("keep");
  });

  it("keeps an input selection intact when the clipboard contains no text", async () => {
    readText.mockResolvedValue("");
    const native = mockExecCommand();
    const input = document.createElement("textarea");
    input.value = "keep selected";
    document.body.append(input);
    input.setSelectionRange(0, 4);

    await expect(executeEditorContextMenuCommand("paste", input)).resolves.toBe(false);
    expect(input.value).toBe("keep selected");
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
    expect(native).not.toHaveBeenCalled();
  });

  it.each(["removed", "changed", "renamed", "changed-markup"])(
    "discards clipboard results when the source document was %s while reading",
    async (change) => {
      let finish!: (value: string) => void;
      readText.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      const native = mockExecCommand();
      const editor = editableSurface();
      editor.setAttribute("data-document-id", "test-document.md");
      const received = vi.fn();
      editor.addEventListener("paste", received);
      const pending = executeEditorContextMenuCommand("paste", editor);
      if (change === "removed") editor.remove();
      if (change === "changed") editor.textContent = "new document text";
      if (change === "renamed") editor.setAttribute("data-document-id", "other.md");
      if (change === "changed-markup")
        editor.innerHTML = "<strong>keep</strong> this selection";
      finish("late paste");

      await expect(pending).resolves.toBe(false);
      expect(received).not.toHaveBeenCalled();
      expect(native).not.toHaveBeenCalled();
      expect(editor.textContent).not.toContain("late paste");
    },
  );

  it("supports WebViews without DataTransfer and ClipboardEvent constructors", async () => {
    vi.stubGlobal("DataTransfer", undefined);
    vi.stubGlobal("ClipboardEvent", undefined);
    const editor = editableSurface();
    const received = vi.fn((event: Event) => {
      expect((event as ClipboardEvent).clipboardData!.getData("text/plain")).toBe("pasted");
      expect((event as ClipboardEvent).clipboardData!.getData("text/html")).toBe("");
      event.preventDefault();
    });
    editor.addEventListener("paste", received);

    await expect(executeEditorContextMenuCommand("paste", editor)).resolves.toBe(true);
    expect(received).toHaveBeenCalledTimes(1);
  });

  it("selects content inside a contenteditable surface", async () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.textContent = "editable code";
    document.body.append(editor);

    await expect(executeEditorContextMenuCommand("selectAll", editor)).resolves.toBe(true);
    expect(window.getSelection()?.toString()).toBe("editable code");
    editor.remove();
  });

  it("dispatches undo and redo to the editor target", async () => {
    const input = document.createElement("textarea");
    document.body.append(input);
    const originalExecCommand = document.execCommand;
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await expect(executeEditorContextMenuCommand("undo", input)).resolves.toBe(true);
    await expect(executeEditorContextMenuCommand("redo", input)).resolves.toBe(true);
    expect(execCommand).toHaveBeenNthCalledWith(1, "undo", false, undefined);
    expect(execCommand).toHaveBeenNthCalledWith(2, "redo", false, undefined);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: originalExecCommand,
    });
    input.remove();
  });

  it("opens and copies a link without assigning window.location", async () => {
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "./next.md#details");
    const target = document.createElement("span");
    anchor.append(target);
    document.body.append(anchor);
    const clicks: MouseEvent[] = [];
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      clicks.push(event);
    });

    await expect(executeEditorContextMenuCommand("openLink", target)).resolves.toBe(true);
    await expect(executeEditorContextMenuCommand("openLinkNewTab", target)).resolves.toBe(
      true,
    );
    await expect(executeEditorContextMenuCommand("copyLink", target)).resolves.toBe(true);

    expect(clicks).toHaveLength(2);
    expect(clicks[0]?.metaKey).toBe(false);
    expect(clicks[1]?.metaKey).toBe(true);
    expect(writeText).toHaveBeenCalledWith("./next.md#details");
    anchor.remove();
  });

  it("only reports visual structure commands handled when the editor accepts them", async () => {
    const editor = document.createElement("div");
    editor.className = "ProseMirror";
    editor.contentEditable = "true";
    const paragraph = document.createElement("p");
    paragraph.textContent = "editable";
    editor.append(paragraph);
    document.body.append(editor);
    const commands: string[] = [];
    editor.addEventListener("markdown-workspace:editor-command", (event) => {
      commands.push((event as CustomEvent<{ command: string }>).detail.command);
      if ((event as CustomEvent<{ command: string }>).detail.command === "heading2") {
        event.preventDefault();
      }
    });

    await expect(executeEditorContextMenuCommand("heading2", paragraph)).resolves.toBe(
      true,
    );
    await expect(executeEditorContextMenuCommand("insertTable", paragraph)).resolves.toBe(
      false,
    );
    expect(commands).toEqual(["heading2", "insertTable"]);
    editor.remove();
  });
});
