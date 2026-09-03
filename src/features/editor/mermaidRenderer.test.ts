import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { restoreFlowchartLabelSlots } from "./mermaidRenderer";

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: mermaid }));

const diagramSource = `flowchart TD
  R[执行协调器] -->|工作指令与资料| M[语言模型]
  M -->|工具调用请求| R
  R -->|新一轮调用上下文| M
  M -->|最终答复| R`;

function flowchartMarkup(
  points: unknown = [
    { x: 80, y: 20 },
    { x: 20, y: 70 },
    { x: 80, y: 120 },
  ],
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="flowchart" width="200" height="160" viewBox="0 0 200 160"><style>.edgeLabel { color: black }</style><g><g class="edgePaths"><path class="flowchart-link" data-id="L_R_M_0" data-points="${btoa(JSON.stringify(points))}" d="M80,20 Q0,70 80,120" marker-end="url(#arrow)"/></g><g class="edgeLabels"><g class="edgeLabel" transform="translate(75, 72)"><g class="label" data-id="L_R_M_0" transform="translate(-40, -12)"><foreignObject width="80" height="24"><div xmlns="http://www.w3.org/1999/xhtml"><span>工作指令与资料</span></div></foreignObject></g></g></g></g></svg>`;
}

function parse(markup: string): Element {
  return new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
}

describe("Mermaid flowchart label slots", () => {
  it("restores the reserved routing midpoint without changing text, paths or markers", () => {
    const input = flowchartMarkup();
    const original = parse(input);
    const output = parse(restoreFlowchartLabelSlots(input));
    expect(
      output.querySelector(".edgeLabels > .edgeLabel")?.getAttribute("transform"),
    ).toBe("translate(20, 70)");
    expect(output.querySelector("path")?.outerHTML).toBe(
      original.querySelector("path")?.outerHTML,
    );
    expect(output.querySelector("foreignObject")?.outerHTML).toBe(
      original.querySelector("foreignObject")?.outerHTML,
    );
    expect(output.querySelector("style")?.textContent).toBe(
      original.querySelector("style")?.textContent,
    );
    expect(output.getAttribute("viewBox")).toBe("-28 0 228 160");
    expect(output.getAttribute("width")).toBe("228");
  });

  it("includes nested translations when keeping the restored label inside the viewBox", () => {
    const input = flowchartMarkup().replace(
      '<g><g class="edgePaths">',
      '<g transform="translate(30, 180)"><g class="edgePaths">',
    );
    const output = parse(restoreFlowchartLabelSlots(input));
    expect(output.getAttribute("viewBox")).toBe("0 0 200 270");
    expect(
      output.querySelector(".edgeLabels > .edgeLabel")?.getAttribute("transform"),
    ).toBe("translate(20, 70)");
  });

  it("uses the middle slot for longer and horizontal routes", () => {
    const points = [
      { x: 10, y: 20 },
      { x: 50, y: 20 },
      { x: 100, y: 85 },
      { x: 150, y: 20 },
      { x: 180, y: 20 },
    ];
    const output = parse(restoreFlowchartLabelSlots(flowchartMarkup(points)));
    expect(
      output.querySelector(".edgeLabels > .edgeLabel")?.getAttribute("transform"),
    ).toBe("translate(100, 85)");
  });

  it("leaves unknown diagrams and unsupported renderer metadata untouched", () => {
    const input = flowchartMarkup();
    const alternatives = [
      input.replace('class="flowchart"', 'class="sequence"'),
      input.replace(/data-points="[^"]+"/u, 'data-points="invalid"'),
      input.replace('transform="translate(-40, -12)"', 'transform="scale(2)"'),
      input.replace(
        '<g><g class="edgePaths">',
        '<g transform="scale(2)"><g class="edgePaths">',
      ),
      flowchartMarkup([
        { x: 10, y: 20 },
        { x: 100, y: 20 },
      ]),
      flowchartMarkup([
        { x: 10, y: 20 },
        { x: "invalid", y: 50 },
        { x: 100, y: 20 },
      ]),
      "not an SVG",
    ];
    for (const markup of alternatives)
      expect(restoreFlowchartLabelSlots(markup)).toBe(markup);
  });
});

describe("Mermaid rendering", () => {
  const fontsDescriptor = Object.getOwnPropertyDescriptor(document, "fonts");

  beforeEach(() => {
    vi.resetModules();
    mermaid.initialize.mockReset();
    mermaid.render.mockReset().mockResolvedValue({ svg: flowchartMarkup() });
  });

  afterEach(() => {
    if (fontsDescriptor) Object.defineProperty(document, "fonts", fontsDescriptor);
    else Reflect.deleteProperty(document, "fonts");
  });

  it("keeps label typography independent of prose and waits for fonts before measurement", async () => {
    let ready!: () => void;
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        ready: new Promise<void>((resolve) => {
          ready = resolve;
        }),
      },
    });
    const { renderMermaidSvg } = await import("./mermaidRenderer");
    const pending = renderMermaidSvg(diagramSource);
    await vi.waitFor(() => expect(mermaid.initialize).toHaveBeenCalledOnce());
    expect(mermaid.render).not.toHaveBeenCalled();
    const configuration = mermaid.initialize.mock.calls[0]?.[0] as { themeCSS: string };
    expect(configuration.themeCSS).toContain("foreignObject p");
    expect(configuration.themeCSS).toContain("line-height: inherit");
    expect(configuration.themeCSS).toContain("font-size: inherit");
    ready();
    const result = await pending;
    expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), diagramSource);
    expect(
      parse(result).querySelector(".edgeLabels > .edgeLabel")?.getAttribute("transform"),
    ).toBe("translate(20, 70)");
  });

  it("deduplicates renders, clears cached projections, and never changes the source", async () => {
    const { renderMermaidSvg, clearMermaidRenderCache } = await import("./mermaidRenderer");
    const first = renderMermaidSvg(diagramSource);
    expect(renderMermaidSvg(diagramSource)).toBe(first);
    await first;
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    clearMermaidRenderCache();
    await renderMermaidSvg(diagramSource);
    expect(mermaid.render).toHaveBeenCalledTimes(2);
    for (const call of mermaid.render.mock.calls) expect(call[1]).toBe(diagramSource);
  });

  it("evicts failures so an unchanged block can retry", async () => {
    mermaid.render.mockRejectedValueOnce(new Error("Diagram error"));
    const { renderMermaidSvg } = await import("./mermaidRenderer");
    await expect(renderMermaidSvg(diagramSource)).rejects.toThrow("Diagram error");
    await expect(renderMermaidSvg(diagramSource)).resolves.toContain("工作指令与资料");
    expect(mermaid.render).toHaveBeenCalledTimes(2);
  });

  it("preserves explicitly selected layout engines", async () => {
    const { renderMermaidSvg } = await import("./mermaidRenderer");
    for (const prefix of [
      "---\nconfig:\n  layout: elk\n---\n",
      '%%{init: {"flowchart": {"defaultRenderer": "dagre-d3"}}}%%\n',
    ]) {
      await expect(renderMermaidSvg(prefix + diagramSource)).resolves.toBe(
        flowchartMarkup(),
      );
    }
  });
});
