import { describe, expect, it } from "vitest";

import { enUS, translate, zhCN } from "./translations";

describe("translations", () => {
  it("uses the localized NoteSpace product name", () => {
    expect(translate("zh-CN", "app.name")).toBe("笔记空间");
    expect(translate("en-US", "app.name")).toBe("NoteSpace");
  });

  it("keeps Chinese and English dictionaries complete", () => {
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it("interpolates typed values", () => {
    expect(translate("zh-CN", "sidebar.documents", { count: 79 })).toBe("79 篇文档");
    expect(translate("en-US", "status.saved", { name: "notes.md" })).toBe("notes.md saved");
    expect(translate("zh-CN", "closeConfirm.windowMessage", { count: 2 })).toContain(
      "2 个文件",
    );
    expect(translate("en-US", "closeConfirm.tabMessage", { count: 1 })).toContain(
      "Unsaved files: 1",
    );
  });

  it("localizes workspace creation and keeps the delete description separate from its path", () => {
    expect(translate("zh-CN", "workspace.newFolder")).toBe("新建文件夹");
    expect(translate("en-US", "workspace.openNewTab")).toBe("Open in New Tab");
    expect(translate("zh-CN", "status.workspaceFolderCreated", { name: "examples" })).toBe(
      "已在工作区新建文件夹 examples",
    );
    expect(
      translate("en-US", "status.workspaceFolderCreateFailed", { error: "exists" }),
    ).toBe("Could not create folder: exists");
    for (const locale of ["zh-CN", "en-US"] as const) {
      expect(translate(locale, "deleteConfirm.message")).not.toContain("{path}");
    }
  });
});
