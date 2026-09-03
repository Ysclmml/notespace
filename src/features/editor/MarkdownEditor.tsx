import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  defaultHighlightStyle,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  linkDispositionFromPointer,
  markdownLinkTargetAt,
  type LinkDisposition,
} from "./linkTarget";
import { isOversizedInlineImagePaste } from "./pasteGuard";
import {
  clipboardImagePasteKind,
  type ClipboardImagePasteKind,
  type EditorImageInsertRequest,
} from "./clipboardImage";
import { mergeCompositionChange, sharedTextChange } from "./sharedTextChange";
import {
  markdownPositionFromSemantic,
  semanticPositionFromMarkdown,
  type EditorSemanticPosition,
} from "./semanticPosition";
import { VisualMarkdownEditor, type MarkdownEditorLocale } from "./VisualMarkdownEditor";
import type { PreviewVisual } from "../viewer/model";
import { FindBar } from "../find/FindBar";
import { codeFindDecorations, codeMirrorFindTarget } from "../find/codeMirrorFind";
import { usePageFind } from "../find/usePageFind";
import "./MarkdownEditor.css";

export interface SelectionRange {
  readonly from: number;
  readonly to: number;
}

export interface EditorRevealRequest {
  readonly anchor?: string;
  readonly headingText?: string;
  readonly position?: number;
  readonly requestId: number;
  readonly scrollTop?: number;
}

export interface EditorViewSnapshot {
  readonly scrollTop: number;
  readonly selectionFrom: number;
  readonly selectionTo: number;
  readonly semanticPosition?: EditorSemanticPosition;
}

export interface MarkdownEditorProps {
  readonly documentId: string;
  readonly instanceId?: string;
  readonly value: string;
  readonly mode: "normal" | "sourceOnly";
  readonly presentationMode?: "visual" | "source";
  readonly autofocus?: boolean;
  /** Controls wrapping inside fenced code blocks on the visual surface. */
  readonly codeWrap?: boolean;
  readonly initialView?: EditorViewSnapshot;
  readonly locale?: MarkdownEditorLocale;
  readonly findRequest?: number;
  readonly onFindRequestConsumed?: (request: number) => void;
  readonly reveal?: EditorRevealRequest;
  readonly showCodeLineNumbers?: boolean;
  readonly showTypingHints?: boolean;
  readonly onChange: (value: string) => void;
  readonly onImagePaste?: (
    selection: SelectionRange,
    kind?: ClipboardImagePasteKind,
  ) => Promise<string>;
  readonly imageInsertRequest?: EditorImageInsertRequest;
  readonly onImageInsertConsumed?: (id: number) => void;
  readonly onInternalLink?: (target: string, disposition: LinkDisposition) => void;
  readonly onPasteRejected?: (message: string) => void;
  readonly onPasteError?: (message: string) => void;
  readonly onOpenVisual?: (visual: PreviewVisual) => void;
  readonly onRevealConsumed?: (requestId: number) => void;
  readonly onViewChange?: (view: EditorViewSnapshot) => void;
}

/**
 * Small integration contract for an explicit visual/source switch. The target
 * surface resolves `semanticPosition` against its own document model instead
 * of treating ProseMirror positions as Markdown offsets.
 */
function viewForSemanticModeSwitch(current: EditorViewSnapshot): EditorViewSnapshot {
  return {
    scrollTop: 0,
    selectionFrom: 0,
    selectionTo: 0,
    semanticPosition: current.semanticPosition,
  };
}

function insertSourceImage(view: EditorView, selection: SelectionRange, markdown: string) {
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: markdown },
    selection: { anchor: selection.from + markdown.length },
    annotations: Transaction.userEvent.of("input.paste"),
  });
}

function sourceViewportPosition(view: EditorView): number {
  const bounds = view.scrollDOM.getBoundingClientRect();
  // CM's viewport includes an overscan margin. Its offset midpoint is not the
  // reading position (and can remain unchanged while a short document scrolls).
  if (bounds.width <= 0 || bounds.height <= 0) return view.state.selection.main.from;
  return (
    view.posAtCoords({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + Math.min(bounds.height / 2, 180),
    }) ?? view.state.selection.main.from
  );
}

const paperHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: "760", color: "#20242b" },
  { tag: tags.heading2, fontWeight: "720", color: "#20242b" },
  { tag: tags.heading3, fontWeight: "690", color: "#2b3039" },
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
    fontSize: "var(--app-editor-font-size, 14px)",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace',
  },
  ".cm-content": {
    boxSizing: "border-box",
    width: "min(100%, var(--prose-max, 1080px))",
    minHeight: "100%",
    margin: "0 auto",
    padding: "52px clamp(32px, 7vw, 88px) 140px",
    caretColor: "#315fcf",
    lineHeight: "1.72",
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
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "#b8cff8",
  },
  ".cm-content ::selection": {
    color: "#17233a",
    backgroundColor: "#b8cff8",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(65, 105, 180, 0.12)",
  },
  ".cm-gutters": {
    display: "none",
  },
});

