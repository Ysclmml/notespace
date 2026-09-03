import {
  copyLoadedImage,
  imageMarkdownReference,
  resolveImageActionTarget,
  type ImageActionCommand,
} from "../image-actions/imageActions";

export type EditorContextMenuCommand =
  | ImageActionCommand
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "selectAll"
  | "openLink"
  | "openLinkNewTab"
  | "copyLink"
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "blockquote"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "toggleBold"
  | "toggleItalic"
  | "toggleStrike"
  | "toggleInlineCode"
  | "clearFormatting"
  | "codeBlock"
  | "horizontalRule"
  | "insertTable"
  | "addRowBefore"
  | "addRowAfter"
  | "deleteRow"
  | "addColumnBefore"
  | "addColumnAfter"
  | "deleteColumn"
  | "deleteTable";

export const VISUAL_EDITOR_COMMAND_EVENT = "markdown-workspace:editor-command";

export interface VisualEditorCommandDetail {
  readonly command: Exclude<
    EditorContextMenuCommand,
    | "undo"
    | "redo"
    | "cut"
    | "copy"
    | "paste"
    | "selectAll"
    | "openLink"
    | "openLinkNewTab"
    | "copyLink"
    | "previewImage"
    | "copyImage"
    | "copyImageAddress"
    | "copyImageMarkdown"
    | "revealImage"
    | "editMermaidSource"
  >;
  readonly target?: EventTarget | null;
}

export interface ContextMenuLink {
  readonly element: HTMLAnchorElement;
  readonly href: string;
}

type TextControl = HTMLInputElement | HTMLTextAreaElement;

function isTextControl(target: HTMLElement): target is TextControl {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
}

function isTextSurface(target: HTMLElement): boolean {
  return (
    isTextControl(target) ||
    target.isContentEditable ||
    target.contentEditable === "true" ||
    target.matches(
      '[contenteditable="true"], [contenteditable=""], [contenteditable="false"], .cm-content',
    )
  );
}

function isCodeMirrorContent(target: HTMLElement): boolean {
  return target.matches(".cm-content");
}

export function resolveEditorTarget(target?: EventTarget | null): HTMLElement | null {
  const element =
    target instanceof HTMLElement
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  if (element && isTextSurface(element)) return element;
  const candidate = element?.closest<HTMLElement>(
    'input, textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="false"], .cm-content',
  );
  if (candidate && isTextSurface(candidate)) return candidate;

  return document.activeElement instanceof HTMLElement &&
    isTextSurface(document.activeElement)
    ? document.activeElement
    : null;
}

function targetElement(target?: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
}

export function isVisualMarkdownTarget(target?: EventTarget | null): boolean {
  return Boolean(targetElement(target)?.closest(".ProseMirror"));
}

function dispatchVisualEditorCommand(
  command: VisualEditorCommandDetail["command"],
  target?: EventTarget | null,
): boolean {
  const surface = targetElement(target)?.closest<HTMLElement>(".ProseMirror");
  if (!surface) return false;
  if (command !== "editImage") surface.focus();
  const event = new CustomEvent<VisualEditorCommandDetail>(VISUAL_EDITOR_COMMAND_EVENT, {
    bubbles: true,
    cancelable: true,
    detail: { command, target },
  });
  surface.dispatchEvent(event);
  // The visual editor only cancels a command event after the corresponding
  // ProseMirror command has actually handled it.  Merely finding a
  // `.ProseMirror` element is not enough: table-only commands, for example,
  // must report false when the selection is outside a table.
  return event.defaultPrevented;
}

export function resolveContextMenuLink(
  target?: EventTarget | null,
): ContextMenuLink | null {
  const anchor = targetElement(target)?.closest<HTMLAnchorElement>("a[href]");
  const href = anchor?.getAttribute("href")?.trim();
  return anchor && href ? { element: anchor, href } : null;
}

export function isReadOnlyCodeTarget(target?: EventTarget | null): boolean {
  return Boolean(
    targetElement(target)?.closest('.code-file-preview[data-editable="false"]'),
  );
}

