import { describe, expect, it } from "vitest";

import { markdownImagePath, resolveMarkdownImageSource } from "./imageSource";

describe("Markdown image source", () => {
  it("resolves adjacent assets without rewriting external URLs", () => {
    expect(markdownImagePath("/workspace/guide/readme.md", "../assets/a%20b.png")).toBe(
      "/workspace/assets/a b.png",
    );
    expect(markdownImagePath("/workspace/readme.md", "https://example.com/a.png")).toBe(
      null,
    );
    expect(resolveMarkdownImageSource("/workspace/readme.md", "https://x/a.png")).toBe(
      "https://x/a.png",
    );
  });

  it("does not turn browser demo paths into local filesystem assets", () => {
    expect(markdownImagePath("demo://paper/readme.md", "assets/a.png")).toBeNull();
    expect(resolveMarkdownImageSource("demo://paper/readme.md", "assets/a.png")).toBe(
      "assets/a.png",
    );
  });
});
