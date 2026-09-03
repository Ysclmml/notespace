import { Schema } from "@milkdown/kit/prose/model";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { describe, expect, it, vi } from "vitest";

import {
  markdownPositionFromSemantic,
  semanticPositionFromMarkdown,
  semanticPositionFromVisualDocument,
  visualPositionFromSemantic,
} from "./semanticPosition";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    heading: { content: "text*", group: "block" },
    text: { group: "inline" },
  },
});

function visualDocument(paragraph: string) {
  return schema.nodeFromJSON({
    type: "doc",
    content: [
      { type: "heading", content: [{ type: "text", text: "Section" }] },
      { type: "paragraph", content: [{ type: "text", text: paragraph }] },
    ],
  });
}

describe("semantic editor positions", () => {
  it("maps a source position back to nearby text instead of the document start", () => {
    const markdown = [
      "# 第一章",
      "",
      "前面的内容。",
      "",
      "# 第二章",
      "",
      "这里是需要继续阅读的目标段落。",
      "",
      "结尾。",
    ].join("\n");
    const sourcePosition = markdown.indexOf("目标段落");
    const semantic = semanticPositionFromMarkdown(markdown, sourcePosition);

    expect(semantic.headingText).toBe("第二章");
    expect(markdownPositionFromSemantic(markdown, semantic)).toBe(sourcePosition);
  });

  it("maps between parsed visual content and Markdown by nearby text", () => {
    const markdown = [
      "# 标题",
      "",
      "开头。",
      "",
      "## 目标",
      "",
      "这一段用于模式切换定位。",
    ].join("\n");
    const schema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "text*", group: "block" },
        heading: {
          attrs: { level: { default: 1 } },
          content: "text*",
          group: "block",
        },
        text: { group: "inline" },
      },
    });
    const visualDocument = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "标题" }] },
        { type: "paragraph", content: [{ type: "text", text: "开头。" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "目标" }] },
        {
          type: "paragraph",
          content: [{ type: "text", text: "这一段用于模式切换定位。" }],
        },
      ],
    });
    const visualTarget = visualDocument.content.size - 5;
    const semantic = semanticPositionFromVisualDocument(visualDocument, visualTarget);
    const sourceTarget = markdownPositionFromSemantic(markdown, semantic);

    expect(sourceTarget).toBeGreaterThan(markdown.indexOf("## 目标"));
    expect(visualPositionFromSemantic(visualDocument, semantic)).toBeGreaterThan(10);
  });

  it.each([
    ["目标 **加粗内容** 之后", "目标 加粗内容 之后", "之后"],
    ["前 *强调* 中 ~~删除~~ 后", "前 强调 中 删除 后", "删除"],
    ["前 `x * 1` 后", "前 x * 1 后", "*"],
    ['Read [the **guide**](../guide.md "Title") now', "Read the guide now", "guide"],
    [
      `Read [the guide](../${"long-directory/".repeat(20)}guide.md) now`,
      "Read the guide now",
      "guide",
    ],
    ["Visit <https://example.test> now", "Visit https://example.test now", "example"],
    ["前 \\*星号\\* 后", "前 *星号* 后", "星号"],
  ])("maps formatted text in both directions: %s", (source, visible, target) => {
    const markdown = `# Section\n\n${source}\n`;
    const document = visualDocument(visible);
    const originalDocument = document.toJSON();
    const sourcePosition = markdown.indexOf(target) + 1;
    const visualPosition = document.firstChild!.nodeSize + 1 + visible.indexOf(target) + 1;

    expect(
      visualPositionFromSemantic(
        document,
        semanticPositionFromMarkdown(markdown, sourcePosition),
      ),
    ).toBe(visualPosition);
    expect(
      markdownPositionFromSemantic(
        markdown,
        semanticPositionFromVisualDocument(document, visualPosition),
      ),
    ).toBe(sourcePosition);
    // Mapping only reads the source/models; it cannot manufacture a body edit.
    expect(document.toJSON()).toEqual(originalDocument);
    expect(markdown).toBe(`# Section\n\n${source}\n`);
  });

  it.each([
    ["alpha  beta\tgamma", "alpha beta gamma"],
    ["alpha  beta\tgamma", "alpha  beta\tgamma"],
    ["  alpha  beta gamma", "alpha beta gamma"],
  ])("preserves offsets when whitespace is normalized: %s", (source, visible) => {
    const markdown = `# Section\n\n${source}\n`;
    const document = visualDocument(visible);
    const sourcePosition = markdown.indexOf("gamma") + 2;
    const visualPosition = document.firstChild!.nodeSize + 1 + visible.indexOf("gamma") + 2;
    const sourceSemantic = semanticPositionFromMarkdown(markdown, sourcePosition);

    expect(markdownPositionFromSemantic(markdown, sourceSemantic)).toBe(sourcePosition);
    expect(visualPositionFromSemantic(document, sourceSemantic)).toBe(visualPosition);
    expect(
      markdownPositionFromSemantic(
        markdown,
        semanticPositionFromVisualDocument(document, visualPosition),
      ),
    ).toBe(sourcePosition);
  });

  it("chooses the nearest overlapping occurrence within one visual paragraph", () => {
    const document = visualDocument("aaaaaa");
    const position = document.firstChild!.nodeSize + 5;
    const semantic = {
      progress: position / document.content.size,
      text: "aaa",
      textOffset: 1,
    };
    expect(visualPositionFromSemantic(document, semantic)).toBe(position);

    const markdown = "aaaaaa";
    expect(
      markdownPositionFromSemantic(markdown, {
        progress: 4 / 6,
        text: "aaa",
        textOffset: 1,
      }),
    ).toBe(4);
  });

  it("keeps raw code and unresolved bracket text ahead of the formatted alternative", () => {
    for (const text of ["x **literal** y", "unresolved [label] stays", "<tag> literal"]) {
      const markdown = `# Section\n\n${text}\n`;
      const document = visualDocument(text);
      const sourcePosition = markdown.indexOf(text) + 3;
      const visualPosition = document.firstChild!.nodeSize + 4;
      expect(
        visualPositionFromSemantic(
          document,
          semanticPositionFromMarkdown(markdown, sourcePosition),
        ),
      ).toBe(visualPosition);
    }
  });

  it("bounds line parsing and preserves raw matching for long source lines", () => {
    const text = "x".repeat(9000) + " target **literal** end";
    const markdown = `# Section\n\n${text}\n`;
    const position = markdown.indexOf("target") + 2;
    const semantic = semanticPositionFromMarkdown(markdown, position);
    expect(semantic.plainText).toBeUndefined();
    expect(markdownPositionFromSemantic(markdown, semantic)).toBe(position);
  });

  it("captures bounded raw needles from long source lines and visual paragraphs", () => {
    const text = "long content ".repeat(20_000) + "target ending";
    const markdown = `# Section\n\n${text}\n`;
    const document = visualDocument(text);
    const sourcePosition = markdown.indexOf("target") + 3;
    const visualPosition = document.firstChild!.nodeSize + 1 + text.indexOf("target") + 3;
    const parse = vi.spyOn(markdownLanguage.parser, "parse");
    try {
      const sourceSemantic = semanticPositionFromMarkdown(markdown, sourcePosition);
      const visualSemantic = semanticPositionFromVisualDocument(document, visualPosition);
      expect(sourceSemantic.text).toBe(visualSemantic.text);
      expect(sourceSemantic.text?.length).toBeLessThanOrEqual(64);
      expect(sourceSemantic.plainText).toBeUndefined();
      expect(parse).not.toHaveBeenCalled();
      expect(markdownPositionFromSemantic(markdown, sourceSemantic)).toBe(sourcePosition);
      expect(markdownPositionFromSemantic(markdown, visualSemantic)).toBe(sourcePosition);
    } finally {
      parse.mockRestore();
    }
  });

  it("reuses the same bounded line projection as the caret moves", () => {
    const line = "Unique **cached projection** for several caret positions.";
    const markdown = `# Cache\n\n${line}\n\nOther paragraph.`;
    const parse = vi.spyOn(markdownLanguage.parser, "parse");
    try {
      for (const target of ["cached", "projection", "positions"]) {
        semanticPositionFromMarkdown(markdown, markdown.indexOf(target));
      }
      expect(parse).toHaveBeenCalledTimes(1);
      expect(parse).toHaveBeenCalledWith(line);
    } finally {
      parse.mockRestore();
    }
  });

  it("keeps at most four bounded source-line projections", () => {
    const lines = Array.from({ length: 5 }, (_, index) => `Cache entry ${index} **bold**.`);
    const parse = vi.spyOn(markdownLanguage.parser, "parse");
    try {
      for (const line of lines) semanticPositionFromMarkdown(line, 3);
      semanticPositionFromMarkdown(lines[0]!, 3);
      expect(parse).toHaveBeenCalledTimes(6);
    } finally {
      parse.mockRestore();
    }
  });
});
