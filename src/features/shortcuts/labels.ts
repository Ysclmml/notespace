import type { FormattingAction } from "./shortcuts";

const actionLabels: Readonly<Record<FormattingAction, readonly [string, string]>> = {
  heading1: ["一级标题", "Heading 1"],
  heading2: ["二级标题", "Heading 2"],
  heading3: ["三级标题", "Heading 3"],
  heading4: ["四级标题", "Heading 4"],
  heading5: ["五级标题", "Heading 5"],
  heading6: ["六级标题", "Heading 6"],
  paragraph: ["正文段落", "Paragraph"],
  toggleBold: ["粗体", "Bold"],
  toggleItalic: ["斜体", "Italic"],
  toggleInlineCode: ["行内代码", "Inline code"],
  toggleStrike: ["删除线", "Strikethrough"],
  blockquote: ["引用", "Blockquote"],
  codeBlock: ["代码块", "Code block"],
};

export function getFormattingActionLabel(
  action: FormattingAction,
  locale: "zh-CN" | "en-US",
): string {
  return actionLabels[action][locale === "zh-CN" ? 0 : 1];
}

export const shortcutLabels = {
  "zh-CN": {
    title: "快捷键",
    description:
      "用于 Markdown 可视与源码编辑。Mac 使用 ⌘，Windows / Linux 使用 Ctrl。标题作用于所在或选中的段落。",
    search: "搜索格式动作",
    record: "录入",
    recording: "请按组合键…",
    cancel: "取消录入",
    empty: "未设置",
    clear: "清除",
    reset: "恢复默认",
    resetAll: "恢复全部快捷键",
    noMatches: "没有找到格式动作。",
    guidance:
      "点击组合键录入；使用 ⌘ / Ctrl 加字母、数字或符号，可加 Shift / Alt。Esc 取消。应用和系统保留组合不可用。",
    invalid:
      "请使用 ⌘ / Ctrl 加字母、数字或符号，可搭配 Shift / Alt；不支持单键或输入法组合。",
    reserved: "这个组合用于应用、剪贴板或系统操作，请换一个。",
    conflict: (action: string) => `这个组合已用于“${action}”，请先清除原绑定或换一个。`,
    default: (binding: string) => `默认：${binding}`,
    recordAction: (action: string) => `录入${action}快捷键`,
    clearAction: (action: string) => `清除${action}快捷键`,
    resetAction: (action: string) => `恢复${action}默认快捷键`,
  },
  "en-US": {
    title: "Shortcuts",
    description:
      "For visual and source Markdown editing. Mac uses ⌘; Windows / Linux use Ctrl. Headings apply to the current or selected paragraphs.",
    search: "Search formatting actions",
    record: "Record",
    recording: "Press shortcut…",
    cancel: "Cancel recording",
    empty: "Not set",
    clear: "Clear",
    reset: "Reset",
    resetAll: "Reset all shortcuts",
    noMatches: "No formatting actions found.",
    guidance:
      "Click a shortcut to record. Use ⌘ / Ctrl with a letter, number, or symbol; add Shift / Alt if needed. Esc cancels. App and system shortcuts are reserved.",
    invalid:
      "Use ⌘ / Ctrl with a letter, number, or symbol, optionally Shift / Alt. Single keys and IME combinations are not supported.",
    reserved:
      "This combination is reserved for app, clipboard, or system actions. Choose another.",
    conflict: (action: string) =>
      `Already assigned to “${action}”. Clear that binding first or choose another.`,
    default: (binding: string) => `Default: ${binding}`,
    recordAction: (action: string) => `Record shortcut for ${action}`,
    clearAction: (action: string) => `Clear shortcut for ${action}`,
    resetAction: (action: string) => `Reset shortcut for ${action}`,
  },
} as const;
