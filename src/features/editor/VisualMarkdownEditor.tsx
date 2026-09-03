import { Crepe, CrepeFeature } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import {
  EditorState as CodeMirrorState,
  Prec,
  Transaction as CodeMirrorTransaction,
} from "@codemirror/state";
import { EditorView as CodeMirrorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { editorViewCtx, parserCtx, serializerCtx } from "@milkdown/kit/core";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { closeHistory } from "@milkdown/kit/prose/history";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import {
  TableView,
  columnResizing,
  deleteColumn as deleteTableColumn,
  deleteRow as deleteTableRow,
  deleteTable as deleteWholeTable,
} from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  createCodeBlockCommand,
  imageSchema,
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  insertTableCommand,
  toggleStrikethroughCommand,
} from "@milkdown/kit/preset/gfm";
import { $prose, $view, callCommand } from "@milkdown/kit/utils";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  codeFenceLanguagePrefix,
  matchingCodeFenceLanguages,
  type CodeFenceLanguage,
} from "./codeFenceCompletion";
import { prepareMarkdownImageSource, resolveMarkdownImageSource } from "./imageSource";
import { linkDispositionFromPointer, type LinkDisposition } from "./linkTarget";
import { createMermaidPreviewController } from "./mermaidPreview";
import { isOversizedInlineImagePaste } from "./pasteGuard";
import {
  clipboardImagePasteKind,
  type ClipboardImagePasteKind,
  type EditorImageInsertRequest,
} from "./clipboardImage";
import { mergeCompositionChange } from "./sharedTextChange";
import {
  semanticPositionFromVisualDocument,
  visualPositionFromSemantic,
  type EditorSemanticPosition,
} from "./semanticPosition";
import type { PreviewVisual } from "../viewer/model";
import { FindBar } from "../find/FindBar";
import { codeFindDecorations } from "../find/codeMirrorFind";
import { usePageFind } from "../find/usePageFind";
import { visualFindPlugin, visualFindTarget } from "../find/visualFind";
import { installWrappingLinkEditor } from "./linkEditorField";
import { ImageReferenceDialog } from "../image-actions/ImageReferenceDialog";
import { isAssetImageSource } from "../image-actions/imageActions";
import {
  imageEditTarget,
  registerImageNode,
  type ImageEditTarget,
} from "../image-actions/imageNodeEditing";
import "./VisualMarkdownEditor.css";

export interface VisualEditorSelectionRange {
  readonly from: number;
  readonly to: number;
}

export interface VisualEditorViewSnapshot {
  readonly scrollTop: number;
  readonly selectionFrom: number;
  readonly selectionTo: number;
  readonly semanticPosition?: EditorSemanticPosition;
}

export interface VisualEditorRevealRequest {
  readonly requestId: number;
  /** Original Markdown fragment, used to disambiguate duplicate heading slugs. */
  readonly anchor?: string;
  /** Prefer this over `position`: Markdown offsets and ProseMirror positions differ. */
  readonly headingText?: string;
  /** Compatibility fallback for callers that only have a numeric location. */
  readonly position?: number;
  /** Exact surface scroll restoration used by same-document history navigation. */
  readonly scrollTop?: number;
}

export type MarkdownEditorLocale = "zh-CN" | "en-US";

export const VISUAL_EDITOR_COMMAND_EVENT = "markdown-workspace:editor-command";

export type VisualEditorCommand =
  | "editImage"
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "blockquote"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "codeBlock"
  | "horizontalRule"
  | "toggleBold"
  | "toggleItalic"
  | "toggleStrike"
  | "toggleInlineCode"
  | "clearFormatting"
  | "insertTable"
  | "addRowBefore"
  | "addRowAfter"
  | "deleteRow"
  | "addColumnBefore"
  | "addColumnAfter"
  | "deleteColumn"
  | "alignTableLeft"
  | "alignTableCenter"
  | "alignTableRight"
  | "resizeTable"
  | "deleteTable";

export interface VisualEditorCommandDetail {
  readonly command: VisualEditorCommand;
  readonly target?: EventTarget | null;
  readonly rows?: number;
  readonly columns?: number;
}

export interface VisualMarkdownEditorProps {
  readonly documentId: string;
  readonly instanceId?: string;
  readonly value: string;
  readonly autofocus?: boolean;
  readonly codeWrap?: boolean;
  readonly initialView?: VisualEditorViewSnapshot;
  readonly locale?: MarkdownEditorLocale;
  readonly findRequest?: number;
  readonly onFindRequestConsumed?: (request: number) => void;
  readonly reveal?: VisualEditorRevealRequest;
  readonly showCodeLineNumbers?: boolean;
  readonly showTypingHints?: boolean;
  readonly onChange: (value: string) => void;
  readonly onImagePaste?: (
    selection: VisualEditorSelectionRange,
    kind?: ClipboardImagePasteKind,
  ) => Promise<string>;
  readonly imageInsertRequest?: EditorImageInsertRequest;
  readonly onImageInsertConsumed?: (id: number) => void;
  readonly onInternalLink?: (target: string, disposition: LinkDisposition) => void;
  readonly onPasteRejected?: (message: string) => void;
  readonly onPasteError?: (message: string) => void;
  readonly onOpenVisual?: (visual: PreviewVisual) => void;
  readonly onRevealConsumed?: (requestId: number) => void;
  readonly onViewChange?: (view: VisualEditorViewSnapshot) => void;
}

interface EditorMessages {
  readonly editorAriaLabel: string;
  readonly creationErrorTitle: string;
  readonly creationErrorFallback: string;
  readonly codeLanguageSearch: string;
  readonly codeNoResult: string;
  readonly codeCopy: string;
  readonly codePreview: string;
  readonly codePreviewLoading: string;
  readonly codeEditPreviewSource: string;
  readonly codeHidePreviewSource: string;
  readonly codePlainText: string;
  readonly image: string;
  readonly imageZoom: (title: string) => string;
  readonly imageUnavailable: string;
  readonly imageEditReference: string;
  readonly imageRemoveReference: string;
  readonly imagePasteUnavailable: string;
  readonly imagePasteFailed: string;
  readonly mermaidTitle: string;
  readonly mermaidOpen: string;
  readonly mermaidRenderFailed: string;
  readonly mermaidRendering: string;
  readonly oversizedPaste: string;
  readonly codeFenceLanguages: string;
  readonly codeFenceKeys: string;
  readonly insertTable: string;
  readonly tableGrid: string;
  readonly tableGridSize: (rows: number, columns: number) => string;
  readonly tableTools: string;
  readonly tableSize: string;
  readonly tableRows: string;
  readonly tableColumns: string;
  readonly applyTableSize: string;
  readonly alignTableLeft: string;
  readonly alignTableCenter: string;
  readonly alignTableRight: string;
  readonly addTableRow: string;
  readonly deleteTableRow: string;
  readonly addTableColumn: string;
  readonly deleteTableColumn: string;
}

const EDITOR_MESSAGES: Record<MarkdownEditorLocale, EditorMessages> = {
  "zh-CN": {
    editorAriaLabel: "Markdown 可视化编辑器",
    creationErrorTitle: "可视化编辑器没有启动",
    creationErrorFallback: "可视化编辑器启动失败",
    codeLanguageSearch: "搜索代码语言",
    codeNoResult: "未找到匹配语言",
    codeCopy: "复制",
    codePreview: "预览",
    codePreviewLoading:
      '<div class="visual-mermaid-preview visual-mermaid-preview--loading">正在渲染图表…</div>',
    codeEditPreviewSource: "编辑图表源码",
    codeHidePreviewSource: "隐藏图表源码",
    codePlainText: "纯文本",
    image: "图片",
    imageZoom: (title) => `放大查看：${title}`,
    imageUnavailable: "图片不存在或无法加载",
    imageEditReference: "编辑引用…",
    imageRemoveReference: "删除引用",
    imagePasteUnavailable: "图片粘贴尚未启用",
    imagePasteFailed: "图片没有保存",
    mermaidTitle: "Mermaid 图表",
    mermaidOpen: "放大查看",
    mermaidRenderFailed: "图表渲染失败",
    mermaidRendering: "正在渲染图表…",
    oversizedPaste: "这段粘贴内容包含很大的内嵌图片数据，已阻止以避免编辑器卡死。",
    codeFenceLanguages: "代码语言",
    codeFenceKeys: "↑↓ 选择 · Enter/Tab 创建 · Esc 关闭",
    insertTable: "插入表格",
    tableGrid: "选择表格大小",
    tableGridSize: (rows, columns) => `${rows} 行 × ${columns} 列`,
    tableTools: "表格工具",
    tableSize: "调整表格大小",
    tableRows: "行数",
    tableColumns: "列数",
    applyTableSize: "应用",
    alignTableLeft: "左对齐当前列",
    alignTableCenter: "居中对齐当前列",
    alignTableRight: "右对齐当前列",
    addTableRow: "在下方添加行",
    deleteTableRow: "删除当前行",
    addTableColumn: "在右侧添加列",
    deleteTableColumn: "删除当前列",
  },
  "en-US": {
    editorAriaLabel: "Markdown visual editor",
    creationErrorTitle: "The visual editor did not start",
    creationErrorFallback: "The visual editor failed to start",
    codeLanguageSearch: "Search code languages",
    codeNoResult: "No matching language",
    codeCopy: "Copy",
    codePreview: "Preview",
    codePreviewLoading:
      '<div class="visual-mermaid-preview visual-mermaid-preview--loading">Rendering diagram…</div>',
    codeEditPreviewSource: "Edit diagram source",
    codeHidePreviewSource: "Hide diagram source",
    codePlainText: "Plain text",
    image: "Image",
    imageZoom: (title) => `Zoom image: ${title}`,
    imageUnavailable: "Image missing or unavailable",
    imageEditReference: "Edit reference…",
    imageRemoveReference: "Remove reference",
    imagePasteUnavailable: "Image paste is not enabled",
    imagePasteFailed: "The image was not saved",
    mermaidTitle: "Mermaid diagram",
    mermaidOpen: "Zoom diagram",
    mermaidRenderFailed: "Diagram rendering failed",
    mermaidRendering: "Rendering diagram…",
    oversizedPaste: "This paste contains a very large embedded image and was blocked.",
    codeFenceLanguages: "Code languages",
    codeFenceKeys: "↑↓ Select · Enter/Tab create · Esc close",
    insertTable: "Insert table",
    tableGrid: "Choose table size",
    tableGridSize: (rows, columns) => `${rows} rows × ${columns} columns`,
    tableTools: "Table tools",
    tableSize: "Resize table",
    tableRows: "Rows",
    tableColumns: "Columns",
    applyTableSize: "Apply",
    alignTableLeft: "Align current column left",
    alignTableCenter: "Align current column center",
    alignTableRight: "Align current column right",
    addTableRow: "Add row below",
    deleteTableRow: "Delete current row",
    addTableColumn: "Add column after",
    deleteTableColumn: "Delete current column",
  },
};

