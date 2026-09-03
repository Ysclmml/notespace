import { describe, expect, it } from "vitest";

import { mergeCompositionChange, sharedTextChange } from "./sharedTextChange";

describe("shared text changes", () => {
  it("keeps unchanged text out of a bounded replacement", () => {
    expect(sharedTextChange("first\nold\nlast", "first\nnew\nlast")).toEqual({
      from: 6,
      to: 9,
      insert: "new",
    });
    expect(sharedTextChange("same", "same")).toBeNull();
    expect(sharedTextChange("ab", "axb")).toEqual({ from: 1, to: 1, insert: "x" });
    expect(sharedTextChange("axb", "ab")).toEqual({ from: 1, to: 2, insert: "" });
    expect(sharedTextChange("", "中文")).toEqual({ from: 0, to: 0, insert: "中文" });
  });

  it("never splits changed emoji surrogate pairs", () => {
    expect(sharedTextChange("a😀b", "a😃b")).toEqual({ from: 1, to: 3, insert: "😃" });
    expect(sharedTextChange("a😀b", "a𠀀b")).toEqual({ from: 1, to: 3, insert: "𠀀" });
  });

  it("merges a deferred IME draft with a disjoint shared edit", () => {
    expect(mergeCompositionChange("one\ntwo", "one\n中文two", "new one\ntwo")).toBe(
      "new one\n中文two",
    );
    expect(mergeCompositionChange("one\ntwo", "中文one\ntwo", "one\nnew two")).toBe(
      "中文one\nnew two",
    );
    expect(mergeCompositionChange("one", "one", "new one")).toBe("new one");
    expect(mergeCompositionChange("one", "中文one", "one")).toBe("中文one");
    expect(mergeCompositionChange("ab", "Ab", "a新b")).toBe("A新b");
    expect(mergeCompositionChange("ab", "aB", "新b")).toBe("新B");
  });

  it("uses the active IME draft for an overlapping replacement", () => {
    expect(mergeCompositionChange("a old z", "a 中文 z", "a remote z")).toBe("a 中文 z");
    expect(mergeCompositionChange("a", "中文a", "remote a")).toBe("remote 中文a");
    expect(mergeCompositionChange("a", "中文a", "中文a")).toBe("中文a");
  });
});
