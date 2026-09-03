import { describe, expect, it } from "vitest";

import { codeFenceLanguagePrefix, matchingCodeFenceLanguages } from "./codeFenceCompletion";

describe("code fence language completion", () => {
  it("recognizes only a complete lowercase fence query", () => {
    expect(codeFenceLanguagePrefix("```pyt")).toBe("pyt");
    expect(codeFenceLanguagePrefix("```")).toBe("");
    expect(codeFenceLanguagePrefix("before ```py")).toBeNull();
    expect(codeFenceLanguagePrefix("```Python")).toBeNull();
    expect(codeFenceLanguagePrefix("```" + "a".repeat(33))).toBeNull();
  });

  it("matches common languages by name and alias", () => {
    expect(matchingCodeFenceLanguages("p").map(({ id }) => id)).toEqual(
      expect.arrayContaining(["python", "php", "perl", "pascal"]),
    );
    expect(matchingCodeFenceLanguages("py")[0]?.id).toBe("python");
    expect(matchingCodeFenceLanguages("js")[0]?.id).toBe("javascript");
    expect(matchingCodeFenceLanguages("not-a-language")).toEqual([]);
  });
});
