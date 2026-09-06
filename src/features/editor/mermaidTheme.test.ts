import mermaid from "mermaid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { clearMermaidRenderCache, renderMermaidSvg } from "./mermaidRenderer";

const sequence = `sequenceDiagram
participant A as 阅读器
participant B as 工作区
A->>B: 请求合成内容
B-->>A: 返回阅读结果`;

const bboxDescriptor = Object.getOwnPropertyDescriptor(SVGElement.prototype, "getBBox");

beforeAll(() => {
  // jsdom has no SVG layout. Supply geometry only; Mermaid's real parser, theme
  // resolution and SVG/CSS rendering remain intact. This does not test sizing.
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => new DOMRect(0, 0, 160, 28),
  });
});

afterEach(clearMermaidRenderCache);

afterAll(() => {
  if (bboxDescriptor)
    Object.defineProperty(SVGElement.prototype, "getBBox", bboxDescriptor);
  else Reflect.deleteProperty(SVGElement.prototype, "getBBox");
});

function actorStyles(markup: string): string {
  const svg = new DOMParser().parseFromString(markup, "image/svg+xml");
  expect(svg.querySelector("parsererror")).toBeNull();
  expect(svg.querySelector("rect.actor")).not.toBeNull();
  expect(svg.documentElement.textContent).toContain("请求合成内容");
  const css = svg.querySelector("style")?.textContent ?? "";
  const actor = /\.actor\s*\{([^}]*)\}/u.exec(css)?.[1];
  if (!actor) throw new Error("Mermaid did not render its participant styles");
  return actor;
}

async function expectDefaultColors() {
  const styles = actorStyles(await renderMermaidSvg(sequence));
  expect(styles).toContain("fill:#eef3ff;");
  expect(styles).toContain("stroke:#7895df;");
  expect(mermaid.mermaidAPI.getConfig()).toMatchObject({
    theme: "base",
    themeVariables: {
      actorTextColor: "#263143",
      signalTextColor: "#263143",
    },
  });
}

describe("Mermaid diagram colors", () => {
  it("renders the application's pale blue palette for an unstyled sequence", async () => {
    await expectDefaultColors();
  });

  it.each([
    {
      name: "an init neutral theme",
      prefix: '%%{init: {"theme":"neutral"}}%%\n',
      theme: "neutral",
      fill: "#eee",
    },
    {
      name: "a frontmatter forest theme",
      prefix: "---\nconfig:\n  theme: forest\n---\n",
      theme: "forest",
      fill: "#cde498",
    },
    {
      name: "an init dark theme",
      prefix: '%%{init: {"theme":"dark"}}%%\n',
      theme: "dark",
      fill: "#1f2020",
    },
    {
      name: "explicit participant colors",
      prefix:
        '%%{init: {"theme":"base","themeVariables":{"actorBkg":"#ffeeaa","actorBorder":"#996600"}}}%%\n',
      theme: "base",
      fill: "#ffeeaa",
      stroke: "#996600",
    },
  ])("preserves $name without changing the next diagram", async (example) => {
    const styles = actorStyles(await renderMermaidSvg(example.prefix + sequence));
    expect(styles).toContain(`fill:${example.fill};`);
    if (example.stroke) expect(styles).toContain(`stroke:${example.stroke};`);
    expect(mermaid.mermaidAPI.getConfig().theme).toBe(example.theme);

    // Force a fresh render so a cached default SVG cannot hide leaked settings.
    clearMermaidRenderCache();
    await expectDefaultColors();
  });
});
