import type {
  MobileComputer,
  MobileConnectionState,
  MobileDirectory,
  MobileDocument,
  MobileFavorite,
  MobilePairingRequest,
  MobileSearchRequest,
  MobileSearchResult,
  MobileWorkspace,
} from "./types";

/**
 * Boundary between the mobile UI and the LAN client.
 *
 * Implementations must expose only opaque ids received from the paired desktop.
 * The mobile UI never sends an absolute desktop path and has no write operation.
 */
export interface MobileTransport {
  /** Identifies the intentionally insecure, debug-only HTTP implementation. */
  readonly securityMode?: "insecure-debug-http";
  getConnectionState(): MobileConnectionState;
  subscribeConnection(listener: (state: MobileConnectionState) => void): () => void;
  subscribeComputers?(listener: () => void): () => void;
  listSavedComputers(): Promise<readonly MobileComputer[]>;
  pair(request: MobilePairingRequest): Promise<MobileComputer>;
  connect(computerId: string): Promise<void>;
  disconnect(): Promise<void>;
  listWorkspaces(): Promise<readonly MobileWorkspace[]>;
  listDirectory(workspaceId: string, directoryId?: string | null): Promise<MobileDirectory>;
  readDocument(documentId: string): Promise<MobileDocument>;
  search(request: MobileSearchRequest): Promise<readonly MobileSearchResult[]>;
  listFavorites(): Promise<readonly MobileFavorite[]>;
}

export class MobileTransportError extends Error {
  readonly code: "not-connected" | "pairing-failed" | "not-found" | "unavailable";

  constructor(code: MobileTransportError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MobileTransportError";
    this.code = code;
  }
}
