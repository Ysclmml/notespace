import { describe, expect, it } from "vitest";
import { sourcePositionAtLine } from "./sourcePositionAtLine";

describe("sourcePositionAtLine", () => {
  it("uses one-based lines and UTF-16 columns with CJK and emoji", () => {
    expect(sourcePositionAtLine("标题\n😀中文 hello\n", 2, 5)).toBe(7);
  });
  it("clamps stale results to the current line or document", () => {
    expect(sourcePositionAtLine("a\nb", 20, 10)).toBe(3);
    expect(sourcePositionAtLine("a\nb", 1, 20)).toBe(1);
    expect(sourcePositionAtLine("", 0, 0)).toBe(0);
  });
});
