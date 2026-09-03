import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { normalizeSearchHistoryLimit } from "../../app/settings/searchHistoryLimit";
import { HighlightMatches } from "./SearchHighlight";
import {
  clearSearchHistory,
  loadSearchHistory,
  pushSearchHistory,
  trimSearchHistory,
  type SearchHistoryEntry,
} from "./searchHistory";
import { WorkspaceScopePicker } from "./WorkspaceScopePicker";

import {
  createWorkspaceSearchViewState,
  type WorkspaceSearch,
  type WorkspaceSearchMatch,
  type WorkspaceSearchRoot,
  type WorkspaceSearchViewState,
} from "./types";
import "./WorkspaceSearchPanel.css";

export interface WorkspaceSearchPanelProps {
  readonly locale: "zh-CN" | "en-US";
  readonly workspaces: readonly WorkspaceSearchRoot[];
  readonly search: WorkspaceSearch;
  readonly onOpen: (match: WorkspaceSearchMatch) => void;
  readonly onClose: () => void;
  readonly onOpenWorkspace?: () => void;
  readonly presentation?: "sidebar" | "dialog";
  readonly historyLimit?: number;
  readonly viewState?: WorkspaceSearchViewState;
  readonly onViewStateChange?: (state: WorkspaceSearchViewState) => void;
}

const messages = {
  "zh-CN": {
    title: "工作区全文搜索",
    input: "搜索文件内容",
    placeholder: "输入正文中的文字，按 Enter 搜索",
    caseSensitive: "区分大小写",
    useRegex: "正文正则",
    fileFilter: "文件名或路径筛选（可选正则）",
    fileFilterPlaceholder: "例如：\\.(md|tsx)$",
    submit: "搜索",
    searching: "正在搜索…",
    close: "关闭工作区搜索",
    disk: "搜索 Markdown、代码和文本文件的磁盘正文，不包含未保存的修改。每个匹配行显示一条结果。",
    scopeLabel: "搜索范围",
    allRoots: "全部已打开的工作区",
    openWorkspace: "打开工作区…",
    noWorkspace: "先打开一个工作区，即可搜索其中的文档和代码。",
    hint: "输入文字后按 Enter；再次搜索会读取最新磁盘内容。",
    noMatches: "没有找到匹配内容。",
    error: "无法完成搜索，请重试。",
    invalidSearchPattern: "正文正则表达式无效，请检查后重试。",
    invalidFileFilter: "文件名或路径筛选正则无效，请检查后重试。",
    recentTitle: "最近搜索",
    clearHistory: "清除最近搜索",
    useRecent: (query: string, context: string) => `使用最近搜索：${query}，${context}`,
    historyFilter: (filter: string) => `文件：${filter}`,
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
    placeholder: "Enter text from file contents, then press Enter",
    caseSensitive: "Match case",
    useRegex: "Content regex",
    fileFilter: "File name or path filter (optional regex)",
    fileFilterPlaceholder: "For example: \\.(md|tsx)$",
    submit: "Search",
    searching: "Searching…",
    close: "Close workspace search",
    disk: "Searches Markdown, code and text file contents on disk, excluding unsaved changes. One result per matching line.",
    scopeLabel: "Search scope",
    allRoots: "All open workspaces",
    openWorkspace: "Open workspace…",
    noWorkspace: "Open a workspace to search its documents and code.",
    hint: "Enter text and press Enter. Search again to read the latest files on disk.",
    noMatches: "No matching contents found.",
    error: "Unable to finish the search. Please try again.",
    invalidSearchPattern:
      "The content regular expression is invalid. Check it and try again.",
    invalidFileFilter: "The file name or path filter is invalid. Check it and try again.",
    recentTitle: "Recent searches",
    clearHistory: "Clear recent searches",
    useRecent: (query: string, context: string) =>
      `Use recent search: ${query}, ${context}`,
    historyFilter: (filter: string) => `Files: ${filter}`,
    truncated:
      "A search limit was reached or some folders could not be read. Results are incomplete. Narrow the scope or search for more specific text.",
    unavailable: "These workspaces could not be read:",
    summary: (matches: number, files: number) =>
      `${matches} matching lines · ${files} files searched`,
    skipped: (count: number) =>
      `${count} files skipped due to size, read limits, or unsupported content.`,
  },
} as const;

function resultKey(match: WorkspaceSearchMatch): string {
  return JSON.stringify([match.rootPath, match.path, match.line, match.column]);
}

function failureKind(
  failure: unknown,
): "invalidSearchPattern" | "invalidFileFilter" | "generic" {
  if (typeof failure !== "object" || failure === null || !("code" in failure))
    return "generic";
  if (failure.code === "invalidSearchPattern") return "invalidSearchPattern";
  if (failure.code === "invalidFileFilter") return "invalidFileFilter";
  return "generic";
}

