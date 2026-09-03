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

function markdownNode(path: string, relativePath: string): WorkspaceNode {
  return { kind: "markdown", name: path.split("/").at(-1) ?? path, path, relativePath };
}

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
    expect(resolveWorkspaceLink("/notes/index.md", "missing", tree).kind).toBe("missing");
  });

  it("lets the reader open an explicit Markdown path missing from the tree", () => {
    expect(resolveWorkspaceLink("/notes/index.md", "missing.md", tree)).toEqual({
      kind: "internal",
      path: "/notes/missing.md",
      anchor: undefined,
    });
  });

  it("resolves standalone source documents without any workspace", () => {
    expect(
      resolveWorkspaceLink("/standalone/drafts/start.md", "../next.MARKDOWN", []),
    ).toEqual({
      kind: "internal",
      path: "/standalone/next.MARKDOWN",
      anchor: undefined,
    });
  });

  it("keeps relative links beside an unlisted source instead of another workspace", () => {
    expect(resolveWorkspaceLink("/standalone/start.md", "index.md", tree)).toEqual({
      kind: "internal",
      path: "/standalone/index.md",
      anchor: undefined,
    });
  });

  it("normalizes nested directories and parent traversal from the document directory", () => {
    expect(
      resolveWorkspaceLink("/notes/guide/start.md", "./drafts/../../index.md", tree),
    ).toEqual({
      kind: "internal",
      path: "/notes/index.md",
      anchor: undefined,
    });
  });

  it("can cross opened roots using a relative or absolute Markdown path", () => {
    const destination = markdownNode("/other/guide/next page.md", "guide/next page.md");
    const roots = [destination, ...tree];
    for (const target of ["../other/guide/next%20page.md", "/other/guide/next%20page.md"]) {
      expect(resolveWorkspaceLink("/notes/index.md", target, roots)).toEqual({
        kind: "internal",
        path: destination.path,
        anchor: undefined,
      });
    }
  });

  it("does not confuse identical relative paths in separate workspaces", () => {
    const roots = [markdownNode("/other/index.md", "index.md"), ...tree];
    expect(resolveWorkspaceLink("/notes/guide/start.md", "../index.md", roots)).toEqual({
      kind: "internal",
      path: "/notes/index.md",
      anchor: undefined,
    });
  });

  it("prefers an exact absolute path over legacy workspace-root-relative links", () => {
    const roots = [markdownNode("/guide/next page.md", "next page.md"), ...tree];
    expect(resolveWorkspaceLink("/notes/index.md", "/guide/next%20page.md", roots)).toEqual(
      {
        kind: "internal",
        path: "/guide/next page.md",
        anchor: undefined,
      },
    );
  });

  it("retains an observed root-relative link even when the source is not listed", () => {
    expect(
      resolveWorkspaceLink("/notes/unlisted/start.md", "/guide/next%20page.md", tree),
    ).toEqual({
      kind: "internal",
      path: "/notes/guide/next page.md",
      anchor: undefined,
    });
  });

  it("scopes legacy root-relative fallback to the source's longest matching root", () => {
    const roots = [
      markdownNode("/other/docs/next.md", "docs/next.md"),
      markdownNode("/notes/docs/next.md", "docs/next.md"),
      markdownNode("/notes/nested/docs/next.md", "docs/next.md"),
      ...tree,
    ];
    expect(resolveWorkspaceLink("/notes/nested/start.md", "/docs/next.md", roots)).toEqual({
      kind: "internal",
      path: "/notes/nested/docs/next.md",
      anchor: undefined,
    });
    expect(resolveWorkspaceLink("/standalone/start.md", "/docs/next.md", roots)).toEqual({
      kind: "internal",
      path: "/docs/next.md",
      anchor: undefined,
    });
  });

  it("resolves absolute paths with no source or open workspace", () => {
    expect(resolveWorkspaceLink("", "/standalone/notes.Md#heading", [])).toEqual({
      kind: "internal",
      path: "/standalone/notes.Md",
      anchor: "heading",
    });
    expect(resolveWorkspaceLink("", "notes.md", [])).toEqual({
      kind: "missing",
      target: "notes.md",
    });
  });

  it("decodes paths separately from fragments, preserving encoded punctuation", () => {
    expect(
      resolveWorkspaceLink(
        "/notes/index.md",
        "notes%20%23%3F%25.md?view=1#%E5%BC%80%E5%A7%8B#part",
        [],
      ),
    ).toEqual({
      kind: "internal",
      path: "/notes/notes #?%.md",
      anchor: "开始#part",
    });
  });

  it("tolerates literal percent signs without throwing or double decoding", () => {
    expect(resolveWorkspaceLink("/notes/index.md", "100%.md#bad%anchor", []).kind).toBe(
      "internal",
    );
    expect(resolveWorkspaceLink("/notes/index.md", "%2520.md", [])).toEqual({
      kind: "internal",
      path: "/notes/%20.md",
      anchor: undefined,
    });
  });

  it("keeps standalone and unsaved Markdown anchors on the current document", () => {
    for (const source of ["/standalone/start.md", "untitled://new.md"]) {
      expect(resolveWorkspaceLink(source, "#%E5%BC%80%E5%A7%8B", [])).toEqual({
        kind: "internal",
        path: source,
        anchor: "开始",
      });
    }
    expect(resolveWorkspaceLink("untitled://new.md", "other.md", []).kind).toBe("missing");
  });

  it("resolves local file URLs without treating them as workspace-root-relative", () => {
    for (const target of [
      "file:///guide/next%20page.md#part",
      "file://localhost/guide/next%20page.md#part",
    ]) {
      expect(resolveWorkspaceLink("/notes/index.md", target, tree)).toEqual({
        kind: "internal",
        path: "/guide/next page.md",
        anchor: "part",
      });
    }
    expect(resolveWorkspaceLink("file:///notes/index.md", "next.md", [])).toEqual({
      kind: "internal",
      path: "/notes/next.md",
      anchor: undefined,
    });
  });

  it("resolves Windows drive paths, backslash relatives and file URLs", () => {
    const source = "C:\\Notes\\guide\\start.md";
    for (const target of [
      "..\\Next.MD",
      "C:\\Notes\\Next.MD",
      "file:///C:/Notes/Next.MD",
    ]) {
      expect(resolveWorkspaceLink(source, target, [])).toEqual({
        kind: "internal",
        path: "C:/Notes/Next.MD",
        anchor: undefined,
      });
    }
  });

  it("uses a matching Windows node's original path identity", () => {
    const destination = markdownNode("C:\\Notes\\Guide\\Next.MD", "Guide\\Next.MD");
    expect(
      resolveWorkspaceLink("c:\\notes\\start.md", "guide/next.md", [destination]),
    ).toEqual({
      kind: "internal",
      path: destination.path,
      anchor: undefined,
    });
    expect(
      resolveWorkspaceLink("C:\\Notes\\start.md", "/Guide/Next.MD", [destination]),
    ).toEqual({
      kind: "internal",
      path: destination.path,
      anchor: undefined,
    });
  });

  it("preserves Windows UNC shares while normalizing parent segments", () => {
    for (const target of [
      "\\\\server\\share\\folder\\..\\next.md",
      "file://server/share/next.md",
    ]) {
      expect(resolveWorkspaceLink("", target, [])).toEqual({
        kind: "internal",
        path: "//server/share/next.md",
        anchor: undefined,
      });
    }
  });

  it("keeps extensionless aliases only when an actual Markdown node exists", () => {
    const nodes = [
      ...tree,
      markdownNode("/notes/manual.md", "manual.md"),
      markdownNode("/notes/manual/index.md", "manual/index.md"),
      markdownNode("/notes/tutorial/index.md", "tutorial/index.md"),
    ];
    expect(resolveWorkspaceLink("/notes/index.md", "manual", nodes)).toEqual({
      kind: "internal",
      path: "/notes/manual.md",
      anchor: undefined,
    });
    expect(resolveWorkspaceLink("/notes/index.md", "tutorial", nodes)).toEqual({
      kind: "internal",
      path: "/notes/tutorial/index.md",
      anchor: undefined,
    });
    expect(resolveWorkspaceLink("/notes/index.md", "missing", nodes).kind).toBe("missing");
    expect(resolveWorkspaceLink("/standalone/start.md", "manual", nodes).kind).toBe(
      "missing",
    );
  });

  it("retains existing demo workspace navigation without accepting arbitrary schemes", () => {
    const nodes = [markdownNode("demo://notes/guide/next.md", "guide/next.md")];
    expect(resolveWorkspaceLink("demo://notes/index.md", "guide/next.md", nodes)).toEqual({
      kind: "internal",
      path: "demo://notes/guide/next.md",
      anchor: undefined,
    });
  });

  it.each(["code.py", "code.json", "code.rs", "code.txt", "code.md.py", "code.py#part"])(
    "does not interpret explicit non-Markdown target %s as a Markdown alias",
    (target) => {
      const nodes = [
        markdownNode("/notes/code.py.md", "code.py.md"),
        markdownNode("/notes/code.json/index.md", "code.json/index.md"),
      ];
      expect(resolveWorkspaceLink("/notes/index.md", target, nodes)).toEqual({
        kind: "missing",
        target,
      });
    },
  );

  it.each([
    "https://example.com/notes.md",
    "HTTP://example.com/notes.MD#part",
    "mailto:notes.md@example.com",
  ])("keeps %s external even when the address contains a Markdown extension", (target) => {
    expect(resolveWorkspaceLink("/notes/index.md", target, tree)).toEqual({
      kind: "external",
      href: target,
    });
  });

  it.each([
    "javascript:notes.md",
    "data:text/plain,notes.md",
    "ftp://example.com/notes.md",
    "https%3A//example.com/notes.md",
    "//example.com/notes.md",
    "C:relative.md",
    "notes%00.md",
    "notes\u0000.md",
    "file://[invalid]/notes.md",
  ])("rejects unsupported or malformed local target %s without throwing", (target) => {
    expect(resolveWorkspaceLink("/notes/index.md", target, tree)).toEqual({
      kind: "missing",
      target,
    });
  });

  it("never invents a current Markdown document for empty targets or text-only anchors", () => {
    expect(resolveWorkspaceLink("/notes/index.md", "", tree).kind).toBe("missing");
    expect(resolveWorkspaceLink("/notes/code.py", "#part", tree).kind).toBe("missing");
  });
});
