import { beforeEach, describe, expect, it, vi } from "vitest";

const parse = vi.hoisted(() => vi.fn(() => ({ type: "root", children: [] })));
vi.mock("unified", () => ({
  unified: () => {
    const processor = { use: () => processor, parse };
    return processor;
  },
}));

import { buildHtmlExport, MAX_HTML_EXPORT_SOURCE_BYTES } from "./buildHtmlExport";

describe("HTML export source budget", () => {
  beforeEach(() => parse.mockClear());

  it("accepts exactly 8 MiB of ASCII and rejects the next byte before parsing", () => {
    const boundary = "a".repeat(MAX_HTML_EXPORT_SOURCE_BYTES);
    expect(buildHtmlExport(boundary, { title: "boundary" })).toContain("<!doctype html>");
    expect(parse).toHaveBeenCalledWith(boundary);
    parse.mockClear();
    expect(() => buildHtmlExport(`${boundary}a`, { title: "oversized" })).toThrow(
      "up to 8 MiB",
    );
    expect(parse).not.toHaveBeenCalled();
  });

  it("counts UTF-8 bytes for CJK input rather than assuming one byte per character", () => {
    const chinese = "文".repeat(Math.floor(MAX_HTML_EXPORT_SOURCE_BYTES / 3));
    const boundary = `${chinese}aa`;
    expect(new TextEncoder().encode(boundary).byteLength).toBe(
      MAX_HTML_EXPORT_SOURCE_BYTES,
    );
    buildHtmlExport(boundary, { title: "CJK boundary" });
    expect(parse).toHaveBeenCalledOnce();
    parse.mockClear();
    expect(() => buildHtmlExport(`${boundary}a`, { title: "CJK oversized" })).toThrow(
      expect.objectContaining({ code: "htmlExportSourceTooLarge" }),
    );
    expect(parse).not.toHaveBeenCalled();
  });

  it("rejects a pasted oversized normal-session draft without rendering any nodes", () => {
    const pastedDraft = "😀".repeat(MAX_HTML_EXPORT_SOURCE_BYTES / 4 + 1);
    expect(pastedDraft.length).toBeLessThan(MAX_HTML_EXPORT_SOURCE_BYTES);
    expect(() => buildHtmlExport(pastedDraft, { title: "new draft" })).toThrow();
    expect(parse).not.toHaveBeenCalled();
  });
});
