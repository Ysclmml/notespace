import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HighlightMatches } from "./SearchHighlight";
import { findHighlightRanges, findRegexHighlightRange } from "./highlightRanges";

describe("workspace result highlighting", () => {
  it("finds all visible non-overlapping occurrences with matching case", () => {
    expect(findHighlightRanges("Alpha alpha ALPHA", "alpha", true)).toEqual([[6, 11]]);
    expect(findHighlightRanges("Alpha alpha ALPHA", "alpha", false)).toEqual([
      [0, 5],
      [6, 11],
      [12, 17],
    ]);
    expect(findHighlightRanges("aaaa", "aa", true)).toEqual([[0, 4]]);
    expect(findHighlightRanges("text", "", false)).toEqual([]);
  });

  it("maps Unicode lowercasing expansions back to complete original characters", () => {
    expect(findHighlightRanges("😀 İx 中文", "i", false)).toEqual([[3, 4]]);
    expect(findHighlightRanges("İx", "i\u0307x", false)).toEqual([[0, 2]]);
    expect(findHighlightRanges("İx", "\u0307", false)).toEqual([[0, 1]]);
    expect(findHighlightRanges("😀 中文 文", "中文", false)).toEqual([[3, 5]]);
  });

  it("uses the backend's per-character fold, including final Greek sigma", () => {
    expect(findHighlightRanges("ΟΣ ος οσ", "οσ", false)).toEqual([
      [0, 2],
      [6, 8],
    ]);
    expect(findHighlightRanges("ΟΣ ος οσ", "ος", false)).toEqual([[3, 5]]);
  });

  it("renders literal strings without executing or interpreting markup", () => {
    const text = '<img src=x onerror="alert(1)"> 中文 & <script>bad()</script>';
    const { container } = render(
      <div>
        <HighlightMatches text={text} query="img" caseSensitive={false} />
      </div>,
    );
    expect(container.textContent).toBe(text);
    expect(container.querySelectorAll("mark")).toHaveLength(1);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("uses native UTF-16 offsets for variable-length and native-only regex results", () => {
    expect(findRegexHighlightRange("before a123z after", 7, 12)).toEqual([[7, 12]]);
    expect(findRegexHighlightRange("😀😀 rest", 0, 4)).toEqual([[0, 4]]);
    const { container } = render(
      <HighlightMatches
        text="prefix item-2048 suffix"
        query={"(?P<native>item-\\d+)"}
        caseSensitive={true}
        regexMatchRange={[7, 16]}
      />,
    );
    expect(container.querySelector("mark")).toHaveTextContent("item-2048");
  });

  it("renders plain text for invalid, zero-length, or out-of-bounds regex metadata", () => {
    expect(findRegexHighlightRange("text", NaN, 2)).toEqual([]);
    expect(findRegexHighlightRange("text", 0, 0)).toEqual([]);
    expect(findRegexHighlightRange("text", 0, 99)).toEqual([]);
    expect(findRegexHighlightRange("text", -1, 2)).toEqual([]);
    expect(findRegexHighlightRange("text", 0.5, 2)).toEqual([]);
    const text = "<script>still text</script> $&";
    const { container } = render(
      <HighlightMatches
        text={text}
        query="(?P<native>text)"
        caseSensitive={false}
        regexMatchRange={[NaN, NaN]}
      />,
    );
    expect(container.textContent).toBe(text);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("mark")).toBeNull();
  });

  it("draws truncated results for a backtracking regex without executing it", () => {
    const text = `…${"a".repeat(59)} MATCH`;
    const { container } = render(
      <HighlightMatches
        text={text}
        query="(a+)+b|MATCH"
        caseSensitive
        regexMatchRange={[61, 66]}
      />,
    );
    expect(container.textContent).toBe(text);
    expect(container.querySelector("mark")?.textContent).toBe("MATCH");
  });
});
