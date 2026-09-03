import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";

import type { AppLocale } from "../../app/settings";
import { translate } from "../../app/i18n";
import type { DesktopAdapter } from "../../infrastructure/tauri/desktopAdapter";
import { favoriteLabels, isFavorite, normalizeFavorites } from "./favorites";
import { useFavoriteAvailability } from "./useFavoriteAvailability";
import "./FavoritesPanel.css";

export interface FavoritesPanelProps {
  readonly paths: readonly string[];
  readonly activePath?: string;
  readonly locale: AppLocale;
  readonly onOpen: (path: string) => void | Promise<void>;
  readonly onRemove: (path: string) => void;
  readonly onHide?: () => void;
  readonly inspectPaths?: DesktopAdapter["inspectDocuments"];
  readonly visible?: boolean;
}

function FavoriteGlyph({ file = false }: { readonly file?: boolean }) {
  return (
    <svg aria-hidden="true" height="16" viewBox="0 0 18 18" width="16">
      <path
        d={
          file
            ? "M4 2.5h6l4 4v9H4zM10 2.5v4h4M6.5 10h5M6.5 12.5h4"
            : "m9 2 2.1 4.25 4.7.7-3.4 3.3.8 4.7L9 12.75 4.8 15l.8-4.75-3.4-3.3 4.7-.7z"
        }
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

interface FavoritesContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly keyboard: boolean;
  readonly trigger: HTMLButtonElement;
}

function FavoritesContextMenu({
  menu,
  label,
  closeLabel,
  onClose,
  onHide,
}: {
  readonly menu: FavoritesContextMenuState;
  readonly label: string;
  readonly closeLabel: string;
  readonly onClose: () => void;
  readonly onHide: () => void;
}) {
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
    if (menu.keyboard) element.querySelector<HTMLButtonElement>("button")?.focus();
    else element.focus({ preventScroll: true });
  }, [menu]);

  useEffect(() => {
    const closeFromOutside = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      if (menu.trigger.isConnected) menu.trigger.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", closeFromOutside, true);
    document.addEventListener("contextmenu", closeFromOutside, true);
    document.addEventListener("scroll", closeFromOutside, true);
    document.addEventListener("keydown", closeFromEscape);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside, true);
      document.removeEventListener("contextmenu", closeFromOutside, true);
      document.removeEventListener("scroll", closeFromOutside, true);
      document.removeEventListener("keydown", closeFromEscape);
      window.removeEventListener("resize", onClose);
    };
  }, [menu, onClose]);

  return createPortal(
    <div
      aria-label={label}
      className="favorites-panel__context-menu"
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
        event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus();
      }}
      ref={menuRef}
      role="menu"
      style={{ left: position.x, top: position.y }}
      tabIndex={-1}
    >
      <button
        onClick={() => {
          onClose();
          onHide();
        }}
        role="menuitem"
        tabIndex={-1}
        type="button"
      >
        {closeLabel}
      </button>
    </div>,
    document.body,
  );
}

