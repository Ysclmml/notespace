import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installCodeMirrorDomMeasurementStubs } from "./domTestSupport";
import { dispatchCompositionEvent, dispatchDomInputStep } from "./domInputHarness";
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
      { from: linkFrom + 8, to: linkTo - 1 },
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

  it("EDT-LIVE-001 uses a complete structural ancestor for table, fence, image, and link source", () => {
    const source =
      "plain [outside](next.md) ![alt](asset.png)\n\n" +
      "| key | value |\n| --- | --- |\n| [cell](cell.md) | `c|d` |\n\n" +
      "```ts\nconst value = 1\n```\n";
    const metrics = createEditorSpikeMetrics();
    const tableFrom = source.indexOf("| key");
    const tableTo = source.indexOf("\n\n```ts");
    const fenceFrom = source.indexOf("```ts");
    const fenceTo = source.lastIndexOf("```") + 3;
    const linkFrom = source.indexOf("[outside]");
    const linkTo = linkFrom + "[outside](next.md)".length;
    const imageFrom = source.indexOf("![alt]");
    const imageTo = imageFrom + "![alt](asset.png)".length;

    const rangesAt = (needle: string, offset = 1) =>
      deriveActiveSourceRanges(
        createEditorSpikeState(source, { metrics }, source.indexOf(needle) + offset),
      );

    expect(rangesAt("outside", 2)).toEqual([{ from: linkFrom, to: linkTo }]);
    expect(rangesAt("alt", 1)).toEqual([{ from: imageFrom, to: imageTo }]);
    expect(rangesAt("const value", 3)).toEqual([{ from: fenceFrom, to: fenceTo }]);
    expect(rangesAt("cell", 2)).toEqual([{ from: tableFrom, to: tableTo }]);
    expect(rangesAt("c|d", 1)).toEqual([{ from: tableFrom, to: tableTo }]);
  });

  it("EDT-LIVE-001 keeps list and quote markers visible in current and non-current blocks", () => {
    const source = "- item\n\n> quote\n\n# heading\n";
    const metrics = createEditorSpikeMetrics();
    const listMarker = { from: source.indexOf("-"), to: source.indexOf("-") + 1 };
    const quoteMarker = { from: source.indexOf(">"), to: source.indexOf(">") + 1 };
    const headingMarker = {
      from: source.indexOf("#"),
      to: source.indexOf("#") + 1,
    };
    const view = mount(
      createEditorSpikeState(source, { metrics }, source.indexOf("item") + 2),
    );

    expect(decorationPositions(view)).toEqual([headingMarker]);
    expect(decorationPositions(view)).not.toContainEqual(listMarker);
    expect(decorationPositions(view)).not.toContainEqual(quoteMarker);

    view.dispatch({ selection: EditorSelection.cursor(source.indexOf("quote") + 2) });
    expect(decorationPositions(view)).toEqual([headingMarker]);
    expect(decorationPositions(view)).not.toContainEqual(listMarker);
    expect(decorationPositions(view)).not.toContainEqual(quoteMarker);

    view.dispatch({ selection: EditorSelection.cursor(source.indexOf("heading") + 2) });
    expect(decorationPositions(view)).toEqual([]);
    expect(decorationPositions(view)).not.toContainEqual(listMarker);
    expect(decorationPositions(view)).not.toContainEqual(quoteMarker);
  });
});

