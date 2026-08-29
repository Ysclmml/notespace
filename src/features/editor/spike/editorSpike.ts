import { history } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  StateEffect,
  Transaction,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * P0-SPIKE-01 only. Nothing in the application shell imports this module.
 * P1-EDITOR-01 may reuse ideas after review, but this is not a product adapter.
 */

export interface SourceRange {
  readonly from: number;
  readonly to: number;
}

export interface DecorationScan {
  readonly ranges: readonly SourceRange[];
  readonly scannedCharacters: number;
  readonly markerCount: number;
  readonly kind: "full" | "incremental";
}

export interface EditorSpikeMetrics {
  fullRefreshes: number;
  incrementalRefreshes: number;
  conservativeRefreshes: number;
  compositionStarts: number;
  compositionEnds: number;
  compositionFrozenUpdates: number;
  scheduledCompositionRefreshes: number;
  cancelledCompositionRefreshes: number;
  scans: DecorationScan[];
}

export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export interface EditorSpikeConfig {
  readonly metrics: EditorSpikeMetrics;
  readonly scheduler?: FrameScheduler;
}

const SAFE_SOURCE_NODE_NAMES = new Set([
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
  "SetextHeading1",
  "SetextHeading2",
  "Emphasis",
  "StrongEmphasis",
  "Strikethrough",
  "Link",
  "Image",
  "InlineCode",
  "FencedCode",
  "Table",
]);

const SOURCE_REVEAL_PRIORITY = new Map<string, number>([
  ["Table", 400],
  ["FencedCode", 300],
  ["Image", 200],
  ["Link", 100],
]);

const REPLACEABLE_MARKER_NAMES = new Set(["HeaderMark", "EmphasisMark", "LinkMark", "URL"]);

const requestDecorationRefresh = StateEffect.define<null>();

const browserFrameScheduler: FrameScheduler = {
  request(callback) {
    if (typeof window.requestAnimationFrame === "function") {
      return window.requestAnimationFrame(callback);
    }

    return window.setTimeout(callback, 0);
  },
  cancel(handle) {
    if (typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(handle);
    } else {
      window.clearTimeout(handle);
    }
  },
};

export function createEditorSpikeMetrics(): EditorSpikeMetrics {
  return {
    fullRefreshes: 0,
    incrementalRefreshes: 0,
    conservativeRefreshes: 0,
    compositionStarts: 0,
    compositionEnds: 0,
    compositionFrozenUpdates: 0,
    scheduledCompositionRefreshes: 0,
    cancelledCompositionRefreshes: 0,
    scans: [],
  };
}

export function normalizeSourceRanges(
  ranges: readonly SourceRange[],
  docLength: number,
): SourceRange[] {
  const normalized = ranges
    .map(({ from, to }) => ({
      from: Math.max(0, Math.min(from, docLength)),
      to: Math.max(0, Math.min(to, docLength)),
    }))
    .map(({ from, to }) => (from <= to ? { from, to } : { from: to, to: from }))
    .filter(({ from, to }) => from < to)
    .sort((left, right) => left.from - right.from || left.to - right.to);

  const merged: SourceRange[] = [];
  for (const range of normalized) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to) {
      merged[merged.length - 1] = {
        from: previous.from,
        to: Math.max(previous.to, range.to),
      };
    } else {
      merged.push(range);
    }
  }

  return merged;
}

