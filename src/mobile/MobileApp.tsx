import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { MobileIcon } from "./MobileIcon";
import { MobileReader } from "./MobileReader";
import { DEFAULT_LAN_PORT } from "./httpTransport";
import { findRecentWorkspace, resolveRecentDocumentId } from "./recentDocument";
import {
  createBrowserMobileOfflineStore,
  downloadOfflineWorkspace,
  findOfflineDirectory,
  findOfflineDocument,
  findOfflineDocumentByPath,
  findOfflineWorkspace,
  mobileOfflineWorkspaceKey,
  searchOfflineWorkspaces,
  type MobileOfflineWorkspaceProgress,
  type MobileOfflineWorkspaceSnapshot,
  type MobileOfflineWorkspaceStore,
} from "./offlineWorkspace";
import {
  createBrowserMobileStore,
  findRecentDocument,
  mobileDocumentStorageKey,
  updateRecentDocument,
  type MobileLocalStore,
} from "./storage";
import type { MobileTransport } from "./transport";
import type {
  MobileComputer,
  MobileDirectory,
  MobileDocument,
  MobileFavorite,
  MobileLocalState,
  MobileMainSection,
  MobilePairingRequest,
  MobileReadPosition,
  MobileRecentDocument,
  MobileSearchResult,
  MobileWorkspace,
} from "./types";
import "./MobileApp.css";

export interface MobileAppProps {
  readonly transport: MobileTransport;
  readonly storage?: MobileLocalStore;
  readonly offlineStorage?: MobileOfflineWorkspaceStore;
  readonly onScanPairingCode?: () => Promise<MobilePairingRequest | null>;
  readonly demoMode?: boolean;
  readonly insecureDebugMode?: boolean;
}

const OFFLINE_NOTICE_DURATION_MS = 3_000;

interface OfflineNoticeState {
  readonly generation: number;
  readonly visible: boolean;
}

interface EmptyStateProps {
  readonly icon: "book" | "clock" | "search" | "star";
  readonly title: string;
  readonly children: ReactNode;
}

