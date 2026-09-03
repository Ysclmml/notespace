import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";

import { PlusIcon } from "../../app/shell/icons";
import "./EditorGroupTabs.css";

export const TAB_DRAG_MIME = "application/x-notespace-tab";

export interface EditorGroupTabsProps {
  readonly groupId: string;
  readonly tabs: readonly {
    readonly id: string;
    readonly path: string;
    readonly dirty: boolean;
    readonly preview: boolean;
  }[];
  readonly activeTabId: string | null;
  readonly focused: boolean;
  readonly destinations: readonly { readonly id: string; readonly label: string }[];
  readonly draggedTabId: string | null;
  readonly onDragTabChange: (id: string | null) => void;
  readonly onActivate: (tabId: string) => void;
  readonly onClose: (tabId: string) => void;
  readonly onNew: () => void;
  readonly onSplitRight: (tabId: string) => void;
  readonly onMove: (tabId: string, targetGroupId: string, beforeTabId?: string) => void;
  readonly onKeepOpen: (tabId: string) => void;
  readonly labels: {
    readonly rail: string;
    readonly start: string;
    readonly newTab: string;
    readonly unsaved: string;
    readonly closeTab: (name: string) => string;
    readonly tabActions: string;
    readonly splitRight: string;
    readonly moveTo: (label: string) => string;
    readonly keepOpen: string;
    readonly close: string;
  };
}

interface TabMenu {
  readonly tabId: string;
  readonly x: number;
  readonly y: number;
  readonly keyboard: boolean;
  readonly trigger: HTMLButtonElement;
}

interface MenuAction {
  readonly label: string;
  readonly run: () => void;
}

