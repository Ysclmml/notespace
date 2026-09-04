import { MobileTransportError, type MobileTransport } from "./transport";
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

export interface MockMobileTransportData {
  readonly computers?: readonly MobileComputer[];
  readonly workspaces?: readonly MobileWorkspace[];
  readonly directories?: Readonly<Record<string, MobileDirectory>>;
  readonly documents?: Readonly<Record<string, MobileDocument>>;
  readonly favorites?: readonly MobileFavorite[];
}

function directoryKey(workspaceId: string, directoryId?: string | null) {
  return `${workspaceId}:${directoryId ?? "root"}`;
}

export class MockMobileTransport implements MobileTransport {
  private state: MobileConnectionState = { kind: "disconnected" };
  private readonly listeners = new Set<(state: MobileConnectionState) => void>();
  private readonly computers = new Map<string, MobileComputer>();
  private readonly workspaces: readonly MobileWorkspace[];
  private readonly directories: Readonly<Record<string, MobileDirectory>>;
  private readonly documents: Readonly<Record<string, MobileDocument>>;
  private readonly favorites: readonly MobileFavorite[];

  constructor(data: MockMobileTransportData = {}) {
    for (const computer of data.computers ?? []) this.computers.set(computer.id, computer);
    this.workspaces = data.workspaces ?? [];
    this.directories = data.directories ?? {};
    this.documents = data.documents ?? {};
    this.favorites = data.favorites ?? [];
  }

  getConnectionState() {
    return this.state;
  }

  subscribeConnection(listener: (state: MobileConnectionState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async listSavedComputers() {
    return [...this.computers.values()];
  }

  async pair(request: MobilePairingRequest) {
    if (
      !request.address.trim() ||
      !request.pairingCode.trim() ||
      !request.certificateFingerprint.trim()
    ) {
      throw new MobileTransportError("pairing-failed", "地址、配对码和设备指纹不能为空");
    }
    const computer: MobileComputer = {
      id: `paired-${this.computers.size + 1}`,
      name: "我的电脑",
      address: request.address.trim(),
    };
    this.computers.set(computer.id, computer);
    return computer;
  }

  async connect(computerId: string) {
    const computer = this.computers.get(computerId);
    if (!computer) throw new MobileTransportError("not-found", "没有找到这台电脑");
    this.setConnectionState({ kind: "connecting", computer });
    this.setConnectionState({ kind: "connected", computer });
  }

  async disconnect() {
    this.setConnectionState({ kind: "disconnected", computer: this.state.computer });
  }

  async listWorkspaces() {
    this.assertConnected();
    return this.workspaces;
  }

  async listDirectory(workspaceId: string, directoryId?: string | null) {
    this.assertConnected();
    const directory = this.directories[directoryKey(workspaceId, directoryId)];
    if (!directory) throw new MobileTransportError("not-found", "目录不存在或已停止共享");
    return directory;
  }

  async readDocument(documentId: string) {
    this.assertConnected();
    const document = this.documents[documentId];
    if (!document) throw new MobileTransportError("not-found", "文档不存在或已停止共享");
    return document;
  }

  async search(request: MobileSearchRequest) {
    this.assertConnected();
    const query = request.query.trim().toLocaleLowerCase();
    if (!query) return [];
    const results: MobileSearchResult[] = [];
    for (const document of Object.values(this.documents)) {
      if (request.workspaceId && document.workspaceId !== request.workspaceId) continue;
      const haystack = `${document.title}\n${document.relativePath}\n${document.markdown}`;
      if (!haystack.toLocaleLowerCase().includes(query)) continue;
      results.push({
        id: `result-${document.id}`,
        documentId: document.id,
        title: document.title,
        relativePath: document.relativePath,
        workspaceName: document.workspaceName,
        snippet: document.markdown.replaceAll(/\s+/g, " ").slice(0, 140),
      });
    }
    return results;
  }

  async listFavorites() {
    this.assertConnected();
    return this.favorites;
  }

  simulateDisconnect(message = "电脑暂时无法连接", retainComputer = true) {
    this.setConnectionState({
      kind: "disconnected",
      computer: retainComputer ? this.state.computer : undefined,
      message,
    });
  }

  private assertConnected() {
    if (this.state.kind !== "connected") {
      throw new MobileTransportError("not-connected", "请先连接电脑");
    }
  }

  private setConnectionState(state: MobileConnectionState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
