// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { buildHtmlExport } from "./buildHtmlExport";

function parseExport(markdown: string, documentPath?: string): Document {
  return new DOMParser().parseFromString(
    buildHtmlExport(markdown, { title: "测试笔记", documentPath }),
    "text/html",
  );
}

describe("buildHtmlExport", () => {
  it("renders dollar and TeX-delimited math as portable script-free MathML", () => {
    const document = parseExport(
      [
        "行内 $a_1$ 与 \\(b_2\\)。",
        "",
        "$$",
        "c^2 = a^2 + b^2",
        "$$",
        "",
        "\\[",
        "q'_t = R_t q_t, \\qquad k'_s = R_s k_s",
        "\\]",
      ].join("\n"),
    );

    expect(document.querySelectorAll("math")).toHaveLength(4);
    expect(document.querySelectorAll(".math-inline math")).toHaveLength(2);
    expect(document.querySelectorAll(".math-display math[display='block']")).toHaveLength(
      2,
    );
    expect(document.querySelector(".math-display annotation")?.textContent).toBe(
      "c^2 = a^2 + b^2",
    );
    expect(document.querySelector("script, link[rel='stylesheet']")).toBeNull();
  });

  it("keeps formula-looking code literal and falls back safely for invalid TeX", () => {
    const document = parseExport(
      [
        "`\\(inline code\\)`",
        "",
        "```md",
        "\\[fenced code\\]",
        "```",
        "",
        "Invalid \\(\\sqrt{\\) formula.",
      ].join("\n"),
    );

    expect(document.querySelectorAll("math")).toHaveLength(0);
    expect(document.querySelector("p > code")?.textContent).toBe("\\(inline code\\)");
    expect(document.querySelector("pre code.language-md")?.textContent).toContain(
      "\\[fenced code\\]",
    );
    expect(document.querySelector(".math-error")?.textContent).toContain("$\\sqrt{$");
    expect(document.querySelector("script, [onclick]")).toBeNull();
  });

  it("bounds individual formula rendering without failing the document export", () => {
    const document = parseExport(`Before $${"x".repeat(16_385)}$ after`);

    expect(document.querySelector("math")).toBeNull();
    expect(document.querySelector(".math-error")?.textContent).toContain("xxxxx");
    expect(document.querySelector("main")?.textContent).toContain("Before");
    expect(document.querySelector("main")?.textContent).toContain("after");
  });

  it("renders complete GFM content from a Markdown snapshot without editing it", () => {
    const content = [
      "# 中文 **标题**",
      "",
      "文字 *强调*、~~删除~~ 与 `let x = 1 < 2`。",
      "",
      "> 引用段落",
      "",
      "3. 第一项",
      "4. 第二项",
      "",
      "- [x] 完成",
      "- [ ] 待做",
      "",
      "| 名称 | 数量 |",
      "| :--- | ---: |",
      "| 字符 & 中文 | 2 |",
      "",
      "```ts",
      'const greeting = "<中文>&";',
      "console.log(greeting);",
      "```",
    ].join("\r\n");
    const original = content;
    const document = parseExport(content);

    expect(document.querySelector("h1")?.textContent).toBe("中文 标题");
    expect(document.querySelector("h1 strong")?.textContent).toBe("标题");
    expect(document.querySelector("em")?.textContent).toBe("强调");
    expect(document.querySelector("del")?.textContent).toBe("删除");
    expect(document.querySelector("blockquote")?.textContent).toContain("引用段落");
    expect(document.querySelector("ol")?.getAttribute("start")).toBe("3");
    expect(document.querySelectorAll('input[type="checkbox"][disabled]')).toHaveLength(2);
    expect(document.querySelectorAll('input[type="checkbox"][checked]')).toHaveLength(1);
    expect(document.querySelector("tbody td")?.textContent).toBe("字符 & 中文");
    expect(document.querySelector("tbody td:last-child")?.className).toBe("align-right");
    expect(document.querySelector("pre code")?.textContent).toBe(
      'const greeting = "<中文>&";\nconsole.log(greeting);\n',
    );
    expect(document.querySelector("pre code")?.className).toBe("language-ts");
    expect(content).toBe(original);
    expect(document.querySelector(".cm-editor, .milkdown, button")).toBeNull();
  });

  it("includes the complete code and Mermaid source, not a viewport or generated SVG", () => {
    const lines = Array.from({ length: 250 }, (_, index) => `line ${index + 1}`).join("\n");
    const document = parseExport(
      `\`\`\`text\n${lines}\n\`\`\`\n\n\`\`\`mermaid\nflowchart TD\n A[中文] --> B[结束]\n\`\`\``,
    );
    expect(document.querySelector("code.language-text")?.textContent).toBe(`${lines}\n`);
    expect(document.querySelector("pre.long-code > code.language-text")).not.toBeNull();
    expect(document.querySelector("code.language-mermaid")?.textContent).toContain(
      "A[中文] --> B[结束]",
    );
    expect(document.querySelector(".mermaid-label")?.textContent).toContain("source");
    expect(document.querySelector("script, svg")).toBeNull();
  });

  it("escapes titles, text, HTML and attributes and refuses executable URL schemes", () => {
    const html = buildHtmlExport(
      [
        '# <img src=x onerror="alert(1)">',
        "",
        '<script>alert("unsafe")</script>',
        "",
        '<iframe src="https://example.com"></iframe>',
        "",
        "[one](javascript:alert%281%29) [two](java&#x73;cript:evil) [three](%6aavascript%3aevil)",
        "",
        '![attack](data:image/svg+xml,attack) ![caption](https://example.com/a.png "a &quot; onerror=&quot;alert")',
      ].join("\n"),
      { title: '</title><script>alert("title")</script>' },
    );
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.title).toBe('</title><script>alert("title")</script>');
    expect(document.querySelector("script, iframe, [onerror]")).toBeNull();
    expect(document.querySelector("main")?.textContent).toContain(
      '<script>alert("unsafe")</script>',
    );
    expect(document.querySelectorAll("a[href]")).toHaveLength(0);
    expect(document.querySelectorAll("img")).toHaveLength(1);
    expect(document.querySelector("img")?.getAttribute("title")).toBe('a " onerror="alert');
    expect(document.querySelector("meta[http-equiv]")?.getAttribute("content")).toContain(
      "script-src 'none'",
    );
    expect(document.querySelector('meta[name="referrer"]')?.getAttribute("content")).toBe(
      "no-referrer",
    );
  });

  it("resolves relative images and local links against the source directory, with escaped filenames", () => {
    const document = parseExport(
      [
        '![图像](../assets/%E5%9B%BE%20%26%20%23%25.png "说明")',
        "",
        "[下一篇](./next%20note.md#部分-二)",
        "",
        "[本页](#heading)",
        "",
        "![SVG](file:///tmp/demo/picture.svg#view)",
      ].join("\n"),
      "/tmp/demo/notes/current note.md",
    );
    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      "file:///tmp/demo/assets/%E5%9B%BE%20%26%20%23%25.png",
    );
    expect(document.querySelector("img")?.getAttribute("title")).toBe("说明");
    const links = document.querySelectorAll("a");
    expect(links[0]?.getAttribute("href")).toBe(
      "file:///tmp/demo/notes/next%20note.md#部分-二",
    );
    expect(links[1]?.getAttribute("href")).toBe("#heading");
    expect(document.querySelectorAll("img")[1]?.getAttribute("src")).toBe(
      "file:///tmp/demo/picture.svg#view",
    );
  });

  it("handles Windows drive paths and file URI source paths without relying on the host platform", () => {
    const windows = parseExport(
      "![图](./图%20像.png) [代码](../main.py)",
      "C:\\notes\\中文\\note.md",
    );
    expect(windows.querySelector("img")?.getAttribute("src")).toBe(
      "file:///C:/notes/%E4%B8%AD%E6%96%87/%E5%9B%BE%20%E5%83%8F.png",
    );
    expect(windows.querySelector("a")?.getAttribute("href")).toBe(
      "file:///C:/notes/main.py",
    );
    const fileUri = parseExport(
      "![图](./image.png)",
      "file:///tmp/demo/with%20space/note.md",
    );
    expect(fileUri.querySelector("img")?.getAttribute("src")).toBe(
      "file:///tmp/demo/with%20space/image.png",
    );
  });

  it("keeps unresolved unsaved-document image references visible without inventing a base directory", () => {
    const document = parseExport(
      "![本地图](./image.png) [本地文档](next.md)",
      "untitled://new.md",
    );
    expect(document.querySelector("img, a[href]")).toBeNull();
    expect(document.querySelector(".unresolved-image")?.textContent).toContain(
      "./image.png",
    );
    expect(document.querySelector("main")?.textContent).toContain("本地文档");
  });

  it("keeps remote URLs without loading them and never instantiates an image", () => {
    const fetch = vi.fn();
    const image = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("Image", image);
    try {
      const html = buildHtmlExport(
        "![远程](https://example.com/image.png?x=1&y=2) [网页](https://example.com/docs)",
        { title: "远程引用" },
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(image).not.toHaveBeenCalled();
      expect(html).toContain('src="https://example.com/image.png?x=1&amp;y=2"');
      expect(html).toContain('referrerpolicy="no-referrer"');
      expect(html).not.toContain("<script");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("supports reference links, image definitions, duplicate heading anchors and GFM footnotes", () => {
    const document = parseExport(
      [
        "# Overview",
        "",
        "# Overview",
        "",
        "[Read][DOC] ![Image][PICTURE]",
        "",
        "A note[^one].",
        "",
        '[doc]: https://example.com/docs "Documentation"',
        "[picture]: ./picture.png",
        "[^one]: The **footnote** text.",
      ].join("\n"),
      "/tmp/demo/note.md",
    );
    expect(Array.from(document.querySelectorAll("h1"), (heading) => heading.id)).toEqual([
      "overview",
      "overview-1",
    ]);
    expect(document.querySelector("a")?.getAttribute("title")).toBe("Documentation");
    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      "file:///tmp/demo/picture.png",
    );
    expect(document.querySelector(".footnotes")?.textContent).toContain(
      "The footnote text.",
    );
    expect(document.querySelector("sup a")?.getAttribute("href")).toBe(
      "#notespace-footnote-1",
    );
  });

  it("rejects network file shares and URI control characters instead of emitting active references", () => {
    const document = parseExport(
      "![share](file://server/private.png) [network](//example.com/path) ![control](./a%0ab.png)",
      "/tmp/demo/note.md",
    );
    expect(document.querySelector("img, a[href]")).toBeNull();
    expect(document.querySelectorAll(".unresolved-image")).toHaveLength(2);
  });

  it("allocates globally unique heading and footnote IDs even when natural slugs collide", () => {
    const document = parseExport(
      [
        "# A",
        "",
        "# A",
        "",
        "# A-1",
        "",
        "[link](#a-1)",
        "",
        "A footnote appears before a colliding heading[^check].",
        "",
        "# notespace-footnote-1",
        "",
        "[^check]: Footnote text.",
      ].join("\n"),
    );
    const headingIds = Array.from(document.querySelectorAll("h1"), (node) => node.id);
    expect(headingIds).toEqual(["a", "a-1", "a-1-1", "notespace-footnote-1"]);
    const allIds = Array.from(document.querySelectorAll("[id]"), (node) => node.id);
    expect(new Set(allIds).size).toBe(allIds.length);
    const footnoteHref = document.querySelector("sup a")?.getAttribute("href");
    expect(footnoteHref).toBe("#notespace-footnote-1-1");
    expect(document.getElementById(footnoteHref!.slice(1))?.textContent).toContain(
      "Footnote text.",
    );
  });
});
