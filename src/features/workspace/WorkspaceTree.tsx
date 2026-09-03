import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";

import { useI18n } from "../../app/i18n";
import { FolderIcon } from "../../app/shell/icons";
import type { WorkspaceNode } from "../../infrastructure/tauri/desktopAdapter";
import { favoriteLabels, isFavorite } from "../favorites/favorites";
import { normalizeWorkspaceFileName } from "./workspaceFileName";
import "./WorkspaceTree.css";

export interface WorkspaceTreeProps {
  readonly nodes: readonly WorkspaceNode[];
  readonly rootPath: string;
  readonly rootName?: string;
  readonly rootActive?: boolean;
  readonly showHidden?: boolean;
  readonly activePath?: string;
  readonly favoritePaths?: readonly string[];
  readonly onToggleFavorite?: (path: string) => void;
  readonly onOpen: (path: string) => void;
  readonly onOpenPermanent?: (path: string) => void;
  readonly onOpenInNewTab?: (path: string) => void;
  readonly onActivateWorkspace?: (rootPath: string) => void;
  readonly onCloseWorkspace?: (rootPath: string) => void | Promise<void>;
  readonly onShowHiddenChange?: (
    rootPath: string,
    showHidden: boolean,
  ) => void | Promise<void>;
  readonly onImageSettings?: (rootPath: string) => void;
  readonly onCopyPath?: (path: string) => void | Promise<void>;
  readonly onCreateFile?: (directoryPath: string, fileName: string) => Promise<void>;
  readonly onCreateFolder?: (directoryPath: string, folderName: string) => Promise<void>;
  readonly onQuickOpen?: () => void;
  readonly onDeleteRequested?: (node: WorkspaceNode) => void | Promise<void>;
  readonly onReveal?: (path: string) => void | Promise<void>;
  readonly actionLabels?: WorkspaceTreeActionLabels;
  readonly ariaLabel?: string;
  readonly contextMenuRequest?: {
    readonly x: number;
    readonly y: number;
    readonly id: number;
  };
  readonly onContextMenuRequestHandled?: (id: number) => void;
}

export interface WorkspaceTreeActionLabels {
  readonly collapseWorkspace: string;
  readonly expandWorkspace: string;
  readonly closeWorkspace: string;
  readonly copyPath: string;
  readonly deleteItem: string;
}

interface TreeContextMenu {
  readonly target:
    | { readonly kind: "root" }
    | {
        readonly kind: "node";
        readonly node: WorkspaceNode;
        readonly parentPath: string;
        readonly expanded?: boolean;
        readonly toggleExpanded?: () => void;
      };
  readonly x: number;
  readonly y: number;
  readonly trigger?: HTMLElement;
  readonly keyboard?: boolean;
}

interface CreatingEntry {
  readonly directoryPath: string;
  readonly kind: "file" | "folder";
}

interface TreeViewState {
  readonly rootExpanded: boolean;
  readonly expandedDirectories: Readonly<Record<string, boolean>>;
  readonly activePath?: string;
  readonly activeLocated: boolean;
  readonly revealRevision: number;
}

function activeFileAncestors(
  nodes: readonly WorkspaceNode[],
  activePath: string | undefined,
): readonly string[] | null {
  if (!activePath) return null;
  for (const node of nodes) {
    if (node.kind !== "directory") {
      if (node.path === activePath) return [];
      continue;
    }
    const ancestors = activeFileAncestors(node.children ?? [], activePath);
    if (ancestors) return [node.path, ...ancestors];
  }
  return null;
}

function visibleTreeNodes(
  nodes: readonly WorkspaceNode[],
  showHidden: boolean,
): readonly WorkspaceNode[] {
  if (showHidden) return nodes;
  return nodes
    .filter((node) => !node.name.startsWith("."))
    .map((node) =>
      node.kind === "directory"
        ? { ...node, children: visibleTreeNodes(node.children ?? [], false) }
        : node,
    );
}

