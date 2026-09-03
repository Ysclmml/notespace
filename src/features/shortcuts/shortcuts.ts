export const FORMATTING_ACTIONS = [
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "heading5",
  "heading6",
  "paragraph",
  "toggleBold",
  "toggleItalic",
  "toggleInlineCode",
  "toggleStrike",
  "blockquote",
  "codeBlock",
] as const;

export type FormattingAction = (typeof FORMATTING_ACTIONS)[number];
export type ShortcutBindings = Readonly<Record<FormattingAction, string | null>>;
export type ShortcutPlatform = "mac" | "other";

export const DEFAULT_SHORTCUTS: ShortcutBindings = Object.freeze({
  heading1: "Mod+1",
  heading2: "Mod+2",
  heading3: "Mod+3",
  heading4: "Mod+4",
  heading5: "Mod+5",
  heading6: "Mod+6",
  paragraph: "Mod+0",
  toggleBold: "Mod+B",
  toggleItalic: "Mod+I",
  toggleInlineCode: "Mod+E",
  toggleStrike: "Mod+Shift+X",
  blockquote: "Mod+Shift+B",
  codeBlock: "Mod+Alt+C",
});

// These are existing app, clipboard/history, and text-navigation commands.
// Formatting customization must not shadow them on either supported platform.
export const RESERVED_SHORTCUTS: ReadonlySet<string> = new Set([
  "Mod+A",
  "Mod+C",
  "Mod+V",
  "Mod+Shift+V",
  "Mod+X",
  "Mod+Z",
  "Mod+Shift+Z",
  "Mod+Y",
  "Mod+N",
  "Mod+O",
  "Mod+Shift+O",
  "Mod+S",
  "Mod+Shift+S",
  "Mod+W",
  "Mod+Q",
  "Mod+H",
  "Mod+Alt+H",
  "Mod+M",
  "Mod+Alt+M",
  "Mod+`",
  "Mod+Shift+`",
  "Mod+F",
  "Mod+Shift+F",
  "Mod+Shift+H",
  "Mod+K",
  "Mod+P",
  "Mod+,",
  "Mod+/",
  "Mod+Shift+L",
  "Mod+Shift+Enter",
  "Mod+Space",
]);

export interface ShortcutKeyEvent {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  readonly getModifierState?: (key: string) => boolean;
}

export function getPlatform(): ShortcutPlatform {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    ? "mac"
    : "other";
}

export function hasPlatformModifier(
  event: Pick<ShortcutKeyEvent, "metaKey" | "ctrlKey">,
  platform: ShortcutPlatform = getPlatform(),
): boolean {
  return platform === "mac"
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

function validKey(key: string): boolean {
  return (
    /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Enter|Space)$/.test(key) ||
    (key.length === 1 && ",./;'[]\\-=`".includes(key))
  );
}

export function normalizeShortcut(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 32) return null;
  const parts = value.split("+");
  const key = parts.pop();
  if (!key || !validKey(key) || !parts.includes("Mod")) return null;
  if (
    new Set(parts).size !== parts.length ||
    parts.some((part) => !["Mod", "Shift", "Alt"].includes(part))
  ) {
    return null;
  }
  return [
    "Mod",
    ...(parts.includes("Shift") ? ["Shift"] : []),
    ...(parts.includes("Alt") ? ["Alt"] : []),
    key,
  ].join("+");
}

export function normalizeShortcuts(value: unknown): ShortcutBindings {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<Record<FormattingAction, unknown>>)
      : {};
  const result = { ...DEFAULT_SHORTCUTS };
  const used = new Set<string>();
  for (const action of FORMATTING_ACTIONS) {
    const raw = candidate[action];
    let binding =
      raw === null ? null : (normalizeShortcut(raw) ?? DEFAULT_SHORTCUTS[action]);
    if (binding && (RESERVED_SHORTCUTS.has(binding) || used.has(binding))) {
      const fallback = DEFAULT_SHORTCUTS[action];
      binding = fallback && !used.has(fallback) ? fallback : null;
    }
    result[action] = binding;
    if (binding) used.add(binding);
  }
  return result;
}

const CODE_KEYS: Readonly<Record<string, string>> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  Space: "Space",
};

/** Uses physical letter/digit keys so Option+C and shifted digits remain stable. */
export function shortcutFromEvent(
  event: ShortcutKeyEvent,
  platform: ShortcutPlatform = getPlatform(),
): string | null {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.getModifierState?.("AltGraph") ||
    !hasPlatformModifier(event, platform)
  ) {
    return null;
  }
  const code = event.code ?? "";
  let key = /^(?:Key[A-Z]|Digit[0-9])$/.test(code)
    ? code.replace(/^(?:Key|Digit)/, "")
    : (CODE_KEYS[code] ?? event.key);
  if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
  if (key === " ") key = "Space";
  return normalizeShortcut(
    [
      "Mod",
      ...(event.shiftKey ? ["Shift"] : []),
      ...(event.altKey ? ["Alt"] : []),
      key,
    ].join("+"),
  );
}

export function matchesShortcut(
  event: ShortcutKeyEvent,
  binding: string | null,
  platform: ShortcutPlatform = getPlatform(),
): boolean {
  return binding !== null && shortcutFromEvent(event, platform) === binding;
}

export function matchFormattingShortcut(
  event: ShortcutKeyEvent,
  bindings: ShortcutBindings,
  platform: ShortcutPlatform = getPlatform(),
): FormattingAction | null {
  const binding = shortcutFromEvent(event, platform);
  return binding
    ? (FORMATTING_ACTIONS.find((action) => bindings[action] === binding) ?? null)
    : null;
}

export function formatShortcut(
  binding: string | null,
  platform: ShortcutPlatform = getPlatform(),
): string {
  if (!binding) return "";
  const parts = binding.split("+");
  return platform === "mac"
    ? parts
        .map(
          (part) =>
            ({ Mod: "⌘", Shift: "⇧", Alt: "⌥", Enter: "↵", Space: "Space" })[part] ?? part,
        )
        .join("")
    : parts.map((part) => (part === "Mod" ? "Ctrl" : part)).join("+");
}

export type ShortcutConflict =
  | { readonly kind: "reserved" }
  | { readonly kind: "action"; readonly action: FormattingAction };

export function findShortcutConflict(
  binding: string,
  action: FormattingAction,
  bindings: ShortcutBindings,
): ShortcutConflict | null {
  if (RESERVED_SHORTCUTS.has(binding)) return { kind: "reserved" };
  const owner = FORMATTING_ACTIONS.find(
    (item) => item !== action && bindings[item] === binding,
  );
  return owner ? { kind: "action", action: owner } : null;
}