export function WorkspaceSearchPanel({
  locale,
  workspaces,
  search,
  onOpen,
  onClose,
  onOpenWorkspace,
  presentation = "sidebar",
  historyLimit,
  viewState: controlledViewState,
  onViewStateChange,
}: WorkspaceSearchPanelProps) {
  const labels = messages[locale];
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const running = useRef(false);
  const descriptionId = useId();
  const effectiveHistoryLimit = normalizeSearchHistoryLimit(historyLimit);
  const [localViewState, setLocalViewState] = useState<WorkspaceSearchViewState>(
    createWorkspaceSearchViewState,
  );
  const controlled = controlledViewState !== undefined && onViewStateChange !== undefined;
  const viewState = controlled ? controlledViewState : localViewState;
  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;
  const updateViewState = (
    update:
      | WorkspaceSearchViewState
      | ((current: WorkspaceSearchViewState) => WorkspaceSearchViewState),
  ) => {
    const next = typeof update === "function" ? update(viewStateRef.current) : update;
    viewStateRef.current = next;
    if (controlled) onViewStateChange(next);
    else setLocalViewState(next);
  };
  const {
    query,
    caseSensitive,
    useRegex,
    fileFilter,
    selectedRoot,
    criteriaVersion,
    outcome,
  } = viewState;
  const [history, setHistory] = useState<readonly SearchHistoryEntry[]>(() =>
    loadSearchHistory(undefined, effectiveHistoryLimit),
  );
  const [busy, setBusy] = useState(false);
  const scope = workspaces.some((root) => root.path === selectedRoot) ? selectedRoot : "";
  const selectedWorkspaces = scope
    ? workspaces.filter((root) => root.path === scope)
    : workspaces;
  const inputKey = JSON.stringify([
    criteriaVersion,
    query,
    caseSensitive,
    useRegex,
    fileFilter,
    selectedWorkspaces,
  ]);
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

  useEffect(() => {
    setHistory(trimSearchHistory(effectiveHistoryLimit));
  }, [effectiveHistoryLimit]);

  useLayoutEffect(() => {
    if (resultsRef.current) resultsRef.current.scrollTop = viewState.resultsScrollTop;
  }, [currentOutcome?.inputKey, viewState.resultsScrollTop]);

  const replaceCriteria = (
    patch: Partial<
      Pick<
        WorkspaceSearchViewState,
        "query" | "caseSensitive" | "useRegex" | "fileFilter" | "selectedRoot"
      >
    >,
  ) => {
    updateViewState((current) => ({
      ...current,
      ...patch,
      criteriaVersion: current.criteriaVersion + 1,
      outcome: null,
      resultsScrollTop: 0,
      selectedResultKey: null,
    }));
  };

  const historyContext = (entry: SearchHistoryEntry) =>
    [
      entry.scopePath || labels.allRoots,
      entry.caseSensitive ? labels.caseSensitive : "",
      entry.useRegex ? labels.useRegex : "",
      entry.fileFilter ? labels.historyFilter(entry.fileFilter) : "",
    ]
      .filter(Boolean)
      .join(" · ");

  const applyHistory = (entry: SearchHistoryEntry) => {
    replaceCriteria({
      query: entry.query,
      caseSensitive: entry.caseSensitive,
      useRegex: entry.useRegex,
      fileFilter: entry.fileFilter,
      selectedRoot: workspaces.some((workspace) => workspace.path === entry.scopePath)
        ? entry.scopePath
        : "",
    });
    inputRef.current?.focus({ preventScroll: true });
  };

  const submit = async () => {
    if (running.current || !query.trim() || selectedWorkspaces.length === 0) return;
    running.current = true;
    setBusy(true);
    updateViewState((current) => ({
      ...current,
      outcome: null,
      resultsScrollTop: 0,
      selectedResultKey: null,
    }));
    try {
      const result = await search(
        selectedWorkspaces,
        query,
        caseSensitive,
        useRegex,
        fileFilter,
      );
      const nextHistory = pushSearchHistory(
        {
          query,
          scopePath: scope,
          caseSensitive,
          useRegex,
          fileFilter,
          lastUsedAt: Date.now(),
        },
        undefined,
        effectiveHistoryLimit,
      );
      if (mounted.current) setHistory(nextHistory);
      if (mounted.current)
        updateViewState((current) => ({
          ...current,
          outcome: { inputKey, response: result },
        }));
    } catch (failure) {
      if (mounted.current)
        updateViewState((current) => ({
          ...current,
          outcome: { inputKey, failed: failureKind(failure) },
        }));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <section
      aria-label={labels.title}
      className={`workspace-search workspace-search--${presentation}`}
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
      <p className="workspace-search__description" id={descriptionId}>
        {labels.disk}
      </p>
      <form
        className="workspace-search__form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="workspace-search__query">
          <input
            aria-describedby={descriptionId}
            aria-label={labels.input}
            autoComplete="off"
            maxLength={512}
            onChange={(event) => replaceCriteria({ query: event.target.value })}
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
          <button
            disabled={busy || !query.trim() || selectedWorkspaces.length === 0}
            type="submit"
          >
            {busy ? labels.searching : labels.submit}
          </button>
        </div>
        <div className="workspace-search__controls">
          <WorkspaceScopePicker
            allLabel={labels.allRoots}
            disabled={workspaces.length === 0}
            label={labels.scopeLabel}
            onChange={(path) => replaceCriteria({ selectedRoot: path })}
            value={scope}
            workspaces={workspaces}
          />
          <div className="workspace-search__mode-toggles">
            <button
              aria-checked={caseSensitive}
              className="workspace-search__toggle"
              onClick={() => replaceCriteria({ caseSensitive: !caseSensitive })}
              role="switch"
              type="button"
            >
              <span aria-hidden="true" className="workspace-search__toggle-dot" />
              {labels.caseSensitive}
            </button>
            <button
              aria-checked={useRegex}
              className="workspace-search__toggle"
              onClick={() => replaceCriteria({ useRegex: !useRegex })}
              role="switch"
              type="button"
            >
              <span aria-hidden="true" className="workspace-search__toggle-dot" />
              {labels.useRegex}
            </button>
          </div>
        </div>
        <label className="workspace-search__file-filter">
          <span>{labels.fileFilter}</span>
          <input
            autoComplete="off"
            maxLength={256}
            onChange={(event) => replaceCriteria({ fileFilter: event.currentTarget.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.nativeEvent.isComposing)
                event.preventDefault();
            }}
            placeholder={labels.fileFilterPlaceholder}
            spellCheck={false}
            type="text"
            value={fileFilter}
          />
        </label>
        {history.length > 0 && (
          <section aria-label={labels.recentTitle} className="workspace-search__history">
            <header>
              <h3>{labels.recentTitle}</h3>
              <button
                onClick={() => {
                  clearSearchHistory();
                  setHistory([]);
                }}
                type="button"
              >
                {labels.clearHistory}
              </button>
            </header>
            <div className="workspace-search__history-list">
              {history.map((entry) => {
                const context = historyContext(entry);
                return (
                  <button
                    aria-label={labels.useRecent(entry.query, context)}
                    key={JSON.stringify([
                      entry.query,
                      entry.scopePath,
                      entry.caseSensitive,
                      entry.useRegex,
                      entry.fileFilter,
                    ])}
                    onClick={() => applyHistory(entry)}
                    title={`${entry.query}\n${context}`}
                    type="button"
                  >
                    <strong>{entry.query}</strong>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </form>
      <div
        aria-busy={busy}
        className="workspace-search__results"
        onScroll={(event) => {
          const resultsScrollTop = event.currentTarget.scrollTop;
          if (resultsScrollTop === viewStateRef.current.resultsScrollTop) return;
          updateViewState((current) => ({ ...current, resultsScrollTop }));
        }}
        ref={resultsRef}
      >
        {!workspaces.length ? (
          <div className="workspace-search__empty">
            <p className="workspace-search__hint">{labels.noWorkspace}</p>
            {onOpenWorkspace && (
              <button onClick={onOpenWorkspace} type="button">
                {labels.openWorkspace}
              </button>
            )}
          </div>
        ) : (
          <>
            {!response && !currentOutcome?.failed && !busy && (
              <p className="workspace-search__hint">{labels.hint}</p>
            )}
            {currentOutcome?.failed && (
              <p className="workspace-search__warning" role="alert">
                {currentOutcome.failed === "generic"
                  ? labels.error
                  : labels[currentOutcome.failed]}
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
                      <h3 title={first.path}>
                        <HighlightMatches
                          text={first.relativePath}
                          query={useRegex ? "" : query}
                          caseSensitive={caseSensitive}
                        />
                      </h3>
                      {workspaces.length > 1 && (
                        <p className="workspace-search__root" title={first.rootPath}>
                          {first.rootPath}
                        </p>
                      )}
                      <ul>
                        {matches.map((match) => (
                          <li key={`${match.path}:${match.line}`}>
                            <button
                              aria-current={
                                viewState.selectedResultKey === resultKey(match)
                                  ? "true"
                                  : undefined
                              }
                              className="workspace-search__match"
                              onClick={() => {
                                updateViewState((current) => ({
                                  ...current,
                                  resultsScrollTop:
                                    resultsRef.current?.scrollTop ??
                                    current.resultsScrollTop,
                                  selectedResultKey: resultKey(match),
                                }));
                                onOpen(match);
                              }}
                              title={`${match.relativePath}:${match.line}:${match.column}`}
                              type="button"
                            >
                              <span className="workspace-search__line">{match.line}</span>
                              <code>
                                <HighlightMatches
                                  text={match.snippet}
                                  query={query}
                                  caseSensitive={caseSensitive}
                                  regexMatchLength={
                                    useRegex ? match.matchLength : undefined
                                  }
                                  regexMatchColumn={useRegex ? match.column : undefined}
                                />
                              </code>
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
    </section>
  );
}