function EmptyState({ icon, title, children }: EmptyStateProps) {
  return (
    <div className="mobile-empty-state">
      <span className="mobile-empty-state__icon">
        <MobileIcon name={icon} size={26} />
      </span>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

function friendlyError(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "操作没有完成，请稍后重试";
}

function ConnectionScreen({
  computers,
  busy,
  error,
  onConnect,
  onOpenOffline,
  onPair,
  onScanPairingCode,
  onScanError,
  demoMode,
  insecureDebugMode,
  offlineComputerIds,
}: {
  readonly computers: readonly MobileComputer[];
  readonly busy: boolean;
  readonly error: string | null;
  readonly onConnect: (computerId: string) => Promise<void>;
  readonly onOpenOffline: (computer: MobileComputer) => Promise<void>;
  readonly onPair: (request: MobilePairingRequest) => Promise<void>;
  readonly onScanPairingCode?: () => Promise<MobilePairingRequest | null>;
  readonly onScanError: (error: unknown) => void;
  readonly demoMode: boolean;
  readonly insecureDebugMode: boolean;
  readonly offlineComputerIds: ReadonlySet<string>;
}) {
  const [address, setAddress] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [certificateFingerprint, setCertificateFingerprint] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onPair({ address, pairingCode, certificateFingerprint });
  };

  const scan = async () => {
    if (!onScanPairingCode) return;
    try {
      const request = await onScanPairingCode();
      if (!request) return;
      setAddress(request.address);
      setPairingCode(request.pairingCode);
      setCertificateFingerprint(request.certificateFingerprint);
      await onPair(request);
    } catch (error) {
      onScanError(error);
    }
  };

  return (
    <main className="mobile-connect">
      <header className="mobile-connect__brand">
        <span className="mobile-connect__logo">
          <MobileIcon name="book" size={28} />
        </span>
        <div>
          <strong>NoteSpace</strong>
          <span>移动阅读</span>
        </div>
        <small>只读</small>
      </header>

      <section className="mobile-connect__intro">
        <span className="mobile-connect__intro-icon">
          <MobileIcon name="wifi" size={32} />
        </span>
        <h1>在手机上阅读电脑里的笔记</h1>
        <p>
          {demoMode
            ? "这是浏览器内置演示；点开合成示例可体验浏览、搜索、离线保存和阅读。"
            : "电脑和手机连接同一个局域网，并在桌面端开启“移动访问”。"}
        </p>
      </section>

      {computers.length > 0 && (
        <section
          className="mobile-connect__section"
          aria-labelledby="saved-computers-title"
        >
          <h2 id="saved-computers-title">
            {demoMode
              ? "内置示例"
              : insecureDebugMode
                ? "发现或保存的电脑"
                : "已保存的电脑"}
          </h2>
          <div className="mobile-connect__computers">
            {computers.map((computer) => {
              const hasOfflineContent = offlineComputerIds.has(computer.id);
              return (
                <div className="mobile-connect__computer-card" key={computer.id}>
                  <button
                    className="mobile-connect__computer"
                    disabled={busy}
                    onClick={() => void onConnect(computer.id)}
                    type="button"
                  >
                    <span className="mobile-connect__computer-icon">
                      <MobileIcon name="computer" />
                    </span>
                    <span>
                      <strong>{computer.name}</strong>
                      <small>{computer.address}</small>
                    </span>
                    <MobileIcon name="chevron" size={18} />
                  </button>
                  {hasOfflineContent && (
                    <button
                      className="mobile-connect__offline-action"
                      disabled={busy}
                      onClick={() => void onOpenOffline(computer)}
                      type="button"
                    >
                      离线阅读
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {demoMode ? (
        <section className="mobile-demo-card" aria-label="浏览器演示说明">
          <strong>浏览器预览只使用合成内容</strong>
          <p>Android App 可连接桌面端的“移动访问”；当前网页不会连接或读取真实电脑。</p>
        </section>
      ) : (
        <section className="mobile-connect__section" aria-labelledby="new-connection-title">
          <div className="mobile-section-heading">
            <h2 id="new-connection-title">连接新电脑</h2>
            {onScanPairingCode && (
              <button
                className="mobile-text-action"
                disabled={busy}
                onClick={() => void scan()}
                type="button"
              >
                <MobileIcon name="scan" size={18} />
                扫码连接
              </button>
            )}
          </div>
          <form className="mobile-connect__form" onSubmit={submit}>
            <label>
              <span>电脑地址</span>
              <input
                autoCapitalize="none"
                autoCorrect="off"
                inputMode="url"
                onChange={(event) => setAddress(event.currentTarget.value)}
                placeholder={
                  insecureDebugMode
                    ? `例如 192.168.1.20（默认端口 ${DEFAULT_LAN_PORT}）`
                    : "例如 192.168.1.20:43127"
                }
                required
                value={address}
              />
            </label>
            {!insecureDebugMode && (
              <>
                <label>
                  <span>配对码</span>
                  <input
                    autoCapitalize="characters"
                    autoComplete="one-time-code"
                    onChange={(event) => setPairingCode(event.currentTarget.value)}
                    placeholder="输入桌面端显示的配对码"
                    required
                    value={pairingCode}
                  />
                </label>
                <label>
                  <span>设备指纹</span>
                  <input
                    autoCapitalize="characters"
                    autoCorrect="off"
                    onChange={(event) =>
                      setCertificateFingerprint(event.currentTarget.value)
                    }
                    placeholder="输入桌面端显示的证书指纹"
                    required
                    value={certificateFingerprint}
                  />
                </label>
              </>
            )}
            {error && (
              <p className="mobile-inline-error" role="alert">
                {error}
              </p>
            )}
            <button className="mobile-primary-button" disabled={busy} type="submit">
              {busy ? "正在连接…" : insecureDebugMode ? "连接" : "配对并连接"}
            </button>
          </form>
        </section>
      )}

      <p className="mobile-connect__privacy">
        <span aria-hidden="true">●</span>
        仅能查看桌面端明确共享的工作区，不会修改、上传或删除文件。
      </p>
    </main>
  );
}

function DemoBanner() {
  return (
    <div className="mobile-demo-banner" role="status">
      演示预览 · 当前为内置示例，不会连接真实电脑
    </div>
  );
}

function AppHeader({
  computer,
  online,
  onDisconnect,
  onReconnect,
}: {
  readonly computer: MobileComputer;
  readonly online: boolean;
  readonly onDisconnect: () => void;
  readonly onReconnect?: () => void;
}) {
  return (
    <header className="mobile-app-header">
      <div className="mobile-app-header__logo">
        <MobileIcon name="book" size={20} />
      </div>
      <div className="mobile-app-header__title">
        <strong>NoteSpace</strong>
        <span className={online ? "is-online" : ""}>
          <i />
          {computer.name}
        </span>
      </div>
      {!online && (
        <button
          aria-label={onReconnect ? "离线，重新连接电脑" : "正在重新连接电脑"}
          className="mobile-app-header__offline-status"
          disabled={!onReconnect}
          onClick={onReconnect}
          type="button"
        >
          <MobileIcon name="disconnect" size={14} />
          <span>{onReconnect ? "离线 · 重连" : "连接中"}</span>
        </button>
      )}
      <button
        aria-label="断开并切换电脑"
        className="mobile-icon-button"
        onClick={onDisconnect}
        type="button"
      >
        <MobileIcon name="disconnect" />
      </button>
    </header>
  );
}

const NAV_ITEMS: readonly {
  readonly id: MobileMainSection;
  readonly label: string;
  readonly icon: "book" | "clock" | "search" | "star";
}[] = [
  { id: "browse", label: "浏览", icon: "book" },
  { id: "search", label: "搜索", icon: "search" },
  { id: "favorites", label: "收藏", icon: "star" },
  { id: "recent", label: "最近", icon: "clock" },
];

function BottomNavigation({
  active,
  onChange,
}: {
  readonly active: MobileMainSection;
  readonly onChange: (section: MobileMainSection) => void;
}) {
  return (
    <nav aria-label="主导航" className="mobile-bottom-nav">
      {NAV_ITEMS.map((item) => (
        <button
          aria-current={active === item.id ? "page" : undefined}
          key={item.id}
          onClick={() => onChange(item.id)}
          type="button"
        >
          <MobileIcon name={item.icon} size={21} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function SectionTitle({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail?: string;
}) {
  return (
    <div className="mobile-content-heading">
      <h1>{title}</h1>
      {detail && <p>{detail}</p>}
    </div>
  );
}

function DocumentRow({
  title,
  path,
  detail,
  disabled,
  onOpen,
}: {
  readonly title: string;
  readonly path: string;
  readonly detail?: string;
  readonly disabled?: boolean;
  readonly onOpen: () => void;
}) {
  return (
    <button
      className="mobile-document-row"
      disabled={disabled}
      onClick={onOpen}
      type="button"
    >
      <span className="mobile-document-row__icon">
        <MobileIcon name="document" size={19} />
      </span>
      <span className="mobile-document-row__copy">
        <strong>{title}</strong>
        <small>{path}</small>
        {detail && <span>{detail}</span>}
      </span>
      <MobileIcon name="chevron" size={17} />
    </button>
  );
}

function offlineSnapshotDetail(snapshot: MobileOfflineWorkspaceSnapshot) {
  const syncedAt = new Date(snapshot.syncedAt);
  const time = Number.isNaN(syncedAt.getTime())
    ? "已保存"
    : new Intl.DateTimeFormat("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(syncedAt);
  const bytes = snapshot.totalBytes;
  const size =
    bytes < 1_024
      ? `${bytes} B`
      : bytes < 1_024 * 1_024
        ? `${(bytes / 1_024).toFixed(1)} KB`
        : `${(bytes / 1_024 / 1_024).toFixed(1)} MB`;
  return `${snapshot.documents.length} 篇 · ${size} · ${time}`;
}

function BrowseSection({
  workspaces,
  directory,
  online,
  busy,
  computerId,
  offlineSnapshots,
  onlineWorkspaceIds,
  syncingWorkspaceKeys,
  syncProgress,
  onOpenWorkspace,
  onOpenDirectory,
  onOpenDocument,
  onSaveOffline,
  onRemoveOffline,
}: {
  readonly workspaces: readonly MobileWorkspace[];
  readonly directory: MobileDirectory | null;
  readonly online: boolean;
  readonly busy: boolean;
  readonly computerId: string;
  readonly offlineSnapshots: readonly MobileOfflineWorkspaceSnapshot[];
  readonly onlineWorkspaceIds: ReadonlySet<string>;
  readonly syncingWorkspaceKeys: ReadonlySet<string>;
  readonly syncProgress: Readonly<Record<string, MobileOfflineWorkspaceProgress>>;
  readonly onOpenWorkspace: (workspace: MobileWorkspace) => void;
  readonly onOpenDirectory: (workspaceId: string, directoryId: string | null) => void;
  readonly onOpenDocument: (documentId: string) => void;
  readonly onSaveOffline: (workspace: MobileWorkspace) => void;
  readonly onRemoveOffline: (snapshot: MobileOfflineWorkspaceSnapshot) => void;
}) {
  if (!directory) {
    return (
      <section className="mobile-section">
        <SectionTitle detail="桌面端当前允许这台手机查看的内容" title="共享工作区" />
        {workspaces.length === 0 ? (
          <EmptyState icon="book" title="暂无共享工作区">
            请在电脑端开启移动访问，并至少选择一个工作区。
          </EmptyState>
        ) : (
          <div className="mobile-card-list">
            {workspaces.map((workspace) => {
              const snapshot = findOfflineWorkspace(offlineSnapshots, workspace);
              const snapshotKey = mobileOfflineWorkspaceKey(computerId, workspace);
              const syncing = syncingWorkspaceKeys.has(snapshotKey);
              const progress = syncProgress[snapshotKey];
              const availableOnline = online && onlineWorkspaceIds.has(workspace.id);
              return (
                <div className="mobile-workspace-card-shell" key={workspace.id}>
                  <button
                    className="mobile-workspace-card"
                    disabled={busy}
                    onClick={() => onOpenWorkspace(workspace)}
                    type="button"
                  >
                    <span className="mobile-workspace-card__icon">
                      <MobileIcon name="folder" size={23} />
                    </span>
                    <span>
                      <strong>{workspace.name}</strong>
                      <small>
                        {snapshot
                          ? `可离线阅读 · ${offlineSnapshotDetail(snapshot)}`
                          : workspace.documentCount === undefined
                            ? "只读工作区"
                            : `${workspace.documentCount} 篇文档`}
                      </small>
                    </span>
                    <MobileIcon name="chevron" size={18} />
                  </button>
                  <div className="mobile-workspace-card__offline">
                    <span>
                      {syncing
                        ? `正在更新${progress ? ` · ${progress.documents} 篇` : ""}`
                        : snapshot
                          ? availableOnline
                            ? "连接后自动保持最新"
                            : "正在使用手机上的副本"
                          : "保存整个工作区后可断网阅读"}
                    </span>
                    {snapshot ? (
                      <span className="mobile-workspace-card__offline-actions">
                        {availableOnline && (
                          <button
                            disabled={syncing}
                            onClick={() => onSaveOffline(workspace)}
                            type="button"
                          >
                            {syncing ? "正在更新" : "立即更新"}
                          </button>
                        )}
                        <button
                          disabled={syncing}
                          onClick={() => onRemoveOffline(snapshot)}
                          type="button"
                        >
                          移除
                        </button>
                      </span>
                    ) : (
                      <button
                        disabled={!online || syncing}
                        onClick={() => onSaveOffline(workspace)}
                        type="button"
                      >
                        {syncing ? "正在保存" : "保存离线"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="mobile-section">
      <div className="mobile-directory-heading">
        <button
          aria-label="返回工作区列表"
          className="mobile-icon-button"
          onClick={() => onOpenDirectory(directory.workspaceId, "__workspaces__")}
          type="button"
        >
          <MobileIcon name="back" />
        </button>
        <div>
          <h1>{directory.name}</h1>
          <div aria-label="目录路径" className="mobile-breadcrumbs">
            {directory.breadcrumbs.map((crumb, index) => (
              <span key={`${crumb.id ?? "root"}-${index}`}>
                {index > 0 && <i>/</i>}
                <button
                  disabled={crumb.id === directory.directoryId}
                  onClick={() => onOpenDirectory(directory.workspaceId, crumb.id)}
                  type="button"
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>
      {directory.truncated && (
        <p className="mobile-notice" role="status">
          目录未完整读取，部分内容可能未显示。请检查电脑上的文件访问权限或目录大小后重试。
        </p>
      )}
      {directory.entries.length === 0 ? (
        <EmptyState
          icon="book"
          title={directory.truncated ? "暂时没有可显示的内容" : "这个目录是空的"}
        >
          {directory.truncated
            ? "目录读取尚不完整，可以重新进入目录重试。"
            : "桌面端没有提供可阅读的 Markdown 文档。"}
        </EmptyState>
      ) : (
        <div className="mobile-file-list">
          {directory.entries.map((entry) =>
            entry.kind === "directory" ? (
              <button
                className="mobile-folder-row"
                disabled={busy}
                key={entry.id}
                onClick={() => onOpenDirectory(directory.workspaceId, entry.id)}
                type="button"
              >
                <MobileIcon name="folder" size={20} />
                <span>
                  <strong>{entry.name}</strong>
                  {entry.detail && <small>{entry.detail}</small>}
                </span>
                <MobileIcon name="chevron" size={17} />
              </button>
            ) : (
              <DocumentRow
                disabled={busy}
                key={entry.id}
                onOpen={() => onOpenDocument(entry.id)}
                path={entry.detail ?? "Markdown"}
                title={entry.name}
              />
            ),
          )}
        </div>
      )}
    </section>
  );
}

function SearchSection({
  available,
  offline,
  workspaces,
  results,
  searching,
  searched,
  query,
  workspaceId,
  onQueryChange,
  onWorkspaceChange,
  onSearch,
  onOpen,
}: {
  readonly available: boolean;
  readonly offline: boolean;
  readonly workspaces: readonly MobileWorkspace[];
  readonly results: readonly MobileSearchResult[];
  readonly searching: boolean;
  readonly searched: boolean;
  readonly query: string;
  readonly workspaceId: string;
  readonly onQueryChange: (query: string) => void;
  readonly onWorkspaceChange: (workspaceId: string) => void;
  readonly onSearch: () => void;
  readonly onOpen: (documentId: string) => void;
}) {
  return (
    <section className="mobile-section">
      <SectionTitle
        detail={
          offline
            ? "搜索手机上已保存的离线 Markdown 内容"
            : "搜索电脑磁盘中已经保存的 Markdown 内容"
        }
        title="全文搜索"
      />
      <form
        className="mobile-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <label className="mobile-search-field">
          <MobileIcon name="search" size={19} />
          <input
            aria-label="搜索内容"
            disabled={!available}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            placeholder="输入要查找的内容"
            type="search"
            value={query}
          />
        </label>
        <label className="mobile-search-scope">
          <span>范围</span>
          <select
            aria-label="搜索范围"
            disabled={!available}
            onChange={(event) => onWorkspaceChange(event.currentTarget.value)}
            value={workspaceId}
          >
            <option value="">全部共享工作区</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="mobile-primary-button"
          disabled={!available || searching || !query.trim()}
          type="submit"
        >
          {searching ? "正在搜索…" : "搜索"}
        </button>
      </form>
      {!searched ? (
        <EmptyState icon="search" title="查找所有共享笔记">
          {offline
            ? "当前搜索手机上最后同步成功的离线副本。"
            : "搜索读取的是电脑上已经保存的正文，不包含桌面端未保存的修改。"}
        </EmptyState>
      ) : results.length === 0 ? (
        <EmptyState icon="search" title="没有找到匹配内容">
          换一个关键词，或调整搜索范围后再试。
        </EmptyState>
      ) : (
        <div className="mobile-results" aria-label="搜索结果">
          <p>{results.length} 条结果</p>
          {results.map((result) => (
            <DocumentRow
              detail={result.snippet}
              key={result.id}
              onOpen={() => onOpen(result.documentId)}
              path={`${result.workspaceName} · ${result.relativePath}`}
              title={result.title}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function FavoritesSection({
  favorites,
  online,
  onOpen,
}: {
  readonly favorites: readonly MobileFavorite[];
  readonly online: boolean;
  readonly onOpen: (documentId: string) => void;
}) {
  return (
    <section className="mobile-section">
      <SectionTitle detail="与桌面端收藏保持一致；移动端不改变收藏" title="收藏" />
      {favorites.length === 0 ? (
        <EmptyState icon="star" title="还没有收藏文档">
          可以在桌面端从文件菜单或工具栏添加收藏。
        </EmptyState>
      ) : (
        <div className="mobile-file-list">
          {favorites.map((favorite) => (
            <DocumentRow
              detail={favorite.available ? undefined : "文件不可用或工作区已停止共享"}
              disabled={!online || !favorite.available}
              key={favorite.id}
              onOpen={() => onOpen(favorite.documentId)}
              path={`${favorite.workspaceName} · ${favorite.relativePath}`}
              title={favorite.title}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RecentSection({
  state,
  computerId,
  online,
  offlineSnapshots,
  onOpen,
}: {
  readonly state: MobileLocalState;
  readonly computerId: string;
  readonly online: boolean;
  readonly offlineSnapshots: readonly MobileOfflineWorkspaceSnapshot[];
  readonly onOpen: (recent: MobileRecentDocument) => void;
}) {
  const recentDocuments = state.recentDocuments.filter(
    (recent) => recent.computerId === computerId,
  );
  return (
    <section className="mobile-section">
      <SectionTitle detail="阅读进度只保存在这台手机上" title="最近阅读" />
      {recentDocuments.length === 0 ? (
        <EmptyState icon="clock" title="暂无阅读记录">
          打开一篇文档后，会在这里保留最近位置。
        </EmptyState>
      ) : (
        <div className="mobile-file-list">
          {recentDocuments.map((recent) => {
            const cached =
              findOfflineDocument(offlineSnapshots, recent.documentId) ??
              findOfflineDocumentByPath(
                offlineSnapshots,
                recent.workspaceName,
                recent.relativePath,
                recent.workspaceSyncKey,
              );
            return (
              <DocumentRow
                detail={`已读 ${Math.round(recent.position.progress * 100)}%`}
                disabled={!online && !cached}
                key={`${recent.computerId}:${recent.documentId}`}
                onOpen={() => onOpen(recent)}
                path={`${recent.workspaceName} · ${recent.relativePath}`}
                title={recent.title}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

export function MobileApp({
  transport,
  storage,
  offlineStorage,
  onScanPairingCode,
  demoMode = false,
  insecureDebugMode = false,
}: MobileAppProps) {
  const localStore = useMemo(() => storage ?? createBrowserMobileStore(), [storage]);
  const offlineStore = useMemo(
    () => offlineStorage ?? createBrowserMobileOfflineStore(),
    [offlineStorage],
  );
  const [localState, setLocalState] = useState(() => localStore.load());
  const [connection, setConnection] = useState(() => transport.getConnectionState());
  const [activeComputer, setActiveComputer] = useState<MobileComputer | undefined>(
    connection.kind === "connected" ? connection.computer : undefined,
  );
  const [showConnections, setShowConnections] = useState(connection.kind !== "connected");
  const [computers, setComputers] = useState<readonly MobileComputer[]>([]);
  const [workspaces, setWorkspaces] = useState<readonly MobileWorkspace[]>([]);
  const [favorites, setFavorites] = useState<readonly MobileFavorite[]>([]);
  const [directory, setDirectory] = useState<MobileDirectory | null>(null);
  const [section, setSection] = useState<MobileMainSection>("browse");
  const [document, setDocument] = useState<MobileDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offlineNoticeState, setOfflineNoticeState] = useState<OfflineNoticeState>({
    generation: 0,
    visible: false,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchWorkspaceId, setSearchWorkspaceId] = useState("");
  const [searchResults, setSearchResults] = useState<readonly MobileSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [offlineSnapshots, setOfflineSnapshots] = useState<
    readonly MobileOfflineWorkspaceSnapshot[]
  >([]);
  const [offlineSnapshotsLoaded, setOfflineSnapshotsLoaded] = useState(false);
  const [syncingWorkspaceKeys, setSyncingWorkspaceKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [offlineSyncProgress, setOfflineSyncProgress] = useState<
    Readonly<Record<string, MobileOfflineWorkspaceProgress>>
  >({});

  const connectionEpochRef = useRef(0);
  const connectionActionRef = useRef(0);
  const computersRequestRef = useRef(0);
  const busyRequestRef = useRef(0);
  const directoryRequestRef = useRef(0);
  const documentRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const lastComputerIdRef = useRef(connection.computer?.id);
  const lastConnectionKindRef = useRef(connection.kind);
  const automaticSyncRunRef = useRef("");
  const syncingWorkspaceKeysRef = useRef(new Set<string>());

  const activeOfflineSnapshots = useMemo(
    () =>
      activeComputer
        ? offlineSnapshots.filter((snapshot) => snapshot.computer.id === activeComputer.id)
        : [],
    [activeComputer, offlineSnapshots],
  );
  const offlineComputerIds = useMemo(
    () => new Set(offlineSnapshots.map((snapshot) => snapshot.computer.id)),
    [offlineSnapshots],
  );
  const onlineWorkspaceIds = useMemo(
    () => new Set(workspaces.map((workspace) => workspace.id)),
    [workspaces],
  );
  const visibleComputers = useMemo(() => {
    const merged = new Map(computers.map((computer) => [computer.id, computer]));
    for (const snapshot of offlineSnapshots) {
      if (!merged.has(snapshot.computer.id)) {
        merged.set(snapshot.computer.id, snapshot.computer);
      }
    }
    return [...merged.values()];
  }, [computers, offlineSnapshots]);

  const invalidateRemoteRequests = useCallback(() => {
    connectionEpochRef.current += 1;
    directoryRequestRef.current += 1;
    documentRequestRef.current += 1;
    searchRequestRef.current += 1;
    busyRequestRef.current += 1;
    setBusy(false);
    setSearching(false);
  }, []);

  const clearRemoteProjection = useCallback((preserveDocument = false) => {
    setWorkspaces([]);
    setFavorites([]);
    setDirectory(null);
    setSearchWorkspaceId("");
    setSearchResults([]);
    setSearched(false);
    if (!preserveDocument) setDocument(null);
  }, []);

  const beginBusyOperation = useCallback(() => {
    const requestId = busyRequestRef.current + 1;
    busyRequestRef.current = requestId;
    setBusy(true);
    return requestId;
  }, []);

  const finishBusyOperation = useCallback((requestId: number) => {
    if (busyRequestRef.current === requestId) setBusy(false);
  }, []);

  const announceOfflineNotice = useCallback(() => {
    setOfflineNoticeState((current) => ({
      generation: current.generation + 1,
      visible: true,
    }));
  }, []);

  const hideOfflineNotice = useCallback(() => {
    setOfflineNoticeState((current) =>
      current.visible ? { ...current, visible: false } : current,
    );
  }, []);

  useEffect(() => {
    globalThis.document.body.classList.add("notespace-mobile-body");
    return () => globalThis.document.body.classList.remove("notespace-mobile-body");
  }, []);

  useEffect(() => {
    if (!offlineNoticeState.visible) return;
    const generation = offlineNoticeState.generation;
    const timeout = globalThis.setTimeout(
      () =>
        setOfflineNoticeState((current) =>
          current.generation === generation ? { ...current, visible: false } : current,
        ),
      OFFLINE_NOTICE_DURATION_MS,
    );
    return () => globalThis.clearTimeout(timeout);
  }, [offlineNoticeState.generation, offlineNoticeState.visible]);

  useEffect(() => {
    let active = true;
    void offlineStore
      .list()
      .then((snapshots) => {
        if (active) {
          setOfflineSnapshots(snapshots);
          setOfflineSnapshotsLoaded(true);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setOfflineSnapshotsLoaded(true);
          setError(friendlyError(reason));
        }
      });
    return () => {
      active = false;
    };
  }, [offlineStore]);

  useEffect(
    () =>
      transport.subscribeConnection((state) => {
        const nextComputerId = state.computer?.id;
        const identityChanged =
          nextComputerId !== undefined &&
          lastComputerIdRef.current !== undefined &&
          lastComputerIdRef.current !== nextComputerId;
        const connectionLost =
          lastConnectionKindRef.current === "connected" && state.kind !== "connected";
        if (identityChanged || connectionLost) invalidateRemoteRequests();
        if (identityChanged) clearRemoteProjection();
        else if (connectionLost) clearRemoteProjection(true);
        if (connectionLost && state.kind === "disconnected") {
          announceOfflineNotice();
        } else if (state.kind === "connected") {
          hideOfflineNotice();
        }
        if (nextComputerId !== undefined) lastComputerIdRef.current = nextComputerId;
        lastConnectionKindRef.current = state.kind;
        setConnection(state);
        if (state.computer) setActiveComputer(state.computer);
      }),
    [
      announceOfflineNotice,
      clearRemoteProjection,
      hideOfflineNotice,
      invalidateRemoteRequests,
      transport,
    ],
  );

  useEffect(() => {
    let active = true;
    const refreshComputers = () => {
      const requestId = computersRequestRef.current + 1;
      computersRequestRef.current = requestId;
      void transport
        .listSavedComputers()
        .then((items) => {
          if (active && computersRequestRef.current === requestId) setComputers(items);
        })
        .catch((reason: unknown) => {
          if (active && computersRequestRef.current === requestId) {
            setError(friendlyError(reason));
          }
        });
    };
    refreshComputers();
    const unsubscribeComputers = transport.subscribeComputers?.(refreshComputers);
    return () => {
      active = false;
      unsubscribeComputers?.();
    };
  }, [transport]);

  useEffect(() => {
    if (connection.kind !== "connected" || !connection.computer) return;
    let active = true;
    const epoch = connectionEpochRef.current;
    const computerId = connection.computer.id;
    void Promise.all([transport.listWorkspaces(), transport.listFavorites()])
      .then(([nextWorkspaces, nextFavorites]) => {
        if (
          !active ||
          epoch !== connectionEpochRef.current ||
          computerId !== lastComputerIdRef.current
        ) {
          return;
        }
        setWorkspaces(nextWorkspaces);
        setFavorites(nextFavorites);
      })
      .catch((reason: unknown) => {
        if (active && epoch === connectionEpochRef.current) {
          setError(friendlyError(reason));
        }
      });
    return () => {
      active = false;
    };
  }, [connection.computer, connection.kind, transport]);

  const persistLocalState = useCallback(
    (updater: (current: MobileLocalState) => MobileLocalState) => {
      setLocalState((current) => {
        const next = updater(current);
        localStore.save(next);
        return next;
      });
    },
    [localStore],
  );

  const saveOfflineWorkspace = useCallback(
    async (workspace: MobileWorkspace, announce = true) => {
      const computer = activeComputer;
      if (!computer || lastConnectionKindRef.current !== "connected") {
        if (announce) setError("连接电脑后才能保存离线内容");
        return;
      }
      const key = mobileOfflineWorkspaceKey(computer.id, workspace);
      if (syncingWorkspaceKeysRef.current.has(key)) return;
      syncingWorkspaceKeysRef.current.add(key);
      setSyncingWorkspaceKeys(new Set(syncingWorkspaceKeysRef.current));
      setError(null);
      const epoch = connectionEpochRef.current;
      try {
        const snapshot = await downloadOfflineWorkspace({
          transport,
          computer,
          workspace,
          onProgress: (progress) => {
            if (epoch !== connectionEpochRef.current) return;
            setOfflineSyncProgress((current) => ({ ...current, [key]: progress }));
          },
        });
        if (
          epoch !== connectionEpochRef.current ||
          lastConnectionKindRef.current !== "connected" ||
          lastComputerIdRef.current !== computer.id
        ) {
          return;
        }
        await offlineStore.put(snapshot);
        setOfflineSnapshots((current) => [
          ...current.filter((item) => item.key !== snapshot.key),
          snapshot,
        ]);
        if (announce) {
          setNotice(`${workspace.name} 已保存到手机，断开电脑后仍可阅读。`);
        }
      } catch (reason) {
        const message = friendlyError(reason);
        if (announce) setError(message);
        else setNotice(`${workspace.name} 自动更新失败：${message}`);
      } finally {
        syncingWorkspaceKeysRef.current.delete(key);
        setSyncingWorkspaceKeys(new Set(syncingWorkspaceKeysRef.current));
        setOfflineSyncProgress((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([candidate]) => candidate !== key),
          ),
        );
      }
    },
    [activeComputer, offlineStore, transport],
  );

  const removeOfflineWorkspace = useCallback(
    async (snapshot: MobileOfflineWorkspaceSnapshot) => {
      if (
        !globalThis.confirm(
          `从这台手机移除“${snapshot.workspace.name}”的离线内容？电脑上的文件不会受影响。`,
        )
      ) {
        return;
      }
      try {
        await offlineStore.remove(snapshot.key);
        setOfflineSnapshots((current) =>
          current.filter((item) => item.key !== snapshot.key),
        );
        if (lastConnectionKindRef.current !== "connected") {
          if (directory?.workspaceId === snapshot.workspace.id) setDirectory(null);
          if (document?.workspaceId === snapshot.workspace.id) setDocument(null);
        }
        setNotice(`${snapshot.workspace.name} 的离线内容已从手机移除。`);
      } catch (reason) {
        setError(friendlyError(reason));
      }
    },
    [directory, document, offlineStore],
  );

  useEffect(() => {
    if (
      !offlineSnapshotsLoaded ||
      connection.kind !== "connected" ||
      !connection.computer ||
      workspaces.length === 0
    ) {
      return;
    }
    const epoch = connectionEpochRef.current;
    const runKey = `${connection.computer.id}:${epoch}`;
    if (automaticSyncRunRef.current === runKey) return;
    automaticSyncRunRef.current = runKey;
    const cachedWorkspaces = workspaces.filter((workspace) =>
      Boolean(findOfflineWorkspace(activeOfflineSnapshots, workspace)),
    );
    if (cachedWorkspaces.length === 0) return;
    void (async () => {
      for (const workspace of cachedWorkspaces) {
        if (connectionEpochRef.current !== epoch) return;
        await saveOfflineWorkspace(workspace, false);
      }
    })();
  }, [
    activeOfflineSnapshots,
    connection.computer,
    connection.kind,
    offlineSnapshotsLoaded,
    saveOfflineWorkspace,
    workspaces,
  ]);

  const openOfflineComputer = async (computer: MobileComputer) => {
    const snapshots = offlineSnapshots.filter(
      (snapshot) => snapshot.computer.id === computer.id,
    );
    if (snapshots.length === 0) {
      setError("这台电脑还没有保存在手机上的离线内容");
      return;
    }
    connectionActionRef.current += 1;
    invalidateRemoteRequests();
    clearRemoteProjection();
    await transport.disconnect().catch(() => undefined);
    lastComputerIdRef.current = computer.id;
    lastConnectionKindRef.current = "disconnected";
    setConnection({
      kind: "disconnected",
      computer,
      message: "正在阅读手机上最后同步成功的内容",
    });
    setActiveComputer(computer);
    setShowConnections(false);
    announceOfflineNotice();
    setError(null);
  };

  const connect = async (computerId: string, preserveDocument = false) => {
    const actionId = connectionActionRef.current + 1;
    connectionActionRef.current = actionId;
    invalidateRemoteRequests();
    clearRemoteProjection(preserveDocument);
    const busyId = beginBusyOperation();
    setError(null);
    try {
      await transport.connect(computerId);
      if (connectionActionRef.current === actionId) setShowConnections(false);
    } catch (reason) {
      if (connectionActionRef.current === actionId) setError(friendlyError(reason));
    } finally {
      finishBusyOperation(busyId);
    }
  };

  const pair = async (request: MobilePairingRequest) => {
    if (demoMode) {
      setError("当前是浏览器内置演示，不会连接真实电脑");
      return;
    }
    const actionId = connectionActionRef.current + 1;
    connectionActionRef.current = actionId;
    invalidateRemoteRequests();
    clearRemoteProjection();
    const busyId = beginBusyOperation();
    setError(null);
    try {
      const computer = await transport.pair(request);
      const computersRequestId = computersRequestRef.current + 1;
      computersRequestRef.current = computersRequestId;
      const nextComputers = await transport.listSavedComputers();
      if (
        connectionActionRef.current !== actionId ||
        computersRequestRef.current !== computersRequestId
      ) {
        return;
      }
      setComputers(nextComputers);
      await transport.connect(computer.id);
      if (connectionActionRef.current === actionId) setShowConnections(false);
    } catch (reason) {
      if (connectionActionRef.current === actionId) setError(friendlyError(reason));
    } finally {
      finishBusyOperation(busyId);
    }
  };

  const disconnect = async () => {
    connectionActionRef.current += 1;
    invalidateRemoteRequests();
    clearRemoteProjection();
    setShowConnections(true);
    setActiveComputer(undefined);
    await transport.disconnect().catch(() => undefined);
  };

  const openDirectory = async (workspaceId: string, directoryId?: string | null) => {
    const requestId = directoryRequestRef.current + 1;
    directoryRequestRef.current = requestId;
    if (directoryId === "__workspaces__") {
      setDirectory(null);
      return;
    }
    const epoch = connectionEpochRef.current;
    const busyId = beginBusyOperation();
    setError(null);
    try {
      const nextDirectory =
        lastConnectionKindRef.current === "connected" && onlineWorkspaceIds.has(workspaceId)
          ? await transport.listDirectory(workspaceId, directoryId)
          : findOfflineDirectory(activeOfflineSnapshots, workspaceId, directoryId);
      if (!nextDirectory) {
        throw new Error("这个目录没有保存在手机离线内容中");
      }
      if (
        requestId === directoryRequestRef.current &&
        epoch === connectionEpochRef.current
      ) {
        setDirectory(nextDirectory);
      }
    } catch (reason) {
      if (
        requestId === directoryRequestRef.current &&
        epoch === connectionEpochRef.current
      ) {
        setError(friendlyError(reason));
      }
    } finally {
      finishBusyOperation(busyId);
    }
  };

  const openDocument = async (documentId: string, recent?: MobileRecentDocument) => {
    const computerId = activeComputer?.id;
    if (!computerId) return;
    const requestId = documentRequestRef.current + 1;
    documentRequestRef.current = requestId;
    const epoch = connectionEpochRef.current;
    const busyId = beginBusyOperation();
    setError(null);
    try {
      const onlineAtStart = lastConnectionKindRef.current === "connected";
      const cachedDocument =
        findOfflineDocument(activeOfflineSnapshots, documentId) ??
        (recent
          ? findOfflineDocumentByPath(
              activeOfflineSnapshots,
              recent.workspaceName,
              recent.relativePath,
              recent.workspaceSyncKey,
            )
          : undefined);
      const readFromComputer =
        onlineAtStart &&
        (!cachedDocument ||
          (recent
            ? Boolean(findRecentWorkspace(workspaces, recent))
            : onlineWorkspaceIds.has(cachedDocument.workspaceId)));
      let opened: MobileDocument | undefined;
      try {
        const resolvedId =
          readFromComputer && recent
            ? await resolveRecentDocumentId(
                transport,
                workspaces,
                recent,
                () =>
                  requestId === documentRequestRef.current &&
                  epoch === connectionEpochRef.current &&
                  computerId === lastComputerIdRef.current,
              )
            : documentId;
        opened = readFromComputer
          ? await transport.readDocument(resolvedId)
          : cachedDocument;
      } catch (reason) {
        if (
          requestId !== documentRequestRef.current ||
          epoch !== connectionEpochRef.current ||
          computerId !== lastComputerIdRef.current
        ) {
          return;
        }
        opened = cachedDocument;
        if (!opened) throw reason;
        setNotice("电脑暂时无法读取这篇文档，已打开手机上的离线副本。");
      }
      if (!opened) throw new Error("这篇文档没有保存在手机离线内容中");
      if (
        requestId !== documentRequestRef.current ||
        (readFromComputer && epoch !== connectionEpochRef.current) ||
        computerId !== lastComputerIdRef.current
      ) {
        return;
      }
      setDocument(opened);
      const workspace =
        workspaces.find((item) => item.id === opened.workspaceId) ??
        activeOfflineSnapshots.find((item) => item.workspace.id === opened.workspaceId)
          ?.workspace;
      const previous = findRecentDocument(
        localState,
        computerId,
        opened,
        workspace?.syncKey,
        (readFromComputer
          ? workspaces
          : activeOfflineSnapshots.map((item) => item.workspace)
        ).filter((item) => item.name === opened.workspaceName).length === 1,
      );
      const storageKey = mobileDocumentStorageKey(computerId, opened.id);
      const previousPosition = previous
        ? (localState.positions[
            mobileDocumentStorageKey(computerId, previous.documentId)
          ] ?? previous.position)
        : undefined;
      const position = localState.positions[storageKey] ??
        previousPosition ?? {
          scrollTop: 0,
          progress: 0,
          updatedAt: new Date().toISOString(),
        };
      persistLocalState((current) =>
        updateRecentDocument(
          current,
          {
            computerId,
            documentId: opened.id,
            title: opened.title,
            relativePath: opened.relativePath,
            workspaceName: opened.workspaceName,
            ...(workspace?.syncKey ? { workspaceSyncKey: workspace.syncKey } : {}),
            position,
          },
          previous?.documentId,
        ),
      );
    } catch (reason) {
      if (
        requestId === documentRequestRef.current &&
        epoch === connectionEpochRef.current
      ) {
        setError(friendlyError(reason));
      }
    } finally {
      finishBusyOperation(busyId);
    }
  };

  const openRecentDocument = (recent: MobileRecentDocument) => {
    void openDocument(recent.documentId, recent);
  };

  const rememberPosition = useCallback(
    (position: MobileReadPosition) => {
      if (!document || !activeComputer) return;
      persistLocalState((current) => {
        const previous = current.recentDocuments.find(
          (item) =>
            item.computerId === activeComputer.id && item.documentId === document.id,
        );
        return updateRecentDocument(current, {
          computerId: activeComputer.id,
          documentId: document.id,
          title: document.title,
          relativePath: document.relativePath,
          workspaceName: document.workspaceName,
          ...(previous?.workspaceSyncKey
            ? { workspaceSyncKey: previous.workspaceSyncKey }
            : {}),
          position,
        });
      });
    },
    [activeComputer, document, persistLocalState],
  );

  const search = async () => {
    if (!searchQuery.trim()) return;
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    const epoch = connectionEpochRef.current;
    setSearching(true);
    setError(null);
    try {
      const request = {
        query: searchQuery.trim(),
        workspaceId: searchWorkspaceId || undefined,
      };
      const onlineNow = lastConnectionKindRef.current === "connected";
      const selectedWorkspaceIsOnline =
        !searchWorkspaceId || onlineWorkspaceIds.has(searchWorkspaceId);
      const staleSnapshots = activeOfflineSnapshots.filter(
        (snapshot) => !onlineWorkspaceIds.has(snapshot.workspace.id),
      );
      let nextResults: readonly MobileSearchResult[];
      if (onlineNow && selectedWorkspaceIsOnline) {
        const onlineResults = await transport.search(request);
        nextResults = searchWorkspaceId
          ? onlineResults
          : [...onlineResults, ...searchOfflineWorkspaces(staleSnapshots, request)].slice(
              0,
              200,
            );
      } else {
        nextResults = searchOfflineWorkspaces(activeOfflineSnapshots, request);
      }
      if (requestId === searchRequestRef.current && epoch === connectionEpochRef.current) {
        setSearchResults(nextResults);
        setSearched(true);
      }
    } catch (reason) {
      if (requestId === searchRequestRef.current && epoch === connectionEpochRef.current) {
        setError(friendlyError(reason));
      }
    } finally {
      if (requestId === searchRequestRef.current) setSearching(false);
    }
  };

  const retry = () => {
    if (
      !activeComputer ||
      connection.kind === "connecting" ||
      connection.kind === "reconnecting"
    ) {
      return;
    }
    void connect(activeComputer.id, true);
  };

  const rootClassName = `notespace-mobile-root${demoMode ? " is-demo has-environment-banner" : ""}`;
  if (showConnections || !activeComputer) {
    return (
      <div className={rootClassName}>
        {demoMode && <DemoBanner />}
        <ConnectionScreen
          busy={busy}
          computers={visibleComputers}
          demoMode={demoMode}
          error={error}
          insecureDebugMode={insecureDebugMode}
          offlineComputerIds={offlineComputerIds}
          onConnect={connect}
          onOpenOffline={openOfflineComputer}
          onPair={pair}
          onScanError={(reason) => setError(friendlyError(reason))}
          onScanPairingCode={demoMode || insecureDebugMode ? undefined : onScanPairingCode}
        />
      </div>
    );
  }

  const online = connection.kind === "connected";
  const offlineAvailable = activeOfflineSnapshots.length > 0;
  const showOfflineNotice = offlineNoticeState.visible;
  const cachedOnlyWorkspaces = activeOfflineSnapshots
    .filter(
      (snapshot) =>
        !workspaces.some((workspace) =>
          Boolean(findOfflineWorkspace([snapshot], workspace)),
        ),
    )
    .map((snapshot) => snapshot.workspace);
  const displayedWorkspaces = online
    ? [...workspaces, ...cachedOnlyWorkspaces]
    : activeOfflineSnapshots.map((snapshot) => snapshot.workspace);
  const documentStorageKey = document
    ? mobileDocumentStorageKey(activeComputer.id, document.id)
    : null;
  return (
    <div className={rootClassName}>
      {demoMode && <DemoBanner />}
      {document ? (
        <MobileReader
          document={document}
          initialPosition={
            documentStorageKey ? localState.positions[documentStorageKey] : undefined
          }
          key={documentStorageKey ?? document.id}
          notice={notice}
          offline={!online}
          offlineNotice={
            showOfflineNotice
              ? {
                  title: offlineAvailable
                    ? "正在使用离线内容"
                    : "连接已断开，当前页面仍可阅读",
                  detail:
                    connection.message ??
                    (offlineAvailable
                      ? "重新连接后会自动更新已保存的工作区"
                      : "当前页面仍可阅读"),
                }
              : undefined
          }
          onBack={() => setDocument(null)}
          onDismissNotice={() => setNotice(null)}
          onOpenLink={() => setNotice("链接导航将在真实局域网连接完成后开放。")}
          onPositionChange={rememberPosition}
          onReconnect={
            connection.kind === "connecting" || connection.kind === "reconnecting"
              ? undefined
              : retry
          }
        />
      ) : (
        <div className="mobile-shell">
          <div className="mobile-shell__chrome">
            <AppHeader
              computer={activeComputer}
              online={online}
              onDisconnect={() => void disconnect()}
              onReconnect={
                connection.kind === "connecting" || connection.kind === "reconnecting"
                  ? undefined
                  : retry
              }
            />
            {!online && showOfflineNotice && (
              <div
                className="mobile-offline-banner mobile-offline-banner--transient"
                role="status"
              >
                <MobileIcon name="disconnect" size={18} />
                <span>
                  <strong>
                    {offlineAvailable ? "正在使用离线内容" : "与电脑的连接已断开"}
                  </strong>
                  <small>
                    {connection.message ??
                      (offlineAvailable
                        ? "重新连接后会自动更新已保存的工作区"
                        : "重新连接后才能打开其他文档")}
                  </small>
                </span>
                <button
                  disabled={
                    connection.kind === "connecting" || connection.kind === "reconnecting"
                  }
                  onClick={retry}
                  type="button"
                >
                  重连
                </button>
              </div>
            )}
            {error && (
              <div className="mobile-error-banner" role="alert">
                <span>{error}</span>
                <button onClick={() => setError(null)} type="button">
                  关闭
                </button>
              </div>
            )}
            {notice && (
              <div className="mobile-notice" role="status">
                <span>{notice}</span>
                <button onClick={() => setNotice(null)} type="button">
                  知道了
                </button>
              </div>
            )}
          </div>
          <main className="mobile-shell__content" aria-busy={busy}>
            {section === "browse" && (
              <BrowseSection
                busy={busy}
                computerId={activeComputer.id}
                directory={directory}
                offlineSnapshots={activeOfflineSnapshots}
                online={online}
                onlineWorkspaceIds={onlineWorkspaceIds}
                onOpenDirectory={(workspaceId, directoryId) =>
                  void openDirectory(workspaceId, directoryId)
                }
                onOpenDocument={(documentId) => void openDocument(documentId)}
                onOpenWorkspace={(workspace) => void openDirectory(workspace.id, null)}
                onRemoveOffline={(snapshot) => void removeOfflineWorkspace(snapshot)}
                onSaveOffline={(workspace) => void saveOfflineWorkspace(workspace)}
                syncProgress={offlineSyncProgress}
                syncingWorkspaceKeys={syncingWorkspaceKeys}
                workspaces={displayedWorkspaces}
              />
            )}
            {section === "search" && (
              <SearchSection
                available={online || offlineAvailable}
                offline={!online}
                onOpen={(documentId) => void openDocument(documentId)}
                onQueryChange={setSearchQuery}
                onSearch={() => void search()}
                onWorkspaceChange={setSearchWorkspaceId}
                query={searchQuery}
                results={searchResults}
                searched={searched}
                searching={searching}
                workspaceId={searchWorkspaceId}
                workspaces={displayedWorkspaces}
              />
            )}
            {section === "favorites" && (
              <FavoritesSection
                favorites={favorites}
                online={online}
                onOpen={(documentId) => void openDocument(documentId)}
              />
            )}
            {section === "recent" && (
              <RecentSection
                computerId={activeComputer.id}
                offlineSnapshots={activeOfflineSnapshots}
                online={online}
                onOpen={openRecentDocument}
                state={localState}
              />
            )}
          </main>
          <BottomNavigation
            active={section}
            onChange={(next) => {
              setSection(next);
              setError(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