const TABLE_MIN_ROWS = 2;
const TABLE_MIN_COLUMNS = 1;
const TABLE_MAX_ROWS = 8;
const TABLE_MAX_COLUMNS = 8;
const TABLE_GRID_ROWS = TABLE_MAX_ROWS - TABLE_MIN_ROWS + 1;
const TABLE_GRID_COLUMNS = TABLE_MAX_COLUMNS - TABLE_MIN_COLUMNS + 1;
const TABLE_RESIZE_MAX_ROWS = 99;
const TABLE_RESIZE_MAX_COLUMNS = 32;

type TableAlignment = "left" | "center" | "right";

interface SelectedTableSnapshot {
  readonly alignment: TableAlignment;
  readonly columns: number;
  readonly rows: number;
}

interface SelectedTableContext extends SelectedTableSnapshot {
  readonly cellPosition: number;
  readonly columnIndex: number;
  readonly table: ProseMirrorNode;
  readonly tablePosition: number;
}

class WorkspaceResizableTableView extends TableView {
  constructor(node: ProseMirrorNode, cellMinWidth: number) {
    super(node, cellMinWidth);
    this.dom.classList.add("milkdown-table-block", "workspace-table-scroll");
    this.dom.dataset.tableView = "resizable";
    this.table.classList.add("children");
  }
}

const workspaceTableColumnResizing = $prose(() =>
  columnResizing({
    View: WorkspaceResizableTableView,
    cellMinWidth: 112,
    defaultCellMinWidth: 152,
    handleWidth: 8,
  }),
);

const codeBlockHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "#738092", fontStyle: "italic" },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: "#7048b8" },
  { tag: [tags.string, tags.special(tags.string)], color: "#5f8f3e" },
  { tag: [tags.number, tags.bool, tags.null], color: "#b45f36" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "#276f85" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#245fa8" },
  { tag: [tags.propertyName, tags.attributeName], color: "#8a4f82" },
  { tag: [tags.variableName, tags.name], color: "#303947" },
  { tag: [tags.punctuation, tags.bracket], color: "#6c7482" },
]);

// Crepe defaults to oneDark. Supplying a complete light CodeMirror theme here
// keeps active lines, gutters, selections and syntax colors in the same paper
// palette instead of trying to paint over a dark editor with fragile CSS.
const codeBlockLightTheme = [
  CodeMirrorView.theme(
    {
      "&": {
        color: "#303947",
        backgroundColor: "#f7f8fa",
      },
      ".cm-content": {
        caretColor: "#315fcf",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "#315fcf",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: "#b8cff8",
      },
      "&:not(.cm-focused) .cm-selectionLayer": {
        visibility: "hidden",
      },
      "&:not(.cm-focused) .cm-selectionMatch": {
        backgroundColor: "transparent",
      },
      ".cm-content ::selection": {
        color: "#17233a",
        backgroundColor: "#b8cff8",
      },
      ".cm-activeLine": {
        backgroundColor: "rgba(65, 105, 180, 0.12)",
      },
      ".cm-gutters": {
        color: "#8a95a5",
        backgroundColor: "#f7f8fa",
        borderRight: "1px solid #e5e9ef",
      },
      ".cm-activeLineGutter": {
        color: "#44546b",
        backgroundColor: "#dbe5f5",
      },
      ".cm-foldPlaceholder": {
        color: "#667184",
        backgroundColor: "#e8ecf2",
        border: "0",
      },
    },
    { dark: false },
  ),
  syntaxHighlighting(codeBlockHighlightStyle),
];

const hideCodeBlockGutters = CodeMirrorView.theme({
  ".cm-gutters": {
    display: "none",
  },
});

interface CodeFenceTypingCompletion {
  readonly prefix: string;
  readonly suggestions: readonly CodeFenceLanguage[];
  readonly selectedIndex: number;
  readonly left: number;
  readonly top: number;
}

function codeFenceTypingCompletion(
  view: EditorView,
  scroller: HTMLElement,
): CodeFenceTypingCompletion | null {
  if (view.composing) return null;
  const selection = view.state.selection;
  if (!selection.empty || selection.$from.parent.type.name !== "paragraph") return null;

  const paragraph = selection.$from.parent.textContent;
  const prefix = codeFenceLanguagePrefix(paragraph);
  if (prefix === null) return null;
  const suggestions = matchingCodeFenceLanguages(prefix);
  if (suggestions.length === 0) return null;

  try {
    const caret = view.coordsAtPos(selection.head);
    const bounds = scroller.getBoundingClientRect();
    return {
      prefix,
      suggestions,
      selectedIndex: 0,
      left: Math.max(18, caret.left - bounds.left + scroller.scrollLeft),
      top: Math.max(18, caret.bottom - bounds.top + scroller.scrollTop + 7),
    };
  } catch {
    return null;
  }
}

function createCodeBlockFromFenceQuery(view: EditorView, language: string): boolean {
  if (view.composing) return false;
  const selection = view.state.selection;
  if (!selection.empty || selection.$from.parent.type.name !== "paragraph") return false;
  if (codeFenceLanguagePrefix(selection.$from.parent.textContent) === null) return false;
  const codeBlock = view.state.schema.nodes.code_block;
  if (!codeBlock) return false;

  const paragraphPosition = selection.$from.before();
  const contentStart = selection.$from.start();
  const contentEnd = selection.$from.end();
  try {
    const transaction = view.state.tr
      .delete(contentStart, contentEnd)
      .setNodeMarkup(paragraphPosition, codeBlock, { language });
    transaction.setSelection(TextSelection.create(transaction.doc, contentStart));
    view.dispatch(transaction.scrollIntoView());
    view.focus();
    return true;
  } catch {
    return false;
  }
}

function visualViewportPosition(view: EditorView, scroller: HTMLElement): number {
  try {
    const bounds = scroller.getBoundingClientRect();
    const coordinates = {
      left: bounds.left + Math.max(20, Math.min(bounds.width / 2, 120)),
      top: bounds.top + Math.max(20, Math.min(bounds.height / 2, 180)),
    };
    return view.posAtCoords(coordinates)?.pos ?? view.state.selection.from;
  } catch {
    return view.state.selection.from;
  }
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function onlyAddsEmptyTrailingParagraph(
  previousDocument: ProseMirrorNode,
  currentDocument: ProseMirrorNode,
): boolean {
  if (currentDocument.childCount !== previousDocument.childCount + 1) return false;
  const trailing = currentDocument.lastChild;
  if (!trailing || trailing.type.name !== "paragraph" || trailing.content.size !== 0) {
    return false;
  }

  for (let index = 0; index < previousDocument.childCount; index += 1) {
    if (!previousDocument.child(index).eq(currentDocument.child(index))) return false;
  }
  return true;
}

function withoutEditorTrailingParagraph(document: ProseMirrorNode): ProseMirrorNode {
  const trailing = document.lastChild;
  if (
    document.childCount < 2 ||
    !trailing ||
    trailing.type.name !== "paragraph" ||
    trailing.content.size !== 0
  ) {
    return document;
  }
  const preceding = document.child(document.childCount - 2);
  if (preceding.type.name === "paragraph" || preceding.type.name === "heading") {
    return document;
  }
  return document.copy(document.content.cut(0, document.content.size - trailing.nodeSize));
}

function imagePayloadFromUploadResult(
  result: string,
  invalidMessage: string,
): {
  readonly alt: string;
  readonly src: string;
  readonly title: string;
} {
  const value = result.trim();
  const markdownImage = /^!\[([^\]\r\n]*)\]\(\s*(<[^>\r\n]+>|\S+)\s*\)$/u.exec(value);
  if (markdownImage?.[2]) {
    const target = markdownImage[2];
    return {
      alt: markdownImage[1] ?? "",
      src: target.startsWith("<") && target.endsWith(">") ? target.slice(1, -1) : target,
      title: "",
    };
  }

  // Supporting a direct URL keeps this adapter useful if the host later returns
  // the asset URI instead of the complete Markdown image expression.
  if (value && !/\s/u.test(value) && !value.startsWith("![")) {
    return { alt: "", src: value, title: "" };
  }
  throw new Error(invalidMessage);
}

async function copyCodeText(value: string): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    const previousFocus = document.activeElement as HTMLElement | null;
    const selection = document.getSelection();
    const previousRange = selection?.rangeCount ? selection.getRangeAt(0) : null;

    textarea.value = value;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.select();
    const copied =
      typeof document.execCommand === "function" && document.execCommand("copy");
    textarea.remove();

    if (selection && previousRange) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
    previousFocus?.focus();
    if (!copied) throw new Error("Unable to copy code");
  }
}

