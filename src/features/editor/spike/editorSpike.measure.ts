import { undoDepth } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { mkdirSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { installCodeMirrorDomMeasurementStubs } from "./domTestSupport";
import {
  createEditorSpikeMetrics,
  createEditorSpikeState,
  createLargeTextSpikeState,
  generateSyntheticMarkdown,
  generateSyntheticMultilineText,
} from "./editorSpike";

interface Distribution {
  readonly samples: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

const MiB = 1024 * 1024;
const SAMPLE_COUNT = 30;
const WARMUP_COUNT = 3;
const thresholds = {
  normalMarkdownMountP95Ms: 500,
  normalMarkdownLocalEditP95Ms: 50,
  large10MiBSourceOnlyMountP95Ms: 2_000,
  large10MiBLocalEditP95Ms: 50,
  longLine1MiBSourceOnlyMountP95Ms: 2_000,
  processRssDeltaBytes: 512 * MiB,
} as const;

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}

function measure(operation: () => void, cleanup?: () => void): Distribution {
  for (let index = 0; index < WARMUP_COUNT; index += 1) {
    operation();
    cleanup?.();
  }

  const timings: number[] = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const startedAt = performance.now();
    operation();
    timings.push(performance.now() - startedAt);
    cleanup?.();
  }
  timings.sort((left, right) => left - right);
  return {
    samples: SAMPLE_COUNT,
    p50Ms: percentile(timings, 0.5),
    p95Ms: percentile(timings, 0.95),
    maxMs: timings.at(-1) ?? 0,
  };
}

function createHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.style.height = "720px";
  host.style.width = "1280px";
  document.body.append(host);
  return host;
}

function mountNormal(doc: string): { view: EditorView; host: HTMLElement } {
  const host = createHost();
  const metrics = createEditorSpikeMetrics();
  const view = new EditorView({
    state: createEditorSpikeState(doc, { metrics }),
    parent: host,
  });
  return { view, host };
}

function mountLarge(doc: string): { view: EditorView; host: HTMLElement } {
  const host = createHost();
  const view = new EditorView({
    state: createLargeTextSpikeState(doc),
    parent: host,
  });
  return { view, host };
}

function destroyMounted(mounted: { view: EditorView; host: HTMLElement } | null): null {
  mounted?.view.destroy();
  mounted?.host.remove();
  return null;
}

beforeAll(() => installCodeMirrorDomMeasurementStubs());

