import { history } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";

export type PreviewVisual =
  | { readonly kind: "image"; readonly source: string; readonly title: string }
  | { readonly kind: "mermaid"; readonly source: string; readonly title: string };

export interface LivePreviewConfig {
  readonly onOpenVisual?: (visual: PreviewVisual) => void;
  readonly renderMermaid?: (source: string) => Promise<string>;
  readonly resolveImageSource?: (target: string) => string;
}

interface SourceRange {
  readonly from: number;
  readonly to: number;
}

interface TableCellModel {
  readonly from: number;
  readonly text: string;
}

interface TableModel {
  readonly header: readonly TableCellModel[];
  readonly rows: readonly (readonly TableCellModel[])[];
}

type MarkdownNode = ReturnType<typeof syntaxTree>["topNode"];

const EMPTY_CONFIG: LivePreviewConfig = {};
const previewConfig = Facet.define<LivePreviewConfig, LivePreviewConfig>({
  combine(values) {
    return values.at(-1) ?? EMPTY_CONFIG;
  },
});

const ACTIVE_NODE_PRIORITY = new Map<string, number>([
  ["Table", 900],
  ["FencedCode", 800],
  ["Image", 700],
  ["Link", 650],
  ["ATXHeading1", 600],
  ["ATXHeading2", 600],
  ["ATXHeading3", 600],
  ["ATXHeading4", 600],
  ["ATXHeading5", 600],
  ["ATXHeading6", 600],
  ["SetextHeading1", 600],
  ["SetextHeading2", 600],
  ["InlineCode", 500],
  ["StrongEmphasis", 450],
  ["Emphasis", 440],
  ["Strikethrough", 430],
  ["ListItem", 300],
  ["Blockquote", 200],
  ["HorizontalRule", 100],
]);

const HEADING_LEVEL = new Map<string, number>([
  ["ATXHeading1", 1],
  ["SetextHeading1", 1],
  ["ATXHeading2", 2],
  ["SetextHeading2", 2],
  ["ATXHeading3", 3],
  ["ATXHeading4", 4],
  ["ATXHeading5", 5],
  ["ATXHeading6", 6],
]);

const HIDDEN_MARKS = new Set([
  "CodeMark",
  "EmphasisMark",
  "HeaderMark",
  "LinkMark",
  "QuoteMark",
  "StrikethroughMark",
]);

function intersects(left: SourceRange, right: SourceRange): boolean {
  if (left.from === left.to) return right.from <= left.from && left.from <= right.to;
  if (right.from === right.to) return left.from <= right.from && right.from <= left.to;
  return left.from < right.to && right.from < left.to;
}

function activeSourceRanges(state: EditorState): SourceRange[] {
  const ranges: SourceRange[] = [];
  for (const selection of state.selection.ranges) {
    for (const position of selection.empty
      ? [selection.from]
      : [selection.from, selection.to]) {
      const biases: Array<-1 | 1> = position === 0 ? [1] : [-1, 1];
      let best: (SourceRange & { readonly priority: number }) | null = null;
      for (const bias of biases) {
        let node: MarkdownNode | null = syntaxTree(state).resolveInner(position, bias);
        while (node) {
          const priority = ACTIVE_NODE_PRIORITY.get(node.name);
          if (priority !== undefined) {
            const candidate = { from: node.from, to: node.to, priority };
            if (
              !best ||
              candidate.priority > best.priority ||
              (candidate.priority === best.priority &&
                candidate.to - candidate.from < best.to - best.from)
            ) {
              best = candidate;
            }
          }
          node = node.parent;
        }
      }
      if (best) ranges.push({ from: best.from, to: best.to });
    }
  }
  return ranges;
}

function rangeIsActive(range: SourceRange, active: readonly SourceRange[]): boolean {
  return active.some((candidate) => intersects(range, candidate));
}

function addLineClasses(
  state: EditorState,
  ranges: Range<Decoration>[],
  from: number,
  to: number,
  baseClass: string,
): void {
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(Math.max(from, to - 1));
  for (let number = first.number; number <= last.number; number += 1) {
    const line = state.doc.line(number);
    const position = number - first.number;
    const suffix =
      first.number === last.number
        ? " cm-live-block-single"
        : position === 0
          ? " cm-live-block-first"
          : number === last.number
            ? " cm-live-block-last"
            : " cm-live-block-middle";
    ranges.push(
      Decoration.line({ attributes: { class: `${baseClass}${suffix}` } }).range(line.from),
    );
  }
}

