import { describe, expect, it } from "vitest";

import {
  findRecentDocument,
  normalizeMobileLocalState,
  updateRecentDocument,
} from "./storage";
import type { MobileLocalState } from "./types";

const position = { progress: 0.4, scrollTop: 320, updatedAt: "2026-09-04T10:00:00Z" };

describe("mobile local reader state", () => {
  it("migrates a restarted document and its position without duplicating a stable recent entry", () => {
    const previous = {
      computerId: "computer-a",
      documentId: "old-document",
      title: "说明",
      relativePath: "设计/说明.md",
      workspaceName: "工作区",
      workspaceSyncKey: "stable-key",
      position,
    };
    const state = updateRecentDocument({ positions: {}, recentDocuments: [] }, previous);
    const document = {
      id: "new-document",
      workspaceId: "new-workspace",
      workspaceName: "工作区",
      title: "说明",
      relativePath: "设计/说明.md",
      markdown: "# 说明",
    };
    expect(findRecentDocument(state, "computer-a", document, "stable-key", false)).toEqual(
      previous,
    );
    expect(
      findRecentDocument(state, "computer-a", document, "other-key", false),
    ).toBeUndefined();
    const migrated = updateRecentDocument(state, { ...previous, documentId: document.id });
    expect(migrated.recentDocuments).toHaveLength(1);
    expect(migrated.positions["computer-a:new-document"]).toEqual(position);
    expect(migrated.positions["computer-a:old-document"]).toBeUndefined();
    expect(normalizeMobileLocalState(migrated)).toEqual(migrated);
  });
  it("moves a reopened document to the front and keeps the list bounded", () => {
    let state: MobileLocalState = { positions: {}, recentDocuments: [] };
    for (let index = 0; index < 35; index += 1) {
      state = updateRecentDocument(state, {
        computerId: "computer-a",
        documentId: `document-${index}`,
        title: `文档 ${index}`,
        relativePath: `${index}.md`,
        workspaceName: "工作区",
        position,
      });
    }
    state = updateRecentDocument(state, {
      computerId: "computer-a",
      documentId: "document-20",
      title: "再次打开",
      relativePath: "20.md",
      workspaceName: "工作区",
      position,
    });

    expect(state.recentDocuments).toHaveLength(30);
    expect(state.recentDocuments[0]?.title).toBe("再次打开");
    expect(
      state.recentDocuments.filter(({ documentId }) => documentId === "document-20"),
    ).toHaveLength(1);
    expect(Object.keys(state.positions)).toHaveLength(30);
  });

  it("drops malformed persisted values rather than breaking the reader", () => {
    expect(
      normalizeMobileLocalState({
        positions: {
          "computer-a:valid": position,
          broken: { progress: 8, scrollTop: -1 },
        },
        recentDocuments: [
          {
            computerId: "computer-a",
            documentId: "valid",
            title: "文档",
            relativePath: "文档.md",
            workspaceName: "工作区",
            position,
          },
          { documentId: "broken" },
        ],
      }),
    ).toEqual({
      positions: { "computer-a:valid": position },
      recentDocuments: [
        {
          computerId: "computer-a",
          documentId: "valid",
          title: "文档",
          relativePath: "文档.md",
          workspaceName: "工作区",
          position,
        },
      ],
    });
  });

  it("keeps identical opaque document ids isolated per paired computer", () => {
    let state: MobileLocalState = { positions: {}, recentDocuments: [] };
    state = updateRecentDocument(state, {
      computerId: "computer-a",
      documentId: "shared-id",
      title: "电脑 A",
      relativePath: "a.md",
      workspaceName: "A",
      position,
    });
    state = updateRecentDocument(state, {
      computerId: "computer-b",
      documentId: "shared-id",
      title: "电脑 B",
      relativePath: "b.md",
      workspaceName: "B",
      position: { ...position, progress: 0.8 },
    });

    expect(state.recentDocuments).toHaveLength(2);
    expect(state.positions["computer-a:shared-id"]?.progress).toBe(0.4);
    expect(state.positions["computer-b:shared-id"]?.progress).toBe(0.8);
  });
});