describe("P0-SPIKE-01 automated feasibility measurements", () => {
  it("PERF-001/PERF-010 records 30-sample editor timing and memory boundaries", () => {
    const rssBefore = process.memoryUsage().rss;
    const normalMarkdown = generateSyntheticMarkdown(248_920);
    const largeMultiline = generateSyntheticMultilineText(10 * MiB);
    const longLine256KiBPlus = "x".repeat(256 * 1024 + 1);
    const longLine1MiB = "x".repeat(MiB);

    let mounted: { view: EditorView; host: HTMLElement } | null = null;
    const normalMount = measure(
      () => {
        mounted = mountNormal(normalMarkdown);
      },
      () => {
        mounted = destroyMounted(mounted);
      },
    );

    mounted = mountNormal(normalMarkdown);
    let normalInserted = false;
    const normalEdit = measure(() => {
      const position = Math.floor(mounted!.view.state.doc.length / 2);
      if (normalInserted) {
        mounted!.view.dispatch({
          changes: { from: position, to: position + 1 },
          userEvent: "input.type",
        });
      } else {
        mounted!.view.dispatch({
          changes: { from: position, insert: "x" },
          selection: EditorSelection.cursor(position + 1),
          userEvent: "input.type",
        });
      }
      normalInserted = !normalInserted;
    });
    const normalUndoDepth = undoDepth(mounted.view.state);
    mounted = destroyMounted(mounted);

    const largeMount = measure(
      () => {
        mounted = mountLarge(largeMultiline);
      },
      () => {
        mounted = destroyMounted(mounted);
      },
    );

    mounted = mountLarge(largeMultiline);
    let largeInserted = false;
    const largeEdit = measure(() => {
      const position = Math.floor(mounted!.view.state.doc.length / 2);
      if (largeInserted) {
        mounted!.view.dispatch({
          changes: { from: position, to: position + 1 },
          userEvent: "input.type",
        });
      } else {
        mounted!.view.dispatch({
          changes: { from: position, insert: "x" },
          selection: EditorSelection.cursor(position + 1),
          userEvent: "input.type",
        });
      }
      largeInserted = !largeInserted;
    });
    const largeUndoDepth = undoDepth(mounted.view.state);
    mounted = destroyMounted(mounted);

    const longLine256KiBPlusMount = measure(
      () => {
        mounted = mountLarge(longLine256KiBPlus);
      },
      () => {
        mounted = destroyMounted(mounted);
      },
    );
    const longLine1MiBMount = measure(
      () => {
        mounted = mountLarge(longLine1MiB);
      },
      () => {
        mounted = destroyMounted(mounted);
      },
    );

    const rssAfter = process.memoryUsage().rss;
    const rssDeltaBytes = Math.max(0, rssAfter - rssBefore);
    const report = {
      schemaVersion: 1,
      taskId: "P0-SPIKE-01",
      generatedAt: new Date().toISOString(),
      environment: {
        platform: platform(),
        release: release(),
        arch: arch(),
        cpu: cpus()[0]?.model ?? "unknown",
        logicalCpuCount: cpus().length,
        totalMemoryBytes: totalmem(),
        node: process.version,
        harness: "Vitest 3.2.7 + jsdom 26.1.0; debug TypeScript bundle",
      },
      boundaries: {
        normalMarkdownBytes: normalMarkdown.length,
        largeMultilineBytes: largeMultiline.length,
        longLine256KiBPlusBytes: longLine256KiBPlus.length,
        longLine1MiBBytes: longLine1MiB.length,
        warmupSamples: WARMUP_COUNT,
        measuredSamples: SAMPLE_COUNT,
        mountBoundary:
          "EditorState.create + EditorView constructor; no native I/O or paint",
        editBoundary: "EditorView.dispatch local one-character insert/delete",
      },
      thresholds,
      measurements: {
        normalMount,
        normalEdit,
        largeMount,
        largeEdit,
        longLine256KiBPlusMount,
        longLine1MiBMount,
        normalUndoDepth,
        largeUndoDepth,
        rssBefore,
        rssAfter,
        rssDeltaBytes,
      },
      limitations: [
        "jsdom does not reproduce native IME candidate windows, WebKit layout, or animation-frame paint",
        "The accepted Rust preflight still must block lines strictly above 1 MiB before EditorView",
        "These feasibility ceilings do not replace release-build reference-machine product budgets",
      ],
    };

    const artifactDirectory = resolve("benchmark-results", "P0-SPIKE-01");
    mkdirSync(artifactDirectory, { recursive: true });
    const artifactPath = resolve(artifactDirectory, "editor-spike.json");
    writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.info(`P0-SPIKE-01 metrics: ${JSON.stringify(report.measurements)}`);

    expect(normalMount.p95Ms).toBeLessThan(thresholds.normalMarkdownMountP95Ms);
    expect(normalEdit.p95Ms).toBeLessThan(thresholds.normalMarkdownLocalEditP95Ms);
    expect(largeMount.p95Ms).toBeLessThan(thresholds.large10MiBSourceOnlyMountP95Ms);
    expect(largeEdit.p95Ms).toBeLessThan(thresholds.large10MiBLocalEditP95Ms);
    expect(longLine1MiBMount.p95Ms).toBeLessThan(
      thresholds.longLine1MiBSourceOnlyMountP95Ms,
    );
    expect(rssDeltaBytes).toBeLessThan(thresholds.processRssDeltaBytes);
    expect(normalUndoDepth).toBeGreaterThan(0);
    expect(largeUndoDepth).toBeGreaterThan(0);
  }, 180_000);
});