export function isWritableEditorTarget(target?: EventTarget | null): boolean {
  if (isReadOnlyCodeTarget(target)) return false;
  const editor = resolveEditorTarget(target);
  if (!editor) return false;
  if (isTextControl(editor)) return !editor.disabled && !editor.readOnly;
  if (editor.matches(".cm-content")) return editor.contentEditable !== "false";
  return editor.isContentEditable || editor.contentEditable === "true";
}

function textControlSelection(target: TextControl): {
  end: number;
  start: number;
  text: string;
} | null {
  const start = target.selectionStart;
  const end = target.selectionEnd;
  if (start === null || end === null) return null;
  return { start, end, text: target.value.slice(start, end) };
}

function selectionInside(target: HTMLElement): Selection | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return target.contains(range.commonAncestorContainer) ? selection : null;
}

function dispatchInput(target: HTMLElement, inputType: string, data: string | null): void {
  const event =
    typeof InputEvent === "function"
      ? new InputEvent("input", { bubbles: true, data, inputType })
      : new Event("input", { bubbles: true });
  target.dispatchEvent(event);
}

function execCommand(command: string, value?: string): boolean {
  const editableDocument = document as Document & {
    execCommand?: (commandId: string, showUI?: boolean, value?: string) => boolean;
  };
  if (typeof editableDocument.execCommand !== "function") return false;

  try {
    return editableDocument.execCommand(command, false, value);
  } catch {
    return false;
  }
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function historyCommand(target: HTMLElement, command: "undo" | "redo"): boolean {
  target.focus();
  const keyEvent = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "z",
    metaKey: true,
    shiftKey: command === "redo",
  });
  if (!target.dispatchEvent(keyEvent) || keyEvent.defaultPrevented) return true;
  return execCommand(command);
}

function activateLink(link: ContextMenuLink, newTab: boolean): boolean {
  link.element.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      metaKey: newTab,
      ctrlKey: newTab,
    }),
  );
  return true;
}

async function readClipboard(): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) return null;
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

async function copy(target: HTMLElement): Promise<boolean> {
  const selected = isTextControl(target)
    ? textControlSelection(target)?.text
    : selectionInside(target)?.toString();
  if (selected && (await writeClipboard(selected))) return true;

  target.focus();
  return execCommand("copy");
}

async function cut(target: HTMLElement): Promise<boolean> {
  if (isTextControl(target)) {
    const selection = textControlSelection(target);
    if (!selection || selection.start === selection.end) return false;
    if (!(await writeClipboard(selection.text))) {
      target.focus();
      return execCommand("cut");
    }

    target.setRangeText("", selection.start, selection.end, "end");
    dispatchInput(target, "deleteByCut", null);
    return true;
  }

  const selection = selectionInside(target);
  const text = selection?.toString() ?? "";
  if (!selection || selection.isCollapsed || !text) return false;
  if (!(await writeClipboard(text))) {
    target.focus();
    return execCommand("cut");
  }

  target.focus();
  if (execCommand("delete")) return true;
  if (isCodeMirrorContent(target)) return false;

  const range = selection.getRangeAt(0);
  range.deleteContents();
  selection.removeAllRanges();
  selection.addRange(range);
  dispatchInput(target, "deleteByCut", null);
  return true;
}

function insertContentEditableText(target: HTMLElement, text: string): boolean {
  target.focus();
  if (execCommand("insertText", text)) return true;
  if (isCodeMirrorContent(target)) return false;

  const selection = window.getSelection();
  if (!selection) return false;
  const range =
    selection.rangeCount > 0 &&
    target.contains(selection.getRangeAt(0).commonAncestorContainer)
      ? selection.getRangeAt(0)
      : document.createRange();

  if (selection.rangeCount === 0 || !target.contains(range.commonAncestorContainer)) {
    range.selectNodeContents(target);
    range.collapse(false);
  }
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  dispatchInput(target, "insertFromPaste", text);
  return true;
}