interface TreeMenuItem {
  readonly label: string;
  readonly action: () => void | Promise<void>;
  readonly danger?: boolean;
  readonly checked?: boolean;
}

function WorkspaceContextMenu({
  menu,
  groups,
  onClose,
}: {
  readonly menu: TreeContextMenu;
  readonly groups: readonly (readonly TreeMenuItem[])[];
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: menu.x, y: menu.y });

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8)),
    });
    // Pointer opening focuses the panel, not the first action. The blue row only
    // appears after an intentional hover or keyboard move.
    if (menu.keyboard) element.querySelector<HTMLButtonElement>("button")?.focus();
    else element.focus({ preventScroll: true });
  }, [menu]);

  useEffect(() => {
    const outside = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      menu.trigger?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("contextmenu", outside, true);
    document.addEventListener("scroll", outside, true);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("contextmenu", outside, true);
      document.removeEventListener("scroll", outside, true);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", onClose);
    };
  }, [menu, onClose]);

  return createPortal(
    <div
      aria-label={t("workspace.fileActions")}
      className="workspace-tree__context-menu"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          onClose();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
        );
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : event.key === "ArrowDown"
                ? (current + 1) % items.length
                : current <= 0
                  ? items.length - 1
                  : current - 1;
        items[next]?.focus();
      }}
      ref={menuRef}
      role="menu"
      style={{ left: position.x, top: position.y }}
      tabIndex={-1}
    >
      {groups
        .filter((group) => group.length > 0)
        .map((group, index) => (
          <div className="workspace-tree__context-group" key={index} role="group">
            {index > 0 && (
              <div className="workspace-tree__context-separator" role="separator" />
            )}
            {group.map((item) => (
              <button
                className={item.danger ? "workspace-tree__context-menu-danger" : undefined}
                key={item.label}
                onClick={() => {
                  onClose();
                  void item.action();
                }}
                aria-checked={item.checked}
                role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                tabIndex={-1}
                type="button"
              >
                <span aria-hidden="true" className="workspace-tree__menu-check">
                  {item.checked === true ? "✓" : ""}
                </span>
                {item.label}
              </button>
            ))}
          </div>
        ))}
    </div>,
    document.body,
  );
}

function FileGlyph({ code = false }: { readonly code?: boolean }) {
  return (
    <svg aria-hidden="true" height="16" viewBox="0 0 18 18" width="16">
      <path
        d="M4 2.5h6l4 4v9H4z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
      <path d="M10 2.5v4h4" stroke="currentColor" strokeWidth="1.2" />
      {code ? (
        <path
          d="m8 9-2 1.75 2 1.75m2-3.5 2 1.75-2 1.75"
          stroke="currentColor"
          strokeWidth="1.1"
        />
      ) : (
        <path d="M6.5 10h5M6.5 12.5h4" stroke="currentColor" strokeWidth="1.2" />
      )}
    </svg>
  );
}

function WorkspaceGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="workspace-tree__workspace-icon"
      height="18"
      viewBox="0 0 20 20"
      width="18"
    >
      <rect
        x="2.5"
        y="3"
        width="15"
        height="14"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M2.5 7h15M8 7v10" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M10.5 10h4M10.5 13h3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CreateEntryRow({
  busy,
  depth,
  kind,
  onCancel,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly depth: number;
  readonly kind: CreatingEntry["kind"];
  readonly onCancel: () => void;
  readonly onSubmit: (fileName: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const fileName = kind === "folder" ? value.trim() : normalizeWorkspaceFileName(value);
    if (fileName) void onSubmit(fileName).catch(() => undefined);
  };

  return (
    <form
      className="workspace-tree__create"
      onContextMenu={(event) => event.stopPropagation()}
      onSubmit={submit}
      style={{ paddingInlineStart: 40 + depth * 14 }}
    >
      {kind === "folder" ? <FolderIcon /> : <FileGlyph />}
      <input
        aria-label={t(
          kind === "folder" ? "workspace.newFolderName" : "workspace.newFileName",
        )}
        disabled={busy}
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        placeholder={t(
          kind === "folder"
            ? "workspace.newFolderPlaceholder"
            : "workspace.newFilePlaceholder",
        )}
        ref={inputRef}
        value={value}
      />
      <button disabled={busy || !value.trim()} type="submit">
        {t("common.confirm")}
      </button>
      <button disabled={busy} onClick={onCancel} type="button">
        {t("common.cancel")}
      </button>
    </form>
  );
}