function visualImageView(
  documentPath: string,
  messages: EditorMessages,
  isDisposed: () => boolean,
  onEditReference: (target: ImageEditTarget) => void,
) {
  return $view(imageSchema.node, () => (initialNode, view, getPos) => {
    const dom = document.createElement("span");
    dom.className = "visual-markdown-image";
    dom.contentEditable = "false";

    const placeholder = document.createElement("span");
    placeholder.className = "visual-markdown-image__placeholder";
    placeholder.hidden = true;
    placeholder.setAttribute("role", "group");
    placeholder.setAttribute("aria-label", messages.imageUnavailable);
    const status = document.createElement("span");
    status.className = "visual-markdown-image__status";
    status.textContent = messages.imageUnavailable;
    const path = document.createElement("span");
    path.className = "visual-markdown-image__path";
    const actions = document.createElement("span");
    actions.className = "visual-markdown-image__actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = messages.imageEditReference;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = messages.imageRemoveReference;
    actions.append(edit, remove);
    placeholder.append(status, path, actions);
    dom.append(placeholder);

    let sourceRevision = 0;
    let destroyed = false;
    let image: HTMLImageElement | null = null;
    let previousSource: string | null = null;
    let currentNode = initialNode;
    let unregister = () => {};

    const currentTarget = () =>
      !destroyed && !isDisposed() && image && view.editable
        ? imageEditTarget(image, view)
        : null;
    edit.addEventListener("click", () => {
      const target = currentTarget();
      if (target && target.node.eq(currentNode)) onEditReference(target);
    });
    remove.addEventListener("click", () => {
      const target = currentTarget();
      const position = target?.getPos();
      if (!target || !target.node.eq(currentNode) || typeof position !== "number") return;
      const transaction = closeHistory(
        view.state.tr.delete(position, position + target.node.nodeSize),
      );
      transaction.setSelection(
        TextSelection.near(
          transaction.doc.resolve(Math.min(position, transaction.doc.content.size)),
        ),
      );
      view.dispatch(transaction);
      view.focus();
    });
    placeholder.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    const showUnavailable = (unavailable: boolean) => {
      placeholder.hidden = !unavailable;
      if (image) image.hidden = unavailable;
      dom.classList.toggle("visual-markdown-image--unavailable", unavailable);
    };

    const bind = (node: typeof initialNode) => {
      currentNode = node;
      const source = String(node.attrs.src ?? "");
      const alt = String(node.attrs.alt ?? "");
      const title = String(node.attrs.title ?? "");
      path.textContent = source;
      edit.disabled = remove.disabled = !view.editable;

      if (source !== previousSource || !image) {
        previousSource = source;
        const revision = ++sourceRevision;
        unregister();
        if (image) {
          image.onload = image.onerror = null;
          image.remove();
        }
        // Keep each request on its own element: a late load/error for an old
        // source must never change the next reference's placeholder state.
        const loadingImage = document.createElement("img");
        image = loadingImage;
        image.className = "visual-markdown-image__content";
        image.decoding = "async";
        image.loading = "lazy";
        image.draggable = false;
        image.tabIndex = 0;
        image.setAttribute("role", "button");
        dom.insertBefore(image, placeholder);
        unregister = registerImageNode(image, { view, getPos });
        showUnavailable(false);
        const isCurrent = () => !destroyed && !isDisposed() && revision === sourceRevision;
        image.onload = () => {
          if (isCurrent()) showUnavailable(false);
        };
        image.onerror = () => {
          if (isCurrent()) showUnavailable(true);
        };
        const resolvedSource = resolveMarkdownImageSource(documentPath, source);
        image.dataset.visualImageSource = resolvedSource;
        if (isAssetImageSource(resolvedSource)) {
          image.crossOrigin = "anonymous";
          // Restore this individual Tauri asset's scope before its first request.
          void prepareMarkdownImageSource(documentPath, source)
            .then((preparedSource) => {
              if (!isCurrent()) return;
              if (!preparedSource) {
                showUnavailable(true);
                return;
              }
              loadingImage.dataset.visualImageSource = preparedSource;
              loadingImage.setAttribute("src", preparedSource);
            })
            .catch(() => {
              if (isCurrent()) showUnavailable(true);
            });
        } else if (resolvedSource) image.setAttribute("src", resolvedSource);
        else showUnavailable(true);
      }
      image.alt = alt;
      if (title) image.title = title;
      else image.removeAttribute("title");
      image.dataset.visualImageReference = source;
      image.dataset.visualImageDocument = documentPath;
      const imageTitle = alt || title || messages.image;
      image.dataset.visualImageTitle = imageTitle;
      image.setAttribute("aria-label", messages.imageZoom(imageTitle));
    };

    bind(initialNode);
    return {
      dom,
      ignoreMutation(mutation) {
        // This leaf's loading UI is a projection, never editable document text.
        return mutation.type !== "selection";
      },
      stopEvent(event) {
        return (
          (event.target instanceof Node && placeholder.contains(event.target)) ||
          event.type === "contextmenu" ||
          (event instanceof MouseEvent &&
            event.type === "mousedown" &&
            (event.button === 2 || (event.button === 0 && event.ctrlKey)))
        );
      },
      destroy() {
        destroyed = true;
        sourceRevision++;
        if (image) image.onload = image.onerror = null;
        unregister();
      },
      update(updatedNode) {
        if (updatedNode.type !== initialNode.type) return false;
        bind(updatedNode);
        return true;
      },
      selectNode() {
        dom.classList.add("visual-markdown-image--selected");
      },
      deselectNode() {
        dom.classList.remove("visual-markdown-image--selected");
      },
    };
  });
}

function normalizeHeadingText(value: string): string {
  return value
    .replace(/^\s*#{1,6}\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function markdownHeadingSlug(value: string): string {
  return normalizeHeadingText(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-");
}

function anchorSlug(anchor: string | undefined): string {
  if (!anchor) return "";
  let decoded = anchor.replace(/^#/u, "");
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep a malformed literal fragment; it may still match a literal heading slug.
  }
  return markdownHeadingSlug(decoded);
}

function selectionFor(view: EditorView, from: number, to = from) {
  const max = view.state.doc.content.size;
  const anchor = Math.max(0, Math.min(from, max));
  const head = Math.max(0, Math.min(to, max));
  return TextSelection.between(
    view.state.doc.resolve(anchor),
    view.state.doc.resolve(head),
  );
}

function selectionIsInTable(view: EditorView): boolean {
  return selectedTableContext(view) !== null;
}

function tableAlignment(value: unknown): TableAlignment {
  return value === "center" || value === "right" ? value : "left";
}

function selectedTableContext(view: EditorView): SelectedTableContext | null {
  const { $from } = view.state.selection;
  let tableDepth = -1;
  let cellDepth = -1;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (cellDepth < 0 && (name === "table_header" || name === "table_cell")) {
      cellDepth = depth;
    }
    if (name === "table") {
      tableDepth = depth;
      break;
    }
  }
  if (tableDepth < 0 || cellDepth < 0) return null;

  const table = $from.node(tableDepth);
  const tablePosition = $from.before(tableDepth);
  const cellPosition = $from.before(cellDepth);
  let rowPosition = tablePosition + 1;
  let columnIndex = -1;
  let alignment: TableAlignment = "left";
  for (let rowIndex = 0; rowIndex < table.childCount; rowIndex += 1) {
    const row = table.child(rowIndex);
    let candidatePosition = rowPosition + 1;
    for (let index = 0; index < row.childCount; index += 1) {
      const cell = row.child(index);
      if (candidatePosition === cellPosition) {
        columnIndex = index;
        alignment = tableAlignment(cell.attrs.alignment);
        break;
      }
      candidatePosition += cell.nodeSize;
    }
    if (columnIndex >= 0) break;
    rowPosition += row.nodeSize;
  }
  if (columnIndex < 0) return null;

  return {
    alignment,
    cellPosition,
    columnIndex,
    columns: table.firstChild?.childCount ?? 0,
    rows: table.childCount,
    table,
    tablePosition,
  };
}

function selectedTableSnapshot(view: EditorView): SelectedTableSnapshot | null {
  const context = selectedTableContext(view);
  if (!context) return null;
  return {
    alignment: context.alignment,
    columns: context.columns,
    rows: context.rows,
  };
}

function alignSelectedTableColumn(view: EditorView, alignment: TableAlignment): boolean {
  const context = selectedTableContext(view);
  if (!context || context.columns === 0) return false;

  const transaction = view.state.tr;
  let changed = false;
  let rowPosition = context.tablePosition + 1;
  for (let rowIndex = 0; rowIndex < context.table.childCount; rowIndex += 1) {
    const row = context.table.child(rowIndex);
    if (context.columnIndex >= row.childCount) return false;
    let cellPosition = rowPosition + 1;
    for (let columnIndex = 0; columnIndex < context.columnIndex; columnIndex += 1) {
      cellPosition += row.child(columnIndex).nodeSize;
    }
    const cell = row.child(context.columnIndex);
    if (tableAlignment(cell.attrs.alignment) !== alignment) {
      transaction.setNodeMarkup(cellPosition, undefined, {
        ...cell.attrs,
        alignment,
      });
      changed = true;
    }
    rowPosition += row.nodeSize;
  }
  if (!changed) return true;
  view.dispatch(transaction);
  return true;
}

function resizeSelectedTable(
  view: EditorView,
  requestedRows: number | undefined,
  requestedColumns: number | undefined,
): boolean {
  const context = selectedTableContext(view);
  if (!context) return false;
  const rows = clampedTableDimension(
    requestedRows,
    TABLE_MIN_ROWS,
    TABLE_RESIZE_MAX_ROWS,
    context.rows,
  );
  const columns = clampedTableDimension(
    requestedColumns,
    TABLE_MIN_COLUMNS,
    TABLE_RESIZE_MAX_COLUMNS,
    context.columns,
  );
  if (rows === context.rows && columns === context.columns) return true;

  const headerRowType = view.state.schema.nodes.table_header_row;
  const rowType = view.state.schema.nodes.table_row;
  const headerCellType = view.state.schema.nodes.table_header;
  const cellType = view.state.schema.nodes.table_cell;
  if (!headerRowType || !rowType || !headerCellType || !cellType) return false;

  const header = context.table.firstChild;
  const alignments = Array.from({ length: columns }, (_, columnIndex) =>
    tableAlignment(
      header && columnIndex < header.childCount
        ? header.child(columnIndex).attrs.alignment
        : undefined,
    ),
  );
  const nextRows: ProseMirrorNode[] = [];
  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    const existingRow =
      rowIndex < context.table.childCount ? context.table.child(rowIndex) : undefined;
    const nextCells: ProseMirrorNode[] = [];
    for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
      const existingCell =
        existingRow && columnIndex < existingRow.childCount
          ? existingRow.child(columnIndex)
          : undefined;
      const expectedCellType = rowIndex === 0 ? headerCellType : cellType;
      const attrs = {
        ...(existingCell?.attrs ?? {}),
        alignment: alignments[columnIndex],
      };
      const cell = existingCell
        ? expectedCellType.createAndFill(attrs, existingCell.content)
        : expectedCellType.createAndFill(attrs);
      if (!cell) return false;
      nextCells.push(cell);
    }
    const expectedRowType = rowIndex === 0 ? headerRowType : rowType;
    const nextRow = expectedRowType.createAndFill(existingRow?.attrs, nextCells);
    if (!nextRow) return false;
    nextRows.push(nextRow);
  }

  const nextTable = context.table.type.createAndFill(context.table.attrs, nextRows);
  if (!nextTable) return false;
  const transaction = view.state.tr.replaceWith(
    context.tablePosition,
    context.tablePosition + context.table.nodeSize,
    nextTable,
  );
  const selectionPosition = Math.min(
    transaction.doc.content.size,
    context.tablePosition + 3,
  );
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(selectionPosition)));
  view.dispatch(transaction.scrollIntoView());
  return true;
}