function editorExtensions(
  onChange: MarkdownEditorProps["onChange"],
  getImagePaste: () => MarkdownEditorProps["onImagePaste"],
  onInternalLink: MarkdownEditorProps["onInternalLink"],
  onPasteRejected: MarkdownEditorProps["onPasteRejected"],
  onPasteError: MarkdownEditorProps["onPasteError"],
  reportView: (view: EditorView, preferViewport?: boolean) => void,
  isCurrentView: (view: EditorView) => boolean,
  locale: MarkdownEditorLocale,
) {
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
    markdown(),
    history(),
    drawSelection(),
    highlightActiveLine(),
    EditorView.lineWrapping,
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    syntaxHighlighting(paperHighlightStyle),
    paperEditorTheme,
    codeFindDecorations,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange(update.state.doc.toString());
      if (update.selectionSet || update.docChanged) reportView(update.view);
      else if (update.viewportChanged) reportView(update.view, true);
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
        if (
          isOversizedInlineImagePaste(text) ||
          isOversizedInlineImagePaste(event.clipboardData?.getData("text/html") ?? "")
        ) {
          event.preventDefault();
          onPasteRejected?.(
            locale === "zh-CN"
              ? "这段粘贴内容包含很大的内嵌图片数据，已阻止以避免编辑器卡死。"
              : "This paste contains a very large embedded image and was blocked.",
          );
          return true;
        }

        const pasteImage = getImagePaste();
        const pasteKind = clipboardImagePasteKind(event.clipboardData);
        if (!pasteImage || !pasteKind) return false;

        event.preventDefault();
        const selection = view.state.selection.main;
        const originalDocument = view.state.doc;
        void pasteImage({ from: selection.from, to: selection.to }, pasteKind)
          .then((markdown) => {
            if (!isCurrentView(view) || !markdown.trim()) return;
            if (view.state.doc !== originalDocument) {
              throw new Error(
                locale === "zh-CN"
                  ? "图片已保存，但文档在等待期间发生了变化，未插入旧位置。请重新粘贴。"
                  : "The image was saved, but the document changed while waiting. Paste again to insert it.",
              );
            }
            insertSourceImage(view, selection, markdown);
          })
          .catch((error: unknown) => {
            if (!isCurrentView(view)) return;
            const message =
              error instanceof Error
                ? error.message
                : locale === "zh-CN"
                  ? "图片没有保存"
                  : "The image was not saved";
            onPasteError?.(message);
          });
        return true;
      },
    }),
  ];
}