function findSafeSourceRange(state: EditorState, position: number): SourceRange | null {
  const biases: Array<-1 | 1> =
    position === 0 ? [1] : position === state.doc.length ? [-1] : [-1, 1];
  let best: (SourceRange & { readonly priority: number }) | null = null;

  for (const bias of biases) {
    const resolved = syntaxTree(state).resolveInner(position, bias);
    let node: typeof resolved | null = resolved;
    while (node) {
      if (SAFE_SOURCE_NODE_NAMES.has(node.name)) {
        const candidate = {
          from: node.from,
          to: node.to,
          priority: SOURCE_REVEAL_PRIORITY.get(node.name) ?? 0,
        };
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

  return best ? { from: best.from, to: best.to } : null;
}

export function deriveActiveSourceRanges(state: EditorState): SourceRange[] {
  const ranges: SourceRange[] = [];
  for (const selection of state.selection.ranges) {
    const start = findSafeSourceRange(state, selection.from);
    const end = findSafeSourceRange(state, selection.to);
    if (start) ranges.push(start);
    if (end) ranges.push(end);

    if (!selection.empty) {
      syntaxTree(state).iterate({
        from: selection.from,
        to: selection.to,
        enter(node) {
          if (
            SAFE_SOURCE_NODE_NAMES.has(node.name) &&
            node.from >= selection.from &&
            node.to <= selection.to
          ) {
            ranges.push({ from: node.from, to: node.to });
          }
        },
      });
    }
  }
  return normalizeSourceRanges(ranges, state.doc.length);
}

function rangesIntersect(left: SourceRange, right: SourceRange): boolean {
  return left.from < right.to && right.from < left.to;
}

function intersectsAny(range: SourceRange, ranges: readonly SourceRange[]): boolean {
  return ranges.some((candidate) => rangesIntersect(range, candidate));
}

interface DecorationBuild {
  readonly decorations: DecorationSet;
  readonly markerCount: number;
}

function buildMarkerDecorations(
  state: EditorState,
  ranges: readonly SourceRange[],
  activeSourceRanges: readonly SourceRange[],
): DecorationBuild {
  const marks: Range<Decoration>[] = [];

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        const markerRange = { from: node.from, to: node.to };
        if (
          REPLACEABLE_MARKER_NAMES.has(node.name) &&
          markerRange.from >= range.from &&
          markerRange.to <= range.to &&
          !intersectsAny(markerRange, activeSourceRanges)
        ) {
          marks.push(
            Decoration.replace({ inclusive: false }).range(
              markerRange.from,
              markerRange.to,
            ),
          );
        }
      },
    });
  }

  return {
    decorations: Decoration.set(marks, true),
    markerCount: marks.length,
  };
}

function recordScan(
  metrics: EditorSpikeMetrics,
  ranges: readonly SourceRange[],
  markerCount: number,
  kind: DecorationScan["kind"],
): void {
  metrics.scans.push({
    ranges: ranges.map((range) => ({ ...range })),
    scannedCharacters: ranges.reduce((total, range) => total + range.to - range.from, 0),
    markerCount,
    kind,
  });
}

export function scanVisibleMarkerDecorations(
  state: EditorState,
  visibleRanges: readonly SourceRange[],
  activeSourceRanges: readonly SourceRange[],
  metrics?: EditorSpikeMetrics,
  kind: DecorationScan["kind"] = "full",
): DecorationSet {
  const normalized = normalizeSourceRanges(visibleRanges, state.doc.length);
  const result = buildMarkerDecorations(state, normalized, activeSourceRanges);
  if (metrics) recordScan(metrics, normalized, result.markerCount, kind);
  return result.decorations;
}

function visibleIntersections(
  requested: readonly SourceRange[],
  visible: readonly SourceRange[],
  docLength: number,
): SourceRange[] {
  const intersections: SourceRange[] = [];
  for (const request of requested) {
    for (const viewport of visible) {
      const from = Math.max(request.from, viewport.from);
      const to = Math.min(request.to, viewport.to);
      if (from < to) intersections.push({ from, to });
    }
  }
  return normalizeSourceRanges(intersections, docLength);
}

function changedLineRanges(update: ViewUpdate): SourceRange[] {
  const ranges: SourceRange[] = [];
  update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const start = update.state.doc.lineAt(fromB).from;
    const end = update.state.doc.lineAt(Math.min(toB, update.state.doc.length)).to;
    ranges.push({ from: start, to: Math.max(start + 1, end) });
  });
  return normalizeSourceRanges(ranges, update.state.doc.length);
}

const WORD_INTERIOR_CHARACTER = /^[\p{L}\p{M}\p{N}_]$/u;
const PLAIN_TEXT_LINE = /^[\p{L}\p{M}\p{N}_\t ]+$/u;

function codePointBefore(state: EditorState, position: number): string {
  if (position <= 0) return "";
  return [...state.sliceDoc(Math.max(0, position - 2), position)].at(-1) ?? "";
}

function codePointAfter(state: EditorState, position: number): string {
  if (position >= state.doc.length) return "";
  return [...state.sliceDoc(position, Math.min(state.doc.length, position + 2))][0] ?? "";
}

/**
 * Only a word-character edit surrounded by word characters on an otherwise
 * plain-text line is proven local. Structural punctuation also rules out the
 * fast path because editing a reference-definition label can invalidate a link
 * elsewhere without changing a delimiter. Everything else falls back to a
 * visible-range rebuild; fences, list indentation, block quotes, reference
 * definitions, and lazy continuation are the important propagation examples.
 */
