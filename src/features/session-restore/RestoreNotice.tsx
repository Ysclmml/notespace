import { useId } from "react";

import type { AppLocale } from "../../app/settings";
import "./restoreNotice.css";

export interface RestoreNoticeEntry {
  readonly kind: "workspace" | "document";
  readonly path: string;
}

export interface RestoreNoticeProps {
  readonly locale: AppLocale;
  readonly entries: readonly RestoreNoticeEntry[];
  readonly pendingPaths?: readonly string[];
  readonly onRetry: (entry: RestoreNoticeEntry) => void;
  readonly onForget: (entry: RestoreNoticeEntry) => void;
  readonly onChooseWorkspace: () => void;
  readonly onDismiss: () => void;
}

const messages = {
  "zh-CN": {
    title: "部分浏览位置未能恢复",
    description: "位置可能已移动或暂时不可访问。你可以继续编辑；不会自动创建文件或文件夹。",
    details: "查看详情与处理",
    workspace: "工作区",
    document: "文件",
    retry: "重试",
    retrying: "正在重试…",
    forget: "从记录移除",
    forgetHelp: "只清除浏览记录，不删除文件，也不关闭已打开的标签。",
    chooseWorkspace: "选择文件夹…",
    chooseHelp: "作为工作区打开所选文件夹，不自动迁移旧路径或修复文档引用。",
    dismiss: "关闭恢复提示",
    count: (workspaces: number, documents: number) =>
      [workspaces > 0 && `${workspaces} 个工作区`, documents > 0 && `${documents} 个文件`]
        .filter(Boolean)
        .join("、"),
  },
  "en-US": {
    title: "Some browsing locations could not be restored",
    description:
      "Locations may have moved or be temporarily unavailable. You can keep editing; no files or folders will be created automatically.",
    details: "View details and actions",
    workspace: "Workspace",
    document: "File",
    retry: "Retry",
    retrying: "Retrying…",
    forget: "Remove from history",
    forgetHelp: "Only removes browsing records. Files and open tabs are not removed.",
    chooseWorkspace: "Choose folder…",
    chooseHelp:
      "Opens the selected folder as a workspace without relocating old paths or repairing document references.",
    dismiss: "Dismiss restore notice",
    count: (workspaces: number, documents: number) =>
      [
        workspaces > 0 && `${workspaces} workspace${workspaces === 1 ? "" : "s"}`,
        documents > 0 && `${documents} file${documents === 1 ? "" : "s"}`,
      ]
        .filter(Boolean)
        .join(", "),
  },
} as const;

function restoreNoticeEntryKey(entry: RestoreNoticeEntry): string {
  return JSON.stringify([entry.kind, entry.path]);
}

export function RestoreNotice({
  locale,
  entries,
  pendingPaths = [],
  onRetry,
  onForget,
  onChooseWorkspace,
  onDismiss,
}: RestoreNoticeProps) {
  const id = useId();
  const copy = messages[locale];
  const uniqueEntries = [
    ...new Map(entries.map((entry) => [restoreNoticeEntryKey(entry), entry])).values(),
  ];
  if (uniqueEntries.length === 0) return null;
  const workspaces = uniqueEntries.filter((entry) => entry.kind === "workspace").length;
  const documents = uniqueEntries.length - workspaces;
  const pending = new Set(pendingPaths);

  return (
    <aside className="restore-notice" aria-labelledby={`${id}-title`}>
      <div className="restore-notice__header">
        <p className="restore-notice__summary" role="status" aria-atomic="true">
          <strong id={`${id}-title`}>{copy.title}</strong>
          <span>{copy.count(workspaces, documents)}</span>
        </p>
        <button
          className="restore-notice__dismiss"
          type="button"
          aria-label={copy.dismiss}
          title={copy.dismiss}
          onClick={onDismiss}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <details className="restore-notice__details">
        <summary>{copy.details}</summary>
        <div className="restore-notice__body">
          <p>{copy.description}</p>
          <p id={`${id}-forget-help`} className="restore-notice__help">
            {copy.forgetHelp}
          </p>
          <ul className="restore-notice__entries">
            {uniqueEntries.map((entry, index) => {
              const busy = pending.has(entry.path);
              const pathId = `${id}-path-${index}`;
              return (
                <li key={restoreNoticeEntryKey(entry)} aria-busy={busy}>
                  <div className="restore-notice__location" id={pathId}>
                    <span className="restore-notice__kind">{copy[entry.kind]}</span>
                    <span className="restore-notice__path" dir="auto">
                      {entry.path}
                    </span>
                  </div>
                  <div className="restore-notice__actions">
                    <button
                      type="button"
                      disabled={busy}
                      aria-describedby={pathId}
                      onClick={() => onRetry(entry)}
                    >
                      {busy ? copy.retrying : copy.retry}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-describedby={`${pathId} ${id}-forget-help`}
                      onClick={() => onForget(entry)}
                    >
                      {copy.forget}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {workspaces > 0 && (
            <div className="restore-notice__choose">
              <button
                type="button"
                aria-describedby={`${id}-choose-help`}
                onClick={onChooseWorkspace}
              >
                {copy.chooseWorkspace}
              </button>
              <p id={`${id}-choose-help`} className="restore-notice__help">
                {copy.chooseHelp}
              </p>
            </div>
          )}
        </div>
      </details>
    </aside>
  );
}