function SourceMarkdownEditorInstance({
  documentId,
  value,
  mode,
  autofocus = true,
  locale = "zh-CN",
  findRequest,
  onFindRequestConsumed,
  onChange,
  onImagePaste,
  imageInsertRequest,
  onImageInsertConsumed,
  onInternalLink,
  onPasteRejected,
  onPasteError,
  onRevealConsumed,
  onViewChange,
  initialView,
  reveal,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const syncValueRef = useRef<(nextValue: string) => void>(() => {});
  const onChangeRef = useRef(onChange);
  const onImagePasteRef = useRef(onImagePaste);
  const onInternalLinkRef = useRef(onInternalLink);
  const onPasteRejectedRef = useRef(onPasteRejected);
  const onPasteErrorRef = useRef(onPasteError);
  const onRevealConsumedRef = useRef(onRevealConsumed);
  const onViewChangeRef = useRef(onViewChange);
  const consumedRevealRef = useRef<number | null>(null);
  const consumedImageInsertRef = useRef<number | null>(null);
  const initialViewRestoredRef = useRef(false);
  const applyImageInsertRequestRef = useRef<() => void>(() => {});
  const initialConfigRef = useRef({
    autofocus,
    documentId,
    initialView,
    locale,
    mode,
    value,
  });
  const find = usePageFind(findRequest, onFindRequestConsumed);
  const { targetRef: findTargetRef, refresh: refreshFind } = find;

  useEffect(() => {
    onChangeRef.current = onChange;
    onImagePasteRef.current = onImagePaste;
    onInternalLinkRef.current = onInternalLink;
    onPasteRejectedRef.current = onPasteRejected;
    onPasteErrorRef.current = onPasteError;
    onRevealConsumedRef.current = onRevealConsumed;
    onViewChangeRef.current = onViewChange;
  }, [
    onChange,
    onImagePaste,
    onInternalLink,
    onPasteError,
    onPasteRejected,
    onRevealConsumed,
    onViewChange,
  ]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    initialViewRestoredRef.current = false;
    const initial = initialConfigRef.current;
    let applyingExternalValue = false;
    let composing = false;
    let compositionFrame = 0;
    let pendingExternalValue: { base: string; value: string } | null = null;
    const semanticSelection = initial.initialView?.semanticPosition
      ? markdownPositionFromSemantic(initial.value, initial.initialView.semanticPosition)
      : undefined;
    const selectionFrom = Math.max(
      0,
      Math.min(
        semanticSelection ?? initial.initialView?.selectionFrom ?? 0,
        initial.value.length,
      ),
    );
    const selectionTo = Math.max(
      selectionFrom,
      Math.min(
        semanticSelection ?? initial.initialView?.selectionTo ?? selectionFrom,
        initial.value.length,
      ),
    );

    const reportView = (view: EditorView, preferViewport = false) => {
      if (!initialViewRestoredRef.current) return;
      const selection = view.state.selection.main;
      const semanticPosition = preferViewport
        ? sourceViewportPosition(view)
        : selection.from;
      onViewChangeRef.current?.({
        scrollTop: view.scrollDOM.scrollTop,
        selectionFrom: selection.from,
        selectionTo: selection.to,
        semanticPosition: semanticPositionFromMarkdown(
          view.state.doc.toString(),
          semanticPosition,
        ),
      });
    };

    const state = EditorState.create({
      doc: initial.value,
      selection: EditorSelection.range(selectionFrom, selectionTo),
      extensions: editorExtensions(
        (nextValue) => {
          refreshFind();
          if (!applyingExternalValue && !pendingExternalValue) {
            onChangeRef.current(nextValue);
          }
        },
        () => onImagePasteRef.current,
        (target, disposition) => onInternalLinkRef.current?.(target, disposition),
        (message) => onPasteRejectedRef.current?.(message),
        (message) => onPasteErrorRef.current?.(message),
        reportView,
        (candidate) => viewRef.current === candidate,
        initial.locale,
      ),
    });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    findTargetRef.current = codeMirrorFindTarget(view);
    const applyExternalValue = (nextValue: string) => {
      const change = sharedTextChange(view.state.doc.toString(), nextValue);
      if (!change) return;
      const { scrollTop, scrollLeft } = view.scrollDOM;
      applyingExternalValue = true;
      try {
        view.dispatch({
          changes: change,
          annotations: Transaction.addToHistory.of(false),
        });
      } finally {
        applyingExternalValue = false;
        view.scrollDOM.scrollTop = scrollTop;
        view.scrollDOM.scrollLeft = scrollLeft;
      }
    };
    syncValueRef.current = (nextValue) => {
      const current = view.state.doc.toString();
      if (pendingExternalValue) {
        pendingExternalValue.value = nextValue;
        return;
      }
      if (nextValue === current) return;
      if (composing || view.composing) {
        pendingExternalValue = {
          base: current,
          value: nextValue,
        };
        return;
      }
      applyExternalValue(nextValue);
    };
    const onCompositionStart = () => {
      composing = true;
      window.cancelAnimationFrame(compositionFrame);
    };
    const onCompositionEnd = () => {
      composing = false;
      // Let the editor finish the compositionend/input transaction first.
      compositionFrame = window.requestAnimationFrame(() => {
        const pending = pendingExternalValue;
        if (!pending || composing) return;
        pendingExternalValue = null;
        const merged = mergeCompositionChange(
          pending.base,
          view.state.doc.toString(),
          pending.value,
        );
        applyExternalValue(merged);
        if (merged !== pending.value) onChangeRef.current(merged);
      });
    };
    host.addEventListener("compositionstart", onCompositionStart, true);
    host.addEventListener("compositionend", onCompositionEnd);
    const onScroll = () => reportView(view, true);
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    const restoreFrame = window.requestAnimationFrame(() => {
      const semanticPosition = initial.initialView?.semanticPosition;
      const savedScrollTop = semanticPosition ? 0 : (initial.initialView?.scrollTop ?? 0);
      if (!semanticPosition) view.scrollDOM.scrollTop = savedScrollTop;
      if ((semanticPosition || savedScrollTop === 0) && selectionFrom > 0) {
        view.dispatch({
          effects: EditorView.scrollIntoView(selectionFrom, {
            y: "start",
            yMargin: 40,
          }),
        });
      }
      initialViewRestoredRef.current = true;
      reportView(view);
      applyImageInsertRequestRef.current();
    });
    if (initial.autofocus) view.focus();

    return () => {
      window.cancelAnimationFrame(restoreFrame);
      initialViewRestoredRef.current = false;
      window.cancelAnimationFrame(compositionFrame);
      host.removeEventListener("compositionstart", onCompositionStart, true);
      host.removeEventListener("compositionend", onCompositionEnd);
      view.scrollDOM.removeEventListener("scroll", onScroll);
      syncValueRef.current = () => {};
      viewRef.current = null;
      findTargetRef.current = null;
      view.destroy();
    };
  }, [findTargetRef, refreshFind]);

  useEffect(() => {
    syncValueRef.current(value);
  }, [value]);

  useEffect(() => {
    applyImageInsertRequestRef.current = () => {
      const request = imageInsertRequest;
      const view = viewRef.current;
      if (
        !request ||
        !view ||
        !initialViewRestoredRef.current ||
        consumedImageInsertRef.current === request.id
      )
        return;
      consumedImageInsertRef.current = request.id;
      try {
        if (
          request.documentId !== documentId ||
          request.editorMode !== "source" ||
          request.expectedText !== view.state.doc.toString() ||
          !request.markdown.trim()
        ) {
          return;
        }
        insertSourceImage(view, request.selection, request.markdown);
      } catch (error: unknown) {
        if (error instanceof Error) onPasteErrorRef.current?.(error.message);
      } finally {
        onImageInsertConsumed?.(request.id);
      }
    };
    applyImageInsertRequestRef.current();
    return () => {
      applyImageInsertRequestRef.current = () => {};
    };
  }, [documentId, imageInsertRequest, onImageInsertConsumed]);

  useEffect(() => {
    const view = viewRef.current;
    if (
      !view ||
      reveal?.position === undefined ||
      consumedRevealRef.current === reveal.requestId
    ) {
      return;
    }
    const position = Math.max(0, Math.min(reveal.position, view.state.doc.length));
    view.dispatch({
      selection: EditorSelection.cursor(position),
      effects:
        reveal.scrollTop === undefined
          ? EditorView.scrollIntoView(position, { y: "start", yMargin: 40 })
          : undefined,
    });
    if (reveal.scrollTop !== undefined) view.scrollDOM.scrollTop = reveal.scrollTop;
    view.focus();
    consumedRevealRef.current = reveal.requestId;
    onRevealConsumedRef.current?.(reveal.requestId);
  }, [reveal]);

  return (
    <div
      aria-label="Markdown 编辑器"
      className={`markdown-editor markdown-editor--source markdown-editor--${mode}`}
      data-document-id={documentId}
    >
      <FindBar find={find} locale={locale} />
      <div className="markdown-editor__source-host" ref={hostRef} />
    </div>
  );
}