function canIncrementallyRefreshChangedLines(update: ViewUpdate): boolean {
  if (!update.docChanged) return true;

  let sawChange = false;
  let safe = true;
  update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    sawChange = true;
    if (!safe) return;

    const deleted = update.startState.sliceDoc(fromA, toA);
    const added = inserted.toString();
    const oldLine = update.startState.doc.lineAt(fromA);
    const newLine = update.state.doc.lineAt(fromB);
    if (
      [...deleted, ...added].some(
        (character) => !WORD_INTERIOR_CHARACTER.test(character),
      ) ||
      toA > oldLine.to ||
      toB > newLine.to ||
      !PLAIN_TEXT_LINE.test(oldLine.text) ||
      !PLAIN_TEXT_LINE.test(newLine.text) ||
      !WORD_INTERIOR_CHARACTER.test(codePointBefore(update.startState, fromA)) ||
      !WORD_INTERIOR_CHARACTER.test(codePointAfter(update.startState, toA)) ||
      !WORD_INTERIOR_CHARACTER.test(codePointBefore(update.state, fromB)) ||
      !WORD_INTERIOR_CHARACTER.test(codePointAfter(update.state, toB))
    ) {
      safe = false;
    }
  });

  return sawChange && safe;
}

export type CompositionRefreshPhase = "idle" | "composing" | "refreshPending";

class EditorSpikeDecorationRuntime {
  decorations: DecorationSet;
  activeSourceRanges: SourceRange[];
  private compositionPhase: CompositionRefreshPhase = "idle";
  private destroyed = false;
  private scheduledRefresh: number | null = null;
  private readonly metrics: EditorSpikeMetrics;
  private readonly scheduler: FrameScheduler;

  constructor(
    private readonly view: EditorView,
    config: EditorSpikeConfig,
  ) {
    this.metrics = config.metrics;
    this.scheduler = config.scheduler ?? browserFrameScheduler;
    this.activeSourceRanges = deriveActiveSourceRanges(view.state);
    this.decorations = Decoration.none;
    this.fullRefresh(view);
  }

  update(update: ViewUpdate): void {
    const requestedRefresh = update.transactions.some((transaction) =>
      transaction.effects.some((effect) => effect.is(requestDecorationRefresh)),
    );

    if (this.compositionPhase !== "idle") {
      if (update.docChanged) {
        this.decorations = this.decorations.map(update.changes);
        this.activeSourceRanges = normalizeSourceRanges(
          this.activeSourceRanges.map(({ from, to }) => ({
            from: update.changes.mapPos(from, 1),
            to: update.changes.mapPos(to, -1),
          })),
          update.state.doc.length,
        );
      }
      if (update.docChanged || update.selectionSet) {
        this.metrics.compositionFrozenUpdates += 1;
      }
      return;
    }

    if (requestedRefresh || update.viewportMoved) {
      this.activeSourceRanges = deriveActiveSourceRanges(update.state);
      this.fullRefresh(update.view);
      return;
    }

    if (update.docChanged || update.selectionSet) {
      this.incrementalRefresh(update);
    }
  }

  startComposition(): void {
    if (this.compositionPhase === "composing") return;
    if (this.scheduledRefresh !== null) {
      this.scheduler.cancel(this.scheduledRefresh);
      this.scheduledRefresh = null;
      this.metrics.cancelledCompositionRefreshes += 1;
    }
    this.compositionPhase = "composing";
    this.metrics.compositionStarts += 1;
  }

  endComposition(): void {
    if (this.compositionPhase !== "composing") return;
    this.compositionPhase = "refreshPending";
    this.metrics.compositionEnds += 1;
    if (this.scheduledRefresh !== null) return;

    this.metrics.scheduledCompositionRefreshes += 1;
    this.scheduledRefresh = this.scheduler.request(() => {
      this.scheduledRefresh = null;
      if (this.destroyed || this.compositionPhase !== "refreshPending") return;
      this.compositionPhase = "idle";
      this.view.dispatch({
        effects: requestDecorationRefresh.of(null),
        annotations: Transaction.addToHistory.of(false),
      });
    });
  }

  isCompositionFrozen(): boolean {
    return this.compositionPhase !== "idle";
  }

  getCompositionPhase(): CompositionRefreshPhase {
    return this.compositionPhase;
  }

