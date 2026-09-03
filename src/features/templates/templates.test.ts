import { describe, expect, it } from "vitest";
import { documentTemplates } from "./templates";

describe("built-in Markdown templates", () => {
  it.each(["zh-CN", "en-US"] as const)(
    "offers three ordinary portable templates in %s",
    (locale) => {
      const templates = documentTemplates(locale);
      expect(templates.map((item) => item.id)).toEqual(["meeting", "weekly", "technical"]);
      for (const template of templates) {
        expect(template.markdown).toMatch(/^# /);
        expect(template.markdown).not.toMatch(/data:|https?:|<script|file:/);
        expect(template.markdown.endsWith("\n")).toBe(true);
      }
    },
  );
});
