import { beforeEach, describe, expect, it, vi } from "vitest";

const { convertFileSrc, invoke, isTauri } = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost${path}`),
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
}));

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc, invoke, isTauri }));

import {
  markdownImagePath,
  prepareMarkdownImageSource,
  resolveMarkdownImageSource,
} from "./imageSource";

beforeEach(() => {
  convertFileSrc.mockClear();
  invoke.mockReset();
  isTauri.mockReturnValue(false);
});

describe("Markdown image preparation", () => {
  it("prepares only the concrete local image before converting its canonical path", async () => {
    isTauri.mockReturnValue(true);
    let finish!: (path: string) => void;
    invoke.mockReturnValue(new Promise<string>((resolve) => (finish = resolve)));
    const prepared = prepareMarkdownImageSource(
      "/workspace/docs/readme.md",
      "../images/a%20b%23c.png?cache=1#detail",
    );
    expect(invoke).toHaveBeenCalledExactlyOnceWith("prepare_local_image", {
      path: "/workspace/images/a b#c.png",
    });
    expect(convertFileSrc).not.toHaveBeenCalled();
    finish("/canonical/pictures/a b#c.png");
    await expect(prepared).resolves.toBe("asset://localhost/canonical/pictures/a b#c.png");
    expect(convertFileSrc).toHaveBeenCalledExactlyOnceWith("/canonical/pictures/a b#c.png");
  });

  it.each([
    ["file:///pictures/a%20b.svg", "/pictures/a b.svg"],
    ["C:\\pictures\\photo.png", "C:/pictures/photo.png"],
    ["/pictures/photo.jpg", "/pictures/photo.jpg"],
  ])(
    "prepares the normalized local target %s without widening access",
    async (target, path) => {
      isTauri.mockReturnValue(true);
      invoke.mockResolvedValue(path);
      await expect(
        prepareMarkdownImageSource("/workspace/readme.md", target),
      ).resolves.toBe(`asset://localhost${path}`);
      expect(invoke).toHaveBeenCalledExactlyOnceWith("prepare_local_image", { path });
    },
  );

  it("propagates local image preparation failure without exposing an unprepared asset URL", async () => {
    isTauri.mockReturnValue(true);
    const error = new Error("Image is missing");
    invoke.mockRejectedValue(error);
    await expect(
      prepareMarkdownImageSource("/workspace/readme.md", "./missing.png"),
    ).rejects.toBe(error);
    expect(convertFileSrc).not.toHaveBeenCalled();
  });

  it.each([
    "https://example.test/a.png",
    "http://example.test/a.svg",
    "//example.test/photo.png",
    "data:image/png;base64,AA==",
    "blob:https://example.test/image",
    "asset://localhost/pictures/image.png",
    "file://server/share/photo.png",
  ])("does not access the host or fetch a nonlocal image %s", async (target) => {
    isTauri.mockReturnValue(true);
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      await expect(
        prepareMarkdownImageSource("/workspace/readme.md", target),
      ).resolves.toBe(target);
      expect(invoke).not.toHaveBeenCalled();
      expect(convertFileSrc).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it("keeps browser paths usable without invoking the desktop host", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      await expect(
        prepareMarkdownImageSource("/fixtures/docs/readme.md", "../images/a.png"),
      ).resolves.toBe("/fixtures/images/a.png");
      await expect(
        prepareMarkdownImageSource("demo://paper/readme.md", "assets/a.png"),
      ).resolves.toBe("assets/a.png");
      expect(invoke).not.toHaveBeenCalled();
      expect(convertFileSrc).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it("keeps synchronous resolution free of preparation IPC", () => {
    isTauri.mockReturnValue(true);
    expect(resolveMarkdownImageSource("/workspace/readme.md", "images/photo.png")).toBe(
      "asset://localhost/workspace/images/photo.png",
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});

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
