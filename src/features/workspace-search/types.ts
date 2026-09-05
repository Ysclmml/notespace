export interface WorkspaceSearchRoot {
  readonly path: string;
  readonly showHidden: boolean;
}

export interface WorkspaceSearchMatch {
  readonly path: string;
  readonly relativePath: string;
  readonly rootPath: string;
  /** One-based physical line and UTF-16 column of the first match on the line. */
  readonly line: number;
  readonly column: number;
  /** UTF-16 length of the first match on this line. */
  readonly matchLength: number;
  readonly snippet: string;
  /** Zero-based UTF-16 range within snippet, clipped before its trailing ellipsis. */
  readonly snippetMatchStart: number;
  readonly snippetMatchEnd: number;
}

export interface WorkspaceSearchResponse {
  readonly matches: readonly WorkspaceSearchMatch[];
  readonly searchedFiles: number;
  readonly skippedFiles: number;
  readonly unavailableRoots: readonly string[];
  readonly truncated: boolean;
}

export interface WorkspaceSearchOutcome {
  readonly inputKey: string;
  readonly response?: WorkspaceSearchResponse;
  readonly failed?: "invalidSearchPattern" | "invalidFileFilter" | "generic";
}

export interface WorkspaceSearchViewState {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly useRegex: boolean;
  readonly fileFilter: string;
  readonly selectedRoot: string;
  readonly criteriaVersion: number;
  readonly outcome: WorkspaceSearchOutcome | null;
  readonly resultsScrollTop: number;
  readonly selectedResultKey: string | null;
}

export function createWorkspaceSearchViewState(): WorkspaceSearchViewState {
  return {
    query: "",
    caseSensitive: false,
    useRegex: false,
    fileFilter: "",
    selectedRoot: "",
    criteriaVersion: 0,
    outcome: null,
    resultsScrollTop: 0,
    selectedResultKey: null,
  };
}

export type WorkspaceSearch = (
  workspaces: readonly WorkspaceSearchRoot[],
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
  fileFilter: string,
) => Promise<WorkspaceSearchResponse>;
