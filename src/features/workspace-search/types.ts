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
  readonly snippet: string;
}

export interface WorkspaceSearchResponse {
  readonly matches: readonly WorkspaceSearchMatch[];
  readonly searchedFiles: number;
  readonly skippedFiles: number;
  readonly unavailableRoots: readonly string[];
  readonly truncated: boolean;
}

export type WorkspaceSearch = (
  workspaces: readonly WorkspaceSearchRoot[],
  query: string,
  caseSensitive: boolean,
) => Promise<WorkspaceSearchResponse>;
