import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  HighlightStyle,
  syntaxHighlighting,
  type LanguageDescription,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import {
  Compartment,
  EditorSelection,
  EditorState,
  Transaction,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useMemo, useRef, useState } from "react";

import { mergeCompositionChange, sharedTextChange } from "../editor/sharedTextChange";
import { FindBar } from "../find/FindBar";
import { codeFindDecorations, codeMirrorFindTarget } from "../find/codeMirrorFind";
import { usePageFind } from "../find/usePageFind";
import "./CodeFilePreview.css";

export type CodeFilePreviewVariant = "tab" | "popover" | "split";

export interface CodeFileViewSnapshot {
  readonly scrollTop: number;
  readonly selectionFrom: number;
  readonly selectionTo: number;
}

export interface CodeFilePreviewProps {
  readonly path: string;
  readonly instanceId?: string;
  readonly content: string;
  readonly language: string;
  readonly startLine?: number;
  readonly targetLine?: number;
  /** @deprecated Prefer variant="popover". Kept while older shell call sites migrate. */
  readonly compact?: boolean;
  readonly variant?: CodeFilePreviewVariant;
  readonly codeWrap?: boolean;
  readonly showLineNumbers?: boolean;
  readonly locale?: "zh-CN" | "en-US";
  readonly findRequest?: number;
  readonly onFindRequestConsumed?: (request: number) => void;
  /** Code previews are read-only unless a caller explicitly enables editing. */
  readonly editable?: boolean;
  readonly initialView?: CodeFileViewSnapshot;
  readonly onChange?: (content: string) => void;
  readonly onViewChange?: (view: CodeFileViewSnapshot) => void;
  readonly onOpenFile?: () => void;
  readonly onOpenSide?: () => void;
  readonly onClose?: () => void;
}

interface PreviewCompartments {
  readonly editable: Compartment;
  readonly highlight: Compartment;
  readonly language: Compartment;
  readonly lineNumbers: Compartment;
  readonly wrap: Compartment;
}

interface LivePreviewProps {
  editable: boolean;
  onChange?: (content: string) => void;
  onViewChange?: (view: CodeFileViewSnapshot) => void;
}

interface InitialPreviewConfig {
  readonly codeWrap: boolean;
  readonly content: string;
  readonly editable: boolean;
  readonly showLineNumbers: boolean;
  readonly startLine: number;
  readonly targetLine?: number;
  readonly initialView?: CodeFileViewSnapshot;
}