function TreeNode({
  node,
  activePath,
  onOpen,
  onOpenPermanent,
  onContextMenu,
  parentPath,
  depth,
  expandedDirectories,
  onToggleDirectory,
  creating,
  createBusy,
  onCancelCreate,
  onCreate,
}: {
  readonly node: WorkspaceNode;
  readonly activePath?: string;
  readonly onOpen: (path: string) => void;
  readonly onOpenPermanent?: (path: string) => void;
  readonly onContextMenu: (event: MouseEvent, target: TreeContextMenu["target"]) => void;
  readonly parentPath: string;
  readonly depth: number;
  readonly expandedDirectories: Readonly<Record<string, boolean>>;
  readonly onToggleDirectory: (path: string, initiallyExpanded: boolean) => void;
  readonly creating: CreatingEntry | null;
  readonly createBusy: boolean;
  readonly onCancelCreate: () => void;
  readonly onCreate: (directoryPath: string, fileName: string) => Promise<void>;
}) {
  const expanded = expandedDirectories[node.path] ?? depth < 1;
  const children = node.children ?? [];

  if (node.kind === "directory") {
    const creatingHere = creating?.directoryPath === node.path;
    return (
      <li>
        <button
          aria-expanded={expanded}
          className="workspace-tree__row"
          onClick={(event) => {
            if (event.button !== 0 || event.ctrlKey) return;
            onToggleDirectory(node.path, depth < 1);
          }}
          onContextMenu={(event) =>
            onContextMenu(event, {
              kind: "node",
              node,
              parentPath,
              expanded,
              toggleExpanded: () => onToggleDirectory(node.path, depth < 1),
            })
          }
          onMouseDown={(event) => {
            if (event.button === 2 || event.ctrlKey) event.preventDefault();
          }}
          style={{ paddingInlineStart: 22 + depth * 14 }}
          type="button"
        >
          <span className="workspace-tree__chevron" aria-hidden="true">
            {expanded ? "⌄" : "›"}
          </span>
          <FolderIcon />
          <span title={node.relativePath}>{node.name}</span>
        </button>
        {creatingHere && (
          <CreateEntryRow
            busy={createBusy}
            depth={depth + 1}
            kind={creating.kind}
            onCancel={onCancelCreate}
            onSubmit={(fileName) => onCreate(node.path, fileName)}
          />
        )}
        {(expanded || creatingHere) && children.length > 0 && (
          <ul>
            {children.map((child) => (
              <TreeNode
                activePath={activePath}
                createBusy={createBusy}
                creating={creating}
                depth={depth + 1}
                expandedDirectories={expandedDirectories}
                key={child.path}
                node={child}
                onCancelCreate={onCancelCreate}
                onContextMenu={onContextMenu}
                onCreate={onCreate}
                onOpen={onOpen}
                onOpenPermanent={onOpenPermanent}
                onToggleDirectory={onToggleDirectory}
                parentPath={node.path}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <button
        aria-current={activePath === node.path ? "page" : undefined}
        className={`workspace-tree__row workspace-tree__row--file workspace-tree__row--${node.kind}`}
        onClick={(event) => {
          if (event.button !== 0 || event.ctrlKey) return;
          onOpen(node.path);
        }}
        onContextMenu={(event) => onContextMenu(event, { kind: "node", node, parentPath })}
        onDoubleClick={(event) => {
          if (event.button !== 0 || event.ctrlKey) return;
          event.preventDefault();
          onOpenPermanent?.(node.path);
        }}
        onMouseDown={(event) => {
          if (event.button === 2 || event.ctrlKey) event.preventDefault();
        }}
        style={{ paddingInlineStart: 40 + depth * 14 }}
        title={node.relativePath}
        type="button"
      >
        <FileGlyph code={node.kind === "text"} />
        <span>{node.name}</span>
      </button>
    </li>
  );
}

export function WorkspaceTree({
  nodes,
  rootPath,
  rootName,
  rootActive = false,
  showHidden = false,
  activePath,
  onOpen,
  onOpenPermanent,
  onOpenInNewTab,
  favoritePaths = [],
  onToggleFavorite,
  onActivateWorkspace,
  onCloseWorkspace,
  onShowHiddenChange,
  onImageSettings,
  onCopyPath,
  onCreateFile,
  onCreateFolder,
  onQuickOpen,
  onDeleteRequested,
  onReveal,
  actionLabels,
  ariaLabel,
  contextMenuRequest,
  onContextMenuRequestHandled,
}: WorkspaceTreeProps) {
  const { locale, t } = useI18n();
  const resolvedAriaLabel = ariaLabel ?? t("workspace.tree");
  const [contextMenu, setContextMenu] = useState<TreeContextMenu | null>(null);
  const [creating, setCreating] = useState<CreatingEntry | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [view, setView] = useState<TreeViewState>({
    rootExpanded: true,
    expandedDirectories: {},
    activeLocated: false,
    revealRevision: 0,
  });
  const treeRef = useRef<HTMLDivElement>(null);
  const visibleNodes = useMemo(
    () => visibleTreeNodes(nodes, showHidden),
    [nodes, showHidden],
  );
  const ancestors = useMemo(
    () => activeFileAncestors(visibleNodes, activePath),
    [visibleNodes, activePath],
  );
  const [lastContextMenuRequestId, setLastContextMenuRequestId] = useState<number>();
  const acknowledgedRequestId = useRef<number | undefined>(undefined);

  // A navigation (or the first arrival of its file tree) reveals the active
  // document once. Later tree refreshes must not undo the user's manual folds.
  if (view.activePath !== activePath || view.activeLocated !== (ancestors !== null)) {
    setView({
      ...view,
      activePath,
      activeLocated: ancestors !== null,
      ...(ancestors !== null
        ? {
            rootExpanded: true,
            expandedDirectories: {
              ...view.expandedDirectories,
              ...Object.fromEntries(ancestors.map((path) => [path, true])),
            },
            revealRevision: view.revealRevision + 1,
          }
        : {}),
    });
  }

  useLayoutEffect(() => {
    if (view.revealRevision === 0) return;
    const row = treeRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const scroller = treeRef.current?.closest<HTMLElement>(".sidebar__body");
    if (!row || !scroller || scroller.clientHeight === 0) return;
    const rowBounds = row.getBoundingClientRect();
    const viewportTop = scroller.getBoundingClientRect().top + scroller.clientTop;
    const viewportBottom = viewportTop + scroller.clientHeight;
    // Avoid scrollIntoView: it can also scroll the editor's outer ancestors.
    if (rowBounds.top < viewportTop) scroller.scrollTop += rowBounds.top - viewportTop;
    else if (rowBounds.bottom > viewportBottom)
      scroller.scrollTop += rowBounds.bottom - viewportBottom;
  }, [view.revealRevision]);

  const toggleRoot = () =>
    setView((current) => ({ ...current, rootExpanded: !current.rootExpanded }));
  const toggleDirectory = (path: string, initiallyExpanded: boolean) =>
    setView((current) => ({
      ...current,
      expandedDirectories: {
        ...current.expandedDirectories,
        [path]: !(current.expandedDirectories[path] ?? initiallyExpanded),
      },
    }));
  const { rootExpanded } = view;

  if (contextMenuRequest && contextMenuRequest.id !== lastContextMenuRequestId) {
    setLastContextMenuRequestId(contextMenuRequest.id);
    setContextMenu({
      target: { kind: "root" },
      x: contextMenuRequest.x,
      y: contextMenuRequest.y,
    });
  }

  useEffect(() => {
    if (
      !contextMenuRequest ||
      !onContextMenuRequestHandled ||
      contextMenuRequest.id !== lastContextMenuRequestId ||
      acknowledgedRequestId.current === contextMenuRequest.id
    )
      return;
    acknowledgedRequestId.current = contextMenuRequest.id;
    onContextMenuRequestHandled(contextMenuRequest.id);
  }, [contextMenuRequest, lastContextMenuRequestId, onContextMenuRequestHandled]);

  const openContextMenu = (
    event: MouseEvent,
    target: TreeContextMenu["target"] = { kind: "root" },
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const keyboard = event.clientX === 0 && event.clientY === 0;
    const trigger = event.currentTarget as HTMLElement;
    const bounds = trigger.getBoundingClientRect();
    setContextMenu({
      target,
      x: keyboard ? bounds.left + 20 : event.clientX,
      y: keyboard ? bounds.bottom : event.clientY,
      trigger,
      keyboard,
    });
  };

  const create = async (directoryPath: string, fileName: string) => {
    const action = creating?.kind === "folder" ? onCreateFolder : onCreateFile;
    if (!action) return;
    setCreateBusy(true);
    try {
      await action(directoryPath, fileName);
      setCreating(null);
    } finally {
      setCreateBusy(false);
    }
  };

  const menuTarget = contextMenu?.target.kind === "node" ? contextMenu.target : undefined;
  const menuNode = menuTarget?.node;
  const menuPath = menuNode?.path ?? rootPath;
  const menuDirectory =
    menuNode?.kind === "directory" ? menuNode.path : (menuTarget?.parentPath ?? rootPath);
  const rootToggleLabel = rootExpanded
    ? (actionLabels?.collapseWorkspace ?? t("workspace.collapse"))
    : (actionLabels?.expandWorkspace ?? t("workspace.expand"));
  const beginCreate = (kind: CreatingEntry["kind"]) => {
    setCreating({ directoryPath: menuDirectory, kind });
    setView((current) => ({ ...current, rootExpanded: true }));
    if (menuTarget?.node.kind === "directory" && !menuTarget.expanded) {
      menuTarget.toggleExpanded?.();
    }
  };
  const openActions: TreeMenuItem[] =
    menuNode && menuNode.kind !== "directory"
      ? [
          { label: t("workspace.open"), action: () => onOpen(menuPath) },
          ...(onOpenInNewTab
            ? [{ label: t("workspace.openNewTab"), action: () => onOpenInNewTab(menuPath) }]
            : []),
          ...(onToggleFavorite
            ? [
                {
                  label: isFavorite(favoritePaths, menuPath)
                    ? favoriteLabels[locale].remove
                    : favoriteLabels[locale].addFile,
                  action: () => onToggleFavorite(menuPath),
                },
              ]
            : []),
        ]
      : [];
  const createActions: TreeMenuItem[] = [
    ...(onCreateFile
      ? [{ label: t("workspace.newFile"), action: () => beginCreate("file") }]
      : []),
    ...(onCreateFolder
      ? [{ label: t("workspace.newFolder"), action: () => beginCreate("folder") }]
      : []),
  ];
  const viewActions: TreeMenuItem[] = [
    ...(onQuickOpen ? [{ label: t("workspace.findFile"), action: onQuickOpen }] : []),
    ...(!menuNode && rootName ? [{ label: rootToggleLabel, action: toggleRoot }] : []),
    ...(!menuNode && onShowHiddenChange
      ? [
          {
            label: t("workspace.showHiddenFiles"),
            checked: showHidden,
            action: () => onShowHiddenChange(rootPath, !showHidden),
          },
        ]
      : []),
    ...(!menuNode && onImageSettings
      ? [
          {
            label: t("workspace.imageSettings"),
            action: () => onImageSettings(rootPath),
          },
        ]
      : []),
    ...(menuTarget?.toggleExpanded
      ? [
          {
            label: t(
              menuTarget.expanded ? "workspace.collapseFolder" : "workspace.expandFolder",
            ),
            action: menuTarget.toggleExpanded,
          },
        ]
      : []),
  ];
  const platform = navigator.platform;
  const locationActions: TreeMenuItem[] = [
    ...(onCopyPath
      ? [
          {
            label: actionLabels?.copyPath ?? t("workspace.copyPath"),
            action: () => onCopyPath(menuPath),
          },
        ]
      : []),
    ...(onReveal
      ? [
          {
            label: t(
              /Mac|iPhone|iPad/.test(platform)
                ? "workspace.revealFinder"
                : /Win/.test(platform)
                  ? "workspace.revealExplorer"
                  : "workspace.revealLocation",
            ),
            action: () => onReveal(menuPath),
          },
        ]
      : []),
  ];
  const closeActions: TreeMenuItem[] = menuNode
    ? onDeleteRequested
      ? [
          {
            label: actionLabels?.deleteItem ?? t("workspace.delete"),
            action: () => onDeleteRequested(menuNode),
            danger: true,
          },
        ]
      : []
    : onCloseWorkspace
      ? [
          {
            label: actionLabels?.closeWorkspace ?? t("workspace.close"),
            action: () => onCloseWorkspace(rootPath),
          },
        ]
      : [];

  return (
    <div
      className="workspace-tree-shell"
      onContextMenu={(event) => openContextMenu(event)}
      ref={treeRef}
    >
      {rootName && (
        <button
          aria-current={rootActive ? "true" : undefined}
          aria-expanded={rootExpanded}
          aria-label={`${rootToggleLabel} · ${rootName}`}
          className="workspace-tree__root-header"
          onClick={(event) => {
            if (event.button !== 0 || event.ctrlKey) return;
            onActivateWorkspace?.(rootPath);
            toggleRoot();
          }}
          onContextMenu={(event) => openContextMenu(event)}
          onMouseDown={(event) => {
            if (event.button === 2 || event.ctrlKey) event.preventDefault();
          }}
          title={rootPath}
          type="button"
        >
          <WorkspaceGlyph />
          <span className="workspace-tree__root-title">
            <span className="workspace-tree__root-kind">{t("workspace.label")}</span>
            <span className="workspace-tree__root-name">{rootName}</span>
          </span>
          <svg
            aria-hidden="true"
            className="workspace-tree__root-collapse"
            height="14"
            viewBox="0 0 16 16"
            width="14"
          >
            <path
              d="m4.5 6 3.5 3.5L11.5 6"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.4"
            />
          </svg>
        </button>
      )}
      {(!rootName || rootExpanded) && (
        <>
          {creating?.directoryPath === rootPath && (
            <CreateEntryRow
              busy={createBusy}
              depth={0}
              kind={creating.kind}
              onCancel={() => setCreating(null)}
              onSubmit={(fileName) => create(rootPath, fileName)}
            />
          )}
          <ul className="workspace-tree" aria-label={resolvedAriaLabel}>
            {visibleNodes.map((node) => (
              <TreeNode
                activePath={activePath}
                createBusy={createBusy}
                creating={creating}
                depth={0}
                expandedDirectories={view.expandedDirectories}
                key={node.path}
                node={node}
                onCancelCreate={() => setCreating(null)}
                onContextMenu={openContextMenu}
                onCreate={create}
                onOpen={onOpen}
                onOpenPermanent={onOpenPermanent}
                onToggleDirectory={toggleDirectory}
                parentPath={rootPath}
              />
            ))}
          </ul>
        </>
      )}
      {contextMenu && (
        <WorkspaceContextMenu
          groups={[openActions, createActions, viewActions, locationActions, closeActions]}
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
