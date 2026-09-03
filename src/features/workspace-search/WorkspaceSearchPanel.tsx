import { useEffect, useId, useRef, useState } from "react";

import type {
  WorkspaceSearch,
  WorkspaceSearchMatch,
  WorkspaceSearchResponse,
  WorkspaceSearchRoot,
} from "./types";
import "./WorkspaceSearchPanel.css";

export interface WorkspaceSearchPanelProps {
  readonly locale: "zh-CN" | "en-US";
  readonly workspaces: readonly WorkspaceSearchRoot[];
  readonly search: WorkspaceSearch;
  readonly onOpen: (match: WorkspaceSearchMatch) => void;
  readonly onClose: () => void;
}

const messages = {
  "zh-CN": {
    title: "工作区全文搜索",
    input: "搜索文件内容",
    placeholder: "输入文字，按 Enter 搜索",
    caseSensitive: "区分大小写",
    submit: "搜索",
    searching: "正在搜索…",
    close: "关闭工作区搜索",
    disk: "搜索磁盘上的文件内容，不包含未保存的修改。每行显示首个匹配。",
    scope: "搜索全部打开的工作区，沿用各根的隐藏文件设置。",
    noWorkspace: "先打开一个工作区，即可搜索其中的文档和代码。",
    hint: "输入文字后按 Enter；再次搜索会读取最新磁盘内容。",
    noMatches: "没有找到匹配内容。",
    error: "无法完成搜索，请重试。",
    truncated:
      "已达到搜索上限或部分目录无法读取，结果不完整。请缩小范围或使用更具体的文字。",
    unavailable: "以下工作区暂时无法读取：",
    summary: (matches: number, files: number) =>
      `${matches} 个匹配行 · 已搜索 ${files} 个文件`,
    skipped: (count: number) => `因大小、读取限制或内容问题，跳过 ${count} 个文件。`,
  },
  "en-US": {
    title: "Search Workspaces",
    input: "Search file contents",
    placeholder: "Enter text, then press Enter",
    caseSensitive: "Match case",
    submit: "Search",
    searching: "Searching…",
    close: "Close workspace search",
    disk: "Searches files on disk, excluding unsaved changes. Shows the first match on each line.",
    scope: "Searches all open workspaces using each root’s hidden-file setting.",
    noWorkspace: "Open a workspace to search its documents and code.",
    hint: "Enter text and press Enter. Search again to read the latest files on disk.",
    noMatches: "No matching contents found.",
    error: "Unable to finish the search. Please try again.",
    truncated:
      "A search limit was reached or some folders could not be read. Results are incomplete. Narrow the scope or search for more specific text.",
    unavailable: "These workspaces could not be read:",
    summary: (matches: number, files: number) =>
      `${matches} matching lines · ${files} files searched`,
    skipped: (count: number) =>
      `${count} files skipped due to size, read limits, or unsupported content.`,
  },
} as const;

interface SearchOutcome {
  readonly inputKey: string;
  readonly response?: WorkspaceSearchResponse;
  readonly failed?: boolean;
}

export function WorkspaceSearchPanel({
  locale,
  workspaces,
  search,
  onOpen,
  onClose,
}: WorkspaceSearchPanelProps) {
  const labels = messages[locale];
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const running = useRef(false);
  const descriptionId = useId();
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const inputKey = JSON.stringify([query, caseSensitive, workspaces]);
  const currentOutcome = outcome?.inputKey === inputKey ? outcome : null;
  const response = currentOutcome?.response;
  const grouped = new Map<string, WorkspaceSearchMatch[]>();
  for (const match of response?.matches ?? []) {
    const key = `${match.rootPath}\0${match.path}`;
    const group = grouped.get(key) ?? [];
    group.push(match);
    grouped.set(key, group);
  }

  useEffect(() => {
    mounted.current = true;
    inputRef.current?.focus({ preventScroll: true });
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = async () => {
    if (running.current || !query.trim() || workspaces.length === 0) return;
    running.current = true;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await search(workspaces, query, caseSensitive);
      if (mounted.current) setOutcome({ inputKey, response: result });
    } catch {
      if (mounted.current) setOutcome({ inputKey, failed: true });
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <section
      aria-label={labels.title}
      className="workspace-search"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      role="search"
    >
      <div className="workspace-search__header">
        <h2>{labels.title}</h2>
        <button aria-label={labels.close} onClick={onClose} type="button">
          ×
        </button>
      </div>
      <form
        className="workspace-search__form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          aria-describedby={descriptionId}
          aria-label={labels.input}
          autoComplete="off"
          maxLength={512}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.nativeEvent.isComposing)
              event.preventDefault();
          }}
          placeholder={labels.placeholder}
          ref={inputRef}
          spellCheck={false}
          type="search"
          value={query}
        />
        <div className="workspace-search__controls">
          <label>
            <input
              checked={caseSensitive}
              onChange={(event) => setCaseSensitive(event.target.checked)}
              type="checkbox"
            />
            {labels.caseSensitive}
          </label>
          <button disabled={busy || !query.trim() || workspaces.length === 0} type="submit">
            {busy ? labels.searching : labels.submit}
          </button>
        </div>
        <p className="workspace-search__description" id={descriptionId}>
          {labels.disk}
        </p>
      </form>
      <div aria-busy={busy} className="workspace-search__results">
        {!workspaces.length ? (
          <p className="workspace-search__hint">{labels.noWorkspace}</p>
        ) : (
          <>
            {!response && !currentOutcome?.failed && !busy && (
              <p className="workspace-search__hint">{labels.hint}</p>
            )}
            {currentOutcome?.failed && (
              <p className="workspace-search__warning" role="alert">
                {labels.error}
              </p>
            )}
            {response && (
              <>
                <p aria-live="polite" className="workspace-search__summary">
                  {labels.summary(response.matches.length, response.searchedFiles)}
                </p>
                {response.truncated && (
                  <p className="workspace-search__warning" role="status">
                    {labels.truncated}
                  </p>
                )}
                {response.skippedFiles > 0 && (
                  <p className="workspace-search__hint">
                    {labels.skipped(response.skippedFiles)}
                  </p>
                )}
                {response.unavailableRoots.length > 0 && (
                  <div className="workspace-search__warning">
                    <p>{labels.unavailable}</p>
                    <ul>
                      {response.unavailableRoots.map((path) => (
                        <li key={path}>{path}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {!response.matches.length &&
                  !response.truncated &&
                  !response.unavailableRoots.length && (
                    <p className="workspace-search__hint">{labels.noMatches}</p>
                  )}
                {[...grouped.entries()].map(([key, matches]) => {
                  const first = matches[0];
                  if (!first) return null;
                  return (
                    <div className="workspace-search__file" key={key}>
                      <h3 title={first.path}>{first.relativePath}</h3>
                      {workspaces.length > 1 && (
                        <p className="workspace-search__root" title={first.rootPath}>
                          {first.rootPath}
                        </p>
                      )}
                      <ul>
                        {matches.map((match) => (
                          <li key={`${match.path}:${match.line}`}>
                            <button
                              className="workspace-search__match"
                              onClick={() => onOpen(match)}
                              title={`${match.relativePath}:${match.line}:${match.column}`}
                              type="button"
                            >
                              <span className="workspace-search__line">{match.line}</span>
                              <code>{match.snippet}</code>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>
      <p className="workspace-search__scope">{labels.scope}</p>
    </section>
  );
}
