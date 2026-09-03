import { describe, expect, it, vi } from "vitest";

import { createMermaidPreviewController } from "./mermaidPreview";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Mermaid preview controller", () => {
  it("ignores an older async result and keeps viewer source aligned with the visible graph", async () => {
    const root = document.createElement("div");
    const oldRender = deferred<string>();
    const newRender = deferred<string>();
    const renderSvg = vi
      .fn<(source: string) => Promise<string>>()
      .mockReturnValueOnce(oldRender.promise)
      .mockReturnValueOnce(newRender.promise);
    const preview = createMermaidPreviewController(root, () => false, renderSvg);

    const oldMarkup = preview.renderPreview("mermaid", "old --> graph");
    if (!oldMarkup) throw new Error("Old Mermaid preview was not created");
    root.innerHTML = oldMarkup;

    const newMarkup = preview.renderPreview("mermaid", "new --> graph");
    if (!newMarkup) throw new Error("New Mermaid preview was not created");
    root.innerHTML = newMarkup;

    newRender.resolve("<svg><text>new graph</text></svg>");
    await flushPromises();
    const button = root.querySelector<HTMLButtonElement>("button[data-visual-mermaid-id]");
    expect(root).toHaveTextContent("new graph");
    if (!button) throw new Error("Current Mermaid viewer button was not created");
    expect(preview.sourceFor(button)).toBe("new --> graph");

    oldRender.resolve("<svg><text>stale graph</text></svg>");
    await flushPromises();
    expect(root).toHaveTextContent("new graph");
    expect(root).not.toHaveTextContent("stale graph");
    preview.dispose();
  });

  it("waits for a delayed heavy-document mount and cancels pending observers", async () => {
    const root = document.createElement("div");
    const render = deferred<string>();
    const preview = createMermaidPreviewController(
      root,
      () => false,
      () => render.promise,
    );
    const markup = preview.renderPreview("mermaid", "slow --> document");
    if (!markup) throw new Error("Mermaid preview was not created");

    render.resolve("<svg><text>mounted later</text></svg>");
    await flushPromises();
    expect(root).toBeEmptyDOMElement();

    root.innerHTML = markup;
    await flushPromises();
    expect(root).toHaveTextContent("mounted later");
    preview.dispose();

    const cancelledRoot = document.createElement("div");
    const cancelledRender = deferred<string>();
    const cancelledPreview = createMermaidPreviewController(
      cancelledRoot,
      () => false,
      () => cancelledRender.promise,
    );
    const cancelledMarkup = cancelledPreview.renderPreview("mermaid", "cancelled");
    if (!cancelledMarkup) throw new Error("Cancelable preview was not created");
    cancelledRender.resolve("<svg><text>must not mount</text></svg>");
    await flushPromises();
    cancelledPreview.dispose();
    cancelledRoot.innerHTML = cancelledMarkup;
    await flushPromises();
    expect(cancelledRoot).toHaveTextContent("正在渲染图表");
    expect(cancelledRoot).not.toHaveTextContent("must not mount");
  });

  it("uses the active locale for loading, failure, and viewer actions", async () => {
    const root = document.createElement("div");
    const preview = createMermaidPreviewController(
      root,
      () => false,
      async () => "<svg><text>diagram</text></svg>",
      {
        open: "Zoom diagram",
        renderFailed: "Diagram rendering failed",
        rendering: "Rendering diagram…",
      },
    );

    const markup = preview.renderPreview("mermaid", "flowchart LR");
    if (!markup) throw new Error("Mermaid preview was not created");
    expect(markup).toContain("Rendering diagram…");
    root.innerHTML = markup;
    await flushPromises();
    expect(root).toHaveTextContent("Zoom diagram");
    preview.dispose();

    const errorRoot = document.createElement("div");
    const errorPreview = createMermaidPreviewController(
      errorRoot,
      () => false,
      () => Promise.reject("failed"),
      {
        open: "Zoom diagram",
        renderFailed: "Diagram rendering failed",
        rendering: "Rendering diagram…",
      },
    );
    const errorMarkup = errorPreview.renderPreview("mermaid", "invalid");
    if (!errorMarkup) throw new Error("Mermaid error preview was not created");
    errorRoot.innerHTML = errorMarkup;
    await flushPromises();
    expect(errorRoot).toHaveTextContent("Diagram rendering failed");
    errorPreview.dispose();
  });
});
