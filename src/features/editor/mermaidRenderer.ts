let initialized = false;
let renderCounter = 1;
const svgCache = new Map<string, Promise<string>>();

async function mermaidApi() {
  const module = await import("mermaid");
  const mermaid = module.default;
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "neutral",
      securityLevel: "strict",
      flowchart: { htmlLabels: true, useMaxWidth: false },
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
      const id = `markdown-workspace-mermaid-${renderCounter++}`;
      const result = await mermaid.render(id, source);
      return result.svg;
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
