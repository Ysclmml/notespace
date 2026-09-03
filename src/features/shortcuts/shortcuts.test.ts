import { describe, expect, it } from "vitest";

import {
  DEFAULT_SHORTCUTS,
  FORMATTING_ACTIONS,
  RESERVED_SHORTCUTS,
  findShortcutConflict,
  formatShortcut,
  matchFormattingShortcut,
  matchesShortcut,
  normalizeShortcut,
  normalizeShortcuts,
  shortcutFromEvent,
  type ShortcutKeyEvent,
} from "./shortcuts";

function keyEvent(patch: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return {
    key: "b",
    ctrlKey: false,
    metaKey: true,
    altKey: false,
    shiftKey: false,
    ...patch,
  };
}

describe("formatting shortcuts", () => {
  it("provides non-conflicting defaults for every action", () => {
    expect(Object.keys(DEFAULT_SHORTCUTS)).toEqual([...FORMATTING_ACTIONS]);
    expect(new Set(Object.values(DEFAULT_SHORTCUTS)).size).toBe(FORMATTING_ACTIONS.length);
    for (const binding of Object.values(DEFAULT_SHORTCUTS)) {
      expect(binding).toBeTruthy();
      expect(RESERVED_SHORTCUTS.has(binding!)).toBe(false);
    }
    expect(DEFAULT_SHORTCUTS.heading1).toBe("Mod+1");
    expect(DEFAULT_SHORTCUTS.heading6).toBe("Mod+6");
    expect(DEFAULT_SHORTCUTS.paragraph).toBe("Mod+0");
  });

  it("uses Command only on Mac and Control only elsewhere with exact modifiers", () => {
    expect(matchFormattingShortcut(keyEvent(), DEFAULT_SHORTCUTS, "mac")).toBe(
      "toggleBold",
    );
    expect(matchFormattingShortcut(keyEvent(), DEFAULT_SHORTCUTS, "other")).toBeNull();
    const control = keyEvent({ metaKey: false, ctrlKey: true });
    expect(matchFormattingShortcut(control, DEFAULT_SHORTCUTS, "other")).toBe("toggleBold");
    expect(matchFormattingShortcut(control, DEFAULT_SHORTCUTS, "mac")).toBeNull();
    expect(
      matchFormattingShortcut(keyEvent({ ctrlKey: true }), DEFAULT_SHORTCUTS, "mac"),
    ).toBeNull();
    expect(
      matchFormattingShortcut(keyEvent({ shiftKey: true }), DEFAULT_SHORTCUTS, "mac"),
    ).toBe("blockquote");
    expect(
      matchFormattingShortcut(keyEvent({ altKey: true }), DEFAULT_SHORTCUTS, "mac"),
    ).toBeNull();
  });

  it("supports physical digits and Option-modified letters without changing the displayed binding", () => {
    expect(
      shortcutFromEvent(keyEvent({ code: "Digit1", key: "!", shiftKey: true }), "mac"),
    ).toBe("Mod+Shift+1");
    expect(
      shortcutFromEvent(keyEvent({ code: "KeyC", key: "ç", altKey: true }), "mac"),
    ).toBe("Mod+Alt+C");
    expect(
      shortcutFromEvent(keyEvent({ code: "Slash", key: "?", shiftKey: true }), "mac"),
    ).toBe("Mod+Shift+/");
  });

  it("ignores composition, AltGraph, modifier-only keys and unsupported unmodified input", () => {
    for (const event of [
      keyEvent({ isComposing: true }),
      keyEvent({ keyCode: 229 }),
      keyEvent({ getModifierState: (modifier) => modifier === "AltGraph" }),
      keyEvent({ key: "Meta" }),
      keyEvent({ metaKey: false }),
      keyEvent({ key: "ArrowLeft" }),
    ])
      expect(shortcutFromEvent(event, "mac")).toBeNull();
  });

  it("formats platform-specific labels and cleared bindings", () => {
    expect(formatShortcut("Mod+Shift+X", "mac")).toBe("⌘⇧X");
    expect(formatShortcut("Mod+Alt+C", "other")).toBe("Ctrl+Alt+C");
    expect(formatShortcut(null, "mac")).toBe("");
    expect(matchesShortcut(keyEvent(), "Mod+B", "mac")).toBe(true);
    expect(matchesShortcut(keyEvent({ shiftKey: true }), "Mod+B", "mac")).toBe(false);
  });

  it("normalizes canonical order and rejects unsupported combinations", () => {
    expect(normalizeShortcut("Alt+Mod+Shift+F12")).toBe("Mod+Shift+Alt+F12");
    for (const input of [
      undefined,
      {},
      "Ctrl+B",
      "B",
      "Mod+Mod+B",
      "Mod+Shift+",
      "Mod+b",
      "Mod+ArrowLeft",
      "Mod+F13",
    ])
      expect(normalizeShortcut(input)).toBeNull();
  });

  it("loads old or malformed settings safely, preserving explicit clears", () => {
    expect(normalizeShortcuts(undefined)).toEqual(DEFAULT_SHORTCUTS);
    const normalized = normalizeShortcuts({
      heading1: "Mod+J",
      heading2: "Mod+J",
      toggleBold: null,
      toggleItalic: "Mod+S",
      unknown: "Mod+R",
    });
    expect(normalized.heading1).toBe("Mod+J");
    expect(normalized.heading2).toBe("Mod+2");
    expect(normalized.toggleBold).toBeNull();
    expect(normalized.toggleItalic).toBe("Mod+I");
    expect(Object.keys(normalized)).toEqual([...FORMATTING_ACTIONS]);
    expect(new Set(Object.values(normalized).filter(Boolean)).size).toBe(
      Object.values(normalized).filter(Boolean).length,
    );
    expect(matchFormattingShortcut(keyEvent(), normalized, "mac")).toBeNull();
  });

  it("reports action and reserved conflicts without mutating the binding map", () => {
    expect(findShortcutConflict("Mod+I", "toggleBold", DEFAULT_SHORTCUTS)).toEqual({
      kind: "action",
      action: "toggleItalic",
    });
    expect(findShortcutConflict("Mod+B", "toggleBold", DEFAULT_SHORTCUTS)).toBeNull();
    expect(
      findShortcutConflict("Mod+Shift+Enter", "toggleBold", DEFAULT_SHORTCUTS),
    ).toEqual({ kind: "reserved" });
    expect(findShortcutConflict("Mod+Shift+H", "toggleBold", DEFAULT_SHORTCUTS)).toEqual({
      kind: "reserved",
    });
    expect(DEFAULT_SHORTCUTS.toggleBold).toBe("Mod+B");
  });
});
