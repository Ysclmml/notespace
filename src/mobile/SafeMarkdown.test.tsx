import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { mobileMarkdownOutline } from "./markdownModel";
import { SafeMarkdown } from "./SafeMarkdown";

describe("SafeMarkdown", () => {
  it("renders a useful GFM subset without executing raw HTML", () => {
    const { container } = render(
      <SafeMarkdown
        markdown={`# 标题

<img src=x onerror="window.bad=true"><script>alert(1)</script>

| A | B |
| - | - |
| 1 | 2 |

![封面](private.png)`}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "标题" })).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByRole("img")).toHaveTextContent("图片 · 封面");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeVisible();
  });

  it("renders dollar and TeX delimiters with KaTeX in inline and display modes", () => {
    const { container } = render(
      <SafeMarkdown
        markdown={[
          String.raw`行内 $x^2 + y^2$ 与 \(a_t + b_t\)。`,
          "",
          "$$",
          String.raw`\int_0^1 x^2\,dx`,
          "$$",
          "",
          String.raw`\[`,
          String.raw`\sum_{i=1}^{n} i`,
          String.raw`\]`,
        ].join("\n")}
      />,
    );

    expect(container.querySelectorAll(".katex")).toHaveLength(4);
    expect(container.querySelectorAll('[data-math-display="false"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-math-display="true"]')).toHaveLength(2);
    expect(container.querySelectorAll(".katex-display")).toHaveLength(2);
  });

  it("leaves formula-looking text inside inline and fenced code untouched", () => {
    const { container } = render(
      <SafeMarkdown
        markdown={[
          "代码 `$inline$ 与 \\(bracket\\)`，外部 $rendered$。",
          "",
          "```tex",
          String.raw`$fenced$`,
          String.raw`\[also_fenced\]`,
          "```",
        ].join("\n")}
      />,
    );

    expect(container.querySelectorAll(".katex")).toHaveLength(1);
    expect(screen.getByText(String.raw`$inline$ 与 \(bracket\)`)).toBeVisible();
    expect(container.querySelector("pre code")).toHaveTextContent(
      String.raw`$fenced$ \[also_fenced\]`,
    );
  });

  it("keeps unclosed formulas literal instead of handing them to KaTeX", () => {
    const { container } = render(
      <SafeMarkdown
        markdown={[
          "$not closed",
          "",
          "$$",
          "display not closed",
          "",
          String.raw`\(bracket not closed`,
          "",
          String.raw`\[display bracket not closed`,
        ].join("\n")}
      />,
    );

    expect(container.querySelector(".katex")).toBeNull();
    expect(container).toHaveTextContent("$not closed");
    expect(container).toHaveTextContent("$$ display not closed");
    expect(container).toHaveTextContent("bracket not closed");
  });

  it("shows a readable literal fallback for invalid KaTeX without creating markup", () => {
    const { container } = render(
      <SafeMarkdown
        markdown={[
          String.raw`坏公式 $\frac{$ 仍可继续阅读。`,
          "",
          String.raw`安全公式 $\text{<script>window.bad=true</script>}$。`,
          "",
          String.raw`不可信链接 $\href{javascript:alert(1)}{点我}$。`,
        ].join("\n")}
      />,
    );

    const fallback = container.querySelector('[data-math-error="true"]');
    expect(fallback).toHaveAccessibleName("公式无法渲染");
    expect(fallback).toHaveTextContent(String.raw`$\frac{$`);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a[href]")).toBeNull();
    expect(container.querySelectorAll('[data-math-error="true"]')).toHaveLength(2);
    expect(container.querySelectorAll(".katex")).toHaveLength(1);
  });

  it("produces stable unique outline ids for duplicate CJK headings", () => {
    expect(mobileMarkdownOutline("# 介绍\n\n## 使用方法\n\n## 使用方法")).toEqual([
      { depth: 1, id: "介绍", text: "介绍" },
      { depth: 2, id: "使用方法", text: "使用方法" },
      { depth: 2, id: "使用方法-2", text: "使用方法" },
    ]);
  });
});
