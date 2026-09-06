import { describe, expect, it } from "vitest";
import { mobileDocumentLink } from "./documentLink";

describe("mobile document links", () => {
  it.each([
    ["../基础/公式%20说明.md#%E6%A6%82%E8%BF%B0", "基础/公式 说明.md", "概述"],
    ["./下一章.markdown", "学习/下一章.markdown", ""],
    ["/入门.md", "入门.md", ""],
    ["#当前标题", "学习/笔记.md", "当前标题"],
    ["特殊%23文件.md", "学习/特殊#文件.md", ""],
  ])("resolves %s without turning it into a host path", (href, relativePath, anchor) => {
    expect(mobileDocumentLink("学习/笔记.md", href)).toEqual({ relativePath, anchor });
  });
  it.each([
    "../../secret.md",
    "file:///secret.md",
    "https://example.test/a.md",
    "//other/a.md",
    "bad%.md",
    "data:text/plain,test",
    "notes.pdf",
    "one.md?query=yes",
  ])("keeps unsupported %s on the current document", (href) => {
    expect(() => mobileDocumentLink("学习/笔记.md", href)).toThrow();
  });
});