describe("P0-SPIKE-01 composition and history", () => {
  it("IME-001 DOM event-order harness freezes the post-composition mutation until RAF", () => {
    const source = "# 标题\n\n**文本**\n";
    const metrics = createEditorSpikeMetrics();
    const scheduler = new ManualFrameScheduler();
    const cursor = source.indexOf("文本") + 1;
    const view = mount(createEditorSpikeState(source, { metrics, scheduler }, cursor));
    const refreshesBefore = metrics.fullRefreshes + metrics.incrementalRefreshes;
    const positionsBefore = decorationPositions(view);

    const domEvents: Array<{ type: string; isComposing: boolean | null }> = [];
    for (const type of ["compositionstart", "beforeinput", "input", "compositionend"]) {
      view.contentDOM.addEventListener(type, (event) => {
        domEvents.push({
          type: event.type,
          isComposing: event instanceof InputEvent ? event.isComposing : null,
        });
      });
    }

    dispatchCompositionEvent(view, "compositionstart");
    expect(getEditorSpikeRuntime(view).compositionFrozen).toBe(true);
    expect(getEditorSpikeRuntime(view).compositionPhase).toBe("composing");

    dispatchDomInputStep(view, {
      data: "中",
      inputType: "insertCompositionText",
      isComposing: true,
      applyObservedMutation: () => {
        view.dispatch({
          changes: { from: cursor, insert: "中" },
          selection: EditorSelection.cursor(cursor + 1),
          userEvent: "input.type.compose",
        });
      },
    });

    const candidateConfirmation = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      isComposing: true,
    });
    expect(view.contentDOM.dispatchEvent(candidateConfirmation)).toBe(true);
    expect(candidateConfirmation.defaultPrevented).toBe(false);

    expect(metrics.compositionFrozenUpdates).toBe(1);
    expect(metrics.fullRefreshes + metrics.incrementalRefreshes).toBe(refreshesBefore);
    expect(decorationPositions(view)).toEqual(positionsBefore);
    expect(view.state.doc.toString()).toBe("# 标题\n\n**文中本**\n");

    dispatchCompositionEvent(view, "compositionend", "中文");
    expect(getEditorSpikeRuntime(view).compositionFrozen).toBe(true);
    expect(getEditorSpikeRuntime(view).compositionPhase).toBe("refreshPending");
    expect(getEditorSpikeRuntime(view).scheduledRefresh).toBe(true);
    expect(scheduler.size).toBe(1);

    dispatchDomInputStep(view, {
      data: "中文",
      inputType: "insertFromComposition",
      isComposing: false,
      applyObservedMutation: () => {
        view.dispatch({
          changes: { from: cursor, to: cursor + 1, insert: "中文" },
          selection: EditorSelection.cursor(cursor + 2),
          userEvent: "input.type.compose",
        });
      },
    });

    expect(metrics.compositionFrozenUpdates).toBe(2);
    expect(metrics.fullRefreshes + metrics.incrementalRefreshes).toBe(refreshesBefore);
    expect(getEditorSpikeRuntime(view).compositionPhase).toBe("refreshPending");
    expect(view.state.doc.toString()).toBe("# 标题\n\n**文中文本**\n");

    scheduler.flush();
    expect(getEditorSpikeRuntime(view).scheduledRefresh).toBe(false);
    expect(getEditorSpikeRuntime(view).compositionFrozen).toBe(false);
    expect(getEditorSpikeRuntime(view).compositionPhase).toBe("idle");
    expect(metrics.fullRefreshes).toBeGreaterThan(1);
    expect(domEvents).toEqual([
      { type: "compositionstart", isComposing: null },
      { type: "beforeinput", isComposing: true },
      { type: "input", isComposing: true },
      { type: "compositionend", isComposing: null },
      { type: "beforeinput", isComposing: false },
      { type: "input", isComposing: false },
    ]);
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

  it.each([
    { block: "list", source: "- item\n", marker: "-", word: "item" },
    { block: "quote", source: "> quote\n", marker: ">", word: "quote" },
  ])(
    "IME-001 never replaces the $block marker before, during, or after composition",
    ({ source, marker, word }) => {
      const metrics = createEditorSpikeMetrics();
      const scheduler = new ManualFrameScheduler();
      const cursor = source.indexOf(word) + 2;
      const markerRange = {
        from: source.indexOf(marker),
        to: source.indexOf(marker) + marker.length,
      };
      const view = mount(createEditorSpikeState(source, { metrics, scheduler }, cursor));
      const expectMarkerVisible = () => {
        expect(decorationPositions(view)).not.toContainEqual(markerRange);
      };

      expectMarkerVisible();
      dispatchCompositionEvent(view, "compositionstart");
      dispatchDomInputStep(view, {
        data: "中",
        inputType: "insertCompositionText",
        isComposing: true,
        applyObservedMutation: () => {
          view.dispatch({
            changes: { from: cursor, insert: "中" },
            selection: EditorSelection.cursor(cursor + 1),
            userEvent: "input.type.compose",
          });
        },
      });
      expectMarkerVisible();

      dispatchCompositionEvent(view, "compositionend", "中");
      expect(getEditorSpikeRuntime(view).compositionPhase).toBe("refreshPending");
      expectMarkerVisible();

      scheduler.flush();
      expect(getEditorSpikeRuntime(view).compositionPhase).toBe("idle");
      expectMarkerVisible();
      expect(view.state.doc.toString()).toBe(
        `${source.slice(0, cursor)}中${source.slice(cursor)}`,
      );
    },
  );

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

  it("PERF-001 incrementally rescans a proven word-interior edit instead of the whole document", () => {
    const source = `safe ordinary words\n\n${generateSyntheticMarkdown(64 * 1024)}`;
    const metrics = createEditorSpikeMetrics();
    const editAt = source.indexOf("ordinary") + 3;
    const view = mount(createEditorSpikeState(source, { metrics }, editAt));
    const scansBefore = metrics.scans.length;

    view.dispatch({
      changes: { from: editAt, insert: "x" },
      selection: EditorSelection.cursor(editAt + 1),
      userEvent: "input.type",
    });

    const incrementalScans = metrics.scans
      .slice(scansBefore)
      .filter((scan) => scan.kind === "incremental");
    expect(incrementalScans).toHaveLength(1);
    expect(incrementalScans[0]?.scannedCharacters).toBeLessThan(source.length / 100);
    expect(metrics.conservativeRefreshes).toBe(0);
    expect(view.state.doc.toString()).toBe(
      `${source.slice(0, editAt)}x${source.slice(editAt)}`,
    );
  });

  it.each([
    {
      boundary: "opening fence",
      source: "plain\n\n# shown\n[link](target.md)\ntrailing\n",
      from: "# shown",
      to: "# shown",
      insert: "```\n# shown",
    },
    {
      boundary: "closing fence",
      source: "plain\n\n```\n# hidden\n[hidden](target.md)\n# trailing hidden\n",
      from: "# trailing hidden",
      to: "# trailing hidden",
      insert: "```\n# trailing hidden",
    },
    {
      boundary: "list continuation",
      source: "plain\n\n- item\n    # child heading\n\n# outside\n",
      from: "- item",
      to: "- item",
      insert: "item",
    },
    {
      boundary: "quote/fence",
      source: "plain\n\n> ```\n> # hidden\n> ```\n# outside\n",
      from: "> ```",
      to: "> ```",
      insert: "```",
    },
    {
      boundary: "reference definition",
      source: "plain\n\n[referencekey]: target.md\n\n[referencekey]\n",
      from: "k",
      to: "k",
      insert: "x",
    },
  ])(
    "PERF-001 conservatively rebuilds visible decorations across a $boundary boundary",
    ({ source, from: fromText, to: toText, insert }) => {
      const metrics = createEditorSpikeMetrics();
      const cursor = source.indexOf("plain") + 2;
      const view = mount(createEditorSpikeState(source, { metrics }, cursor));
      const from = source.indexOf(fromText);
      const to = from + toText.length;
      const nextSource = `${source.slice(0, from)}${insert}${source.slice(to)}`;

      view.dispatch({
        changes: { from, to, insert },
        userEvent: "input.type",
      });

      const fresh = mount(
        createEditorSpikeState(nextSource, { metrics: createEditorSpikeMetrics() }, cursor),
      );
      expect(decorationPositions(view)).toEqual(decorationPositions(fresh));
      expect(metrics.conservativeRefreshes).toBe(1);
      expect(metrics.scans.at(-1)?.kind).toBe("full");
      expect(view.state.doc.toString()).toBe(nextSource);
    },
  );

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
