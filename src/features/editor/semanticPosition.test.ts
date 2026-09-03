import { Schema } from "@milkdown/kit/prose/model";
import { describe, expect, it } from "vitest";

import {
  markdownPositionFromSemantic,
  semanticPositionFromMarkdown,
  semanticPositionFromVisualDocument,
  visualPositionFromSemantic,
} from "./semanticPosition";

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
});
