export type MobileConnectionKind =
  "disconnected" | "connecting" | "connected" | "reconnecting";

export interface MobileComputer {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly lastConnectedAt?: string;
}

export interface MobileConnectionState {
  readonly kind: MobileConnectionKind;
  readonly computer?: MobileComputer;
  readonly message?: string;
}

export interface MobilePairingRequest {
  readonly address: string;
  readonly addressCandidates?: readonly string[];
  readonly pairingCode: string;
  readonly certificateFingerprint: string;
  readonly instanceId?: string;
  readonly protocolVersion?: number;
}

export interface MobileWorkspace {
  readonly id: string;
  /** Stable, path-redacted identity used to replace an offline snapshot after reconnecting. */
  readonly syncKey?: string;
  readonly name: string;
  readonly documentCount?: number;
}

export interface MobileBreadcrumb {
  readonly id: string | null;
  readonly name: string;
}

export interface MobileDirectoryEntry {
  readonly id: string;
  readonly name: string;
  readonly kind: "directory" | "document";
  readonly detail?: string;
}

export interface MobileDirectory {
  readonly workspaceId: string;
  readonly directoryId: string | null;
  readonly name: string;
  readonly breadcrumbs: readonly MobileBreadcrumb[];
  readonly entries: readonly MobileDirectoryEntry[];
}

export interface MobileDocument {
  readonly id: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly title: string;
  readonly relativePath: string;
  readonly markdown: string;
  readonly updatedAt?: string;
}

export interface MobileSearchRequest {
  readonly query: string;
  readonly workspaceId?: string;
  readonly caseSensitive?: boolean;
  readonly useRegex?: boolean;
  readonly fileFilter?: string | null;
}

export interface MobileSearchResult {
  readonly id: string;
  readonly documentId: string;
  readonly title: string;
  readonly relativePath: string;
  readonly workspaceName: string;
  readonly snippet: string;
}

export interface MobileFavorite {
  readonly id: string;
  readonly documentId: string;
  readonly title: string;
  readonly relativePath: string;
  readonly workspaceName: string;
  readonly available: boolean;
}

export interface MobileReadPosition {
  readonly scrollTop: number;
  readonly progress: number;
  readonly updatedAt: string;
}

export interface MobileRecentDocument {
  readonly computerId: string;
  readonly documentId: string;
  readonly title: string;
  readonly relativePath: string;
  readonly workspaceName: string;
  readonly position: MobileReadPosition;
}

export interface MobileLocalState {
  readonly recentDocuments: readonly MobileRecentDocument[];
  readonly positions: Readonly<Record<string, MobileReadPosition>>;
}

export type MobileMainSection = "browse" | "search" | "favorites" | "recent";

export type MobileReaderTheme = "paper" | "sepia" | "dark";