const previewTheme = EditorView.theme({
  "&": {
    height: "100%",
    minWidth: "0",
    backgroundColor: "#fbfbfc",
    color: "#252a32",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace',
    fontSize: "13px",
    lineHeight: "1.65",
  },
  ".cm-content": {
    boxSizing: "border-box",
    minHeight: "100%",
    padding: "14px 0 32px",
    fontFamily: "inherit",
    fontVariantLigatures: "none",
    textAlign: "left",
  },
  ".cm-line": {
    boxSizing: "border-box",
    minHeight: "1.65em",
    padding: "0 16px",
    fontFamily: "inherit",
  },
  ".cm-gutters": {
    borderRight: "1px solid #e7e9ee",
    backgroundColor: "#f7f8fa",
    color: "#9299a5",
  },
  ".cm-gutterElement": {
    boxSizing: "border-box",
    paddingLeft: "8px",
    paddingRight: "10px",
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
  ".cm-activeLineGutter": {
    color: "#44546b",
    backgroundColor: "#dbe5f5",
  },
  ".cm-focused": { outline: "none" },
});

// Keep the code surfaces visibly distinct from plain text even in the light
// desktop theme. These colors intentionally match the visual Markdown code
// blocks so the main tab, popover and right-side preview use one vocabulary.
const previewHighlightStyle = HighlightStyle.define([
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

const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  csharp: "C#",
  cpp: "C++",
  css: "CSS",
  graphql: "GraphQL",
  html: "HTML",
  javascript: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  php: "PHP",
  protobuf: "Protocol Buffers",
  sql: "SQL",
  tsx: "TSX",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML",
};

function languageLabel(language: string, locale: "zh-CN" | "en-US"): string {
  const normalized = language.trim().toLowerCase();
  if (!normalized || normalized === "text" || normalized === "plaintext") {
    return locale === "zh-CN" ? "纯文本" : "Plain Text";
  }
  if (normalized === "config") return locale === "zh-CN" ? "配置" : "Config";
  return (
    LANGUAGE_LABELS[normalized] ?? normalized.charAt(0).toUpperCase() + normalized.slice(1)
  );
}

function resolveLanguageDescription(language: string): LanguageDescription | undefined {
  const normalized = language.trim().toLowerCase();
  if (!normalized || normalized === "text" || normalized === "plaintext") return undefined;
  return languages.find(
    (candidate) =>
      candidate.name.toLowerCase() === normalized ||
      candidate.alias.some((alias) => alias.toLowerCase() === normalized),
  );
}

function targetLineStart(content: string, startLine: number, targetLine?: number) {
  if (!targetLine) return undefined;
  const localLine = targetLine - startLine + 1;
  if (localLine < 1) return undefined;
  const lines = content.split("\n");
  if (localLine > lines.length) return undefined;
  let position = 0;
  for (let index = 1; index < localLine; index += 1) {
    position += (lines[index - 1]?.length ?? 0) + 1;
  }
  return position;
}

function targetLineDecorations(
  content: string,
  startLine: number,
  targetLine?: number,
): { decoration: Extension; position?: number } {
  const position = targetLineStart(content, startLine, targetLine);
  return {
    decoration:
      position === undefined
        ? EditorView.decorations.of(Decoration.none)
        : EditorView.decorations.of(
            Decoration.set([
              Decoration.line({ class: "code-file-preview__target-line" }).range(position),
            ]),
          ),
    position,
  };
}

function editableExtensions(editable: boolean): Extension {
  return [
    EditorState.readOnly.of(!editable),
    EditorView.editable.of(editable),
    ...(editable
      ? [history(), keymap.of([...defaultKeymap, ...historyKeymap])]
      : [keymap.of(defaultKeymap)]),
  ];
}

function lineNumberExtensions(showLineNumbers: boolean, startLine: number): Extension {
  return showLineNumbers
    ? [
        lineNumbers({ formatNumber: (line) => String(line + startLine - 1) }),
        highlightActiveLineGutter(),
      ]
    : [];
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function CodeFilePreview({
  path,
  instanceId,
  content,
  language,
  startLine = 1,
  targetLine,
  compact = false,
  variant: requestedVariant,
  codeWrap = true,
  showLineNumbers = true,
  locale = "zh-CN",
  findRequest,
  onFindRequestConsumed,
  editable = false,
  initialView,
  onChange,
  onViewChange,
  onOpenFile,
  onOpenSide,
  onClose,
}: CodeFilePreviewProps) {
  const variant = requestedVariant ?? (compact ? "popover" : "tab");
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const syncContentRef = useRef<(nextContent: string) => void>(() => {});
  const livePropsRef = useRef<LivePreviewProps>({ editable, onChange, onViewChange });
  const currentConfigRef = useRef<InitialPreviewConfig>({
    codeWrap,
    content,
    editable,
    showLineNumbers,
    startLine,
    targetLine,
    initialView,
  });
  const [copied, setCopied] = useState(false);
  const find = usePageFind(findRequest, onFindRequestConsumed);
  const { targetRef: findTargetRef, refresh: refreshFind } = find;
  const compartments = useMemo<PreviewCompartments>(
    () => ({
      editable: new Compartment(),
      highlight: new Compartment(),
      language: new Compartment(),
      lineNumbers: new Compartment(),
      wrap: new Compartment(),
    }),
    [],
  );

  useEffect(() => {
    livePropsRef.current = { editable, onChange, onViewChange };
  }, [editable, onChange, onViewChange]);

  useEffect(() => {
    currentConfigRef.current = {
      codeWrap,
      content,
      editable,
      showLineNumbers,
      startLine,
      targetLine,
      initialView,
    };
  }, [codeWrap, content, editable, initialView, showLineNumbers, startLine, targetLine]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const initial = currentConfigRef.current;
    let applyingExternalContent = false;
    let composing = false;
    let compositionFrame = 0;
    let pendingExternalContent: { base: string; value: string } | null = null;
    const reportView = (view: EditorView) => {
      const selection = view.state.selection.main;
      livePropsRef.current.onViewChange?.({
        scrollTop: view.scrollDOM.scrollTop,
        selectionFrom: selection.from,
        selectionTo: selection.to,
      });
    };
    const initialHighlight = targetLineDecorations(
      initial.content,
      initial.startLine,
      initial.targetLine,
    );
    const state = EditorState.create({
      doc: initial.content,
      selection: EditorSelection.range(
        initialHighlight.position ??
          Math.max(
            0,
            Math.min(initial.initialView?.selectionFrom ?? 0, initial.content.length),
          ),
        initialHighlight.position ??
          Math.max(
            0,
            Math.min(
              initial.initialView?.selectionTo ?? initial.initialView?.selectionFrom ?? 0,
              initial.content.length,
            ),
          ),
      ),
      extensions: [
        compartments.editable.of(editableExtensions(initial.editable)),
        compartments.lineNumbers.of(
          lineNumberExtensions(initial.showLineNumbers, initial.startLine),
        ),
        compartments.wrap.of(initial.codeWrap ? EditorView.lineWrapping : []),
        compartments.highlight.of(initialHighlight.decoration),
        compartments.language.of([]),
        highlightActiveLine(),
        drawSelection(),
        syntaxHighlighting(previewHighlightStyle, { fallback: true }),
        previewTheme,
        codeFindDecorations,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) refreshFind();
          if (update.docChanged && !applyingExternalContent && !pendingExternalContent) {
            const live = livePropsRef.current;
            if (live.editable) live.onChange?.(update.state.doc.toString());
          }
          if (update.selectionSet || update.docChanged) reportView(update.view);
        }),
      ],
    });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    findTargetRef.current = codeMirrorFindTarget(view);
    refreshFind();
    const applyExternalContent = (nextContent: string) => {
      const change = sharedTextChange(view.state.doc.toString(), nextContent);
      if (!change) return;
      const { scrollTop, scrollLeft } = view.scrollDOM;
      applyingExternalContent = true;
      try {
        const config = currentConfigRef.current;
        view.dispatch({
          changes: change,
          annotations: Transaction.addToHistory.of(false),
          effects: compartments.highlight.reconfigure(
            targetLineDecorations(nextContent, config.startLine, config.targetLine)
              .decoration,
          ),
        });
      } finally {
        applyingExternalContent = false;
        view.scrollDOM.scrollTop = scrollTop;
        view.scrollDOM.scrollLeft = scrollLeft;
      }
    };
    syncContentRef.current = (nextContent) => {
      const current = view.state.doc.toString();
      if (pendingExternalContent) {
        pendingExternalContent.value = nextContent;
        return;
      }
      if (nextContent === current) return;
      if (composing || view.composing) {
        pendingExternalContent = {
          base: current,
          value: nextContent,
        };
        return;
      }
      applyExternalContent(nextContent);
    };
    const onCompositionStart = () => {
      composing = true;
      window.cancelAnimationFrame(compositionFrame);
    };
    const onCompositionEnd = () => {
      composing = false;
      compositionFrame = window.requestAnimationFrame(() => {
        const pending = pendingExternalContent;
        if (!pending || composing) return;
        pendingExternalContent = null;
        const merged = mergeCompositionChange(
          pending.base,
          view.state.doc.toString(),
          pending.value,
        );
        applyExternalContent(merged);
        const live = livePropsRef.current;
        if (merged !== pending.value && live.editable) live.onChange?.(merged);
      });
    };
    const onScroll = () => reportView(view);
    host.addEventListener("compositionstart", onCompositionStart, true);
    host.addEventListener("compositionend", onCompositionEnd);
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    const restoreFrame = window.requestAnimationFrame(() => {
      if (initialHighlight.position !== undefined) {
        view.dispatch({
          effects: EditorView.scrollIntoView(initialHighlight.position, { y: "center" }),
        });
      } else {
        view.scrollDOM.scrollTop = initial.initialView?.scrollTop ?? 0;
      }
      reportView(view);
    });
    return () => {
      window.cancelAnimationFrame(restoreFrame);
      window.cancelAnimationFrame(compositionFrame);
      host.removeEventListener("compositionstart", onCompositionStart, true);
      host.removeEventListener("compositionend", onCompositionEnd);
      view.scrollDOM.removeEventListener("scroll", onScroll);
      syncContentRef.current = () => {};
      if (viewRef.current === view) viewRef.current = null;
      findTargetRef.current = null;
      view.destroy();
    };
    // The mounted view is updated through compartments below instead of being rebuilt.
  }, [compartments, findTargetRef, instanceId, path, refreshFind]);

  useEffect(() => {
    syncContentRef.current(content);
  }, [content]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: compartments.editable.reconfigure(editableExtensions(editable)),
    });
  }, [compartments, editable]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: compartments.lineNumbers.reconfigure(
        lineNumberExtensions(showLineNumbers, startLine),
      ),
    });
  }, [compartments, showLineNumbers, startLine]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: compartments.wrap.reconfigure(codeWrap ? EditorView.lineWrapping : []),
    });
  }, [codeWrap, compartments]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const highlight = targetLineDecorations(
      view.state.doc.toString(),
      startLine,
      targetLine,
    );
    view.dispatch({
      effects: compartments.highlight.reconfigure(highlight.decoration),
    });
  }, [compartments, content, startLine, targetLine]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const position = targetLineStart(view.state.doc.toString(), startLine, targetLine);
    if (position !== undefined) {
      view.dispatch({
        selection: EditorSelection.cursor(position),
        effects: EditorView.scrollIntoView(position, { y: "center" }),
      });
    }
  }, [instanceId, path, startLine, targetLine]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let disposed = false;
    const description = resolveLanguageDescription(language);
    // Remove a previous parser immediately so a slow lazy import can never make a
    // newly opened JSON/shell/etc. file look like the language from the prior tab.
    view.dispatch({ effects: compartments.language.reconfigure([]) });
    if (!description) {
      return;
    }
    void description
      .load()
      .then((support) => {
        if (!disposed && viewRef.current === view) {
          view.dispatch({ effects: compartments.language.reconfigure(support) });
        }
      })
      .catch(() => {
        // Missing optional language packages degrade to a clean plain-text
        // CodeMirror surface. Never fall back to Markdown/rich-text rendering.
        if (!disposed && viewRef.current === view) {
          view.dispatch({ effects: compartments.language.reconfigure([]) });
        }
      });
    return () => {
      disposed = true;
    };
  }, [compartments, instanceId, language, path]);

  const isChinese = locale === "zh-CN";
  const className = `code-file-preview code-file-preview--${variant}`;
  return (
    <section
      className={className}
      data-editable={editable ? "true" : "false"}
      data-language={language.trim().toLowerCase() || "text"}
      data-testid="code-file-preview"
      data-variant={variant}
    >
      <header className="code-file-preview__toolbar">
        <div className="code-file-preview__identity">
          <span className="code-file-preview__language">
            {languageLabel(language, locale)}
          </span>
          <span className="code-file-preview__path" title={path}>
            {path}
          </span>
          {targetLine && (
            <span className="code-file-preview__line">
              {isChinese ? `第 ${targetLine} 行` : `Line ${targetLine}`}
            </span>
          )}
        </div>
        <div className="code-file-preview__actions">
          {onOpenSide && (
            <button onClick={onOpenSide} type="button">
              {isChinese ? "在右侧打开" : "Open on right"}
            </button>
          )}
          {onOpenFile && (
            <button onClick={onOpenFile} type="button">
              {isChinese ? "打开文件" : "Open file"}
            </button>
          )}
          <button
            onClick={() => {
              void copyText(viewRef.current?.state.doc.toString() ?? content)
                .then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1400);
                })
                .catch(() => setCopied(false));
            }}
            type="button"
          >
            {copied ? (isChinese ? "已复制" : "Copied") : isChinese ? "复制" : "Copy"}
          </button>
          {onClose && (
            <button
              aria-label={isChinese ? "关闭右侧预览" : "Close right preview"}
              onClick={onClose}
              title={isChinese ? "关闭" : "Close"}
              type="button"
            >
              ×
            </button>
          )}
        </div>
      </header>
      <div className="code-file-preview__find">
        <FindBar find={find} locale={locale} />
      </div>
      <div
        aria-label={
          editable
            ? isChinese
              ? "代码编辑器"
              : "Code editor"
            : isChinese
              ? "代码预览"
              : "Code preview"
        }
        aria-readonly={!editable}
        className="code-file-preview__editor"
        ref={hostRef}
      />
    </section>
  );
}