function childNodes(node: MarkdownNode): MarkdownNode[] {
  const children: MarkdownNode[] = [];
  let child = node.firstChild;
  while (child) {
    children.push(child);
    child = child.nextSibling;
  }
  return children;
}

export function parseTableModel(state: EditorState, node: MarkdownNode): TableModel {
  const rows = childNodes(node).filter(
    (child) => child.name === "TableHeader" || child.name === "TableRow",
  );
  const parsed = rows.map((row) =>
    childNodes(row)
      .filter((child) => child.name === "TableCell")
      .map((cell) => ({
        from: cell.from,
        text: state.sliceDoc(cell.from, cell.to).trim(),
      })),
  );
  return { header: parsed[0] ?? [], rows: parsed.slice(1) };
}

function appendInlineMarkdown(parent: HTMLElement, source: string): void {
  const token = /(`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  for (const match of source.matchAll(token)) {
    const index = match.index ?? 0;
    if (index > cursor) parent.append(document.createTextNode(source.slice(cursor, index)));
    const value = match[0];
    const element = document.createElement(
      value.startsWith("`") ? "code" : value.startsWith("[") ? "span" : "strong",
    );
    if (value.startsWith("`")) element.textContent = value.slice(1, -1);
    else if (value.startsWith("**")) element.textContent = value.slice(2, -2);
    else if (value.startsWith("~~")) {
      element.textContent = value.slice(2, -2);
      element.className = "cm-live-strike";
    } else {
      element.textContent = value.slice(1, value.indexOf("]"));
      element.className = "cm-live-link-label";
    }
    parent.append(element);
    cursor = index + value.length;
  }
  if (cursor < source.length) parent.append(document.createTextNode(source.slice(cursor)));
}

function revealSource(view: EditorView, position: number): void {
  view.dispatch({
    selection: EditorSelection.cursor(position),
    effects: EditorView.scrollIntoView(position, { y: "center" }),
  });
  view.focus();
}

class ListMarkerWidget extends WidgetType {
  constructor(private readonly marker: string) {
    super();
  }

  eq(other: ListMarkerWidget): boolean {
    return other.marker === this.marker;
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = "cm-live-list-marker";
    marker.textContent = /^\d/u.test(this.marker) ? this.marker : "•";
    return marker;
  }
}

class TaskMarkerWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(other: TaskMarkerWidget): boolean {
    return (
      other.checked === this.checked && other.from === this.from && other.to === this.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.className = "cm-live-task-marker";
    input.type = "checkbox";
    input.checked = this.checked;
    input.setAttribute("aria-label", this.checked ? "标记为未完成" : "标记为已完成");
    input.addEventListener("mousedown", (event) => event.stopPropagation());
    input.addEventListener("change", () => {
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: this.checked ? "[ ]" : "[x]" },
      });
      view.focus();
    });
    return input;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class TableWidget extends WidgetType {
  constructor(
    private readonly model: TableModel,
    private readonly tableFrom: number,
    private readonly source: string,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.tableFrom === this.tableFrom && other.source === this.source;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-live-table-wrap";
    const table = document.createElement("table");
    table.className = "cm-live-table";

    const renderRow = (
      cells: readonly TableCellModel[],
      section: HTMLTableSectionElement,
      header: boolean,
    ) => {
      const row = document.createElement("tr");
      for (const cell of cells) {
        const element = document.createElement(header ? "th" : "td");
        element.dataset.sourceFrom = String(cell.from);
        appendInlineMarkdown(element, cell.text);
        row.append(element);
      }
      section.append(row);
    };

    if (this.model.header.length > 0) {
      const head = document.createElement("thead");
      renderRow(this.model.header, head, true);
      table.append(head);
    }
    const body = document.createElement("tbody");
    for (const row of this.model.rows) renderRow(row, body, false);
    table.append(body);
    wrapper.append(table);
    wrapper.title = "点击表格进入 Markdown 源码编辑";
    wrapper.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const target =
        event.target instanceof Element ? event.target.closest("[data-source-from]") : null;
      const position = Number(target?.getAttribute("data-source-from") ?? this.tableFrom);
      revealSource(view, Number.isFinite(position) ? position : this.tableFrom);
    });
    return wrapper;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class CodeBlockWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly language: string,
    private readonly from: number,
  ) {
    super();
  }

  eq(other: CodeBlockWidget): boolean {
    return (
      other.source === this.source &&
      other.language === this.language &&
      other.from === this.from
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const figure = document.createElement("figure");
    figure.className = "cm-live-code-card";
    if (this.language) {
      const language = document.createElement("figcaption");
      language.textContent = this.language;
      figure.append(language);
    }
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = this.source;
    pre.append(code);
    figure.append(pre);
    figure.title = "点击代码块进入 Markdown 源码编辑";
    figure.addEventListener("mousedown", (event) => {
      event.preventDefault();
      revealSource(view, this.from);
    });
    return figure;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class MermaidWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly from: number,
    private readonly config: LivePreviewConfig,
  ) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return other.source === this.source && other.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const card = document.createElement("figure");
    card.className = "cm-live-mermaid-card";
    const toolbar = document.createElement("figcaption");
    const label = document.createElement("span");
    label.textContent = "Mermaid";
    const actions = document.createElement("span");
    actions.className = "cm-live-mermaid-actions";
    const sourceButton = document.createElement("button");
    sourceButton.type = "button";
    sourceButton.textContent = "源码";
    sourceButton.addEventListener("mousedown", (event) => event.stopPropagation());
    sourceButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      revealSource(view, this.from);
    });
    const expand = document.createElement("button");
    expand.type = "button";
    expand.textContent = "放大查看";
    expand.addEventListener("mousedown", (event) => event.stopPropagation());
    expand.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.config.onOpenVisual?.({
        kind: "mermaid",
        source: this.source,
        title: "Mermaid 图表",
      });
    });
    actions.append(sourceButton, expand);
    toolbar.append(label, actions);
    const canvas = document.createElement("div");
    canvas.className = "cm-live-mermaid-canvas cm-live-mermaid-canvas--loading";
    canvas.textContent = "正在渲染图表…";
    card.append(toolbar, canvas);
    card.addEventListener("dblclick", () =>
      this.config.onOpenVisual?.({
        kind: "mermaid",
        source: this.source,
        title: "Mermaid 图表",
      }),
    );

    if (this.config.renderMermaid) {
      void this.config
        .renderMermaid(this.source)
        .then((svg) => {
          if (!canvas.isConnected) return;
          canvas.classList.remove("cm-live-mermaid-canvas--loading");
          canvas.replaceChildren();
          canvas.insertAdjacentHTML("afterbegin", svg);
          view.requestMeasure();
        })
        .catch((error: unknown) => {
          if (!canvas.isConnected) return;
          canvas.className = "cm-live-mermaid-canvas cm-live-mermaid-canvas--error";
          canvas.textContent = `图表渲染失败：${error instanceof Error ? error.message : "未知错误"}`;
          view.requestMeasure();
        });
    }
    return card;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly target: string,
    private readonly alt: string,
    private readonly from: number,
    private readonly config: LivePreviewConfig,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return (
      other.source === this.source &&
      other.target === this.target &&
      other.alt === this.alt &&
      other.from === this.from
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const figure = document.createElement("figure");
    figure.className = "cm-live-image-card";
    const image = document.createElement("img");
    image.alt = this.alt;
    image.src = this.source;
    image.addEventListener("error", () => {
      figure.classList.add("cm-live-image-card--error");
      image.hidden = true;
      const message = document.createElement("span");
      message.textContent = this.alt || this.target;
      figure.append(message);
      view.requestMeasure();
    });
    const expand = document.createElement("button");
    expand.type = "button";
    expand.textContent = "放大查看";
    expand.addEventListener("mousedown", (event) => event.stopPropagation());
    expand.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.config.onOpenVisual?.({
        kind: "image",
        source: this.source,
        title: this.alt || "图片",
      });
    });
    figure.append(image, expand);
    figure.addEventListener("mousedown", (event) => {
      if (event.target instanceof Element && event.target.closest("button")) return;
      event.preventDefault();
      revealSource(view, this.from);
    });
    return figure;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class HorizontalRuleWidget extends WidgetType {
  constructor(private readonly from: number) {
    super();
  }

  eq(other: HorizontalRuleWidget): boolean {
    return other.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-live-horizontal-rule";
    wrapper.append(document.createElement("hr"));
    wrapper.addEventListener("mousedown", (event) => {
      event.preventDefault();
      revealSource(view, this.from);
    });
    return wrapper;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function fencedCodeParts(
  state: EditorState,
  node: MarkdownNode,
): {
  language: string;
  source: string;
} {
  let language = "";
  let source = "";
  for (const child of childNodes(node)) {
    if (child.name === "CodeInfo") language = state.sliceDoc(child.from, child.to).trim();
    if (child.name === "CodeText") source = state.sliceDoc(child.from, child.to);
  }
  return { language, source };
}

function imageParts(
  state: EditorState,
  node: MarkdownNode,
): {
  alt: string;
  target: string;
} {
  const source = state.sliceDoc(node.from, node.to);
  const targetNode = childNodes(node).find((child) => child.name === "URL");
  const altMatch = source.match(/^!\[([^\]]*)\]/u);
  return {
    alt: altMatch?.[1] ?? "",
    target: targetNode ? state.sliceDoc(targetNode.from, targetNode.to) : "",
  };
}

function buildPreviewDecorations(state: EditorState): DecorationSet {
  const config = state.facet(previewConfig);
  const active = activeSourceRanges(state);
  const ranges: Range<Decoration>[] = [];

  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    if (line.text.trim().length === 0) {
      ranges.push(
        Decoration.line({ attributes: { class: "cm-live-blank-line" } }).range(line.from),
      );
    }
  }

  syntaxTree(state).iterate({
    enter(nodeRef) {
      const node = nodeRef.node;
      const range = { from: node.from, to: node.to };
      const isActive = rangeIsActive(range, active);
      const heading = HEADING_LEVEL.get(node.name);
      if (heading) {
        addLineClasses(
          state,
          ranges,
          node.from,
          node.to,
          `cm-live-heading cm-live-heading-${heading}`,
        );
      }

      if (node.name === "Paragraph") {
        addLineClasses(state, ranges, node.from, node.to, "cm-live-paragraph");
      } else if (node.name === "Blockquote") {
        addLineClasses(state, ranges, node.from, node.to, "cm-live-blockquote");
      } else if (node.name === "ListItem") {
        const ordered = node.parent?.name === "OrderedList";
        addLineClasses(
          state,
          ranges,
          node.from,
          node.to,
          ordered
            ? "cm-live-list cm-live-list-ordered"
            : "cm-live-list cm-live-list-bullet",
        );
      } else if (node.name === "Table") {
        if (!isActive) {
          ranges.push(
            Decoration.replace({
              block: true,
              inclusive: false,
              widget: new TableWidget(
                parseTableModel(state, node),
                node.from,
                state.sliceDoc(node.from, node.to),
              ),
            }).range(node.from, node.to),
          );
        } else {
          addLineClasses(state, ranges, node.from, node.to, "cm-live-source-table");
        }
        return false;
      } else if (node.name === "FencedCode") {
        const parts = fencedCodeParts(state, node);
        if (!isActive) {
          ranges.push(
            Decoration.replace({
              block: true,
              inclusive: false,
              widget:
                parts.language.toLocaleLowerCase() === "mermaid"
                  ? new MermaidWidget(parts.source, node.from, config)
                  : new CodeBlockWidget(parts.source, parts.language, node.from),
            }).range(node.from, node.to),
          );
        } else {
          addLineClasses(state, ranges, node.from, node.to, "cm-live-source-code");
        }
        return false;
      } else if (node.name === "Image") {
        if (!isActive) {
          const parts = imageParts(state, node);
          const source = config.resolveImageSource?.(parts.target) ?? parts.target;
          ranges.push(
            Decoration.replace({
              inclusive: false,
              widget: new ImageWidget(source, parts.target, parts.alt, node.from, config),
            }).range(node.from, node.to),
          );
          return false;
        }
      } else if (node.name === "HorizontalRule") {
        if (!isActive) {
          ranges.push(
            Decoration.replace({
              block: true,
              inclusive: false,
              widget: new HorizontalRuleWidget(node.from),
            }).range(node.from, node.to),
          );
        }
        return false;
      } else if (node.name === "ListMark" && !isActive) {
        const isTaskItem = Boolean(node.parent?.getChild("Task"));
        ranges.push(
          Decoration.replace({
            inclusive: false,
            widget: isTaskItem
              ? undefined
              : new ListMarkerWidget(state.sliceDoc(node.from, node.to)),
          }).range(node.from, node.to),
        );
      } else if (node.name === "TaskMarker" && !isActive) {
        ranges.push(
          Decoration.replace({
            inclusive: false,
            widget: new TaskMarkerWidget(
              /x/iu.test(state.sliceDoc(node.from, node.to)),
              node.from,
              node.to,
            ),
          }).range(node.from, node.to),
        );
      } else if (
        node.name === "URL" &&
        (node.parent?.name === "Link" || node.parent?.name === "Image") &&
        !isActive
      ) {
        ranges.push(Decoration.replace({ inclusive: false }).range(node.from, node.to));
      } else if (HIDDEN_MARKS.has(node.name) && !isActive) {
        ranges.push(Decoration.replace({ inclusive: false }).range(node.from, node.to));
      }
      return true;
    },
  });

  return Decoration.set(ranges, true);
}

