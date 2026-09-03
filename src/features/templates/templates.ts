import type { AppLocale } from "../../app/settings";

export interface DocumentTemplate {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly markdown: string;
}

export function documentTemplates(locale: AppLocale): readonly DocumentTemplate[] {
  return locale === "zh-CN"
    ? [
        {
          id: "meeting",
          title: "会议记录",
          description: "议题、讨论结论与行动项",
          markdown:
            "# 会议记录\n\n- 日期：\n- 参与人：\n\n## 议题\n\n1. \n\n## 讨论与结论\n\n\n## 行动项\n\n| 任务 | 负责人 | 截止日期 |\n| --- | --- | --- |\n| 待办事项 | 待确认 | 待确认 |\n",
        },
        {
          id: "weekly",
          title: "工作周报",
          description: "本周进展、问题与下周计划",
          markdown:
            "# 工作周报\n\n周期：\n\n## 本周完成\n\n- [ ] 事项\n\n## 进展与成果\n\n\n## 风险与需要的支持\n\n\n## 下周计划\n\n- [ ] 事项\n",
        },
        {
          id: "technical",
          title: "技术方案",
          description: "背景、目标、方案和验收清单",
          markdown:
            "# 技术方案\n\n## 背景与问题\n\n\n## 目标与非目标\n\n\n## 方案设计\n\n\n## 备选方案与取舍\n\n\n## 实施步骤\n\n1. 需求确认\n2. 实施与验证\n\n## 验收清单\n\n- [ ] 功能符合预期\n- [ ] 回归测试通过\n\n## 风险与回退\n\n",
        },
      ]
    : [
        {
          id: "meeting",
          title: "Meeting notes",
          description: "Agenda, decisions and action items",
          markdown:
            "# Meeting notes\n\n- Date:\n- Attendees:\n\n## Agenda\n\n1. \n\n## Discussion and decisions\n\n\n## Action items\n\n| Task | Owner | Due date |\n| --- | --- | --- |\n| Action item | TBD | TBD |\n",
        },
        {
          id: "weekly",
          title: "Weekly report",
          description: "Progress, blockers and next steps",
          markdown:
            "# Weekly report\n\nPeriod:\n\n## Completed this week\n\n- [ ] Task\n\n## Progress and outcomes\n\n\n## Risks and support needed\n\n\n## Next week\n\n- [ ] Task\n",
        },
        {
          id: "technical",
          title: "Technical proposal",
          description: "Context, goals, design and acceptance",
          markdown:
            "# Technical proposal\n\n## Context and problem\n\n\n## Goals and non-goals\n\n\n## Design\n\n\n## Alternatives and trade-offs\n\n\n## Implementation\n\n1. Confirm requirements\n2. Implement and verify\n\n## Acceptance checklist\n\n- [ ] Behavior meets requirements\n- [ ] Regression tests pass\n\n## Risks and rollback\n\n",
        },
      ];
}

export const templateLabels = {
  "zh-CN": {
    title: "从模板新建",
    hint: "在当前分屏新建未保存的 Markdown，不修改已打开的文档。",
    cancel: "取消",
    create: "使用模板",
    builtIn: "内置模板",
    custom: "自定义模板",
    refresh: "刷新",
    openDirectory: "打开模板文件夹",
    directory: "模板文件夹",
    customHint:
      "把 .md 或 .markdown 文件放进此文件夹，刷新后即可使用。模板只复制 Markdown 正文；图片不会搬移，相对图片链接请在新文档另存后检查。",
    unavailable: "自定义模板需要桌面应用；浏览器演示可使用内置模板。",
    empty: "还没有自定义模板。可以保存当前正文，或打开文件夹放入 Markdown 文件。",
    loading: "正在读取模板…",
    opening: "正在打开模板文件夹…",
    saving: "正在保存模板…",
    saveTitle: "将当前文档存为模板",
    saveHint: "保存当前正文的独立副本，不保存或修改原文档，也不覆盖同名模板。",
    save: "保存模板",
    name: "模板名称",
    namePlaceholder: "例如：项目复盘",
    noCurrentDocument: "先打开一个普通 Markdown 文档，才能把正文保存为模板。",
    tooLarge: "模板正文最多 256 KiB；请精简当前文档后再保存。",
    saved: (title: string) => `已保存模板“${title}”。原文档保持不变。`,
    skipped: (count: number) => `已跳过 ${count} 个过大、不可读或不支持的 Markdown 项。`,
    truncated: "仅显示前 128 个模板，最多扫描 1024 个目录项。请打开文件夹整理后刷新。",
  },
  "en-US": {
    title: "New from template",
    hint: "Create an unsaved Markdown file in the current group. Open documents stay unchanged.",
    cancel: "Cancel",
    create: "Use template",
    builtIn: "Built-in",
    custom: "Custom templates",
    refresh: "Refresh",
    openDirectory: "Open templates folder",
    directory: "Templates folder",
    customHint:
      "Place .md or .markdown files in this folder, then refresh. Templates copy Markdown only; images are not moved. Check relative image links after saving the new document.",
    unavailable:
      "Custom templates require the desktop app. Built-in templates work in this browser demo.",
    empty:
      "No custom templates yet. Save the current document or add Markdown files to the folder.",
    loading: "Reading templates…",
    opening: "Opening templates folder…",
    saving: "Saving template…",
    saveTitle: "Save current document as a template",
    saveHint:
      "Save an independent copy of the current text. The original document and existing templates stay unchanged.",
    save: "Save template",
    name: "Template name",
    namePlaceholder: "For example: Project review",
    noCurrentDocument: "Open a normal Markdown document to save its text as a template.",
    tooLarge:
      "Templates support up to 256 KiB. Shorten the current document before saving.",
    saved: (title: string) =>
      `Saved template “${title}”. The original document is unchanged.`,
    skipped: (count: number) =>
      `Skipped ${count} oversized, unreadable or unsupported Markdown entries.`,
    truncated:
      "Showing up to 128 templates from at most 1024 directory entries. Organize the folder and refresh.",
  },
} as const;
