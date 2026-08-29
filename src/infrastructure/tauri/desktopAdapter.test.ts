import { describe, expect, it } from "vitest";

import { DemoDesktopAdapter, isTauriRuntime } from "./desktopAdapter";

describe("desktop adapter environment", () => {
  it("uses a small explicit Tauri marker check", () => {
    expect(isTauriRuntime({})).toBe(false);
    expect(isTauriRuntime({ __TAURI_INTERNALS__: {} })).toBe(true);
  });
});

describe("browser demo adapter", () => {
  it("supports the same workspace/open/save shape without touching disk", async () => {
    const adapter = new DemoDesktopAdapter();
    const workspace = await adapter.pickWorkspace();
    const nodes = await adapter.listWorkspace(workspace.path);
    const firstNode = nodes[0];
    if (!firstNode) throw new Error("expected a demo document");
    const document = await adapter.openDocument(firstNode.path);

    expect(document.status).toBe("editable");
    if (document.status !== "editable") throw new Error("expected editable demo");

    await adapter.saveDocument(document.path, `${document.content}\n已编辑`);
    const reopened = await adapter.openDocument(document.path);
    expect(reopened.status === "editable" && reopened.content.endsWith("已编辑")).toBe(
      true,
    );
  });
});
