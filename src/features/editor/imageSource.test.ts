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

  it("resolves local file URLs and encoded filename characters without query fragments", () => {
    expect(markdownImagePath("/workspace/readme.md", "file:///tmp/a%20b.png#detail")).toBe(
      "/tmp/a b.png",
    );
    expect(
      markdownImagePath("file:///workspace/docs/readme.md", "../images/a%23b.svg?cache=1"),
    ).toBe("/workspace/images/a#b.svg");
    expect(
      markdownImagePath("/workspace/readme.md", "file://server/share/photo.png"),
    ).toBeNull();
    expect(markdownImagePath("C:\\notes\\readme.md", "..\\images\\photo.png")).toBe(
      "C:/images/photo.png",
    );
    expect(markdownImagePath("/workspace/readme.md", "C:\\images\\photo.png")).toBe(
      "C:/images/photo.png",
    );
    expect(markdownImagePath("/workspace/readme.md", "file:///C:/images/photo.png")).toBe(
      "C:/images/photo.png",
    );
  });
});
