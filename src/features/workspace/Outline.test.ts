import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { Outline } from "./Outline";
import {
  extractOutline,
  findMarkdownAnchorPosition,
  markdownHeadingSlug,
} from "./outlineModel";

describe("outline extraction", () => {
  it("collects ATX headings and ignores fenced examples", () => {
    expect(extractOutline("# A\n\n## B\n```md\n# hidden\n```\n### C")).toEqual([
      { from: 0, level: 1, title: "A", line: 1 },
      { from: 5, level: 2, title: "B", line: 3 },
      { from: 29, level: 3, title: "C", line: 7 },
    ]);
  });

  it("reports the source position when a heading is selected", () => {
    const onNavigate = vi.fn();
    render(createElement(Outline, { markdown: "# A\n\n## B", onNavigate }));

    fireEvent.click(screen.getByRole("button", { name: "B" }));

    expect(onNavigate).toHaveBeenCalledWith({
      from: 5,
      level: 2,
      line: 3,
      title: "B",
    });
  });

  it("resolves encoded anchors and duplicate heading slugs", () => {
    const markdown = "# 阅读导航\n\n## 状态与异常\n\n## 状态与异常\n";

    expect(markdownHeadingSlug("状态与异常！")).toBe("状态与异常");
    expect(
      findMarkdownAnchorPosition(
        markdown,
        "#%E7%8A%B6%E6%80%81%E4%B8%8E%E5%BC%82%E5%B8%B8",
      ),
    ).toBe(8);
    expect(findMarkdownAnchorPosition(markdown, "状态与异常-1")).toBe(18);
  });
});