  hasScheduledRefresh(): boolean {
    return this.scheduledRefresh !== null;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.scheduledRefresh !== null) {
      this.scheduler.cancel(this.scheduledRefresh);
      this.scheduledRefresh = null;
      this.metrics.cancelledCompositionRefreshes += 1;
    }
  }

  private fullRefresh(view: EditorView): void {
    this.metrics.fullRefreshes += 1;
    this.decorations = scanVisibleMarkerDecorations(
      view.state,
      view.visibleRanges,
      this.activeSourceRanges,
      this.metrics,
      "full",
    );
  }

  private incrementalRefresh(update: ViewUpdate): void {
    const previousActive = update.docChanged
      ? normalizeSourceRanges(
          this.activeSourceRanges.map(({ from, to }) => ({
            from: update.changes.mapPos(from, 1),
            to: update.changes.mapPos(to, -1),
          })),
          update.state.doc.length,
        )
      : this.activeSourceRanges;
    const nextActive = deriveActiveSourceRanges(update.state);
    this.activeSourceRanges = nextActive;
    this.decorations = this.decorations.map(update.changes);

    if (update.docChanged && !canIncrementallyRefreshChangedLines(update)) {
      this.metrics.conservativeRefreshes += 1;
      this.fullRefresh(update.view);
      return;
    }

    const requestedRanges = normalizeSourceRanges(
      [...changedLineRanges(update), ...previousActive, ...nextActive],
      update.state.doc.length,
    );
    const ranges = visibleIntersections(
      requestedRanges,
      update.view.visibleRanges,
      update.state.doc.length,
    );
    if (ranges.length === 0) return;

    const rebuilt = buildMarkerDecorations(update.state, ranges, nextActive);
    this.decorations = this.decorations.update({
      filter: (from, to) => !intersectsAny({ from, to }, ranges),
      add: collectDecorationRanges(rebuilt.decorations),
      sort: true,
    });
    this.metrics.incrementalRefreshes += 1;
    recordScan(this.metrics, ranges, rebuilt.markerCount, "incremental");
  }
}

function collectDecorationRanges(decorations: DecorationSet): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  decorations.between(0, Number.MAX_SAFE_INTEGER, (from, to, value) => {
    ranges.push(value.range(from, to));
  });
  return ranges;
}

const editorSpikeDecorationPlugin = ViewPlugin.define<
  EditorSpikeDecorationRuntime,
  EditorSpikeConfig
>((view, config) => new EditorSpikeDecorationRuntime(view, config), {
  decorations: (runtime) => runtime.decorations,
  eventHandlers: {
    compositionstart() {
      this.startComposition();
    },
    compositionend() {
      this.endComposition();
    },
  },
});

export function editorSpikeExtensions(config: EditorSpikeConfig): Extension {
  return [
    markdown({
      base: markdownLanguage,
      addKeymap: false,
      completeHTMLTags: false,
      pasteURLAsLink: false,
    }),
    history(),
    editorSpikeDecorationPlugin.of(config),
  ];
}

export function createEditorSpikeState(
  doc: string,
  config: EditorSpikeConfig,
  selection = 0,
): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(selection),
    extensions: editorSpikeExtensions(config),
  });
}

export function createLargeTextSpikeState(doc: string, selection = 0): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(selection),
    extensions: [history()],
  });
}

export function getEditorSpikeRuntime(view: EditorView): {
  readonly decorations: DecorationSet;
  readonly activeSourceRanges: readonly SourceRange[];
  readonly compositionFrozen: boolean;
  readonly compositionPhase: CompositionRefreshPhase;
  readonly scheduledRefresh: boolean;
} {
  const runtime = view.plugin(editorSpikeDecorationPlugin);
  if (!runtime) throw new Error("P0-SPIKE-01 decoration runtime is not installed");
  return {
    decorations: runtime.decorations,
    activeSourceRanges: runtime.activeSourceRanges,
    compositionFrozen: runtime.isCompositionFrozen(),
    compositionPhase: runtime.getCompositionPhase(),
    scheduledRefresh: runtime.hasScheduledRefresh(),
  };
}

export function generateSyntheticMarkdown(byteLength: number): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new RangeError("byteLength must be a non-negative safe integer");
  }
  const pattern =
    "# Synthetic heading\n\n| key | value |\n| --- | --- |\n| alpha | beta |\n\n[link](next.md) plain text.\n\n";
  if (byteLength === 0) return "";
  return pattern.repeat(Math.ceil(byteLength / pattern.length)).slice(0, byteLength);
}

export function generateSyntheticMultilineText(byteLength: number): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new RangeError("byteLength must be a non-negative safe integer");
  }
  const line =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ source-only\n";
  if (byteLength === 0) return "";
  return line.repeat(Math.ceil(byteLength / line.length)).slice(0, byteLength);
}
