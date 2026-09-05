import type { AppLocale } from "../../app/settings";

export interface HelpSection {
  readonly id: string;
  readonly title: string;
  readonly intro: string;
  readonly items: readonly { readonly title: string; readonly text: string }[];
}

export function helpSections(locale: AppLocale): readonly HelpSection[] {
  return locale === "zh-CN"
    ? [
        {
          id: "start",
          title: "开始使用",
          intro: "直接编辑本地文件，不需要账户。Markdown、代码和图片仍保存在你选择的位置。",
          items: [
            {
              title: "打开文件或工作区",
              text: "一个文件可以单独打开；工作区是你选择的文件夹。可同时打开多个工作区，在左侧文件栏查看各自的目录。打包安装版还可通过系统文件管理器的“打开方式”把 .md/.markdown 文件交给 NoteSpace 打开。",
            },
            {
              title: "标签与分屏",
              text: "单击文件临时预览，双击或编辑后保持打开。标签右键可向右分屏，移动原标签；前进和后退可以跨标签回到之前的位置。",
            },
            {
              title: "本地保存",
              text: "默认手动保存。首次保存新文档会选择文件位置；未保存时关闭会询问。设置中可开启停止输入后的自动保存，它不自动保存未命名文档。",
            },
          ],
        },
        {
          id: "write",
          title: "编辑与阅读",
          intro: "Markdown 默认直接编辑排版后的内容，也可明确切换到源码。",
          items: [
            {
              title: "阅读模式",
              text: "顶部“阅读 / 编辑”随时一键切换，专注时也保留切换按钮。默认编辑；开启阅读后，所有标签和分屏（包括新打开的文件）防止误输入，并精简编辑工具与右键。仍可选字、复制、查找、打开链接和查看图表；切换保留当前位置、已有修改与撤销记录。下次启动仍默认编辑。",
            },
            {
              title: "可视与源码",
              text: "工具栏或 Cmd/Ctrl+/ 切换。切换本身不修改文档；首次可视编辑后，Markdown 的空白和标记可能被规范化。普通代码文件始终使用代码编辑器。",
            },
            {
              title: "表格、图片和图表",
              text: "表格可直接编辑并用就地工具增删行列。截图粘贴先保存图片文件，再插入链接；撤销只移除链接，不删除图片。点击图片或 Mermaid 可放大查看。",
            },
            {
              title: "专注模式",
              text: "Cmd/Ctrl+Shift+Enter 收起工具栏、侧栏与标签。正文和撤销记录保留；退出按钮或 Esc 返回。Esc 会先关闭查找栏或对话框。",
            },
          ],
        },
        {
          id: "search",
          title: "查找与搜索",
          intro: "三个入口各有用途：找文件、找正文、找当前页。",
          items: [
            {
              title: "快速打开 · Cmd/Ctrl+K",
              text: "按文件名和相对路径筛选已打开工作区中的文件，不搜索正文。右上角的“快速打开”使用这个入口。",
            },
            {
              title: "全文搜索 · Cmd/Ctrl+Shift+F",
              text: "独立面板搜索已打开工作区内 Markdown、代码和文本的磁盘正文。默认全部已打开工作区，也可选一个工作区；不搜索整台电脑、已关闭工作区或未保存的修改。结果按文件分组，点击匹配行定位；再次打开搜索会回到本次运行内的上次结果、滚动位置和最后点击项，不重复扫描。成功提交后会在本地保留搜索条件，默认 15 条，可在设置中调整为 1–30 条；最近项只显示查询文字，点选只回填条件，绝不会自动触发磁盘搜索，也可手动清空。结果和片段不会持久保存。",
            },
            {
              title: "当前页查找与替换 · Cmd/Ctrl+F",
              text: "只查当前活动页，可展开单项或全部替换，全部替换可以一次撤销。可视模式查可见文字，源码模式查源文本，所以数量可能不同。只读预览不允许替换。",
            },
            {
              title: "搜索为什么可能不完整",
              text: "搜索沿用每个工作区的隐藏文件设置，跳过依赖、构建缓存、符号链接及过大或不可读的文件。达到扫描或结果上限时会明确提示，缩小范围后可再次搜索。",
            },
          ],
        },
        {
          id: "organize",
          title: "收藏与模板",
          intro: "常用文件集中收藏，重复文档用本地 Markdown 模板创建。",
          items: [
            {
              title: "收藏文件",
              text: "文件右键或工具栏星标可收藏/取消收藏。收藏显示在文件栏顶部的可折叠分组，与固定标签独立；仅记录路径，不复制正文。如需隐藏整个分组，请右键或按住 Control 点击“收藏”标题，再在菜单中明确选择“关闭收藏”；可在设置中恢复。关闭分组不会清空已收藏路径。",
            },
            {
              title: "工作区关闭或文件失效",
              text: "关闭工作区不移除收藏。点击仍存在的收藏文件会单独打开，不自动重新打开整个工作区。文件被删除、移动或暂不可读时保留并标记，不静默移除；可重试或取消收藏。取消收藏不会删除文件。",
            },
            {
              title: "内置与自定义模板",
              text: "“更多 → 从模板新建”提供会议记录、周报和技术方案。自定义页可把当前正文保存为模板、刷新列表或打开模板文件夹。使用模板会创建新的未保存 Markdown，不覆盖原文或模板。",
            },
            {
              title: "模板存在哪里",
              text: "自定义模板是用户数据目录 templates 文件夹中的普通 .md/.markdown 文件，不在应用安装包内。升级不覆盖模板，Debug 与正式版各自独立。可在文件夹中编辑或删除；模板不执行宏，也不自动复制图片，保存新文档后请检查相对图片引用。",
            },
          ],
        },
        {
          id: "share",
          title: "导出与文件安全",
          intro: "导出生成可分享文件，不会替你保存或修改原文。",
          items: [
            {
              title: "导出 → HTML / PDF",
              text: "HTML 把样式、本地图片和静态 Mermaid 放进一个文件，对方可离线打开，不需要 NoteSpace。macOS 还支持分页 PDF，文字可选择；其他平台暂不提供原生 PDF。",
            },
            {
              title: "联网图片与分享范围",
              text: "联网图片需在本次导出明确勾选下载，不上传正文。缺图、图表错误或资源过大时会停止并提示。只导出当前文档，不打包链接指向的其他笔记，也不会自动发布到网站。",
            },
            {
              title: "外部修改与删除",
              text: "其他程序修改干净文件时会更新；存在未保存修改时保留当前内容并提示冲突，不自动覆盖。文件已删除时保留打开的正文，可另存为。工作区删除操作使用系统废纸篓。",
            },
            {
              title: "什么是离线帮助",
              text: "就是当前这份随应用提供的功能说明与快捷键速查，不需要联网。核心编辑可离线使用；远程图片和外部网页仍需要网络。",
            },
          ],
        },
      ]
    : [
        {
          id: "start",
          title: "Getting started",
          intro:
            "Edit local files without an account. Markdown, code and images stay where you choose.",
          items: [
            {
              title: "Files and workspaces",
              text: "Open a file on its own, or choose a folder as a workspace. Multiple workspaces can be open together in the Files sidebar. The packaged app can also receive .md/.markdown files through your system file manager’s Open With command.",
            },
            {
              title: "Tabs and groups",
              text: "Single-click to preview; double-click or edit to keep a tab open. Right-click a tab to move it into a right-hand group. Back and Forward can revisit positions across tabs.",
            },
            {
              title: "Saving",
              text: "Saving is manual by default. New documents ask for a location; closing unsaved edits asks for confirmation. Optional inactivity auto-save only saves documents that already have a path.",
            },
          ],
        },
        {
          id: "write",
          title: "Writing and reading",
          intro:
            "Markdown opens in visual editing. Source mode is always an explicit choice.",
          items: [
            {
              title: "Reading mode",
              text: "Use Read / Edit at the top, or in focus mode, to switch with one click. Editing is the default. Reading protects every tab and split, including newly opened files, from accidental input and hides editing tools. Selection, copying, find, links and diagram viewing remain available. Switching preserves your position, existing changes and undo history. The next launch starts in editing mode.",
            },
            {
              title: "Visual and source",
              text: "Switch using the toolbar or Cmd/Ctrl+/. Switching does not edit the document. The first visual edit may normalize equivalent Markdown formatting. Code files use the code editor.",
            },
            {
              title: "Tables, images and diagrams",
              text: "Edit table cells directly and use their tools for rows and columns. Pasted screenshots are saved as files before links are inserted; Undo removes the link, not the image file. Click images or Mermaid to zoom.",
            },
            {
              title: "Focus mode",
              text: "Cmd/Ctrl+Shift+Enter hides the surrounding interface while preserving the editor and Undo. Use Exit or Esc to return. Esc closes dialogs and find bars first.",
            },
          ],
        },
        {
          id: "search",
          title: "Finding and searching",
          intro: "Choose between file names, workspace contents and the current page.",
          items: [
            {
              title: "Quick open · Cmd/Ctrl+K",
              text: "Filter file names and relative paths in open workspaces, not file contents. Use Quick open at the top right.",
            },
            {
              title: "Search contents · Cmd/Ctrl+Shift+F",
              text: "Search the on-disk contents of Markdown, code and text files in all open workspaces or one selected workspace. It does not search your whole computer, closed workspaces or unsaved edits. Click a matching line to open it; reopening Search returns to the previous in-memory results, scroll position and last activated match without scanning again. Successful conditions are kept locally: 15 by default, configurable from 1–30 in Settings. Recent items show only the query; selecting one only fills the controls and never starts a disk search automatically. You can clear the list manually. Results and snippets are never persisted.",
            },
            {
              title: "Find and replace · Cmd/Ctrl+F",
              text: "Search the active page and expand Replace for one or all matches. Replace all is one Undo step. Visual mode searches visible text; source mode searches source text. Read-only previews cannot replace.",
            },
            {
              title: "Incomplete results",
              text: "Search respects hidden-file preferences and skips dependencies, build caches, symbolic links, oversized and unreadable files. Reached limits are reported. Narrow the scope and search again.",
            },
          ],
        },
        {
          id: "organize",
          title: "Favorites and templates",
          intro:
            "Keep frequent files together and reuse ordinary local Markdown templates.",
          items: [
            {
              title: "Favorite a file",
              text: "Use a file’s context menu or the toolbar star. Favorites form a collapsible group above workspace trees, separate from pinned tabs. Only paths are remembered. To hide the whole group, right-click or Control-click the Favorites heading, then explicitly choose Close Favorites from its menu; restore it in Settings. Closing the group does not clear any favorite paths.",
            },
            {
              title: "Closed workspaces and unavailable files",
              text: "Closing a workspace keeps its favorites. Opening a favorite opens the file on its own without reopening the workspace. Missing, moved or unreadable files remain marked and can be retried or removed. Removing a favorite never deletes the file.",
            },
            {
              title: "Built-in and custom templates",
              text: "More → New from template offers meeting notes, weekly reports and technical proposals. The Custom tab can save the current content, refresh the list or open its folder. Using a template creates a new unsaved document, leaving both originals unchanged.",
            },
            {
              title: "Template storage",
              text: "Custom templates are ordinary .md/.markdown files in the user-data templates directory, not inside the app bundle. Updates preserve them; Debug and release apps have separate libraries. Manage files directly. No macros or image copying; check relative image references after saving the new document.",
            },
          ],
        },
        {
          id: "share",
          title: "Export and file safety",
          intro:
            "Export creates a shareable file without saving or modifying your original.",
          items: [
            {
              title: "Export → HTML / PDF",
              text: "HTML embeds styles, local images and static Mermaid in one file for offline reading without NoteSpace. macOS also offers paginated PDF with selectable text; native PDF is not yet available on other platforms.",
            },
            {
              title: "Online images and scope",
              text: "Online images need explicit download consent for each export. Document contents are never uploaded. Missing media, diagram errors or exceeded limits stop export. Linked documents are not bundled, and nothing is automatically published online.",
            },
            {
              title: "External changes",
              text: "Clean files can reload external changes. Unsaved edits are preserved with a conflict notice instead of silently overwritten. A deleted file’s open content remains available for Save As. Workspace deletion uses the system Trash.",
            },
            {
              title: "Offline help",
              text: "This guide and shortcut reference ship with the app and need no connection. Core editing works offline; remote images and external websites still require a network.",
            },
          ],
        },
      ];
}
