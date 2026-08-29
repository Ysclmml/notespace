import { useState } from "react";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  FolderIcon,
  MoreIcon,
  OutlineIcon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  WorkspaceMark,
} from "./icons";
import "./AppShell.css";

type SidebarMode = "files" | "outline";

const unavailableHint = "将在后续基础契约完成后接入";

export function AppShell() {
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("files");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div
      className={sidebarCollapsed ? "app-shell app-shell--sidebar-collapsed" : "app-shell"}
    >
      <header className="shell-toolbar">
        <div className="shell-toolbar__cluster" aria-label="浏览导航">
          <button
            className="icon-button"
            disabled
            aria-label="后退"
            title={unavailableHint}
            type="button"
          >
            <ArrowLeftIcon />
          </button>
          <button
            className="icon-button"
            disabled
            aria-label="前进"
            title={unavailableHint}
            type="button"
          >
            <ArrowRightIcon />
          </button>
        </div>

        <button
          aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
          aria-pressed={sidebarCollapsed}
          className="icon-button shell-toolbar__sidebar-toggle"
          onClick={() => setSidebarCollapsed((value) => !value)}
          type="button"
        >
          <PanelLeftIcon />
        </button>

        <div className="workspace-identity" aria-label="当前工作区">
          <WorkspaceMark className="workspace-identity__mark" />
          <span className="workspace-identity__app">Markdown Workspace</span>
          <span className="workspace-identity__separator" aria-hidden="true">
            /
          </span>
          <span className="workspace-identity__current">未打开工作区</span>
        </div>

        <div className="shell-toolbar__actions">
          <button className="command-button" disabled title={unavailableHint} type="button">
            <SearchIcon />
            <span>快速打开</span>
            <kbd>⌘K</kbd>
          </button>
          <button
            className="icon-button"
            disabled
            aria-label="更多操作"
            title={unavailableHint}
            type="button"
          >
            <MoreIcon />
          </button>
        </div>
      </header>

      {!sidebarCollapsed && (
        <aside className="sidebar" aria-label="工作区侧栏">
          <div className="sidebar__mode-tabs" role="tablist" aria-label="侧栏内容">
            <button
              aria-controls="sidebar-panel"
              aria-selected={sidebarMode === "files"}
              className="sidebar__mode-tab"
              onClick={() => setSidebarMode("files")}
              role="tab"
              type="button"
            >
              文件
            </button>
            <button
              aria-controls="sidebar-panel"
              aria-selected={sidebarMode === "outline"}
              className="sidebar__mode-tab"
              onClick={() => setSidebarMode("outline")}
              role="tab"
              type="button"
            >
              大纲
            </button>
          </div>

          <div className="sidebar__body" id="sidebar-panel" role="tabpanel">
            {sidebarMode === "files" ? (
              <div className="sidebar-empty">
                <FolderIcon className="sidebar-empty__icon" />
                <p className="sidebar-empty__title">尚未打开工作区</p>
                <p>完成本地资源授权契约后，这里会显示文件树。</p>
              </div>
            ) : (
              <div className="sidebar-empty">
                <OutlineIcon className="sidebar-empty__icon" />
                <p className="sidebar-empty__title">当前没有可用大纲</p>
                <p>打开 Markdown 文档后，将按标题生成可导航大纲。</p>
              </div>
            )}
          </div>

          <div className="sidebar__footer">
            <span>本地工作区</span>
            <span className="sidebar__privacy">默认离线</span>
          </div>
        </aside>
      )}

      <nav className="tab-rail" aria-label="文档标签页">
        <button aria-current="page" className="tab-rail__tab" type="button">
          <span>开始</span>
        </button>
        <button
          className="tab-rail__new"
          disabled
          aria-label="新建标签页"
          title={unavailableHint}
          type="button"
        >
          <PlusIcon />
        </button>
      </nav>

      <main className="main-viewport">
        <section className="welcome" aria-labelledby="welcome-title">
          <div className="welcome__symbol" aria-hidden="true">
            <WorkspaceMark />
          </div>
          <p className="welcome__eyebrow">基础壳 · Phase 0</p>
          <h1 id="welcome-title">把本地文档，当作可以编辑的浏览器。</h1>
          <p className="welcome__lead">
            当前版本先建立可靠的桌面边界与 Paper &amp; Ink
            视觉骨架。文件、编辑器和导航能力会在契约冻结后逐步接入。
          </p>

          <div className="welcome__actions" aria-label="尚未接入的开始操作">
            <button
              className="primary-button"
              disabled
              title={unavailableHint}
              type="button"
            >
              打开工作区
            </button>
            <button
              className="secondary-button"
              disabled
              title={unavailableHint}
              type="button"
            >
              打开 Markdown
            </button>
          </div>

          <p className="welcome__availability">
            文件能力尚未接入；此页面不会读取或上传本地文档。
          </p>

          <ol className="foundation-progress" aria-label="基础建设进度">
            <li className="foundation-progress__item foundation-progress__item--ready">
              <span className="foundation-progress__index">01</span>
              <span>
                <strong>桌面壳</strong>
                <small>窗口、视觉与构建边界</small>
              </span>
            </li>
            <li className="foundation-progress__item">
              <span className="foundation-progress__index">02</span>
              <span>
                <strong>本地契约</strong>
                <small>权限、文件与安全接口</small>
              </span>
            </li>
            <li className="foundation-progress__item">
              <span className="foundation-progress__index">03</span>
              <span>
                <strong>编辑主链路</strong>
                <small>打开、编辑、保存与恢复</small>
              </span>
            </li>
          </ol>
        </section>
      </main>

      <footer className="status-bar" role="status" aria-live="polite">
        <span className="status-bar__state">
          <span className="status-bar__dot" aria-hidden="true" />
          基础壳已就绪
        </span>
        <span>本地优先 · 无网络能力</span>
        <span>Markdown Workspace 0.1.0</span>
      </footer>
    </div>
  );
}
