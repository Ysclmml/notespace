// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareShareableHtml, staticMermaidSvg } from "./prepareShareableHtml";
import { renderMermaidSvg } from "../editor/mermaidRenderer";

vi.mock("../editor/mermaidRenderer", () => ({ renderMermaidSvg: vi.fn() }));

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" id="chart" viewBox="0 0 100 80"><style>#chart .edge {marker-end:url(#arrow)}</style><defs><marker id="arrow"/></defs><path class="edge" marker-end="url(#arrow)"/><foreignObject width="80" height="30"><div xmlns="http://www.w3.org/1999/xhtml">中文图表</div></foreignObject></svg>';

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("shareable HTML preparation", () => {
  it("keeps portable MathML from both dollar and TeX delimiters", async () => {
    const result = await prepareShareableHtml("行内 $a_1$。\n\n\\[\nb_2 = c^2\n\\]", {
      title: "公式",
    });
    const document = new DOMParser().parseFromString(result.html, "text/html");

    expect(document.querySelectorAll("math")).toHaveLength(2);
    expect(document.querySelector(".math-display annotation")?.textContent).toBe(
      "b_2 = c^2",
    );
    expect(document.querySelector("script, link[rel='stylesheet']")).toBeNull();
    expect(result.images).toEqual([]);
  });

  it("renders complete Mermaid SVG without scripts, preserves CJK and makes repeated IDs unique", async () => {
    vi.mocked(renderMermaidSvg).mockResolvedValue(svg);
    const body =
      "# 草稿\n\n```mermaid\ngraph TD; A-->B\n```\n\n```mermaid\ngraph TD; A-->B\n```";
    const result = await prepareShareableHtml(body, { title: "分享" });
    const document = new DOMParser().parseFromString(result.html, "text/html");
    expect(document.querySelectorAll("figure svg")).toHaveLength(2);
    expect(document.querySelector("#export-mermaid-0-chart")?.textContent).toContain(
      "中文图表",
    );
    expect(
      document.querySelector("#export-mermaid-1-chart path")?.getAttribute("marker-end"),
    ).toBe("url(#export-mermaid-1-arrow)");
    expect(document.querySelector("script, code.language-mermaid")).toBeNull();
    expect(result.html).toContain("img-src data:");
    expect(result.images).toEqual([]);
    expect(body).toContain("```mermaid");
  });

  it("collects and deduplicates local/remote image sources without fetching them in JS", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      const result = await prepareShareableHtml(
        "![一](./图.png) ![二](./图.png) ![三](https://example.com/a.png)",
        { title: "图", documentPath: "/synthetic/note.md" },
      );
      expect(result.images).toEqual([
        { id: "notespace-export-image-0", source: "file:///synthetic/%E5%9B%BE.png" },
        { id: "notespace-export-image-1", source: "https://example.com/a.png" },
      ]);
      expect(result.html.match(/src="notespace-export-image-0"/gu)).toHaveLength(2);
      expect(result.html).not.toContain('src="file:');
      expect(result.html).not.toContain('src="http');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves dollar replacement sequences literally in Mermaid labels", async () => {
    vi.mocked(renderMermaidSvg).mockResolvedValue(
      '<svg xmlns="http://www.w3.org/2000/svg"><text>$&amp; $\' $` $$</text></svg>',
    );
    const result = await prepareShareableHtml("```mermaid\ngraph TD; A-->B\n```", {
      title: "dollars",
    });
    const document = new DOMParser().parseFromString(result.html, "text/html");
    expect(document.querySelector("svg text")?.textContent).toBe("$& $' $` $$");
    expect(document.querySelector("[data-notespace-export-mermaid]")).toBeNull();
  });

  it("fails unresolved images or invalid diagrams instead of claiming a complete export", async () => {
    await expect(
      prepareShareableHtml("![missing](./a.png)", { title: "untitled" }),
    ).rejects.toMatchObject({ code: "exportImageUnresolved" });
    vi.mocked(renderMermaidSvg).mockRejectedValue(new Error("invalid syntax"));
    await expect(
      prepareShareableHtml("```mermaid\nbroken\n```", { title: "diagram" }),
    ).rejects.toMatchObject({ code: "exportDiagramFailed" });
    expect(() => staticMermaidSvg("not SVG", 0)).toThrow();
  });

  it("times out stalled rendering and clears timers after completion", async () => {
    vi.useFakeTimers();
    vi.mocked(renderMermaidSvg).mockReturnValue(new Promise(() => {}));
    const result = prepareShareableHtml("```mermaid\ngraph TD; A-->B\n```", {
      title: "timeout",
    });
    const rejected = expect(result).rejects.toMatchObject({ code: "exportDiagramFailed" });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds diagram and image counts before expensive work", async () => {
    await expect(
      prepareShareableHtml(
        Array.from({ length: 129 }, (_, i) => `![${i}](https://example.com/${i}.png)`).join(
          "\n",
        ),
        { title: "many" },
      ),
    ).rejects.toMatchObject({ code: "exportTooManyImages" });
    await expect(
      prepareShareableHtml("```mermaid\ngraph TD; A-->B\n```\n\n".repeat(65), {
        title: "many",
      }),
    ).rejects.toMatchObject({ code: "exportTooManyDiagrams" });
    expect(renderMermaidSvg).not.toHaveBeenCalled();
  });

  it("refuses active/external SVG resources while keeping local marker and use references", () => {
    for (const content of [
      "<script/>",
      '<image href="https://example.com/a.png"/>',
      '<style>@import "https://example.com/a.css"</style>',
      '<path fill="url(https://example.com/a.svg)"/>',
      '<foreignObject><img src="https://example.com/a.png"/></foreignObject>',
    ]) {
      expect(() =>
        staticMermaidSvg(`<svg xmlns="http://www.w3.org/2000/svg">${content}</svg>`, 0),
      ).toThrow();
    }
    const result = staticMermaidSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" id="chart" onload="bad()"><a href="https://example.com">link</a><use href="#chart"/></svg>',
      3,
    );
    expect(result).not.toContain("onload");
    expect(result).not.toContain("https:");
    expect(result).toContain('href="#export-mermaid-3-chart"');
  });
});