interface PreviewDecorationState {
  readonly decorations: DecorationSet;
  readonly compositionFrozen: boolean;
}

const setCompositionFrozen = StateEffect.define<boolean>();

const previewDecorations = StateField.define<PreviewDecorationState>({
  create(state) {
    return {
      decorations: buildPreviewDecorations(state),
      compositionFrozen: false,
    };
  },
  update(value, transaction) {
    const frozenEffect = transaction.effects.find((effect) =>
      effect.is(setCompositionFrozen),
    );
    if (frozenEffect?.value === true) {
      return { decorations: value.decorations, compositionFrozen: true };
    }
    if (frozenEffect?.value === false) {
      return {
        decorations: buildPreviewDecorations(transaction.state),
        compositionFrozen: false,
      };
    }
    if (value.compositionFrozen) {
      return {
        decorations: value.decorations.map(transaction.changes),
        compositionFrozen: true,
      };
    }
    if (transaction.docChanged || transaction.selection) {
      return {
        decorations: buildPreviewDecorations(transaction.state),
        compositionFrozen: false,
      };
    }
    return {
      decorations: value.decorations.map(transaction.changes),
      compositionFrozen: false,
    };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

class CompositionFreezeRuntime {
  private refreshFrame: number | null = null;

  constructor(private readonly view: EditorView) {}

  start(): void {
    if (this.refreshFrame !== null) {
      window.cancelAnimationFrame(this.refreshFrame);
      this.refreshFrame = null;
    }
    if (!this.view.state.field(previewDecorations).compositionFrozen) {
      this.view.dispatch({ effects: setCompositionFrozen.of(true) });
    }
  }

  end(): void {
    if (this.refreshFrame !== null) return;
    this.refreshFrame = window.requestAnimationFrame(() => {
      this.refreshFrame = null;
      this.view.dispatch({ effects: setCompositionFrozen.of(false) });
    });
  }

  destroy(): void {
    if (this.refreshFrame !== null) window.cancelAnimationFrame(this.refreshFrame);
  }
}

const compositionFreezePlugin = ViewPlugin.define(
  (view) => new CompositionFreezeRuntime(view),
  {
    eventHandlers: {
      compositionstart() {
        this.start();
      },
      compositionend() {
        this.end();
      },
    },
  },
);

export function livePreviewExtensions(config: LivePreviewConfig = {}): Extension {
  return [
    markdown({
      base: markdownLanguage,
      addKeymap: false,
      completeHTMLTags: false,
      pasteURLAsLink: false,
    }),
    history(),
    previewConfig.of(config),
    previewDecorations,
    compositionFreezePlugin,
  ];
}

export function getLivePreviewDecorations(state: EditorState): DecorationSet {
  return state.field(previewDecorations).decorations;
}

export function isLivePreviewCompositionFrozen(state: EditorState): boolean {
  return state.field(previewDecorations).compositionFrozen;
}
