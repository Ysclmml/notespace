import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installCodeMirrorDomMeasurementStubs } from "./domTestSupport";
import {
  createEditorSpikeMetrics,
  createEditorSpikeState,
  deriveActiveSourceRanges,
  generateSyntheticMarkdown,
  generateSyntheticMultilineText,
  getEditorSpikeRuntime,
  normalizeSourceRanges,
  scanVisibleMarkerDecorations,
  type FrameScheduler,
} from "./editorSpike";

class ManualFrameScheduler implements FrameScheduler {
  private nextHandle = 1;
  private readonly callbacks = new Map<number, () => void>();

  request(callback: () => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.callbacks.delete(handle);
  }

  flush(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback();
  }

  get size(): number {
    return this.callbacks.size;
  }
}

const mountedViews: EditorView[] = [];

function mount(state: EditorState): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({ state, parent });
  mountedViews.push(view);
  return view;
}

function decorationPositions(view: EditorView): Array<{ from: number; to: number }> {
  const positions: Array<{ from: number; to: number }> = [];
  getEditorSpikeRuntime(view).decorations.between(0, view.state.doc.length, (from, to) => {
    positions.push({ from, to });
  });
  return positions;
}

beforeAll(() => installCodeMirrorDomMeasurementStubs());

afterEach(() => {
  for (const view of mountedViews.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

describe("P0-SPIKE-01 cursor-local source reveal", () => {
  it("EDT-LIVE-001 reveals the complete active link and leaves EditorState.doc exact", () => {
    const source = "# Heading\n\nBefore [label](next.md) after.\n";
    const metrics = createEditorSpikeMetrics();
    const linkCursor = source.indexOf("label") + 2;
    const view = mount(createEditorSpikeState(source, { metrics }, linkCursor));

    const linkFrom = source.indexOf("[label]");
    const linkTo = linkFrom + "[label](next.md)".length;
    expect(getEditorSpikeRuntime(view).activeSourceRanges).toEqual([
      { from: linkFrom, to: linkTo },
    ]);
    expect(decorationPositions(view)).toEqual([{ from: 0, to: 1 }]);
    expect(view.state.doc.toString()).toBe(source);

    view.dispatch({ selection: EditorSelection.cursor(source.indexOf("Before") + 2) });
    expect(decorationPositions(view)).toEqual([
      { from: 0, to: 1 },
      { from: linkFrom, to: linkFrom + 1 },
      { from: linkFrom + 6, to: linkFrom + 7 },
      { from: linkFrom + 7, to: linkFrom + 8 },
      { from: linkTo - 1, to: linkTo },
    ]);
    expect(view.state.doc.toString()).toBe(source);
    expect(metrics.incrementalRefreshes).toBeGreaterThan(0);
  });

  it("RT-002 and TABLE-001 keep incomplete syntax and untouched pipe-table bytes", () => {
    const source =
      "unknown ::syntax{ stays\n\n| key | value |\n| --- | --- |\n| a\\|b | `c|d` |\n\n**unfinished";
    const metrics = createEditorSpikeMetrics();
    const state = createEditorSpikeState(source, { metrics }, source.indexOf("a\\|b") + 1);
    const active = deriveActiveSourceRanges(state);
    const tableFrom = source.indexOf("| key");
    const tableTo = source.indexOf("\n\n**unfinished");

    expect(active).toEqual([{ from: tableFrom, to: tableTo }]);
    scanVisibleMarkerDecorations(state, [{ from: 0, to: source.length }], active, metrics);
    expect(state.doc.toString()).toBe(source);
    expect(state.sliceDoc(0, "unknown ::syntax{ stays".length)).toBe(
      "unknown ::syntax{ stays",
    );
    expect(state.sliceDoc(tableFrom, tableTo)).toBe(
      "| key | value |\n| --- | --- |\n| a\\|b | `c|d` |",
    );
  });

  it("EDT-LIVE-001 expands every complete syntax node touched by a non-empty selection", () => {
    const source = "# Heading\n\n[middle](next.md)\n\n**bold** tail\n";
    const metrics = createEditorSpikeMetrics();
    const view = mount(createEditorSpikeState(source, { metrics }));
    const headingTo = source.indexOf("\n");
    const linkFrom = source.indexOf("[middle]");
    const linkTo = linkFrom + "[middle](next.md)".length;
    const strongFrom = source.indexOf("**bold**");
    const strongTo = strongFrom + "**bold**".length;

    view.dispatch({
      selection: EditorSelection.range(2, strongFrom + 3),
    });

    expect(getEditorSpikeRuntime(view).activeSourceRanges).toEqual([
      { from: 0, to: headingTo },
      { from: linkFrom, to: linkTo },
      { from: strongFrom, to: strongTo },
    ]);
    expect(decorationPositions(view)).toEqual([]);
    expect(undoDepth(view.state)).toBe(0);
    expect(view.state.doc.toString()).toBe(source);
  });
});

describe("P0-SPIKE-01 composition and history", () => {
  it("IME-001 freezes decoration switches until the next scheduled frame", () => {
    const source = "# 标题\n\n**文本**\n";
    const metrics = createEditorSpikeMetrics();
    const scheduler = new ManualFrameScheduler();
    const cursor = source.indexOf("文本") + 1;
    const view = mount(createEditorSpikeState(source, { metrics, scheduler }, cursor));
    const refreshesBefore = metrics.fullRefreshes + metrics.incrementalRefreshes;
    const positionsBefore = decorationPositions(view);

    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    expect(getEditorSpikeRuntime(view).compositionFrozen).toBe(true);

    view.dispatch({
      changes: { from: cursor, insert: "中" },
      selection: EditorSelection.cursor(cursor + 1),
      userEvent: "input.type.compose",
    });

    const candidateConfirmation = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      isComposing: true,
    });
    expect(view.contentDOM.dispatchEvent(candidateConfirmation)).toBe(true);
    expect(candidateConfirmation.defaultPrevented).toBe(false);

    view.dispatch({
      changes: { from: cursor, to: cursor + 1, insert: "中文" },
      selection: EditorSelection.cursor(cursor + 2),
      userEvent: "input.type.compose",
    });

    expect(metrics.compositionFrozenUpdates).toBe(2);
    expect(metrics.fullRefreshes + metrics.incrementalRefreshes).toBe(refreshesBefore);
    expect(decorationPositions(view)).toEqual(positionsBefore);
    expect(view.state.doc.toString()).toBe("# 标题\n\n**文中文本**\n");

    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    expect(getEditorSpikeRuntime(view).compositionFrozen).toBe(false);
    expect(getEditorSpikeRuntime(view).scheduledRefresh).toBe(true);
    expect(scheduler.size).toBe(1);

    scheduler.flush();
    expect(getEditorSpikeRuntime(view).scheduledRefresh).toBe(false);
    expect(metrics.fullRefreshes).toBeGreaterThan(1);
    expect(undoDepth(view.state)).toBe(1);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("IME-001 cancellation boundary cancels the next-frame refresh on teardown", () => {
    const source = "# 标题\n";
    const metrics = createEditorSpikeMetrics();
    const scheduler = new ManualFrameScheduler();
    const view = mount(createEditorSpikeState(source, { metrics, scheduler }, 3));

    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    expect(scheduler.size).toBe(1);

    mountedViews.splice(mountedViews.indexOf(view), 1);
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
    expect(scheduler.size).toBe(0);
    expect(metrics.cancelledCompositionRefreshes).toBe(1);
    expect(() => scheduler.flush()).not.toThrow();
  });

  it("EDT-UNDO-001 keeps selection/decorations out of unified text undo and supports redo", () => {
    const source = "# Heading\n";
    const metrics = createEditorSpikeMetrics();
    const view = mount(createEditorSpikeState(source, { metrics }, source.length));

    view.dispatch({
      changes: { from: source.length, insert: "next" },
      userEvent: "input.type",
    });
    view.dispatch({ selection: EditorSelection.cursor(2) });
    expect(undoDepth(view.state)).toBe(1);
    expect(redoDepth(view.state)).toBe(0);

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    expect(redoDepth(view.state)).toBe(1);
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`${source}next`);
  });
});

describe("P0-SPIKE-01 viewport and generated input boundaries", () => {
  it("PERF-001 scans only normalized requested ranges", () => {
    const source = generateSyntheticMarkdown(64 * 1024);
    const metrics = createEditorSpikeMetrics();
    const state = createEditorSpikeState(source, { metrics });
    const requested = [
      { from: 0, to: 256 },
      { from: 200, to: 512 },
      { from: source.length - 128, to: source.length },
    ];

    scanVisibleMarkerDecorations(state, requested, [], metrics);
    const scan = metrics.scans.at(-1);
    expect(scan?.ranges).toEqual([
      { from: 0, to: 512 },
      { from: source.length - 128, to: source.length },
    ]);
    expect(scan?.scannedCharacters).toBe(640);
    expect(scan?.scannedCharacters).toBeLessThan(source.length / 100);
  });

  it("PERF-001 incrementally rescans a local line instead of the whole document", () => {
    const source = generateSyntheticMarkdown(64 * 1024);
    const metrics = createEditorSpikeMetrics();
    const view = mount(createEditorSpikeState(source, { metrics }, 2));
    const scansBefore = metrics.scans.length;

    view.dispatch({
      changes: { from: 2, insert: "x" },
      selection: EditorSelection.cursor(3),
      userEvent: "input.type",
    });

    const incrementalScans = metrics.scans
      .slice(scansBefore)
      .filter((scan) => scan.kind === "incremental");
    expect(incrementalScans).toHaveLength(1);
    expect(incrementalScans[0]?.scannedCharacters).toBeLessThan(source.length / 100);
    expect(view.state.doc.toString()).toBe(`${source.slice(0, 2)}x${source.slice(2)}`);
  });

  it("PERF-010 generators are deterministic, bounded, and never persist a giant fixture", () => {
    const tenMiB = 10 * 1024 * 1024;
    const multiline = generateSyntheticMultilineText(tenMiB);
    const longLine = "x".repeat(1024 * 1024);

    expect(multiline).toHaveLength(tenMiB);
    expect(multiline.lastIndexOf("\n")).toBeGreaterThan(tenMiB - 100);
    expect(longLine).toHaveLength(1024 * 1024);
    expect(normalizeSourceRanges([{ from: -2, to: tenMiB + 2 }], tenMiB)).toEqual([
      { from: 0, to: tenMiB },
    ]);
    expect(() => generateSyntheticMultilineText(-1)).toThrow(RangeError);
  });
});
