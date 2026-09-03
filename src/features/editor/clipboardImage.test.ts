import { describe, expect, it, vi } from "vitest";

import { clipboardImagePasteKind } from "./clipboardImage";

function clipboardData(
  representations: {
    readonly items?: readonly { type: string; kind?: string; getAsFile?: () => null }[];
    readonly files?: readonly { type: string; name?: string }[];
    readonly types?: readonly string[];
    readonly text?: Readonly<Record<string, string | undefined>>;
  } = {},
): DataTransfer {
  return {
    items: representations.items ?? [],
    files: representations.files ?? [],
    types: representations.types ?? [],
    getData: (type: string) => representations.text?.[type] ?? "",
  } as unknown as DataTransfer;
}

describe("clipboard image representation detection", () => {
  it.each(["image/png", "image/tiff", "image/jpeg", "image/webp"])(
    "accepts %s items without asking WebKit for their file bytes",
    (type) => {
      const getAsFile = vi.fn(() => null);
      expect(
        clipboardImagePasteKind(
          clipboardData({ items: [{ kind: "file", type, getAsFile }] }),
        ),
      ).toBe("image");
      expect(getAsFile).not.toHaveBeenCalled();
    },
  );

  it.each(["image/png", "image/tiff"])("accepts files-only and types-only %s", (type) => {
    expect(clipboardImagePasteKind(clipboardData({ files: [{ type }] }))).toBe("image");
    expect(clipboardImagePasteKind(clipboardData({ types: [type] }))).toBe("image");
  });

  it("allows a native fallback for WebKit Files-only or empty payloads", () => {
    expect(clipboardImagePasteKind(clipboardData({ types: ["Files"] }))).toBe(
      "native-fallback",
    );
    expect(clipboardImagePasteKind(clipboardData())).toBe("native-fallback");
    expect(clipboardImagePasteKind(null)).toBe(null);
  });

  it.each([
    {
      types: ["image/png"],
      text: { "text/html": '<img src="file:///fixtures/capture.png">' },
    },
    {
      types: ["image/png"],
      text: {
        "text/html":
          '<html><body><!--StartFragment--><div><img src="file:///fixtures/capture.png"></div><!--EndFragment--></body></html>',
      },
    },
    {
      types: ["image/png"],
      text: {
        "text/plain": "\n\uFFFC\n",
        "text/html": '<p><img src="file:///fixtures/capture.png"></p>',
      },
    },
    { types: ["image/png"], items: [{ kind: "file", type: "" }] },
    {
      files: [{ type: "image/png", name: "capture.png" }],
      items: [{ kind: "file", type: "" }],
    },
    { files: [{ type: "", name: "capture.PNG" }], items: [{ kind: "file", type: "" }] },
  ])(
    "recognizes screenshot metadata without treating an image-only representation as text ($types)",
    (representations) => {
      expect(clipboardImagePasteKind(clipboardData(representations))).toBe("image");
    },
  );

  it.each(["text/plain", "text/html", "text/uri-list"])(
    "does not intercept mixed image and %s content",
    (type) => {
      expect(
        clipboardImagePasteKind(
          clipboardData({ types: ["image/png", type], text: { [type]: "copied content" } }),
        ),
      ).toBe(null);
    },
  );

  it.each([
    '<p>A caption<img src="file:///fixtures/capture.png"></p>',
    '<img src="file:///fixtures/one.png"><img src="file:///fixtures/two.png">',
    '<iframe src="https://example.invalid/"></iframe><img src="file:///fixtures/capture.png">',
    '<input value="preserve"><img src="file:///fixtures/capture.png">',
  ])("keeps rich HTML or multiple images on the normal paste path", (html) => {
    expect(
      clipboardImagePasteKind(
        clipboardData({ types: ["image/png"], text: { "text/html": html } }),
      ),
    ).toBe(null);
  });

  it("does not turn HTML-only images or copied filenames into native clipboard images", () => {
    expect(
      clipboardImagePasteKind(
        clipboardData({
          text: { "text/html": '<img src="https://example.invalid/capture.png">' },
        }),
      ),
    ).toBe(null);
    expect(
      clipboardImagePasteKind(
        clipboardData({ types: ["image/png"], text: { "text/plain": "capture.png" } }),
      ),
    ).toBe(null);
    expect(
      clipboardImagePasteKind(
        clipboardData({ files: [{ type: "", name: "notes.txt" }], types: ["image/png"] }),
      ),
    ).toBe(null);
  });

  it("preserves ordinary text, HTML, unsupported types and copied non-image files", () => {
    expect(clipboardImagePasteKind(clipboardData({ types: ["text/plain"] }))).toBe(null);
    expect(clipboardImagePasteKind(clipboardData({ types: ["text/html"] }))).toBe(null);
    expect(clipboardImagePasteKind(clipboardData({ types: ["application/pdf"] }))).toBe(
      null,
    );
    expect(
      clipboardImagePasteKind(
        clipboardData({ files: [{ type: "image/png" }, { type: "text/plain" }] }),
      ),
    ).toBe(null);
    expect(
      clipboardImagePasteKind(
        clipboardData({ items: [{ type: "application/pdf", kind: "file" }] }),
      ),
    ).toBe(null);
    expect(clipboardImagePasteKind(clipboardData({ files: [{ type: "" }] }))).toBe(null);
  });
});
