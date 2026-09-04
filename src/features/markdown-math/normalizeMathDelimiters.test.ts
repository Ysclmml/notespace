import { describe, expect, it } from "vitest";
import { normalizeMathDelimiters } from "./normalizeMathDelimiters";

describe("normalizeMathDelimiters", () => {
  it("maps paired TeX inline and display delimiters without changing dollar math", () => {
    const source = [
      "行内 \\(a_t + b_t\\) 与 $c_t$。",
      "",
      "\\[",
      "q'_t = R_t q_t, \\qquad k'_s = R_s k_s",
      "\\]",
      "",
      "$$",
      "existing = true",
      "$$",
    ].join("\n");

    expect(normalizeMathDelimiters(source)).toBe(
      [
        "行内 $$a_t + b_t$$ 与 $c_t$。",
        "",
        "$$",
        "q'_t = R_t q_t, \\qquad k'_s = R_s k_s",
        "$$",
        "",
        "$$",
        "existing = true",
        "$$",
      ].join("\n"),
    );
  });

  it("promotes same-line square delimiters to a display block", () => {
    expect(normalizeMathDelimiters("之前 \\[x^2\\] 之后")).toBe(
      "之前 \n$$\nx^2\n$$\n 之后",
    );
  });

  it("does not consume unclosed or explicitly escaped delimiter text", () => {
    const source = String.raw`未闭合 \(x，字面量 \\(y\\)`;
    expect(normalizeMathDelimiters(source)).toBe(source);
  });

  it("protects code, HTML, links, images, definitions and existing math", () => {
    const source = [
      String.raw`外部 \(ok\)。`,
      "行内代码 `\\(literal\\)`。",
      "",
      "```md",
      String.raw`\[fenced\]`,
      "```",
      "",
      "    \\(indented\\)",
      "",
      String.raw`<span data-value="\(html\)">literal</span>`,
      "",
      String.raw`[link](https://example.test/\(path\))`,
      String.raw`![image](./\[asset\].png)`,
      String.raw`[ref]: https://example.test/\[definition\]`,
      "",
      String.raw`$\(already-dollar\)$`,
    ].join("\n");

    const normalized = normalizeMathDelimiters(source);
    expect(normalized).toContain("外部 $$ok$$。");
    expect(normalized).toContain("`\\(literal\\)`");
    expect(normalized).toContain(String.raw`\[fenced\]`);
    expect(normalized).toContain(String.raw`\(indented\)`);
    expect(normalized).toContain(String.raw`data-value="\(html\)"`);
    expect(normalized).toContain(String.raw`https://example.test/\(path\)`);
    expect(normalized).toContain(String.raw`./\[asset\].png`);
    expect(normalized).toContain(String.raw`https://example.test/\[definition\]`);
    expect(normalized).toContain(String.raw`$\(already-dollar\)$`);
  });
});