async function paste(target: HTMLElement): Promise<boolean> {
  const text = await readClipboard();
  if (text === null) {
    target.focus();
    return execCommand("paste");
  }

  if (isTextControl(target)) {
    const selection = textControlSelection(target);
    if (!selection) return false;
    target.focus();
    target.setRangeText(text, selection.start, selection.end, "end");
    dispatchInput(target, "insertFromPaste", text);
    return true;
  }

  return insertContentEditableText(target, text);
}

function selectAll(target: HTMLElement): boolean {
  target.focus();
  if (isTextControl(target)) {
    target.select();
    return true;
  }

  if (isCodeMirrorContent(target) && execCommand("selectAll")) return true;

  const selection = window.getSelection();
  if (!selection) return execCommand("selectAll");
  const range = document.createRange();
  range.selectNodeContents(target);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export async function executeEditorContextMenuCommand(
  command: EditorContextMenuCommand,
  sourceTarget?: EventTarget | null,
  linkHref?: string,
): Promise<boolean> {
  const image = resolveImageActionTarget(sourceTarget);
  if (command === "copyImage") {
    return image?.element instanceof HTMLImageElement
      ? copyLoadedImage(image.element)
      : false;
  }
  if (command === "copyImageAddress")
    return image?.reference ? writeClipboard(image.reference) : false;
  if (command === "copyImageMarkdown")
    return image?.reference ? writeClipboard(imageMarkdownReference(image)) : false;
  if (command === "editImage")
    return image?.editable ? dispatchVisualEditorCommand(command, image.element) : false;
  if (command === "revealImage") return false; // Native action supplied by the Shell.
  if (command === "previewImage") {
    if (!image) return false;
    const open =
      image.kind === "image"
        ? image.element
        : image.element.querySelector<HTMLElement>("[data-visual-mermaid-id]");
    if (!open?.isConnected || open.closest(".visual-viewer")) return false;
    open.click();
    return true;
  }
  if (command === "editMermaidSource") {
    const block =
      image?.kind === "mermaid" ? image.element.closest(".milkdown-code-block") : null;
    const source = block?.querySelector<HTMLElement>(".codemirror-host");
    if (!source) return false;
    if (source.classList.contains("hidden"))
      block?.querySelector<HTMLButtonElement>(".preview-toggle-button")?.click();
    // Vue removes the preview-only class in its queued DOM update.
    await Promise.resolve();
    if (!source.isConnected) return false;
    const editor = source.querySelector<HTMLElement>(".cm-content");
    editor?.focus();
    return true;
  }
  const link = resolveContextMenuLink(sourceTarget);
  if (command === "copyLink") {
    const href = linkHref ?? link?.href;
    return href ? writeClipboard(href) : false;
  }
  if (command === "openLink" || command === "openLinkNewTab") {
    return link ? activateLink(link, command === "openLinkNewTab") : false;
  }
  if (
    command === "paragraph" ||
    command === "heading1" ||
    command === "heading2" ||
    command === "heading3" ||
    command === "blockquote" ||
    command === "bulletList" ||
    command === "orderedList" ||
    command === "taskList" ||
    command === "toggleBold" ||
    command === "toggleItalic" ||
    command === "toggleStrike" ||
    command === "toggleInlineCode" ||
    command === "clearFormatting" ||
    command === "codeBlock" ||
    command === "horizontalRule" ||
    command === "insertTable" ||
    command === "addRowBefore" ||
    command === "addRowAfter" ||
    command === "deleteRow" ||
    command === "addColumnBefore" ||
    command === "addColumnAfter" ||
    command === "deleteColumn" ||
    command === "deleteTable"
  ) {
    return dispatchVisualEditorCommand(command, sourceTarget);
  }

  const target = resolveEditorTarget(sourceTarget);
  if (!target) return false;

  switch (command) {
    case "undo":
      return historyCommand(target, "undo");
    case "redo":
      return historyCommand(target, "redo");
    case "copy":
      return copy(target);
    case "cut":
      return cut(target);
    case "paste":
      return paste(target);
    case "selectAll":
      return selectAll(target);
  }
}
