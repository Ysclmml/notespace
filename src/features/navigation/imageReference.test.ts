import { beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({ enabled: false }));
const convertFileSrc = vi.hoisted(() =>
  vi.fn((path: string) => `asset://${encodeURIComponent(path)}`),
);
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => desktop.enabled,
  convertFileSrc,
}));

import { imageReferenceFromLink } from "./imageReference";

beforeEach(() => {
  desktop.enabled = false;
  convertFileSrc.mockClear();
});

describe("image links", () => {
  it.each(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico"])(
    "recognizes a %s link without requiring a line number",
    (extension) => {
      expect(
        imageReferenceFromLink(
          "/workspace/docs/guide.md",
          `../images/picture.${extension}`,
        ),
      ).toEqual({
        kind: "image",
        source: `/workspace/images/picture.${extension}`,
        title: `picture.${extension}`,
        reference: `../images/picture.${extension}`,
        documentPath: "/workspace/docs/guide.md",
      });
    },
  );

  it("decodes local Chinese/space paths once and keeps a supplied title", () => {
    expect(
      imageReferenceFromLink(
        "/workspace/docs/guide.md",
        "<../images/%E6%9E%B6%E6%9E%84%20%E5%9B%BE.PNG>",
        " 架构预览 ",
      ),
    ).toEqual({
      kind: "image",
      source: "/workspace/images/架构 图.PNG",
      title: "架构预览",
      reference: "../images/%E6%9E%B6%E6%9E%84%20%E5%9B%BE.PNG",
      documentPath: "/workspace/docs/guide.md",
    });
    expect(
      imageReferenceFromLink("/workspace/guide.md", "/tmp/100%25%20ready.svg"),
    ).toEqual({
      kind: "image",
      source: "/tmp/100% ready.svg",
      title: "100% ready.svg",
      reference: "/tmp/100%25%20ready.svg",
      documentPath: "/workspace/guide.md",
    });
    expect(
      imageReferenceFromLink("/workspace/guide.md", "assets/a%23b.png?cache=1#preview")
        ?.source,
    ).toBe("/workspace/assets/a#b.png");
  });

  it("converts absolute local paths and local file URLs through the Tauri asset protocol", () => {
    desktop.enabled = true;
    expect(
      imageReferenceFromLink("/workspace/guide.md", "file:///tmp/%E5%9B%BE%20%E7%89%87.svg")
        ?.source,
    ).toBe("asset://%2Ftmp%2F%E5%9B%BE%20%E7%89%87.svg");
    expect(convertFileSrc).toHaveBeenLastCalledWith("/tmp/图 片.svg");
    expect(
      imageReferenceFromLink("/workspace/guide.md", "file://localhost/tmp/icon.ico")?.title,
    ).toBe("icon.ico");
    expect(convertFileSrc).toHaveBeenLastCalledWith("/tmp/icon.ico");
    expect(
      imageReferenceFromLink("C:\\notes\\guide.md", "..\\images\\photo.jpg")?.title,
    ).toBe("photo.jpg");
    expect(convertFileSrc).toHaveBeenLastCalledWith("C:/images/photo.jpg");
  });

  it("recognizes HTTP(S) image paths while preserving their query and fragment", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(
      imageReferenceFromLink(
        "/workspace/guide.md",
        "https://example.test/images/%E6%B5%81%E7%A8%8B%20%E5%9B%BE.webp?raw=1#detail",
      ),
    ).toEqual({
      kind: "image",
      source:
        "https://example.test/images/%E6%B5%81%E7%A8%8B%20%E5%9B%BE.webp?raw=1#detail",
      title: "流程 图.webp",
      reference:
        "https://example.test/images/%E6%B5%81%E7%A8%8B%20%E5%9B%BE.webp?raw=1#detail",
      documentPath: "/workspace/guide.md",
    });
    expect(
      imageReferenceFromLink("/workspace/guide.md", "http://example.test/icon.AVIF?v=2")
        ?.title,
    ).toBe("icon.AVIF");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(convertFileSrc).not.toHaveBeenCalled();
  });

  it.each([
    "javascript:alert('image.svg')",
    "data:image/svg+xml,icon.svg",
    "blob:https://example.test/a.png",
    "%6aavascript:icon.png",
    "mailto:photo.png",
    "#diagram.svg",
    "//example.test/picture.png",
    "file://remote-host/share/picture.png",
    "https://[bad-url/image.png",
    "https://example.test/download?name=picture.png",
    "notes.md",
    "worker.py:21",
    "image.png:12",
    "assets/page.html",
    "assets/picture.png\u0000",
  ])("does not treat %s as an image preview", (target) => {
    expect(imageReferenceFromLink("/workspace/guide.md", target)).toBeNull();
  });
});