interface SurfaceCoordinatorState {
  readonly activeMode: "visual" | "source";
  readonly snapshots: Partial<
    Record<
      "visual" | "source",
      { readonly value: string; readonly view: EditorViewSnapshot }
    >
  >;
}

function CoordinatedMarkdownEditor(props: MarkdownEditorProps) {
  const presentationMode =
    props.mode === "sourceOnly" ? "source" : (props.presentationMode ?? "visual");
  const notifyViewChange = props.onViewChange;
  const [coordinator, setCoordinator] = useState<SurfaceCoordinatorState>(() => ({
    activeMode: presentationMode,
    snapshots: {},
  }));
  const switchedSurface = coordinator.activeMode !== presentationMode;
  const previousSnapshot = coordinator.snapshots[coordinator.activeMode]?.view;
  const savedTarget = coordinator.snapshots[presentationMode];
  let initialView = props.initialView;
  if (!props.reveal) {
    if (savedTarget?.value === props.value) {
      // Offsets and pixels only have meaning in their original surface. A
      // no-edit round trip restores that surface's exact range and scroll,
      // rather than resolving its viewport again as a collapsed caret.
      const { scrollTop, selectionFrom, selectionTo } = savedTarget.view;
      initialView = { scrollTop, selectionFrom, selectionTo };
    } else if (switchedSurface && previousSnapshot?.semanticPosition) {
      initialView = viewForSemanticModeSwitch(previousSnapshot);
    }
  }

  const onViewChange = useCallback(
    (view: EditorViewSnapshot) => {
      setCoordinator((current) => ({
        activeMode: presentationMode,
        snapshots: {
          ...current.snapshots,
          [presentationMode]: { value: props.value, view },
        },
      }));
      notifyViewChange?.(view);
    },
    [notifyViewChange, presentationMode, props.value],
  );

  const surfaceProps = { ...props, initialView, onViewChange };

  if (presentationMode === "visual") {
    return <VisualMarkdownEditor {...surfaceProps} />;
  }

  return (
    <SourceMarkdownEditorInstance
      {...surfaceProps}
      key={`${props.instanceId ?? props.documentId}:${props.documentId}:source`}
    />
  );
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  const scope = `${props.instanceId ?? props.documentId}:${props.documentId}`;
  return <CoordinatedMarkdownEditor {...props} key={scope} />;
}
