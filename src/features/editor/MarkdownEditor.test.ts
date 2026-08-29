import { describe, expect, it } from "vitest";

import { isOversizedInlineImagePaste, LARGE_PASTE_TEXT_THRESHOLD } from "./pasteGuard";

describe("large inline-image paste guard", () => {
  it("rejects only a large text paste containing a data image marker", () => {
    const payload = "data:image/png;base64," + "A".repeat(LARGE_PASTE_TEXT_THRESHOLD + 1);

    expect(isOversizedInlineImagePaste(payload)).toBe(true);
    expect(isOversizedInlineImagePaste("A".repeat(LARGE_PASTE_TEXT_THRESHOLD + 1))).toBe(
      false,
    );
    expect(isOversizedInlineImagePaste("data:image/png;base64,AAAA")).toBe(false);
  });

  it("recognizes the marker without depending on casing", () => {
    const payload = "DATA:IMAGE/PNG;BASE64," + "A".repeat(LARGE_PASTE_TEXT_THRESHOLD + 1);
    expect(isOversizedInlineImagePaste(payload)).toBe(true);
  });
});