function selectionIsInTableHeaderRow(view: EditorView): boolean {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    if ($from.node(depth).type.name === "table_header_row") return true;
  }
  return false;
}

function deleteSelectedGfmTableRow(view: EditorView): boolean {
  if (!selectionIsInTableHeaderRow(view)) {
    return deleteTableRow(view.state, view.dispatch);
  }

  const { $from } = view.state.selection;
  let tableDepth = -1;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    if ($from.node(depth).type.name === "table") {
      tableDepth = depth;
      break;
    }
  }
  if (tableDepth < 0) return false;

  const table = $from.node(tableDepth);
  // GFM requires one dedicated header plus at least one data row. Removing
  // the header from the smallest valid table therefore removes the table.
  if (table.childCount <= 2) {
    return deleteWholeTable(view.state, view.dispatch);
  }

  const header = table.child(0);
  const firstDataRow = table.child(1);
  const headerRowType = view.state.schema.nodes.table_header_row;
  const headerCellType = view.state.schema.nodes.table_header;
  if (!headerRowType || !headerCellType) return false;

  const promotedCells: ProseMirrorNode[] = [];
  firstDataRow.forEach((cell) => {
    promotedCells.push(headerCellType.create(cell.attrs, cell.content));
  });
  const promotedHeader = headerRowType.create(firstDataRow.attrs, promotedCells);
  const tableStart = $from.before(tableDepth) + 1;
  const transaction = view.state.tr.replaceWith(
    tableStart,
    tableStart + header.nodeSize + firstDataRow.nodeSize,
    promotedHeader,
  );
  view.dispatch(transaction);
  return true;
}

function clampedTableDimension(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function markCurrentListItemAsTask(view: EditorView): boolean {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "list_item") continue;
    if (node.attrs.checked === false) return true;
    view.dispatch(
      view.state.tr.setNodeMarkup($from.before(depth), undefined, {
        ...node.attrs,
        checked: false,
      }),
    );
    return true;
  }
  return false;
}

function clearCurrentFormatting(crepe: Crepe, view: EditorView): boolean {
  const { from, to, empty } = view.state.selection;
  const transaction = view.state.tr;
  if (empty) transaction.setStoredMarks([]);
  else transaction.removeMark(from, to);
  view.dispatch(transaction);
  // Match a conventional "clear formatting" action by also returning the
  // selected text block to a paragraph. Both transactions participate in the
  // normal ProseMirror history and remain undoable.
  crepe.editor.action(callCommand(turnIntoTextCommand.key));
  return true;
}

function runVisualEditorCommand(
  crepe: Crepe,
  view: EditorView,
  detail: VisualEditorCommandDetail,
): boolean {
  try {
    let handled = false;
    switch (detail.command) {
      case "paragraph":
        handled = crepe.editor.action(callCommand(turnIntoTextCommand.key));
        break;
      case "heading1":
        handled = crepe.editor.action(callCommand(wrapInHeadingCommand.key, 1));
        break;
      case "heading2":
        handled = crepe.editor.action(callCommand(wrapInHeadingCommand.key, 2));
        break;
      case "heading3":
        handled = crepe.editor.action(callCommand(wrapInHeadingCommand.key, 3));
        break;
      case "blockquote":
        handled = crepe.editor.action(callCommand(wrapInBlockquoteCommand.key));
        break;
      case "bulletList":
        handled = crepe.editor.action(callCommand(wrapInBulletListCommand.key));
        break;
      case "orderedList":
        handled = crepe.editor.action(callCommand(wrapInOrderedListCommand.key));
        break;
      case "taskList":
        handled = markCurrentListItemAsTask(view);
        if (!handled) {
          handled = crepe.editor.action(callCommand(wrapInBulletListCommand.key));
          if (handled) markCurrentListItemAsTask(view);
        }
        break;
      case "codeBlock":
        handled = crepe.editor.action(callCommand(createCodeBlockCommand.key, ""));
        break;
      case "horizontalRule":
        handled = crepe.editor.action(callCommand(insertHrCommand.key));
        break;
      case "toggleBold":
        handled = crepe.editor.action(callCommand(toggleStrongCommand.key));
        break;
      case "toggleItalic":
        handled = crepe.editor.action(callCommand(toggleEmphasisCommand.key));
        break;
      case "toggleStrike":
        handled = crepe.editor.action(callCommand(toggleStrikethroughCommand.key));
        break;
      case "toggleInlineCode":
        handled = crepe.editor.action(callCommand(toggleInlineCodeCommand.key));
        break;
      case "clearFormatting":
        handled = clearCurrentFormatting(crepe, view);
        break;
      case "insertTable":
        if (selectionIsInTable(view)) break;
        handled = crepe.editor.action(
          callCommand(insertTableCommand.key, {
            row: clampedTableDimension(detail.rows, TABLE_MIN_ROWS, TABLE_MAX_ROWS, 3),
            col: clampedTableDimension(
              detail.columns,
              TABLE_MIN_COLUMNS,
              TABLE_MAX_COLUMNS,
              3,
            ),
          }),
        );
        break;
      case "addRowBefore":
        // A GFM table must keep its dedicated header row first. Milkdown's
        // generic add-before command creates a normal row even when the
        // selection is in that header, which violates the schema and can
        // split one table into two during normalization. In that one case,
        // insert the new data row immediately after the header instead.
        handled = crepe.editor.action(
          callCommand(
            selectionIsInTableHeaderRow(view)
              ? addRowAfterCommand.key
              : addRowBeforeCommand.key,
          ),
        );
        break;
      case "addRowAfter":
        handled = crepe.editor.action(callCommand(addRowAfterCommand.key));
        break;
      case "deleteRow":
        handled = deleteSelectedGfmTableRow(view);
        break;
      case "addColumnBefore":
        handled = crepe.editor.action(callCommand(addColBeforeCommand.key));
        break;
      case "addColumnAfter":
        handled = crepe.editor.action(callCommand(addColAfterCommand.key));
        break;
      case "deleteColumn":
        handled = deleteTableColumn(view.state, view.dispatch);
        break;
      case "alignTableLeft":
        handled = alignSelectedTableColumn(view, "left");
        break;
      case "alignTableCenter":
        handled = alignSelectedTableColumn(view, "center");
        break;
      case "alignTableRight":
        handled = alignSelectedTableColumn(view, "right");
        break;
      case "resizeTable":
        handled = resizeSelectedTable(view, detail.rows, detail.columns);
        break;
      case "deleteTable":
        handled = deleteWholeTable(view.state, view.dispatch);
        break;
    }
    if (handled) view.focus();
    return handled;
  } catch {
    return false;
  }
}

function revealInEditor(
  editorRoot: HTMLElement,
  scroller: HTMLElement,
  view: EditorView,
  reveal: VisualEditorRevealRequest,
): boolean {
  let target: HTMLElement | null = null;
  const headings = Array.from(
    editorRoot.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
  );
  const requestedSlug = anchorSlug(reveal.anchor);
  const requestedHeading = reveal.headingText
    ? normalizeHeadingText(reveal.headingText)
    : "";

  if (requestedSlug) {
    const duplicates = new Map<string, number>();
    for (const heading of headings) {
      const base = markdownHeadingSlug(heading.textContent ?? "");
      const duplicate = duplicates.get(base) ?? 0;
      duplicates.set(base, duplicate + 1);
      const slug = duplicate === 0 ? base : `${base}-${duplicate}`;
      if (slug === requestedSlug) {
        target = heading;
        break;
      }
    }
  }

  if (requestedHeading) {
    target ??=
      headings.find(
        (heading) => normalizeHeadingText(heading.textContent ?? "") === requestedHeading,
      ) ?? null;
  }

  if (target) {
    try {
      const position = view.posAtDOM(target, 0);
      view.dispatch(view.state.tr.setSelection(selectionFor(view, position)));
    } catch {
      // The heading may have been replaced between the query and the selection.
    }
    if (reveal.scrollTop !== undefined) {
      scroller.scrollTop = reveal.scrollTop;
    } else {
      const scrollerBounds = scroller.getBoundingClientRect();
      const targetBounds = target.getBoundingClientRect();
      scroller.scrollTop = Math.max(
        0,
        scroller.scrollTop + targetBounds.top - scrollerBounds.top - 36,
      );
    }
    view.focus();
    return true;
  }

  if (reveal.position === undefined) return false;
  const selection = selectionFor(view, reveal.position);
  view.dispatch(view.state.tr.setSelection(selection));
  view.focus();
  if (reveal.scrollTop !== undefined) {
    scroller.scrollTop = reveal.scrollTop;
    return true;
  }
  try {
    const coordinates = view.coordsAtPos(selection.from);
    const scrollerBounds = scroller.getBoundingClientRect();
    scroller.scrollTop = Math.max(
      0,
      scroller.scrollTop + coordinates.top - scrollerBounds.top - 36,
    );
  } catch {
    // A numeric Markdown offset is only a compatibility fallback.
  }
  return true;
}

