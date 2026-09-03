import { beforeEach, describe, expect, it, vi } from "vitest";

import { executeEditorContextMenuCommand } from "./editorCommands";

const readText = vi.fn<() => Promise<string>>();
const writeText = vi.fn<(text: string) => Promise<void>>();

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
