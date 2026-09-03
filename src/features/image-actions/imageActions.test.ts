import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyLoadedImage,
  imageMarkdownReference,
  isAssetImageSource,
  isSupportedImageAddress,
  resolveImageActionTarget,
} from "./imageActions";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function fixtureImage(reference = "../assets/流程 图.svg") {
  const surface = document.createElement("div");
  surface.className = "ProseMirror";
  const image = document.createElement("img");
  image.src = "/fixtures/assets/流程 图.svg";
  image.dataset.visualImageSource = "asset://localhost/fixtures/assets/flow.svg";
  image.dataset.visualImageReference = reference;
  image.dataset.visualImageDocument = "/fixtures/docs/guide.md";
  image.alt = "图 [1]";
  image.title = "原图";
  surface.append(image);
  document.body.append(surface);
  return image;
}

describe("image context targets and references", () => {
  it("uses original Markdown metadata, not the asset URL or text selection", () => {
    const image = fixtureImage();
    expect(resolveImageActionTarget(image)).toEqual({
      kind: "image",
      element: image,
      source: image.dataset.visualImageSource,
      reference: "../assets/流程 图.svg",
      documentPath: "/fixtures/docs/guide.md",
      localPath: "/fixtures/assets/流程 图.svg",
      alt: "图 [1]",
      title: "原图",
      editable: true,
    });
  });
  it("recognizes Mermaid SVG descendants without inventing a file or editable image node", () => {
    const preview = document.createElement("section");
    preview.className = "visual-mermaid-preview";
    preview.innerHTML = "<svg><g><text>Diagram</text></g></svg>";
    document.body.append(preview);
    expect(resolveImageActionTarget(preview.querySelector("text"))).toEqual({
      kind: "mermaid",
      element: preview,
      source: "",
      alt: "",
      title: "",
      editable: false,
    });
  });
  it("keeps addresses for unloaded ordinary SVG images and omits remote file-manager paths", () => {
    const image = document.createElement("img");
    image.src = "https://example.test/diagram.svg";
    expect(image.currentSrc).toBe("");
    expect(resolveImageActionTarget(image)).toMatchObject({
      source: "https://example.test/diagram.svg",
      reference: "https://example.test/diagram.svg",
      editable: false,
      localPath: undefined,
    });
  });
  it("resolves absolute paths in untitled documents without inventing relative parents", () => {
    const image = fixtureImage("./relative.png");
    image.dataset.visualImageDocument = "untitled://note.md";
    expect(resolveImageActionTarget(image)?.localPath).toBeUndefined();
    image.dataset.visualImageReference = "file:///fixtures/photo.png";
    expect(resolveImageActionTarget(image)?.localPath).toBe("/fixtures/photo.png");
  });
  it("escapes reference Markdown without interpreting entities or backslash punctuation", () => {
    const image = fixtureImage("C:\\img\\(test)&amp;b.png");
    image.alt = "[label]&amp;";
    image.title = 'A "title" &amp;';
    const target = resolveImageActionTarget(image)!;
    expect(imageMarkdownReference(target)).toBe(
      '![\\[label\\]&amp;amp;](<C:\\\\img\\\\(test)&amp;amp;b.png> "A \\"title\\" &amp;amp;")',
    );
  });
  it.each([
    "../assets/图.png",
    "/fixtures/photo.svg",
    "file:///fixtures/a.png",
    "C:\\photos\\a.jpg",
    "https://example.test/image?id=1",
  ])("accepts an explicit supported reference: %s", (source) => {
    expect(isSupportedImageAddress(source)).toBe(true);
  });
  it.each([
    "",
    "javascript:alert(1)",
    "data:image/png;base64,abc",
    "blob:abc",
    "//example.test/x.png",
    "#node",
    "https://",
    "./bad\nimage.png",
  ])("rejects an unusable address without probing: %s", (source) => {
    expect(isSupportedImageAddress(source)).toBe(false);
  });
  it("rejects oversized embedded data before an editor transaction", () => {
    expect(
      isSupportedImageAddress("data:image/png;base64," + "A".repeat(1024 * 1024)),
    ).toBe(false);
  });
  it("only requests CORS for Tauri asset images, never changes remote loading", () => {
    expect(isAssetImageSource("asset://localhost/fixtures/a.png")).toBe(true);
    expect(isAssetImageSource("http://asset.localhost/fixtures/a.png")).toBe(true);
    expect(isAssetImageSource("https://example.test/a.png")).toBe(false);
  });
});

describe("copying decoded image pixels", () => {
  function loadedImage() {
    const image = document.createElement("img");
    Object.defineProperties(image, {
      complete: { value: true },
      naturalWidth: { value: 30 },
      naturalHeight: { value: 20 },
    });
    return image;
  }
  it("writes a promised PNG in the user gesture using only the loaded image", async () => {
    const image = loadedImage();
    const drawImage = vi.fn();
    const write = vi.fn(async () => undefined);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    let data: Record<string, Blob | Promise<Blob>> | undefined;
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(value: Record<string, Blob | Promise<Blob>>) {
          data = value;
        }
      },
    );
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    let encode: BlobCallback | undefined;
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      encode = callback;
    });
    const copying = copyLoadedImage(image);
    expect(write).toHaveBeenCalledOnce(); // Before asynchronous encoding resolves.
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0);
    const blob = new Blob(["synthetic png"], { type: "image/png" });
    encode?.(blob);
    await expect(data?.["image/png"]).resolves.toBe(blob);
    await expect(copying).resolves.toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reports unloaded, unsupported and tainted images as failures without copying text", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await expect(copyLoadedImage(document.createElement("img"))).resolves.toBe(false);
    await expect(copyLoadedImage(loadedImage())).resolves.toBe(false);
    vi.stubGlobal("ClipboardItem", class {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: vi.fn(), writeText },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage() {
        throw new DOMException("Tainted canvas", "SecurityError");
      },
    } as unknown as CanvasRenderingContext2D);
    await expect(copyLoadedImage(loadedImage())).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});
