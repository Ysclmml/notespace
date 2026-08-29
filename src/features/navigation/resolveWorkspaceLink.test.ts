import { describe, expect, it } from "vitest";

import type { WorkspaceNode } from "../../infrastructure/tauri/desktopAdapter";
import { resolveWorkspaceLink } from "./resolveWorkspaceLink";

const tree: readonly WorkspaceNode[] = [
  { kind: "markdown", name: "index.md", path: "/notes/index.md", relativePath: "index.md" },
  {
    kind: "directory",
    name: "guide",
    path: "/notes/guide",
    relativePath: "guide",
    children: [
      {
        kind: "markdown",
        name: "next page.md",
        path: "/notes/guide/next page.md",
        relativePath: "guide/next page.md",
      },
    ],
  },
];

describe("workspace link resolution", () => {
  it("resolves decoded relative documents and anchors", () => {
    expect(
      resolveWorkspaceLink("/notes/index.md", "guide/next%20page.md#开始", tree),
    ).toEqual({ kind: "internal", path: "/notes/guide/next page.md", anchor: "开始" });
  });

  it("keeps same-document anchors and identifies external or missing targets", () => {
    expect(resolveWorkspaceLink("/notes/index.md", "#文档地图", tree)).toEqual({
      kind: "internal",
      path: "/notes/index.md",
      anchor: "文档地图",
    });
    expect(resolveWorkspaceLink("/notes/index.md", "https://example.com", tree)).toEqual({
      kind: "external",
      href: "https://example.com",
    });
    expect(resolveWorkspaceLink("/notes/index.md", "missing.md", tree).kind).toBe(
      "missing",
    );
  });
});