function TabContextMenu({
  menu,
  label,
  groups,
  onClose,
}: {
  readonly menu: TabMenu;
  readonly label: string;
  readonly groups: readonly (readonly MenuAction[])[];
  readonly onClose: () => void;
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
    const outside = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      if (menu.trigger.isConnected) menu.trigger.focus({ preventScroll: true });
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
      aria-label={label}
      className="editor-group-tab-menu"
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
        event.stopPropagation();
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
          <div key={index} role="group">
            {index > 0 && (
              <div className="editor-group-tab-menu__separator" role="separator" />
            )}
            {group.map((action) => (
              <button
                key={action.label}
                onClick={() => {
                  onClose();
                  action.run();
                }}
                role="menuitem"
                tabIndex={-1}
                type="button"
              >
                {action.label}
              </button>
            ))}
          </div>
        ))}
    </div>,
    document.body,
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function EditorGroupTabs({
  groupId,
  tabs,
  activeTabId,
  focused,
  destinations,
  draggedTabId,
  onDragTabChange,
  onActivate,
  onClose,
  onNew,
  onSplitRight,
  onMove,
  onKeepOpen,
  labels,
}: EditorGroupTabsProps) {
  const [menu, setMenu] = useState<TabMenu | null>(null);
  const [dropTarget, setDropTarget] = useState<
    { tabId: string; side: "before" | "after" } | "append" | null
  >(null);
  const [lastDraggedTabId, setLastDraggedTabId] = useState(draggedTabId);
  const menuTab = menu ? tabs.find((tab) => tab.id === menu.tabId) : undefined;
  const ownsDrag = tabs.some((tab) => tab.id === draggedTabId);

  if (menu && !menuTab) setMenu(null);
  if (lastDraggedTabId !== draggedTabId) {
    setLastDraggedTabId(draggedTabId);
    setDropTarget(null);
  }

  useEffect(() => {
    if (!ownsDrag) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDragTabChange(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [ownsDrag, onDragTabChange]);

  const internalDrag = (event: DragEvent): boolean =>
    draggedTabId !== null &&
    Array.from(event.dataTransfer.types).includes(TAB_DRAG_MIME) &&
    !Array.from(event.dataTransfer.types).includes("Files");

  const finishDrop = (event: DragEvent, beforeTabId?: string) => {
    if (
      draggedTabId === null ||
      !internalDrag(event) ||
      event.dataTransfer.getData(TAB_DRAG_MIME) !== draggedTabId
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    onMove(draggedTabId, groupId, beforeTabId);
    setDropTarget(null);
    onDragTabChange(null);
  };

  const openMenu = (event: MouseEvent<HTMLElement>, tabId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const trigger = event.currentTarget.querySelector<HTMLButtonElement>(".tab-rail__tab");
    if (!trigger) return;
    const keyboard = event.clientX === 0 && event.clientY === 0;
    const bounds = trigger.getBoundingClientRect();
    setMenu({
      tabId,
      trigger,
      keyboard,
      x: keyboard ? bounds.left + 12 : event.clientX,
      y: keyboard ? bounds.bottom : event.clientY,
    });
  };

  return (
    <nav
      aria-label={labels.rail}
      className={`tab-rail editor-group-tabs${focused ? " editor-group-tabs--focused" : ""}${draggedTabId && dropTarget === "append" ? " editor-group-tabs--drop-append" : ""}`}
      onDragLeave={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setDropTarget(null);
      }}
      onDragOver={(event) => {
        if (!internalDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setDropTarget("append");
      }}
      onDrop={(event) => finishDrop(event)}
    >
      {tabs.length === 0 && <span className="tab-rail__placeholder">{labels.start}</span>}
      {tabs.map((tab, index) => {
        const active = tab.id === activeTabId;
        const name = fileName(tab.path);
        const indicator =
          draggedTabId &&
          dropTarget &&
          dropTarget !== "append" &&
          dropTarget.tabId === tab.id
            ? ` tab-rail__item--drop-${dropTarget.side}`
            : "";
        const sideAt = (event: DragEvent<HTMLElement>) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          return event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
        };
        return (
          <div
            className={`tab-rail__item${active ? " tab-rail__item--active" : ""}${tab.preview ? " tab-rail__item--preview" : ""}${draggedTabId === tab.id ? " tab-rail__item--dragging" : ""}${indicator}`}
            draggable
            key={tab.id}
            onContextMenu={(event) => openMenu(event, tab.id)}
            onDragEnd={() => {
              setDropTarget(null);
              onDragTabChange(null);
            }}
            onDragOver={(event) => {
              if (!internalDrag(event)) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              setDropTarget({ tabId: tab.id, side: sideAt(event) });
            }}
            onDragStart={(event) => {
              event.dataTransfer.setData(TAB_DRAG_MIME, tab.id);
              event.dataTransfer.effectAllowed = "move";
              setMenu(null);
              onDragTabChange(tab.id);
            }}
            onDrop={(event) =>
              finishDrop(event, sideAt(event) === "before" ? tab.id : tabs[index + 1]?.id)
            }
            onMouseDown={(event) => {
              if (event.button === 2 || event.ctrlKey) event.preventDefault();
            }}
          >
            <button
              aria-current={active ? "page" : undefined}
              className="tab-rail__tab"
              onClick={(event) => {
                if (event.button === 0 && !event.ctrlKey) onActivate(tab.id);
              }}
              onDoubleClick={(event) => {
                if (event.button === 0 && !event.ctrlKey) onKeepOpen(tab.id);
              }}
              title={tab.path}
              type="button"
            >
              <span className="tab-rail__label">{name}</span>
              {tab.dirty && (
                <span aria-label={labels.unsaved} className="tab-rail__dirty" />
              )}
            </button>
            <button
              aria-label={labels.closeTab(name)}
              className="tab-rail__close"
              onClick={(event) => {
                if (event.button === 0 && !event.ctrlKey) onClose(tab.id);
              }}
              type="button"
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        aria-label={labels.newTab}
        className="tab-rail__new"
        onClick={(event) => {
          if (event.button === 0 && !event.ctrlKey) onNew();
        }}
        type="button"
      >
        <PlusIcon />
      </button>
      {menu && menuTab && (
        <TabContextMenu
          groups={[
            [
              ...(menuTab.preview
                ? [{ label: labels.keepOpen, run: () => onKeepOpen(menu.tabId) }]
                : []),
              { label: labels.splitRight, run: () => onSplitRight(menu.tabId) },
            ],
            destinations
              .filter((destination) => destination.id !== groupId)
              .map((destination) => ({
                label: labels.moveTo(destination.label),
                run: () => onMove(menu.tabId, destination.id),
              })),
            [{ label: labels.close, run: () => onClose(menu.tabId) }],
          ]}
          label={labels.tabActions}
          menu={menu}
          onClose={() => setMenu(null)}
        />
      )}
    </nav>
  );
}