function applySharedVisualText(crepe: Crepe, view: EditorView, value: string): void {
  const nextDocument = crepe.editor.action((ctx) => ctx.get(parserCtx)(value));
  const from = view.state.doc.content.findDiffStart(nextDocument.content);
  if (from === null) return;
  const end = view.state.doc.content.findDiffEnd(nextDocument.content);
  if (!end) return;
  // Repeated text can make the common prefix/suffix overlap. This is the
  // standard ProseMirror fragment-diff adjustment before slicing a document.
  const overlap = from - Math.min(end.a, end.b);
  const to = overlap > 0 ? end.a + overlap : end.a;
  const nextTo = overlap > 0 ? end.b + overlap : end.b;
  view.dispatch(
    view.state.tr
      .replace(from, to, nextDocument.slice(from, nextTo))
      .setMeta("addToHistory", false),
  );
}

function VisualMarkdownEditorInstance({
  documentId,
  value,
  autofocus = true,
  codeWrap = false,
  initialView,
  locale = "zh-CN",
  findRequest,
  onFindRequestConsumed,
  reveal,
  showCodeLineNumbers = true,
  showTypingHints = true,
  onChange,
  onImagePaste,
  imageInsertRequest,
  onImageInsertConsumed,
  onInternalLink,
  onPasteRejected,
  onPasteError,
  onOpenVisual,
  onRevealConsumed,
  onViewChange,
}: VisualMarkdownEditorProps) {
  const messages = EDITOR_MESSAGES[locale];
  const scrollerRef = useRef<HTMLDivElement>(null);
  const editorRootRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const readyRef = useRef(false);
  const initialViewRestoredRef = useRef(false);
  const editorValueRef = useRef(value);
  const syncValueRef = useRef<(nextValue: string) => void>(() => {});
  const serializedValueRef = useRef<string | null>(null);
  const latestValueRef = useRef(value);
  const latestAutofocusRef = useRef(autofocus);
  const latestRevealRef = useRef(reveal);
  const onChangeRef = useRef(onChange);
  const onImagePasteRef = useRef(onImagePaste);
  const imageInsertRequestRef = useRef(imageInsertRequest);
  const onImageInsertConsumedRef = useRef(onImageInsertConsumed);
  const consumedImageInsertRef = useRef<number | null>(null);
  const applyImageInsertRequestRef = useRef<() => void>(() => {});
  const onInternalLinkRef = useRef(onInternalLink);
  const onPasteRejectedRef = useRef(onPasteRejected);
  const onPasteErrorRef = useRef(onPasteError);
  const onOpenVisualRef = useRef(onOpenVisual);
  const onRevealConsumedRef = useRef(onRevealConsumed);
  const onViewChangeRef = useRef(onViewChange);
  const consumedRevealRef = useRef<number | null>(null);
  const dismissedFencePrefixRef = useRef<string | null>(null);
  const typingCompletionRef = useRef<CodeFenceTypingCompletion | null>(null);
  const initialConfigRef = useRef({
    codeWrap,
    documentId,
    initialView,
    locale,
    messages,
    showCodeLineNumbers,
    showTypingHints,
    value,
  });
  const [creationError, setCreationError] = useState<string | null>(null);
  const [editingImage, setEditingImage] = useState<ImageEditTarget | null>(null);
  const closeImageEditor = useCallback(() => setEditingImage(null), []);
  const [typingCompletion, setTypingCompletion] =
    useState<CodeFenceTypingCompletion | null>(null);
  const [tableSelection, setTableSelection] = useState<SelectedTableSnapshot | null>(null);
  const [tableGridOpen, setTableGridOpen] = useState(false);
  const [tableGridHover, setTableGridHover] = useState({ rows: 3, columns: 3 });
  const [tableResizeOpen, setTableResizeOpen] = useState(false);
  const [tableResizeDraft, setTableResizeDraft] = useState({ rows: 3, columns: 3 });
  const find = usePageFind(findRequest, onFindRequestConsumed);
  const { targetRef: findTargetRef, refresh: refreshFind } = find;

  const setCompletion = useCallback(
    (
      update:
        | CodeFenceTypingCompletion
        | null
        | ((current: CodeFenceTypingCompletion | null) => CodeFenceTypingCompletion | null),
    ) => {
      setTypingCompletion((current) => {
        const next = typeof update === "function" ? update(current) : update;
        typingCompletionRef.current = next;
        return next;
      });
    },
    [],
  );

  const acceptFenceLanguage = useCallback(
    (language: string) => {
      const view = editorViewRef.current;
      if (!view || !createCodeBlockFromFenceQuery(view, language)) return;
      dismissedFencePrefixRef.current = null;
      setCompletion(null);
    },
    [setCompletion],
  );

  const runCommand = useCallback((detail: VisualEditorCommandDetail) => {
    const crepe = crepeRef.current;
    const view = editorViewRef.current;
    if (!crepe || !view || !readyRef.current) return false;
    if (
      detail.command === "insertTable" &&
      detail.rows === undefined &&
      detail.columns === undefined
    ) {
      if (selectionIsInTable(view)) return false;
      setTableGridHover({ rows: 3, columns: 3 });
      setTableGridOpen(true);
      setTableResizeOpen(false);
      return true;
    }
    const handled = runVisualEditorCommand(crepe, view, detail);
    if (!handled) return false;
    setTableSelection(selectedTableSnapshot(view));
    if (detail.command === "insertTable") setTableGridOpen(false);
    if (detail.command === "resizeTable") setTableResizeOpen(false);
    return true;
  }, []);

  useEffect(() => {
    if (!tableGridOpen && !tableResizeOpen) return undefined;
    const closeTransientTableTools = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          ".visual-markdown-editor__table-grid-popover, .visual-markdown-editor__table-button--size",
        )
      ) {
        return;
      }
      setTableGridOpen(false);
      setTableResizeOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setTableGridOpen(false);
      setTableResizeOpen(false);
    };
    document.addEventListener("pointerdown", closeTransientTableTools);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeTransientTableTools);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [tableGridOpen, tableResizeOpen]);

  useLayoutEffect(() => {
    latestAutofocusRef.current = autofocus;
    latestValueRef.current = value;
    latestRevealRef.current = reveal;
    imageInsertRequestRef.current = imageInsertRequest;
    onImageInsertConsumedRef.current = onImageInsertConsumed;
  }, [autofocus, imageInsertRequest, onImageInsertConsumed, reveal, value]);

  useEffect(() => {
    onChangeRef.current = onChange;
    onImagePasteRef.current = onImagePaste;
    onInternalLinkRef.current = onInternalLink;
    onPasteRejectedRef.current = onPasteRejected;
    onPasteErrorRef.current = onPasteError;
    onOpenVisualRef.current = onOpenVisual;
    onRevealConsumedRef.current = onRevealConsumed;
    onViewChangeRef.current = onViewChange;
  }, [
    onChange,
    onImagePaste,
    onInternalLink,
    onOpenVisual,
    onPasteError,
    onPasteRejected,
    onRevealConsumed,
    onViewChange,
  ]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const editorRoot = editorRootRef.current;
    if (!scroller || !editorRoot) return;

    initialViewRestoredRef.current = false;
    const initial = initialConfigRef.current;
    let cancelled = false;
    let restoreFrame = 0;
    let compositionFrame = 0;
    let composing = false;
    let pendingExternalValue: { base: string; value: string } | null = null;
    const mermaidPreview = createMermaidPreviewController(
      editorRoot,
      () => cancelled,
      undefined,
      {
        open: initial.messages.mermaidOpen,
        renderFailed: initial.messages.mermaidRenderFailed,
        rendering: initial.messages.mermaidRendering,
      },
    );

    const updateTypingCompletion = (view: EditorView) => {
      if (cancelled || !initial.showTypingHints) return;
      const nextCompletion = codeFenceTypingCompletion(view, scroller);
      if (nextCompletion && dismissedFencePrefixRef.current === nextCompletion.prefix) {
        setCompletion(null);
        return;
      }
      if (
        dismissedFencePrefixRef.current !== null &&
        dismissedFencePrefixRef.current !== nextCompletion?.prefix
      ) {
        dismissedFencePrefixRef.current = null;
      }
      setCompletion((current) => {
        if (!nextCompletion) return null;
        const selectedIndex =
          current?.prefix === nextCompletion.prefix
            ? Math.min(current.selectedIndex, nextCompletion.suggestions.length - 1)
            : 0;
        if (
          current?.prefix === nextCompletion.prefix &&
          current.selectedIndex === selectedIndex &&
          current.left === nextCompletion.left &&
          current.top === nextCompletion.top &&
          current.suggestions.map(({ id }) => id).join("\0") ===
            nextCompletion.suggestions.map(({ id }) => id).join("\0")
        ) {
          return current;
        }
        return { ...nextCompletion, selectedIndex };
      });
    };

    const updateTableSelection = (view: EditorView) => {
      if (cancelled) return;
      const selection = selectedTableSnapshot(view);
      setTableSelection(selection);
      if (selection) setTableGridOpen(false);
      else setTableResizeOpen(false);
    };

    const localizeEmptyCodeLanguage = () => {
      const buttons = editorRoot.querySelectorAll<HTMLButtonElement>(
        ".milkdown-code-block .language-button",
      );
      for (const button of buttons) {
        const textNode = Array.from(button.childNodes).find(
          (node) => node.nodeType === Node.TEXT_NODE,
        );
        const label = textNode?.textContent?.trim();
        if (!textNode || !label) continue;
        if (label === "Text") {
          textNode.textContent = initial.messages.codePlainText;
          button.dataset.emptyLanguage = "true";
        } else if (
          button.dataset.emptyLanguage === "true" &&
          label !== initial.messages.codePlainText
        ) {
          delete button.dataset.emptyLanguage;
        }
      }
    };
    const codeControlObserver = new MutationObserver((records) => {
      localizeEmptyCodeLanguage();
      // CodeMirror nodes are lazily mounted as blocks enter the viewport.
      // Reapply search decorations only on a new editor, not on each mark.
      if (
        records.some((record) =>
          Array.from(record.addedNodes).some(
            (node) =>
              node instanceof Element &&
              (node.matches(".cm-editor") || node.querySelector(".cm-editor")),
          ),
        )
      ) {
        refreshFind();
      }
    });
    codeControlObserver.observe(editorRoot, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    const disposeLinkField = installWrappingLinkEditor(
      editorRoot,
      initial.locale === "zh-CN" ? "链接地址" : "Link address",
    );

    const reportView = (view: EditorView, preferViewport = false) => {
      if (cancelled || !initialViewRestoredRef.current) return;
      // Record the position in the event's turn. Deferring it to an animation
      // frame loses the last scroll/selection when a mode switch unmounts us.
      const selection = view.state.selection;
      const semanticPosition = preferViewport
        ? visualViewportPosition(view, scroller)
        : selection.from;
      onViewChangeRef.current?.({
        scrollTop: scroller.scrollTop,
        selectionFrom: selection.from,
        selectionTo: selection.to,
        semanticPosition: semanticPositionFromVisualDocument(
          view.state.doc,
          semanticPosition,
        ),
      });
    };

    const crepe = new Crepe({
      root: editorRoot,
      defaultValue: initial.value,
      features: {
        [CrepeFeature.AI]: false,
        [CrepeFeature.ImageBlock]: false,
        [CrepeFeature.Placeholder]: false,
        [CrepeFeature.Table]: false,
        [CrepeFeature.TopBar]: false,
      },
      featureConfigs: {
        [CrepeFeature.CodeMirror]: {
          copyText: initial.messages.codeCopy,
          extensions: [
            codeFindDecorations,
            CodeMirrorState.transactionFilter.of((transaction) => {
              if (readyRef.current || !transaction.docChanged) return transaction;
              // Crepe's code-node synchronization requests scrollIntoView even
              // for passive updates. Keep the embedded code surface stationary
              // while its enclosing document applies a shared-text transaction.
              return {
                changes: transaction.changes,
                selection: transaction.newSelection,
                effects: transaction.effects,
                annotations: CodeMirrorTransaction.addToHistory.of(false),
                scrollIntoView: false,
              };
            }),
            ...(initial.codeWrap ? [CodeMirrorView.lineWrapping] : []),
            ...(initial.showCodeLineNumbers ? [] : [hideCodeBlockGutters]),
          ],
          noResultText: initial.messages.codeNoResult,
          previewLabel: initial.messages.codePreview,
          previewLoading: initial.messages.codePreviewLoading,
          previewOnlyByDefault: true,
          previewToggleText: (previewOnly) =>
            previewOnly
              ? initial.messages.codeEditPreviewSource
              : initial.messages.codeHidePreviewSource,
          renderPreview: mermaidPreview.renderPreview,
          searchPlaceholder: initial.messages.codeLanguageSearch,
          // Crepe fills missing config with oneDark via defaultsDeep. Wrapping
          // the light extensions in a precedence value keeps that default
          // array from being merged back in at nested indexes.
          theme: Prec.highest(codeBlockLightTheme),
        },
      },
    });

    // Crepe's ImageBlock changes CommonMark image alt text into its caption
    // model. Keep the standard image node so Markdown round-trips losslessly,
    // and only customize its DOM URL and viewer affordance.
    crepe.editor.use(
      visualImageView(
        initial.documentId,
        initial.messages,
        () => cancelled,
        setEditingImage,
      ),
    );
    // The stock table NodeView squeezes wide tables into the prose width and
    // cannot expose ProseMirror's column-resize handles. Keep the GFM schema
    // and serializer, but use the official resizable TableView. Its `colwidth`
    // attrs are deliberately ignored by the Markdown serializer, so widths are
    // view state and never alter the saved file.
    crepe.editor.use(workspaceTableColumnResizing);
    crepe.editor.use($prose(() => visualFindPlugin()));

    // Listener.markdownUpdated is debounced by Milkdown. Keeping this plugin
    // synchronous guarantees that an immediate Cmd+S sees the latest Markdown.
    crepe.editor.use(
      $prose(
        (ctx) =>
          new Plugin({
            appendTransaction(transactions, previousState, currentState) {
              if (
                !readyRef.current ||
                previousState.doc.eq(currentState.doc) ||
                !transactions.some((transaction) => transaction.docChanged)
              ) {
                return null;
              }
              const markdown = ctx.get(serializerCtx)(
                withoutEditorTrailingParagraph(currentState.doc),
              );
              // Milkdown's trailing plugin inserts an empty paragraph after a
              // terminal code/table node so the cursor can leave the block.
              // That editor-only scaffold can arrive after Crepe resolves;
              // never turn it into a user edit or serialize it as `<br />`.
              if (onlyAddsEmptyTrailingParagraph(previousState.doc, currentState.doc)) {
                serializedValueRef.current = markdown;
                return null;
              }
              if (markdown !== serializedValueRef.current) {
                serializedValueRef.current = markdown;
                editorValueRef.current = markdown;
                if (!pendingExternalValue) onChangeRef.current(markdown);
              }
              return null;
            },
            view(initialView) {
              updateTypingCompletion(initialView);
              updateTableSelection(initialView);
              return {
                update(view, previousState) {
                  if (!previousState.doc.eq(view.state.doc)) refreshFind();
                  if (
                    !previousState.doc.eq(view.state.doc) ||
                    !previousState.selection.eq(view.state.selection)
                  ) {
                    reportView(view);
                    updateTypingCompletion(view);
                    updateTableSelection(view);
                  }
                },
              };
            },
          }),
      ),
    );

    crepeRef.current = crepe;

    const serializeView = (view: EditorView) =>
      crepe.editor.action((ctx) =>
        ctx.get(serializerCtx)(withoutEditorTrailingParagraph(view.state.doc)),
      );
    const applyExternalValue = (view: EditorView, nextValue: string) => {
      const { scrollTop, scrollLeft } = scroller;
      const wasReady = readyRef.current;
      readyRef.current = false;
      try {
        applySharedVisualText(crepe, view, nextValue);
        editorValueRef.current = nextValue;
        serializedValueRef.current = serializeView(view);
      } finally {
        readyRef.current = wasReady;
        scroller.scrollTop = scrollTop;
        scroller.scrollLeft = scrollLeft;
      }
    };
    syncValueRef.current = (nextValue) => {
      const view = editorViewRef.current;
      if (!view || !readyRef.current) return;
      if (pendingExternalValue) {
        pendingExternalValue.value = nextValue;
        return;
      }
      if (nextValue === editorValueRef.current) return;
      if (composing || view.composing) {
        pendingExternalValue = {
          base: serializeView(view),
          value: nextValue,
        };
        return;
      }
      applyExternalValue(view, nextValue);
    };
    const onCompositionStart = () => {
      composing = true;
      window.cancelAnimationFrame(compositionFrame);
    };
    const onCompositionEnd = () => {
      composing = false;
      compositionFrame = window.requestAnimationFrame(() => {
        const pending = pendingExternalValue;
        const view = editorViewRef.current;
        if (!pending || !view || composing || cancelled) return;
        pendingExternalValue = null;
        const merged = mergeCompositionChange(
          pending.base,
          serializeView(view),
          pending.value,
        );
        applyExternalValue(view, merged);
        if (merged !== pending.value) onChangeRef.current(merged);
      });
    };

    const onScroll = () => {
      const view = editorViewRef.current;
      if (view) reportView(view, true);
    };
    const insertSavedImage = (
      view: EditorView,
      selection: VisualEditorSelectionRange,
      markdown: string,
    ) => {
      const image = imagePayloadFromUploadResult(
        markdown,
        initial.locale === "zh-CN"
          ? "图片已经保存，但返回的图片链接格式无法识别"
          : "The image was saved, but its returned link could not be understood",
      );
      const node = crepe.editor.action((ctx) => imageSchema.type(ctx).create(image));
      view.dispatch(
        closeHistory(
          view.state.tr
            .setSelection(selectionFor(view, selection.from, selection.to))
            .replaceSelectionWith(node)
            .setMeta("uiEvent", "paste")
            .scrollIntoView(),
        ),
      );
    };
    applyImageInsertRequestRef.current = () => {
      const request = imageInsertRequestRef.current;
      const view = editorViewRef.current;
      if (
        !request ||
        !view ||
        cancelled ||
        !readyRef.current ||
        !initialViewRestoredRef.current ||
        consumedImageInsertRef.current === request.id
      ) {
        return;
      }
      consumedImageInsertRef.current = request.id;
      try {
        if (
          request.documentId !== initial.documentId ||
          request.editorMode !== "visual" ||
          request.expectedText !== editorValueRef.current ||
          !request.markdown.trim()
        ) {
          return;
        }
        insertSavedImage(view, request.selection, request.markdown);
      } catch (error: unknown) {
        if (error instanceof Error) onPasteErrorRef.current?.(error.message);
      } finally {
        onImageInsertConsumedRef.current?.(request.id);
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (
        isOversizedInlineImagePaste(text) ||
        isOversizedInlineImagePaste(event.clipboardData?.getData("text/html") ?? "")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onPasteRejectedRef.current?.(initial.messages.oversizedPaste);
        return;
      }
      const paste = onImagePasteRef.current;
      const pasteKind = clipboardImagePasteKind(event.clipboardData);
      if (!paste || !pasteKind) return;

      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest(".cm-editor")) {
        // A fenced-code CodeMirror selection uses offsets unrelated to the
        // outer ProseMirror selection. Never replace a code block by accident.
        // CodeMirror also replaces its selection with empty text for Files-only
        // payloads, so leave those selections untouched without reading native data.
        event.preventDefault();
        event.stopImmediatePropagation();
        if (pasteKind === "image") {
          onPasteErrorRef.current?.(
            initial.locale === "zh-CN"
              ? "请将光标移到代码块外的正文后粘贴图片。"
              : "Move the cursor outside the code block to paste an image.",
          );
        }
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      const view = editorViewRef.current;
      if (!view) {
        onPasteErrorRef.current?.(initial.messages.imagePasteUnavailable);
        return;
      }

      const selection = { from: view.state.selection.from, to: view.state.selection.to };
      const originalDocument = view.state.doc;
      void paste(selection, pasteKind)
        .then((markdown) => {
          if (cancelled || !markdown.trim()) return;
          const currentView = editorViewRef.current;
          if (currentView !== view) return;
          if (currentView.state.doc !== originalDocument) {
            throw new Error(
              initial.locale === "zh-CN"
                ? "图片已保存，但文档在等待期间发生了变化，未插入旧位置。请重新粘贴。"
                : "The image was saved, but the document changed while waiting. Paste again to insert it.",
            );
          }
          insertSavedImage(currentView, selection, markdown);
        })
        .catch((error: unknown) => {
          if (cancelled || editorViewRef.current !== view) return;
          const message =
            error instanceof Error ? error.message : initial.messages.imagePasteFailed;
          onPasteErrorRef.current?.(message);
        });
    };

    const openImage = (image: HTMLElement): boolean => {
      const source = image.dataset.visualImageSource;
      const openVisual = onOpenVisualRef.current;
      if (!source || !openVisual) return false;
      openVisual({
        kind: "image",
        source,
        title: image.dataset.visualImageTitle || initial.messages.image,
        reference: image.dataset.visualImageReference,
        documentPath: image.dataset.visualImageDocument,
        imageAlt: image.getAttribute("alt") ?? "",
        imageTitle: image.getAttribute("title") ?? "",
      });
      return true;
    };

    const onPointerLink = (event: MouseEvent) => {
      if (event.button !== 0 && event.button !== 1) return;
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest(".visual-markdown-image__placeholder")) {
        // Failed images can themselves be links; their actions must not navigate.
        event.preventDefault();
        return;
      }
      const copyButton = element?.closest<HTMLButtonElement>(
        ".milkdown-code-block .copy-button",
      );
      if (copyButton && event.button === 0) {
        const codeBlock = copyButton.closest<HTMLElement>(".milkdown-code-block");
        const codeMirror = codeBlock?.querySelector<HTMLElement>(".cm-editor");
        const codeView = codeMirror ? CodeMirrorView.findFromDOM(codeMirror) : null;
        if (!codeView) return;
        event.preventDefault();
        event.stopPropagation();
        void copyCodeText(codeView.state.doc.toString()).catch(() => undefined);
        return;
      }
      const image = element?.closest<HTMLElement>("[data-visual-image-source]");
      if (image) {
        if (event.button !== 0 || !openImage(image)) return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const mermaidButton = element?.closest<HTMLElement>("button[data-visual-mermaid-id]");
      if (mermaidButton) {
        if (event.button !== 0) return;
        const source = mermaidPreview.sourceFor(mermaidButton);
        if (!source) return;
        event.preventDefault();
        event.stopPropagation();
        onOpenVisualRef.current?.({
          kind: "mermaid",
          source,
          title: initial.messages.mermaidTitle,
        });
        return;
      }

      // Crepe renders its hover-preview anchor beside ProseMirror, not inside
      // it. Route that anchor too so local links never escape to a WebView tab.
      const link = element?.closest<HTMLAnchorElement>(
        ".ProseMirror a[href], .milkdown-link-preview a.link-display[href]",
      );
      const target = link?.getAttribute("href")?.trim();
      if (!link || !target || !onInternalLinkRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      onInternalLinkRef.current(
        target,
        linkDispositionFromPointer(
          event.metaKey || event.ctrlKey,
          event.shiftKey,
          event.button,
        ),
      );
    };

    const onEditorKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".visual-markdown-image__placeholder")
      )
        return;
      const completion = typingCompletionRef.current;
      if (completion && !event.isComposing) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopImmediatePropagation();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          setCompletion((current) => {
            if (!current) return null;
            const count = current.suggestions.length;
            return {
              ...current,
              selectedIndex: (current.selectedIndex + direction + count) % count,
            };
          });
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const language = completion.suggestions[completion.selectedIndex]?.id;
          if (language) {
            event.preventDefault();
            event.stopImmediatePropagation();
            acceptFenceLanguage(language);
            return;
          }
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          dismissedFencePrefixRef.current = completion.prefix;
          setCompletion(null);
          return;
        }
      }

      if (event.key !== "Enter" && event.key !== " ") return;
      const element = event.target instanceof Element ? event.target : null;
      const image = element?.closest<HTMLElement>("[data-visual-image-source]");
      if (!image || !openImage(image)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const onEditorCommand = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as VisualEditorCommandDetail | undefined;
      if (!detail || typeof detail.command !== "string") return;
      if (detail.command === "editImage") {
        const element = detail.target instanceof Element ? detail.target : null;
        const image =
          element?.closest<HTMLImageElement>("img") ??
          element
            ?.closest(".visual-markdown-image")
            ?.querySelector<HTMLImageElement>("img");
        const view = editorViewRef.current;
        const target = image && view ? imageEditTarget(image, view) : null;
        if (target) {
          setEditingImage(target);
          event.preventDefault();
        }
        return;
      }
      if (runCommand(detail)) event.preventDefault();
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("compositionstart", onCompositionStart, true);
    scroller.addEventListener("compositionend", onCompositionEnd);
    scroller.addEventListener("paste", onPaste, true);
    scroller.addEventListener("click", onPointerLink, true);
    scroller.addEventListener("auxclick", onPointerLink, true);
    scroller.addEventListener("keydown", onEditorKeyDown, true);
    scroller.addEventListener(VISUAL_EDITOR_COMMAND_EVENT, onEditorCommand);

    const creation = crepe.create();
    void creation
      .then(() => {
        if (cancelled) {
          void crepe.destroy();
          return;
        }
        const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx));
        editorViewRef.current = view;
        findTargetRef.current = visualFindTarget(view, scroller);
        serializedValueRef.current = crepe.getMarkdown();

        const latestValue = latestValueRef.current;
        if (latestValue !== editorValueRef.current) {
          applyExternalValue(view, latestValue);
        }
        readyRef.current = true;

        restoreFrame = window.requestAnimationFrame(() => {
          const nextView = editorViewRef.current;
          if (!nextView || cancelled) return;
          const semanticPosition = initial.initialView?.semanticPosition;
          const semanticSelection = semanticPosition
            ? visualPositionFromSemantic(nextView.state.doc, semanticPosition)
            : undefined;
          const selectionFrom =
            semanticSelection ?? initial.initialView?.selectionFrom ?? 0;
          const selectionTo =
            semanticSelection ??
            initial.initialView?.selectionTo ??
            initial.initialView?.selectionFrom ??
            0;
          const savedSelection = selectionFor(nextView, selectionFrom, selectionTo);
          const restoreTransaction = nextView.state.tr.setSelection(savedSelection);
          nextView.dispatch(
            semanticPosition ? restoreTransaction.scrollIntoView() : restoreTransaction,
          );
          // Creation can finish after the user activates a different split.
          // Restore this tab's position without stealing that newer focus.
          if (latestAutofocusRef.current) nextView.focus();
          if (!semanticPosition) scroller.scrollTop = initial.initialView?.scrollTop ?? 0;
          // Link requests can arrive after creation but before this frame. Restore
          // the baseline first, then consume only the latest pending navigation.
          initialViewRestoredRef.current = true;
          const requestedReveal = latestRevealRef.current;
          if (
            requestedReveal &&
            consumedRevealRef.current !== requestedReveal.requestId &&
            revealInEditor(editorRoot, scroller, nextView, requestedReveal)
          ) {
            consumedRevealRef.current = requestedReveal.requestId;
            onRevealConsumedRef.current?.(requestedReveal.requestId);
          }
          reportView(nextView);
          refreshFind();
          updateTypingCompletion(nextView);
          applyImageInsertRequestRef.current();
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCreationError(readableError(error, initial.messages.creationErrorFallback));
        }
      });

    return () => {
      cancelled = true;
      readyRef.current = false;
      initialViewRestoredRef.current = false;
      window.cancelAnimationFrame(restoreFrame);
      window.cancelAnimationFrame(compositionFrame);
      mermaidPreview.dispose();
      codeControlObserver.disconnect();
      disposeLinkField();
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("compositionstart", onCompositionStart, true);
      scroller.removeEventListener("compositionend", onCompositionEnd);
      scroller.removeEventListener("paste", onPaste, true);
      scroller.removeEventListener("click", onPointerLink, true);
      scroller.removeEventListener("auxclick", onPointerLink, true);
      scroller.removeEventListener("keydown", onEditorKeyDown, true);
      scroller.removeEventListener(VISUAL_EDITOR_COMMAND_EVENT, onEditorCommand);
      editorViewRef.current = null;
      findTargetRef.current = null;
      syncValueRef.current = () => {};
      applyImageInsertRequestRef.current = () => {};
      crepeRef.current = null;
      if (crepe.editor.status === "Created") void crepe.destroy();
    };
  }, [acceptFenceLanguage, findTargetRef, refreshFind, runCommand, setCompletion]);

  useEffect(() => {
    syncValueRef.current(value);
  }, [value]);

  useEffect(() => {
    applyImageInsertRequestRef.current();
  }, [imageInsertRequest]);

  useEffect(() => {
    const editorRoot = editorRootRef.current;
    const scroller = scrollerRef.current;
    const view = editorViewRef.current;
    if (
      !reveal ||
      !editorRoot ||
      !scroller ||
      !view ||
      !readyRef.current ||
      !initialViewRestoredRef.current ||
      consumedRevealRef.current === reveal.requestId
    ) {
      return;
    }
    if (revealInEditor(editorRoot, scroller, view, reveal)) {
      consumedRevealRef.current = reveal.requestId;
      onRevealConsumedRef.current?.(reveal.requestId);
    }
  }, [reveal]);

  return (
    <div className="visual-markdown-editor-frame">
      {editingImage && (
        <ImageReferenceDialog
          target={editingImage}
          locale={locale}
          onClose={closeImageEditor}
        />
      )}
      <FindBar find={find} locale={locale} />
      <div
        aria-label={messages.editorAriaLabel}
        className="visual-markdown-editor"
        data-code-line-numbers={String(showCodeLineNumbers)}
        data-code-wrap={String(codeWrap)}
        data-document-id={documentId}
        data-editor-locale={locale}
        ref={scrollerRef}
      >
        {(tableSelection || tableGridOpen) && (
          <div className="visual-markdown-editor__table-tools-anchor">
            {tableSelection && (
              <div
                aria-label={messages.tableTools}
                className="visual-markdown-editor__table-tools"
                onMouseDownCapture={(event) => event.preventDefault()}
                role="toolbar"
              >
                <button
                  aria-expanded={tableResizeOpen}
                  aria-haspopup="dialog"
                  className="visual-markdown-editor__table-button visual-markdown-editor__table-button--size"
                  onClick={() => {
                    setTableResizeDraft({
                      rows: tableSelection.rows,
                      columns: tableSelection.columns,
                    });
                    setTableResizeOpen((open) => !open);
                  }}
                  title={messages.tableSize}
                  type="button"
                >
                  <span aria-hidden="true" className="visual-markdown-editor__table-icon">
                    ▦
                  </span>
                  <span>{`${tableSelection.rows} × ${tableSelection.columns}`}</span>
                </button>
                <span
                  aria-hidden="true"
                  className="visual-markdown-editor__table-divider"
                />
                {(
                  [
                    ["left", "alignTableLeft", messages.alignTableLeft],
                    ["center", "alignTableCenter", messages.alignTableCenter],
                    ["right", "alignTableRight", messages.alignTableRight],
                  ] as const
                ).map(([alignment, command, label]) => (
                  <button
                    aria-label={label}
                    aria-pressed={tableSelection.alignment === alignment}
                    className="visual-markdown-editor__table-button visual-markdown-editor__table-button--icon"
                    key={alignment}
                    onClick={() => runCommand({ command })}
                    title={label}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="visual-markdown-editor__table-align-icon"
                      data-alignment={alignment}
                    >
                      <i />
                      <i />
                      <i />
                    </span>
                  </button>
                ))}
                <span
                  aria-hidden="true"
                  className="visual-markdown-editor__table-divider"
                />
                <button
                  aria-label={messages.addTableRow}
                  className="visual-markdown-editor__table-button"
                  onClick={() => runCommand({ command: "addRowAfter" })}
                  title={messages.addTableRow}
                  type="button"
                >
                  <span aria-hidden="true">＋</span>
                  <span>{locale === "zh-CN" ? "行" : "Row"}</span>
                </button>
                <button
                  aria-label={messages.deleteTableRow}
                  className="visual-markdown-editor__table-button"
                  onClick={() => runCommand({ command: "deleteRow" })}
                  title={messages.deleteTableRow}
                  type="button"
                >
                  <span aria-hidden="true">−</span>
                  <span>{locale === "zh-CN" ? "行" : "Row"}</span>
                </button>
                <button
                  aria-label={messages.addTableColumn}
                  className="visual-markdown-editor__table-button"
                  onClick={() => runCommand({ command: "addColumnAfter" })}
                  title={messages.addTableColumn}
                  type="button"
                >
                  <span aria-hidden="true">＋</span>
                  <span>{locale === "zh-CN" ? "列" : "Column"}</span>
                </button>
                <button
                  aria-label={messages.deleteTableColumn}
                  className="visual-markdown-editor__table-button"
                  onClick={() => runCommand({ command: "deleteColumn" })}
                  title={messages.deleteTableColumn}
                  type="button"
                >
                  <span aria-hidden="true">−</span>
                  <span>{locale === "zh-CN" ? "列" : "Column"}</span>
                </button>
              </div>
            )}
            {tableGridOpen && !tableSelection && (
              <div
                aria-label={messages.tableGrid}
                className="visual-markdown-editor__table-grid-popover visual-markdown-editor__table-grid-popover--insert"
                data-testid="table-grid-popover"
                onMouseDownCapture={(event) => event.preventDefault()}
                role="dialog"
              >
                <strong>
                  {messages.tableGridSize(tableGridHover.rows, tableGridHover.columns)}
                </strong>
                <div className="visual-markdown-editor__table-grid" role="grid">
                  {Array.from({ length: TABLE_GRID_ROWS }, (_, rowIndex) => {
                    const rows = rowIndex + TABLE_MIN_ROWS;
                    return Array.from({ length: TABLE_GRID_COLUMNS }, (_, columnIndex) => {
                      const columns = columnIndex + TABLE_MIN_COLUMNS;
                      const selected =
                        rows <= tableGridHover.rows && columns <= tableGridHover.columns;
                      return (
                        <button
                          aria-label={messages.tableGridSize(rows, columns)}
                          className="visual-markdown-editor__table-grid-cell"
                          data-selected={String(selected)}
                          key={`${rows}:${columns}`}
                          onClick={() =>
                            runCommand({ command: "insertTable", rows, columns })
                          }
                          onMouseEnter={() => setTableGridHover({ rows, columns })}
                          role="gridcell"
                          type="button"
                        />
                      );
                    });
                  })}
                </div>
              </div>
            )}
            {tableResizeOpen && tableSelection && (
              <div
                aria-label={messages.tableSize}
                className="visual-markdown-editor__table-grid-popover visual-markdown-editor__table-grid-popover--resize"
                data-testid="table-resize-popover"
                onMouseDownCapture={(event) => event.preventDefault()}
                role="dialog"
              >
                <strong>
                  {messages.tableGridSize(tableResizeDraft.rows, tableResizeDraft.columns)}
                </strong>
                <div className="visual-markdown-editor__table-size-fields">
                  <label>
                    <span>{messages.tableRows}</span>
                    <input
                      aria-label={messages.tableRows}
                      max={TABLE_RESIZE_MAX_ROWS}
                      min={TABLE_MIN_ROWS}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        setTableResizeDraft((current) => ({
                          ...current,
                          rows: clampedTableDimension(
                            value,
                            TABLE_MIN_ROWS,
                            TABLE_RESIZE_MAX_ROWS,
                            current.rows,
                          ),
                        }));
                      }}
                      type="number"
                      value={tableResizeDraft.rows}
                    />
                  </label>
                  <label>
                    <span>{messages.tableColumns}</span>
                    <input
                      aria-label={messages.tableColumns}
                      max={TABLE_RESIZE_MAX_COLUMNS}
                      min={TABLE_MIN_COLUMNS}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        setTableResizeDraft((current) => ({
                          ...current,
                          columns: clampedTableDimension(
                            value,
                            TABLE_MIN_COLUMNS,
                            TABLE_RESIZE_MAX_COLUMNS,
                            current.columns,
                          ),
                        }));
                      }}
                      type="number"
                      value={tableResizeDraft.columns}
                    />
                  </label>
                  <button
                    className="visual-markdown-editor__table-size-apply"
                    onClick={() =>
                      runCommand({
                        command: "resizeTable",
                        rows: tableResizeDraft.rows,
                        columns: tableResizeDraft.columns,
                      })
                    }
                    type="button"
                  >
                    {messages.applyTableSize}
                  </button>
                </div>
                <div className="visual-markdown-editor__table-grid" role="grid">
                  {Array.from({ length: TABLE_GRID_ROWS }, (_, rowIndex) => {
                    const rows = rowIndex + TABLE_MIN_ROWS;
                    return Array.from({ length: TABLE_GRID_COLUMNS }, (_, columnIndex) => {
                      const columns = columnIndex + TABLE_MIN_COLUMNS;
                      const selected =
                        rows <= tableResizeDraft.rows &&
                        columns <= tableResizeDraft.columns;
                      return (
                        <button
                          aria-label={messages.tableGridSize(rows, columns)}
                          className="visual-markdown-editor__table-grid-cell"
                          data-selected={String(selected)}
                          key={`${rows}:${columns}`}
                          onClick={() =>
                            runCommand({ command: "resizeTable", rows, columns })
                          }
                          onMouseEnter={() => setTableResizeDraft({ rows, columns })}
                          role="gridcell"
                          type="button"
                        />
                      );
                    });
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        <div className="visual-markdown-editor__root" ref={editorRootRef} />
        {typingCompletion && showTypingHints && (
          <div
            aria-label={messages.codeFenceLanguages}
            className="visual-markdown-editor__typing-completion"
            data-testid="code-fence-completion"
            role="listbox"
            style={{ left: typingCompletion.left, top: typingCompletion.top }}
          >
            <div className="visual-markdown-editor__typing-options">
              {typingCompletion.suggestions.map((language, index) => (
                <button
                  aria-selected={index === typingCompletion.selectedIndex}
                  className="visual-markdown-editor__typing-option"
                  data-selected={String(index === typingCompletion.selectedIndex)}
                  key={language.id}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    acceptFenceLanguage(language.id);
                  }}
                  role="option"
                  type="button"
                >
                  <span aria-hidden="true">⌘</span>
                  {language.id}
                </button>
              ))}
            </div>
            <div className="visual-markdown-editor__typing-keys">
              {messages.codeFenceKeys}
            </div>
          </div>
        )}
        {creationError && (
          <div className="visual-markdown-editor__error" role="alert">
            <strong>{messages.creationErrorTitle}</strong>
            <span>{creationError}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function VisualMarkdownEditor(props: VisualMarkdownEditorProps) {
  return (
    <VisualMarkdownEditorInstance
      {...props}
      key={`${props.instanceId ?? props.documentId}:${props.documentId}:${props.locale ?? "zh-CN"}:${String(props.showCodeLineNumbers ?? true)}:${String(props.codeWrap ?? false)}:${String(props.showTypingHints ?? true)}`}
    />
  );
}
