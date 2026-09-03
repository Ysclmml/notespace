let initialized = false;
let renderCounter = 1;
const svgCache = new Map<string, Promise<string>>();

// Mermaid measures HTML labels in a temporary body container, then the same SVG
// is mounted inside ProseMirror or the viewer. Keep text metrics identical in
// both places: prose rules must not enlarge the fixed foreignObject bounds.
// Mermaid scopes themeCSS to the generated SVG ID, including during measurement.
const labelStyles = `
  foreignObject { overflow-wrap: normal; word-break: normal; }
  foreignObject p { margin: 0; padding: 0; font-size: inherit; line-height: inherit; }
  foreignObject a { padding: 0; font-weight: inherit; }
  foreignObject code { padding: 0; font-family: monospace; font-size: 1em; line-height: inherit; }
`;

interface Point {
  readonly x: number;
  readonly y: number;
}

function translation(element: Element): Point | undefined {
  const transform = element.getAttribute("transform");
  if (!transform) return { x: 0, y: 0 };
  const match = /^translate\(\s*([-+.\deE]+)[ ,]+([-+.\deE]+)\s*\)$/u.exec(transform);
  if (!match) return undefined;
  const x = Number(match[1]);
  const y = Number(match[2]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

/**
 * Dagre reserves the middle routing point for an edge's label. Mermaid's final
 * clipped/curved-path pass can move it away from that slot and pile parallel
 * labels together. Restore the reserved positions, without rerouting any edge
 * or changing diagram source. Unrecognised renderer output is left untouched.
 */
export function restoreFlowchartLabelSlots(markup: string): string {
  const document = new DOMParser().parseFromString(markup, "image/svg+xml");
  const svg = document.documentElement;
  if (svg.localName !== "svg" || !svg.classList.contains("flowchart")) return markup;
  const viewBox = (svg.getAttribute("viewBox") ?? "").split(/[ ,]+/u).map(Number);
  if (viewBox.length !== 4 || !viewBox.every(Number.isFinite)) return markup;
  let [left, top, width, height] = viewBox as [number, number, number, number];
  let right = left + width;
  let bottom = top + height;
  let changed = false;

  for (const layer of svg.querySelectorAll("g.edgeLabels")) {
    const paths = layer.parentElement?.querySelector(":scope > g.edgePaths");
    if (!paths) continue;
    for (const label of layer.children) {
      const inner = label.querySelector("g.label[data-id]");
      const bounds = inner?.querySelector("foreignObject");
      if (!inner || !bounds || !inner.textContent?.trim()) continue;
      const path = [...paths.children].find(
        (candidate) =>
          candidate.classList.contains("flowchart-link") &&
          candidate.getAttribute("data-id") === inner.getAttribute("data-id"),
      );
      const encoded = path?.getAttribute("data-points");
      if (!encoded) continue;
      let points: unknown;
      try {
        points = JSON.parse(atob(encoded));
      } catch {
        continue;
      }
      if (!Array.isArray(points) || points.length < 3 || points.length % 2 === 0) continue;
      const point: unknown = points[Math.floor(points.length / 2)];
      if (
        !point ||
        typeof point !== "object" ||
        !("x" in point) ||
        !("y" in point) ||
        typeof point.x !== "number" ||
        typeof point.y !== "number" ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y)
      )
        continue;
      const offset = translation(inner);
      const labelWidth = Number(bounds.getAttribute("width"));
      const labelHeight = Number(bounds.getAttribute("height"));
      if (
        !offset ||
        !(labelWidth > 0) ||
        !(labelHeight > 0) ||
        !Number.isFinite(labelWidth) ||
        !Number.isFinite(labelHeight)
      )
        continue;
      let ancestor: Element | null = layer;
      let x = point.x + offset.x;
      let y = point.y + offset.y;
      while (ancestor && ancestor !== svg) {
        const transform = translation(ancestor);
        if (!transform) break;
        x += transform.x;
        y += transform.y;
        ancestor = ancestor.parentElement;
      }
      if (ancestor !== svg) continue;

      label.setAttribute("transform", `translate(${point.x}, ${point.y})`);
      left = Math.min(left, x - 8);
      top = Math.min(top, y - 8);
      right = Math.max(right, x + labelWidth + 8);
      bottom = Math.max(bottom, y + labelHeight + 8);
      changed = true;
    }
  }
  if (!changed) return markup;
  width = right - left;
  height = bottom - top;
  svg.setAttribute("viewBox", `${left} ${top} ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  return new XMLSerializer().serializeToString(svg);
}

async function mermaidApi() {
  const module = await import("mermaid");
  const mermaid = module.default;
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "neutral",
      securityLevel: "strict",
      flowchart: { htmlLabels: true, useMaxWidth: false },
      themeCSS: labelStyles,
      themeVariables: {
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
        primaryColor: "#eef3ff",
        primaryBorderColor: "#7895df",
        primaryTextColor: "#263143",
        lineColor: "#647188",
        secondaryColor: "#f7f8fa",
        tertiaryColor: "#ffffff",
      },
    });
    initialized = true;
  }
  return mermaid;
}

export function renderMermaidSvg(source: string): Promise<string> {
  const cached = svgCache.get(source);
  if (cached) return cached;

  const rendered = mermaidApi()
    .then(async (mermaid) => {
      // Measure only after the browser has settled its font metrics. Environments
      // without the Font Loading API (including DOM tests) need no extra barrier.
      await document.fonts?.ready;
      const id = `markdown-workspace-mermaid-${renderCounter++}`;
      const result = await mermaid.render(id, source);
      // User-selected layout engines own their label placement. Do not apply
      // the default Dagre workaround to explicit frontmatter/init overrides.
      if (/\b(?:layout|defaultRenderer)["']?\s*:/u.test(source)) return result.svg;
      return restoreFlowchartLabelSlots(result.svg);
    })
    .catch((error: unknown) => {
      svgCache.delete(source);
      throw error;
    });
  svgCache.set(source, rendered);
  return rendered;
}

export function clearMermaidRenderCache(): void {
  svgCache.clear();
}