export function FavoritesPanel({
  paths,
  activePath,
  locale,
  onOpen,
  onRemove,
  onHide,
  inspectPaths,
  visible = true,
}: FavoritesPanelProps) {
  const labels = favoriteLabels[locale];
  const listId = useId();
  const [expanded, setExpanded] = useState(true);
  const [opening, setOpening] = useState<ReadonlySet<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<FavoritesContextMenuState | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const boundedPaths = useMemo(() => normalizeFavorites(paths, true), [paths]);
  const duplicateNames = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const path of boundedPaths) {
      const name = path.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? path;
      if (seen.has(name)) duplicates.add(name);
      seen.add(name);
    }
    return duplicates;
  }, [boundedPaths]);
  const { availability, refresh } = useFavoriteAvailability(
    boundedPaths,
    visible && expanded,
    inspectPaths,
  );
  const open = async (path: string) => {
    if (opening.has(path)) return;
    setOpening((current) => new Set(current).add(path));
    try {
      await onOpen(path);
    } catch {
      // The shell reports the open error; the path stays here for retry/removal.
    } finally {
      setOpening((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
      refresh();
    }
  };
  const contextMenuPosition = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.clientX !== 0 || event.clientY !== 0) {
      return { x: event.clientX, y: event.clientY };
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: bounds.left + 12, y: bounds.top + Math.min(bounds.height, 28) };
  };

  return (
    <section
      className="favorites-panel"
      aria-label={labels.title}
      hidden={!visible}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <button
        aria-controls={listId}
        aria-expanded={expanded}
        aria-label={expanded ? labels.collapse : labels.expand}
        className="favorites-panel__heading"
        onClick={(event) => {
          if (event.button !== 0) return;
          if (event.ctrlKey) {
            event.preventDefault();
            event.stopPropagation();
            if (onHide) {
              const position = contextMenuPosition(event);
              setContextMenu(
                (current) =>
                  current ?? {
                    ...position,
                    keyboard: false,
                    trigger: event.currentTarget,
                  },
              );
            }
            return;
          }
          closeContextMenu();
          setExpanded((current) => !current);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!onHide) return;
          const position = contextMenuPosition(event);
          setContextMenu({
            ...position,
            keyboard: event.clientX === 0 && event.clientY === 0,
            trigger: event.currentTarget,
          });
        }}
        title={onHide ? translate(locale, "favorites.hideHint") : undefined}
        type="button"
      >
        <FavoriteGlyph />
        <span>{labels.title}</span>
        <span className="favorites-panel__count">{boundedPaths.length}</span>
        <svg
          aria-hidden="true"
          className="favorites-panel__chevron"
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
      <div hidden={!expanded} id={listId}>
        {boundedPaths.length === 0 ? (
          <div className="favorites-panel__empty">
            <p>{labels.empty}</p>
            <p>{labels.hint}</p>
          </div>
        ) : (
          <ul aria-label={labels.title}>
            {boundedPaths.map((path) => {
              const segments = path.replaceAll("\\", "/").split("/");
              const name = segments.at(-1) ?? path;
              const parent = segments.at(-2) || "/";
              const status = availability[path];
              const unavailable = status && status !== "present";
              const statusLabel = unavailable ? labels[status] : undefined;
              const hint =
                statusLabel ??
                (duplicateNames.has(name.toLowerCase()) ? parent : undefined);
              const current = activePath && isFavorite([path], activePath);
              const busy = opening.has(path);
              return (
                <li
                  className={`favorites-panel__row${current ? " favorites-panel__row--active" : ""}${unavailable ? " favorites-panel__row--unavailable" : ""}`}
                  key={path}
                >
                  <button
                    className="favorites-panel__file"
                    aria-current={current ? "page" : undefined}
                    aria-label={name}
                    aria-description={statusLabel ? `${statusLabel} · ${path}` : path}
                    aria-busy={busy || undefined}
                    title={statusLabel ? `${path}\n${statusLabel}` : path}
                    onClick={(event) => {
                      if (event.button === 0 && !event.ctrlKey) void open(path);
                    }}
                    onMouseDown={(event) => {
                      if (event.button === 2 || event.ctrlKey) event.preventDefault();
                    }}
                    type="button"
                  >
                    <FavoriteGlyph file />
                    <span className="favorites-panel__name">{name}</span>
                    {hint && <small className="favorites-panel__hint">{hint}</small>}
                  </button>
                  {unavailable && (
                    <button
                      aria-label={`${labels.retry} ${name}`}
                      className="favorites-panel__action favorites-panel__retry"
                      disabled={busy}
                      onClick={() => void open(path)}
                      title={labels.retry}
                      type="button"
                    >
                      <svg aria-hidden="true" height="14" viewBox="0 0 16 16" width="14">
                        <path
                          d="M12.5 5.5A5 5 0 1 0 13 9M12.5 2.5v3.5H9"
                          fill="none"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.3"
                        />
                      </svg>
                    </button>
                  )}
                  <button
                    aria-label={`${labels.remove} ${name}`}
                    className="favorites-panel__action favorites-panel__remove"
                    title={labels.remove}
                    onClick={() => onRemove(path)}
                    type="button"
                  >
                    <svg aria-hidden="true" height="14" viewBox="0 0 16 16" width="14">
                      <path
                        d="m4.5 4.5 7 7m0-7-7 7"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeWidth="1.3"
                      />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {visible && onHide && contextMenu && (
        <FavoritesContextMenu
          closeLabel={translate(locale, "favorites.close")}
          label={translate(locale, "favorites.menuLabel")}
          menu={contextMenu}
          onClose={closeContextMenu}
          onHide={onHide}
        />
      )}
    </section>
  );
}
