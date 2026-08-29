import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  defaultHighlightStyle,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useLayoutEffect, useRef } from "react";

import {
  linkDispositionFromPointer,
  markdownLinkTargetAt,
  type LinkDisposition,
} from "./linkTarget";
import { isOversizedInlineImagePaste } from "./pasteGuard";
import { createEditorSpikeMetrics, editorSpikeExtensions } from "./spike/editorSpike";
import "./MarkdownEditor.css";

export interface SelectionRange {
  readonly from: number;
  readonly to: number;
}

export interface EditorRevealRequest {
  readonly position: number;
  readonly requestId: number;
}

export interface MarkdownEditorProps {
  readonly documentId: string;
  readonly value: string;
  readonly mode: "normal" | "sourceOnly";
  readonly autofocus?: boolean;
  readonly reveal?: EditorRevealRequest;
  readonly onChange: (value: string) => void;
  readonly onImagePaste?: (selection: SelectionRange) => Promise<string>;
  readonly onInternalLink?: (target: string, disposition: LinkDisposition) => void;
  readonly onPasteRejected?: (message: string) => void;
  readonly onPasteError?: (message: string) => void;
}

function firstClipboardImage(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items)) {
    if (!item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

const paperHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "2em", fontWeight: "760", color: "#20242b" },
  { tag: tags.heading2, fontSize: "1.55em", fontWeight: "720", color: "#20242b" },
  { tag: tags.heading3, fontSize: "1.25em", fontWeight: "690", color: "#2b3039" },
  { tag: tags.strong, fontWeight: "720", color: "#292f38" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: [tags.link, tags.url], color: "#3568e8", textDecoration: "underline" },
  {
    tag: tags.monospace,
    fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace',
    color: "#414854",
    backgroundColor: "#f3f4f6",
  },
  { tag: tags.quote, color: "#596273" },
]);

const paperEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "#343a45",
    backgroundColor: "#ffffff",
    fontSize: "17px",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  ".cm-content": {
    width: "min(100%, 980px)",
    minHeight: "100%",
    margin: "0 auto",
    padding: "52px clamp(32px, 7vw, 88px) 140px",
    caretColor: "#315fcf",
    lineHeight: "1.8",
  },
  ".cm-line": {
    padding: "1px 0",
  },
  ".cm-focused": {
    outline: "none",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "#315fcf",
    borderLeftWidth: "2px",
  },
  "&.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(53, 104, 232, 0.18)",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(246, 247, 248, 0.52)",
  },
  ".cm-gutters": {
    display: "none",
  },
});

function editorExtensions(
  mode: MarkdownEditorProps["mode"],
  onChange: MarkdownEditorProps["onChange"],
  onImagePaste: MarkdownEditorProps["onImagePaste"],
  onInternalLink: MarkdownEditorProps["onInternalLink"],
  onPasteRejected: MarkdownEditorProps["onPasteRejected"],
  onPasteError: MarkdownEditorProps["onPasteError"],
) {
  const sourceFirst =
    mode === "normal"
      ? editorSpikeExtensions({ metrics: createEditorSpikeMetrics() })
      : [history()];

  const openMarkdownLink = (event: MouseEvent, view: EditorView): boolean => {
    if (!onInternalLink || (event.button !== 0 && event.button !== 1)) return false;
    const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (position === null) return false;
    const target = markdownLinkTargetAt(view.state, position);
    if (!target) return false;

    event.preventDefault();
    onInternalLink(
      target,
      linkDispositionFromPointer(
        event.metaKey || event.ctrlKey,
        event.shiftKey,
        event.button,
      ),
    );
    return true;
  };

  return [
    sourceFirst,
    drawSelection(),
    highlightActiveLine(),
    EditorView.lineWrapping,
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    syntaxHighlighting(paperHighlightStyle),
    paperEditorTheme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange(update.state.doc.toString());
    }),
    EditorView.domEventHandlers({
      click(event, view) {
        return event.button === 0 ? openMarkdownLink(event, view) : false;
      },
      auxclick(event, view) {
        return event.button === 1 ? openMarkdownLink(event, view) : false;
      },
      paste(event, view) {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (isOversizedInlineImagePaste(text)) {
          event.preventDefault();
          onPasteRejected?.("这段粘贴内容包含很大的内嵌图片数据，已阻止以避免编辑器卡死。");
          return true;
        }

        const file = firstClipboardImage(event.clipboardData);
        if (!file || !onImagePaste) return false;

        event.preventDefault();
        const selection = view.state.selection.main;
        void onImagePaste({ from: selection.from, to: selection.to })
          .then((markdown) => {
            view.dispatch({
              changes: { from: selection.from, to: selection.to, insert: markdown },
              selection: { anchor: selection.from + markdown.length },
            });
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "图片没有保存";
            onPasteError?.(message);
          });
        return true;
      },
    }),
  ];
}

function MarkdownEditorInstance({
  documentId,
  value,
  mode,
  autofocus = true,
  onChange,
  onImagePaste,
  onInternalLink,
  onPasteRejected,
  onPasteError,
  reveal,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onImagePasteRef = useRef(onImagePaste);
  const onInternalLinkRef = useRef(onInternalLink);
  const onPasteRejectedRef = useRef(onPasteRejected);
  const onPasteErrorRef = useRef(onPasteError);
  const initialConfigRef = useRef({ autofocus, mode, value });

  useEffect(() => {
    onChangeRef.current = onChange;
    onImagePasteRef.current = onImagePaste;
    onInternalLinkRef.current = onInternalLink;
    onPasteRejectedRef.current = onPasteRejected;
    onPasteErrorRef.current = onPasteError;
  }, [onChange, onImagePaste, onInternalLink, onPasteError, onPasteRejected]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const initial = initialConfigRef.current;

    valueRef.current = initial.value;
    const state = EditorState.create({
      doc: initial.value,
      selection: EditorSelection.cursor(0),
      extensions: editorExtensions(
        initial.mode,
        (nextValue) => {
          valueRef.current = nextValue;
          onChangeRef.current(nextValue);
        },
        async (selection) => {
          if (!onImagePasteRef.current) throw new Error("图片粘贴尚未启用");
          return onImagePasteRef.current(selection);
        },
        (target, disposition) => onInternalLinkRef.current?.(target, disposition),
        (message) => onPasteRejectedRef.current?.(message),
        (message) => onPasteErrorRef.current?.(message),
      ),
    });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    if (initial.autofocus) view.focus();

    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === valueRef.current) return;

    valueRef.current = value;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: Transaction.addToHistory.of(false),
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !reveal) return;
    const position = Math.max(0, Math.min(reveal.position, view.state.doc.length));
    view.dispatch({
      selection: EditorSelection.cursor(position),
      effects: EditorView.scrollIntoView(position, { y: "start", yMargin: 40 }),
    });
    view.focus();
  }, [reveal]);

  return (
    <div
      aria-label="Markdown 编辑器"
      className={`markdown-editor markdown-editor--${mode}`}
      data-document-id={documentId}
      ref={hostRef}
    />
  );
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  return <MarkdownEditorInstance {...props} key={`${props.documentId}:${props.mode}`} />;
}
