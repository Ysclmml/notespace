# NoteSpace（笔记空间）完整设计

| 字段     | 值                                                                               |
| -------- | -------------------------------------------------------------------------------- |
| 状态     | Approved baseline 2.3（ADR-0026；NoteSpace 0.2.2，跨表面数学分隔符兼容）         |
| 日期     | 2026-09-04                                                                       |
| 首发平台 | macOS 桌面端；Android 移动阅读端优先                                             |
| 技术栈   | React 19 + TypeScript + Milkdown/ProseMirror + CodeMirror 6 + Tauri 2 + Rust     |
| 数据原则 | 本地 Markdown、文本与图片资源文件是唯一持久化真相；UI 投影和本机便利状态均可重建 |

本文是实现、评审和上下文压缩后的首要产品规范。若历史设计与本文冲突，以 [ADR-0005](decisions/0005-lean-local-editor-boundary.md)、[ADR-0006](decisions/0006-visual-editor-explicit-source-mode.md)、[ADR-0007](decisions/0007-local-files-multiple-workspaces-and-split-preview.md)、[ADR-0008](decisions/0008-save-workspace-files-and-visual-tables.md)、[ADR-0009](decisions/0009-recoverable-workspace-delete-and-dirty-close.md)、[ADR-0010](decisions/0010-workspace-context-actions-and-folder-creation.md)、[ADR-0011](decisions/0011-editor-groups-preview-tabs-and-image-links.md) 和本文为准。

导航规则由 [ADR-0012](decisions/0012-markdown-link-policy-and-window-navigation.md) 更新：普通 Markdown 链接按当前标签是否固定选择新页/原位，工具栏前进/后退使用窗口级跨标签访问轨迹。[ADR-0013](decisions/0013-browsing-restore-and-unified-editor-panes.md) 进一步取代旧的独立右侧只读栏、分屏复制标签和不恢复浏览元数据边界。[ADR-0014](decisions/0014-external-filesystem-changes.md) 接受轻量外部文件监听、重载与版本检查，取代“外部修改后置”。[ADR-0015](decisions/0015-workspace-clipboard-images.md) 接受每工作区截图位置、剪贴板兼容和本地图片单文件授权；冲突时以最新适用 ADR 和当前 baseline 2.3 为准。

## 1. 产品定义

[ADR-0016](decisions/0016-workspace-search-html-export-and-restore-notice.md) 增加工作区全文搜索、静态 HTML 导出及失效浏览恢复提示。[ADR-0017](decisions/0017-writing-tools-and-shareable-exports.md) 将导出升级为含图片和静态 Mermaid 的可分享 HTML 与 macOS PDF，并增加可配置格式快捷键、当前页替换、收藏、专注和模板；冲突时优先于早期基线，其他编辑与数据边界保持不变。

[ADR-0018](decisions/0018-organized-favorites-global-search-and-local-templates.md) 将收藏并入文件页顶部折叠组、全文搜索移为独立弹窗，并补充离线帮助、本地 Markdown 模板库及导出二级菜单；该基线确立了 25 个实际命令和 19 个原生菜单动作。

[ADR-0019](decisions/0019-search-favorites-and-github-update-checks.md) 增加应用自绘搜索范围、正文/路径正则、收藏显示设置和固定 GitHub 最新发布检查；新增 `check_for_update()` 后当前有 26 个实际命令，原生菜单动作仍为 19 个。

[ADR-0020](decisions/0020-search-history-favorites-menu-and-markdown-associations.md) 增加有界的最近搜索条件、明确的收藏关闭菜单，以及打包应用的 `.md/.markdown` 文件关联；新增 `take_opened_document_paths()` 后当前有 27 个实际命令，原生菜单动作仍为 19 个。

[ADR-0021](decisions/0021-search-session-and-desktop-ui-localization.md) 让全文搜索在结果跳转后恢复本次运行内的结果与位置，历史上限改为默认 15、可配 1–30，并补齐 macOS 系统菜单本地化和 About 稳定状态区；命令与原生菜单动作数量不变。

[ADR-0022](decisions/0022-mobile-lan-reader.md) 接受一个 Android 优先的真实移动 App：桌面端只在用户明确开启并选择根后提供局域网只读数据，手机负责目录、搜索、收藏、最近和 Markdown 阅读。移动 UI 随 App 打包；生产发布前必须完成 HTTPS 证书固定、一次性配对和逐设备撤销，Debug 明文纵向链路不算发布能力。

[ADR-0023](decisions/0023-debug-lan-sharing-without-pairing.md) 取代 ADR-0022 对开发期原型的一次性口令/配对要求：当前纵向链路是仅 Debug 可启动的无认证 HTTP/JSON 服务，通过 mDNS 发现并保留 `host:port` 手动连接，同一电脑允许多个手机并发阅读。用户明确启停、勾选根、只读、opaque ID 和路径边界继续生效；Release 必须拒绝这套无认证传输。

[ADR-0024](decisions/0024-debug-lan-runtime-and-release-isolation.md) 纠正该原型的运行时语义：协议和桌面只显示瞬时 `activeRequestCount`，不推断在线/配对设备；mDNS 返回多个地址候选并逐一探测，磁盘 I/O 不持全局锁，停止会取消长任务并立即废弃 listener/旧 ID。Release 在编译、命令注册、CSP 和 Android 多播权限四层排除无认证链路，不能只依赖运行时拒绝。

[ADR-0025](decisions/0025-lan-offline-reader.md) 取代上述 Debug/Release 隔离与发布前可信配对门槛：无认证局域网阅读进入普通桌面和移动构建，仍须用户显式启动、选择当前已打开根且保持只读。两端默认端口统一为 `49920`，桌面可持久修改；手机可只填主机。用户还可逐工作区保存有界、原子替换的 IndexedDB Markdown 离线快照，断网时继续浏览/搜索/最近，重连后自动刷新。图片/资源不进入本轮离线包；APK 更新器另行实现。

NoteSpace（笔记空间）是一个“像 Typora 一样编辑、像浏览器一样阅读”的本地桌面编辑器：Markdown 使用稳定真可视编辑；文档跳转具有 Tab、前进和后退；代码/配置/纯文本也能直接编辑。默认单画布，可将原标签移动到横向编辑组并在组间拖动；本地引用可先看只读浮层或进入普通右侧编辑组，图片链接进入专门查看器。启动可恢复上次浏览的路径与视图，也可按偏好打开空白窗口，正文始终从磁盘读取。

首版集中解决这些真实摩擦：

1. 普通 Markdown 默认直接编辑渲染结果，只有用户明确选择时显示源码。
2. 系统截图一次粘贴即可写入 Markdown 所在目录或工作区指定目录，并插入图片链接。
3. 本地 Markdown 链接支持原地、后台 Tab、前台 Tab、前进/后退和 heading anchor。
4. Mermaid 与大图可进入查看器缩放、平移和 Fit。
5. 代码/文本无需另开 IDE 即可做普通文本修改和原子保存。
6. 可同时查看多个工作区文件树，在根/子目录新建文本文件，并从应用定位到访达/系统文件管理器。
7. 默认手动保存；dirty 状态覆盖整个 Tab 历史并通过应用内对话框可靠确认，需要时可启用停止输入后的自动保存。
8. GFM 表格保持真可视，可横向滚动、临时调列宽、用网格插入并增删行列。
9. 多根可独立折叠、复制路径或从当前窗口关闭；工作区内文件/目录可经确认移到系统废纸篓。
10. 当前页可用 `⌘F` / `Ctrl+F` 查找；每个工作区可独立选择是否显示隐藏项。
11. 其他应用新增/修改/删除文件后，文件树同步刷新；干净正文可重载，草稿与缺失文件保留缓冲区并提示处理。

约 10 MiB Base64 是低频误操作：只在内容进入编辑器前阻止卡死，不建设修复或安全平台。普通大多行文件用 `sourceOnly` 降级。

## 2. 产品边界

### 2.1 当前能力

- 恢复过程中暂不可用的工作区/文件有非模态提示：详情、重试、选择文件夹或只移除最近记录；不自动判定为删除，不重建磁盘内容。
- 工具栏全文搜索（`Cmd/Ctrl+Shift+F`）打开独立弹窗，通过带清晰 SVG 箭头的应用自绘单选控件选择全部已打开根或一个根，按用户提交读取受支持 Markdown/代码/文本的磁盘正文；快速打开仍只查文件名/路径。正文默认普通文本，可切换正则并选择大小写；另有独立、忽略大小写的文件名/相对路径正则筛选。最近记录紧凑显示查询文字，默认保留 15 条成功搜索条件，可在设置中调整为 1–30 条、选择回填或手动清空；选择历史不会自动读盘，已关闭的历史范围回退为全部当前根。无效正则分别提示；匹配行号与上下文、隐藏/后缀/重目录/symlink 过滤及有限无索引扫描保持不变。每行首次命中，最多 200 行结果；32 根、20,000 枚举项、5,000 文件、2 MiB 单文件、64 MiB 总读取、64 层深度限制，达到边界或部分目录不可读明确标记不完整。跳过与不可用根单独报告。未保存修改不参与磁盘搜索。点击结果关闭弹窗、保持现有 dirty 会话并在活动组定位；重开时恢复本次运行内的表单、结果、滚动和最后激活项，不重新读盘，退出应用即丢弃结果。
- 普通 Markdown 导出为自带图片/样式/静态 Mermaid 的单文件 HTML 或 macOS 原生分页 PDF。采用最新正文快照与 remark 白名单，不导出可执行 HTML/脚本或编辑器 DOM。图片字节由 Rust 有界嵌入最终产物，不经过 JS/Markdown Base64；联网图片仅在本次对话框显式勾选后读取。缺失/过大/无法渲染资源导致明确失败，不静默缺图。source-only 暂禁用，解析前正文限 8 MiB；详细预算与原子目标保护见 ADR-0017。导出不清 dirty、不改 Undo，不递归打包其他文档。
- 当前页查找可展开可撤销的单项/全部替换；设置可重绑平台格式快捷键。文件收藏只存路径，与固定标签独立；内置模板在当前组新建 dirty 未命名 Markdown；专注模式保持编辑器挂载，只隐藏界面并支持 Esc/快捷键退出。
- 收藏位于文件页顶部可折叠分组，工具栏星标/文件右键均可添加或移除。`showFavorites` 设置可显示或隐藏分组；标题右键/Control-click 打开菜单，只有明确选择「关闭收藏」才隐藏，普通左键仍只折叠。关闭不会清空收藏路径。工作区关闭后独立打开收藏文件；失效项保留并标记，重试/取消不删除或修复原文件。只检查最多 100 个路径元数据，不读取正文。
- 打包版声明可编辑 `.md/.markdown`，可从 Finder/系统「打开方式」进入现有文档打开流程；应用只注册候选处理程序，不静默接管系统默认。关联文件作为独立前台标签打开，不隐式打开父目录工作区，继续使用既有预检、共享会话、dirty 和保存规则。
- About 显示当前应用版本并可手动检查更新；默认启动检查可在设置中关闭。检查只读取 `https://api.github.com/repos/Ysclmml/notespace/releases/latest` 的稳定发布元数据，失败不影响编辑；跳过仅记住该一个版本，发布页只在用户点击后交给系统浏览器。不自动下载/安装，不上传文档或路径。
- 自定义模板位于当前应用 `app_data_dir()/templates`，不在安装包内；显式打开「自定义模板」才列目录，可复制当前正文为模板、刷新、打开文件夹管理。直属普通 `.md/.markdown`，最多 128 篇/1024 枚举项、单篇 256 KiB；有界预检、create-new 不覆盖，失败提示。选用生成普通 dirty 未命名 Markdown，保存模板不保存源页；不搬运相对图片或执行模板变量。

- 多工作区根及其文件树同时显示、各根独立折叠、活动根、聚合 Quick Open、根路径复制/关闭、独立文件打开和最近工作区/文件；根右键可切换本根隐藏项显示，默认关闭。
- 启动默认 `restore`，按保存的路径、标签/分组顺序、固定状态和数值阅读位置重新打开磁盘文件；`empty` 跳过工作区/标签自动打开但保留最近项。不保存正文、未命名页或导航历史。
- 新建未命名 `.md`/`.txt`；也可在工作区根/现有子目录新建 Markdown 或受支持代码/文本；根/目录/文件可复制绝对路径或在系统文件管理器中显示，工作区内文件/目录可经确认移到系统废纸篓。
- 默认手动保存；可配置 1–300 秒停止输入后自动保存，未命名文档仍需 Save As，失败仍 dirty；关闭 Tab/窗口/应用时按整个 Tab 历史聚合 dirty 并显示应用内对话框。
- 原生监听工作区及独立文件的外部变化，聚焦和 30 秒兜底复查；元数据未变不读取正文。干净 session 更新共享正文，dirty/缺失/不可读/blocked 保留缓冲区，提示条暂停普通保存并提供明确的重载/覆盖或 Save As。
- Markdown 使用 Milkdown/ProseMirror 默认真可视 + CodeMirror 显式源码；普通代码/文本使用可编辑 CodeMirror 主 Tab。
- 横向编辑分组与多 Tab；向右分屏移动原 Tab 而不复制，可保留空白左组。每个 Tab 独立 back/forward 和各表面阅读位置，同一文档共享正文。文件树单击打开斜体临时标签，双击/编辑固定，新文件进入当前聚焦组。
- Markdown 相对链接、heading anchor、可点击 Outline；Markdown 路由优先于本地引用预览。
- `path.ext:line` 的有界只读浮层与普通可编辑 Tab；“在右侧打开”复用右邻编辑组，已有右组时新代码引用直接进入该组，不叠加第三辅助栏。干净临时页可替换，固定/dirty 页保留。
- 当前页查找覆盖可视正文、Markdown 源码和普通代码，支持匹配定位/循环与退出，不修改正文或 dirty。
- 浅色 fenced code、真实行号、可读 selection 对比度、失焦后清理旧活动选区、语言选择/Copy、fence 语言自动补全和列表 marker 对齐；长链接编辑地址可完整换行。
- 中英文 Shell、设置、应用内菜单、自定义右键和 macOS 原生菜单。
- 十三项本地持久设置；Base64 预检、截图落盘后插链接、同目录原子保存三项实用护栏。
- GFM 表格真可视编辑、内部横向滚动、view-only 列宽、尺寸网格和行列结构操作。
- Mermaid/图片文内预览与沉浸查看器。
- 同仓库已有独立的 NoteSpace Mobile 构建表面与 Android 工程。真实无认证 HTTP/mDNS transport 是普通构建能力，优先取得多个地址候选并逐一探测，也可输入主机并使用默认 `49920` 端口。桌面共享核心仅为本次勾选的已打开根生成 opaque ID，从磁盘有界读取且 I/O 不持全局锁；同网多个手机可并发浏览。手机可将明确标记的工作区完整保存为 IndexedDB Markdown 快照，断网时继续浏览/搜索/最近并在重连后原子刷新。

自动验证、桌面验收与构建状态以对应修订的实际执行结果为准，不用历史结果替代当前验证。

### 2.2 明确不做

- 账户、云同步、协作、公共/云端服务、遥测、默认网络上传或后台常驻共享。ADR-0025 只增加用户显式开启的同一局域网进程内只读服务，以及用户逐工作区明确保存的手机本地离线投影。
- ProseMirror JSON、工作区数据库、Tab 正文快照或窗口布局作为保存真相。
- 纵向/递归分屏、pane tree、跨窗口拖拽或 IDE docking framework；当前仅扁平横向编辑组。
- LSP、语义代码导航、补全服务器、debug/build/run、终端或完整 IDE。
- Base64 自动提取修复、隔离区、崩溃恢复日志、资产 journal/GC。
- 文件锁服务、自动三方合并、外部重命名身份跟踪或后台文件同步引擎；当前只做路径通知、元数据检查和用户可控重载/保存。
- 与文件修复无关的 HMAC/repair token、193 MiB IPC 测试、37 命令 schema、通用 feature flags。当前 ADR-0025 局域网服务明确不使用设备认证 nonce/token、TLS 或配对；这不取消所选根、只读和路径预算。
- 递归创建目录、重命名、移动、复制文件内容、永久删除、批量文件操作或通用文件管理器。
- Git、知识图谱、AI、插件市场；真实需求出现后逐项决策。
- 任意更新源、静默替换应用包、JavaScript/HTML 热更新或携带文档/工作区路径的更新请求；桌面当前只允许 ADR-0019 的固定 GitHub 最新发布查询，手机 APK 的固定 GitHub Release 检查、用户确认下载和系统安装器仍为后续工作。

## 3. 体验与视觉

视觉基线是 [Paper & Ink 主界面原型](prototypes/markdown-workspace-main-v1.svg)。参考 Typora 的克制排版，但导航骨架更接近浏览器。

### 3.1 窗口结构

```text
┌──────────────────────────────────────────────────────────────────────┐
│ ←  →  [侧栏]  当前工作区 / 当前文档      快速打开  更多             │
├──────────────┬───────────────────────────────────────────────────────┤
│ 多工作区根   │ 组 1：Tab A | +       │ 组 2：Tab B / code.py | +   │
│ 文件 / 大纲  ├───────────────────────┼─────────────────────────────┤
│              │                       │                             │
│ 各自文件树   │ 可视 / 源码 / 文本    │ 同样可编辑、保存、拖动标签  │
│ 最近项       │                       │ 独立阅读位置与查找          │
├──────────────┴───────────────────────┴─────────────────────────────┤
│ 保存状态 · 字数/行数 · 行列 · Markdown 模式                          │
└──────────────────────────────────────────────────────────────────────┘
```

- 默认只有左侧一个活动编辑组；每组有独立标签栏和当前编辑器。标签右键“向右分屏”移动同一 Tab 到右邻组，不存在时才创建；不复制 Tab/session/history。移动唯一标签时可保留可激活的空白左组以继续打开文件，其他无保留标记的空组收起，最后空组显示欢迎页。支持跨组拖放；相邻分隔线可拖动/键盘调整、双击复位。编辑器以 Tab ID 为稳定 key，移动改变列位置而不重建其当前 EditorView。
- 窄窗口横向溢出时，激活/新增编辑组或视口缩窄只做最小横向定位，确保活动组可见；正文更新和分隔线调整不抢回用户手动横向滚动，也不移动正文或整页的纵向位置。
- 主窗口显式关闭原生文件拖放捕获（`dragDropEnabled: false`），内部 HTML5 标签拖放交由 WebView；不接入外部文件拖放功能。
- 不再创建独立右侧辅助栏。只有一个编辑组时，本地代码引用可先进入有界只读浮层；选择“在右侧打开”创建普通右组。已有右组时点击新代码引用直接复用右邻组，最右来源则复用本组并保留来源 Markdown；不为代码预览额外添加第三栏。
- 右侧代码使用完整文件的普通 CodeMirror Tab，遵循临时替换、双击/编辑固定、共享 session、dirty、保存和关闭规则；快速连续点击只允许最新请求生效。只有局部浮层继续使用有界只读片段。
- 文件模式侧栏按打开顺序同时显示全部工作区根及各自文件树，每个根可独立折叠，活动根高亮；工作区切换器仍列出已打开根、最近根和最近文件。关闭工作区只移出本窗口的打开集合，不关闭已打开主 Tab、不删除最近项或磁盘文件。
- 正文默认宽 920 px，可在 640–1600 px 间设置；大表格和图可突破正文宽度。
- 暖白纸面、深灰文字、低饱和蓝色交互；不堆渐变和装饰卡片。
- 活动文档自动展开到最长匹配工作区根的文件位置，只滚动侧栏；输入或同路径刷新不推翻用户的手动折叠。根使用明确的工作区标识、层级间距和可访问折叠按钮，区别于普通子目录。活动文件、悬停与键盘焦点使用独立蓝/灰色阶，活动编辑组的标签高亮强于非活动组。

### 3.2 核心交互

| 动作                          | 行为                                                                      |
| ----------------------------- | ------------------------------------------------------------------------- |
| 普通点击内部 Markdown 链接    | 未固定 Tab 原位替换；固定/编辑 Tab 在原组新开预览页；同文档 anchor 留原页 |
| `⌘` 点击或中键                | 新后台主 Tab                                                              |
| `⌘⇧` 点击                     | 新前台主 Tab                                                              |
| 后退/前进                     | 跨标签/编辑组恢复文档与位置，不触发编辑 Undo                              |
| 文件树单击                    | 当前聚焦组打开斜体临时 Tab，可替换该组干净预览                            |
| 文件树/标签双击、正文编辑     | 固定标签，下次树单击另开临时 Tab                                          |
| 标签右键“向右分屏”            | 移动原 Tab 到右邻组，不存在则创建；可保留空白左组                         |
| 标签跨组拖动/菜单移动         | 移动原 Tab 并保留历史、模式、编辑器和位置                                 |
| 点击 Outline / heading anchor | 滚动并聚焦目标标题                                                        |
| `⌘K` / `⌘P`                   | 聚合搜索全部已打开工作区文件                                              |
| `⌘F` / `Ctrl+F`               | 查找当前活动页；前后匹配、循环和 Esc 退出，不改变正文                     |
| `Cmd/Ctrl+Shift+F`            | 打开磁盘全文搜索；自绘范围、双正则和可清空最近搜索条件                    |
| `⌘O`                          | 原生 chooser 打开独立文件                                                 |
| `⌘N`                          | 新建 Markdown；应用内菜单另有新建文本                                     |
| `⌘S` / `⌘⇧S`                  | 保存 / 另存为当前可编辑主 Tab                                             |
| 工作区根/目录“新建文件”       | 无扩展名补 `.md`；成功后刷新所属树并前台打开                              |
| 文件/目录“在访达中显示”       | 调用系统文件管理器定位；不修改文件                                        |
| 点击工作区根折叠按钮          | 只收起/展开该根；不改变活动根、Tab 或磁盘                                 |
| 根“复制路径 / 关闭工作区”     | 复制绝对路径；或只从当前窗口移出该根                                      |
| 根“显示隐藏文件”              | 切换该根及子树的隐藏项显示，默认关闭并独立持久化                          |
| 收藏标题右键 / Control-click  | 打开收藏菜单；选「关闭收藏」后隐藏，设置可恢复且不清路径                  |
| 系统打开 `.md/.markdown`      | 在前台标签打开独立 Markdown 文件；不自动添加父目录工作区                  |
| 文件/目录“移到废纸篓”         | 应用内确认后可恢复删除；取消或失败保持原状                                |
| `⌘/`                          | Markdown 可视/源码切换；代码/文本无此开关                                 |
| `path.ext:line` hover/点击    | hover 为有界浮层；已有右编辑组时点击直接打开，干净临时页可替换            |
| 浮层“在右侧打开”              | 在普通右邻编辑组打开完整文件；不另加辅助栏                                |
| 浮层“打开文件”                | 在当前可编辑组的 Tab 打开完整文件并定位目标行                             |
| 点击 Mermaid / 大图           | 打开 zoom/pan/Fit 查看器；Esc 返回                                        |
| 停止输入自动保存              | 仅在用户启用后按 1–300 秒延迟保存已有路径                                 |
| 表格列边界拖动                | 只调整当前 view；不写 Markdown、不标 dirty                                |
| 图片链接点击                  | 无需行号，打开缩放/平移查看器；关闭返回原位置                             |

### 3.3 语言、菜单与设置

- 首次启动 `zh-CN`，可即时切换 `en-US`。Shell、设置、代码控件、viewer、应用内/右键菜单随 React locale 更新；Rust 通过 `set_native_menu_locale(locale)` 重建应用自有原生菜单。macOS 自动补入的编辑与窗口管理项目由包内 `zh-Hans/en` 本地化资源覆盖，跟随系统为该应用选择的语言并在重启后完整生效；不遍历标题或调用私有 API 强改系统项目。
- 原生菜单包含应用、文件、编辑、显示、窗口和帮助。19 个固定小型 action ID 送给前端，含 `file.reveal` 和当前页查找 `edit.find`；Undo/Redo/Cut/Copy/Paste/Select All 使用 Tauri 预定义命令。`window.close` / `app.quit` 使用自定义 menu item，并与原生红色关闭统一进入前端 dirty 检查：按全部 Tab 的 current/back/forward 聚合后显示应用内非阻塞对话框；取消保持窗口与进程，确认或无 dirty 时只提交一次窗口销毁，macOS 主窗口实际销毁后应用进程必须退出。Rust 不复制文档状态。
- 应用内“更多”菜单暴露新建 Markdown/文本、打开文件/工作区、Quick Open、保存/另存为、显示当前文件和设置等当前动作；工作区树另有根/目录新建、独立折叠、复制路径、关闭工作区、文件/目录 reveal 与移到废纸篓。
- “更多 → 关于笔记空间”与原生关于 `app.about` 打开双语产品信息，显示当前版本、简介及完整 GitHub 仓库地址 `https://github.com/Ysclmml/notespace`。仓库链接只在用户点击后通过系统浏览器打开；About 的「检查更新」由用户明确触发固定 GitHub API 请求。更新状态使用固定高度区域，未检查、检查中、成功、无发布、新版本、失败和长提示不会改变弹窗外框高度；打开或检查失败仍可重试，不改变正文或导航。
- 启动更新检查默认开启，可在通用设置中关闭；只查询 GitHub `Ysclmml/notespace` 最新稳定发布。发现新版时可稍后提醒、只跳过该版本，或由用户点击打开经过校验的发布页；不自动下载/安装，不接受任意更新源。
- “更多 → 使用帮助”与原生帮助 `help.open` 打开独立离线功能指南及当前快捷键速查；焦点约束、Esc 与恢复焦点，不创建正文。更多菜单和原生文件菜单统一一个导出父项，HTML/PDF 为二级选择，继续使用既有导出确认流程。
- 自定义右键在编辑器、链接、只读代码、标签和工作区树目标上处理右键/Control-click。可视 Markdown 除 Undo/Redo/Cut/Copy/Paste/Select All 外，提供正文/标题、引用、列表、常用格式、代码块、分割线和表格；表格内再提供行列增删与删除表格。根、文件和目录菜单保持已有动作；标签增加保持打开、向右分屏、移到其他组与关闭。
- 页面 capture 层默认阻止 WebView 平台菜单，但不停止事件传播，因此应用自定义菜单仍正常。只有显式标记的顶部工具栏放行平台菜单；菜单/对话框和确认期间不放行。debug 原生“显示 → 开发者工具”直接由 Rust 打开 DevTools，release 隐藏，不增加 invoke 或前端 action ID。
- `markdown-workspace.settings.v1` 存储十三项 UI/保存/启动/快捷键偏好；`markdown-workspace.mobile-access.v1` 独立保存桌面共享端口，避免为局域网服务扩展通用设置模型；`markdown-workspace.workspaces.v1` 存储打开/最近工作区、最近文件、活动根和每根隐藏项偏好；`markdown-workspace.session.v1` 存储有界的路径、分组/标签和数值阅读位置；`markdown-workspace.favorites.v1` 只存最多 100 个收藏路径；`markdown-workspace.search-history.v1` 按 `searchHistoryLimit` 只存默认 15、可配 1–30 条成功搜索条件，不存结果或正文。搜索结果、滚动和最后激活项仅保留在当前运行内存。以上均是可丢弃的本机便利状态，损坏或不可用时回退，不影响正文编辑；关闭收藏分组不会改写收藏路径。

| 偏好                    | 默认值     | 归一化/作用域                                            |
| ----------------------- | ---------- | -------------------------------------------------------- |
| `locale`                | `zh-CN`    | `zh-CN` / `en-US`；含原生菜单                            |
| `startupBehavior`       | `restore`  | `restore` / `empty`；下一次启动生效，空白模式保留最近项  |
| `editorFontSize`        | 16 px      | 12–28 px；Markdown 与代码/文本主表面                     |
| `contentWidth`          | 920 px     | 640–1600 px；Markdown 画布和欢迎页                       |
| `showCodeLineNumbers`   | `true`     | fenced code、代码/文本和只读预览                         |
| `codeWrap`              | `true`     | fenced code、代码/文本和只读预览                         |
| `showTypingHints`       | `true`     | Markdown 可视模式 fence 补全                             |
| `showFavorites`         | `true`     | 文件侧栏收藏分组可见性；隐藏不删除收藏                   |
| `checkUpdatesOnStartup` | `true`     | 启动时查询固定 GitHub 最新发布；可关闭，不自动安装       |
| `searchHistoryLimit`    | 15 条      | 1–30 条；降低后立即裁剪已存的搜索条件                    |
| `autoSaveMode`          | `manual`   | `manual` / `afterDelay`；关闭仍看 dirty                  |
| `autoSaveDelaySeconds`  | 5 秒       | 1–300 秒；仅 `afterDelay` 生效                           |
| `shortcuts`             | 默认格式键 | 平台 Mod、动作白名单、冲突检查、清除/恢复；详见 ADR-0017 |
| `mobileAccess.port`     | `49920`    | 独立存储于移动访问偏好；1024–65535，下次启动服务生效     |

### 3.4 移动阅读端

```text
┌──────────────────────────────────┐
│ NoteSpace Mobile       电脑在线  │
├──────────────────────────────────┤
│  面包屑 / 当前目录                │
│  文件夹与 Markdown 逐层列表       │
│                                  │
│  阅读页：标题 / 大纲 / 正文       │
│  表格、代码横滚；图片/图表全屏    │
├──────────────────────────────────┤
│   浏览      搜索      收藏   最近 │
└──────────────────────────────────┘
```

- 首页自动列出 mDNS 发现的同网电脑，也可手动输入主机或完整基址。手机只收到主机时自动补默认端口 `49920`；桌面采用非默认端口时输入显式 `host:port`。模拟器可使用 `10.0.2.2`。本阶段没有扫码、配对码或设备批准，界面不再显示占空间的 Debug/无认证常驻警告。
- 桌面「移动访问」只允许勾选当前已打开工作区，至少选一项才能启动；面板显示服务地址、端口、发现状态和当前活跃请求数。端口默认 `49920`，可在 `1024`～`65535` 内持久修改并于下次启动服务生效。活跃请求数只统计尚未完成的 HTTP 请求，不代表在线或已配对手机，空闲阅读时可为零。停止、退出或重启立即关闭 listener、取消在途长任务并使本次链接与 ID 失效。
- 手机目录采用逐层导航和面包屑，不复制桌面常驻树。手机阅读优先，首版没有编辑、保存、上传、删除或远端模板操作；平板可在宽度允许时显示目录/正文双栏。
- 搜索、收藏和最近都保留阅读入口：在线搜索读取电脑磁盘正文；当前 host 的收藏暂返回空投影，不读桌面便利状态；最近与滚动位置是手机本机便利状态。未保存为离线的工作区断线后只保留当前已渲染页面，不伪装新导航可用。
- 用户可逐工作区开启离线保存。手机把完整目录投影、Markdown 元数据与正文存入 IndexedDB；单工作区最多 `128 MiB`、`5,000` 个目录、`5,000` 篇文档。同步先完整构建候选，再以单事务原子替换；任何失败都保留上一份完整快照。界面显示占用空间和最近同步时间；进入或切换到离线阅读、当前连接中断时只短暂显示一次提示，随后保留紧凑离线状态而不持续占用目录或正文空间。离线浏览、快照正文搜索和最近阅读可用，重连后已标记工作区自动刷新，用户也可手动刷新或清除。
- 图片、附件、已渲染 Mermaid 资产和其他资源不进入本轮离线包；Markdown 中的 Mermaid 源码仍随正文保存，但不另存渲染产物。联网后资源仍走所选根的既有只读授权链路。
- Markdown 由 App 内白名单渲染器生成；原始 HTML 不执行。内部链接重新交给 opaque ID 路由，图片和 Mermaid 只消费授权资源及源码投影，不允许服务端注入脚本。
- 手机更新器本轮不实现。后续 GitHub APK 分发采用固定 Release 检查、用户确认下载和 Android 系统安装器，要求稳定 application ID/发布签名，不做静默安装或 JavaScript 热更新；进入 Google Play 后切换 Play In-App Updates。

## 4. 编辑模型

### 4.1 Markdown 双表面

- `normal` Markdown 默认 Milkdown/ProseMirror 可视编辑。标题、强调、引用、列表、链接、代码块、图片和 GFM 表格保持结构化视觉形态；光标或 composition 不自动展开标记。
- 用户通过工具栏或 `⌘/` 明确切到 CodeMirror 源码。切换不修改正文、不进 Undo、不标 dirty。
- `sourceOnly` 是 Rust 预检决定的性能降级，强制 CodeMirror 并禁用可视切换；它与用户的 `visual/source` 选择不同。
- 禁止恢复“活动块显示源码、非活动块显示 Widget”的旧 `livePreview.ts` 路线。

### 4.2 代码/文本主 Tab

- Rust 识别的 UTF-8 代码、配置、日志和普通文本返回 `documentKind: "text"` 与语言标识。
- 主 Tab 使用 `CodeFilePreview`/CodeMirror 的 `editable` 变体：正文进入 `DocumentSession`，编辑会 dirty，可 Undo/Redo、`⌘S` 和 Save As。
- 文本 session 不进入 Milkdown，不显示可视/源码开关、Markdown Outline、Mermaid 或图片语义。
- `.rb` 等扩展名只是普通文本/高亮支持；项目本身没有 Ruby 运行时或验证工具。

### 4.3 同步、零差异与语义位置

- 打开时在 `DocumentSession` 保留原始文本。导航、选择、滚动、模式切换或关闭未编辑文档不序列化；未编辑 Markdown 保存必须字节级零差异。
- 第一次可视正文 transaction 后，serializer 可规范化等价 Markdown；正文 transaction 必须同步更新保存读取的 latest-text ref，禁止以 200 ms debounce 延迟权威正文。
- 同一 session 在多个组同时显示时，各表面以最小差异被动更新，不回传 `onChange`、不加入本地 Undo、不抢焦点或滚动（含可视内嵌代码块）。IME 期间暂存远端视图更新，结束后合并不相交修改；同范围冲突以当前输入草稿优先，不提供协同编辑协议。
- 同一表面把精确滚动/选择保存在 Tab `ViewState`。编辑器实例分别缓存两表面的正文值与视图快照；正文未变时返回已访问表面，直接恢复其滚动值和完整选区。正文改变使旧表面快照失效；明确 anchor/reveal 优先。
- 首次进入另一表面或旧快照失效时，按文档进度、最近标题、附近约 64 字符文本和 caret offset 尽力映射。匹配顺序为“靠近期望进度的文本 → 同名标题 → 文档进度”；支持普通行内格式和连续空白的显示文本投影，并映射回原始 offset。捕获只投影当前有界单行，最多缓存四行；不在滚动时解析整篇 Markdown。
- 可视滚动/选择在当前事件内记录，避免立即切换模式时取消待执行帧而丢失最后位置；未完成初始恢复的表面不报告默认页首快照。源码阅读位置取真实可见坐标，不使用 CodeMirror 包含预渲染区域的 viewport 中点。上述视图状态不写正文、不进 Undo，也不是跨重启的语义锚点。
- 可视编辑器初始化时，先完成旧视图的位置恢复，再消费初始化期间收到的最新 anchor/reveal；不得先确认跳转完成、随后被初始滚动值覆盖。正文同步的 ready 状态独立于该位置恢复，不因等待布局而丢弃输入。

### 4.4 粘贴前护栏

普通粘贴不加额外校验。只有文本超过 1 MiB 且包含 `data:image/...;base64,` 时，前端在 CodeMirror/ProseMirror transaction 前拒绝；正文、选择和 Undo 栈不变。

### 4.5 代码块、fence 补全与列表

- 可视 fenced code 使用浅色 CodeMirror，正常 gutter、active line 和 selection 不出现深色整块；选区背景与前景保持足够对比，选中后 token 仍可辨认。
- 焦点移到代码块外的正文输入后，不再显示代码块旧的活动选区或匹配选区；不修改代码正文，也不以失焦制造 Undo 记录。
- 语言选择器和 Copy 常显；语言菜单可搜索/滚动且不被代码块裁切。
- 光标在普通 paragraph 空选择中，且全段匹配 `/^```([a-z]{0,32})$/` 时，从本地语言表按 ID/alias 前缀返回最多 8 个候选。
- 上下键移动候选，Enter/Tab 或点击把当前段落转换为带语言的 code block，Esc 关闭。补全浮层变化不产生正文 transaction；接受候选是正常、可 Undo 的编辑。
- 有序/无序 marker 使用固定列并与首行基线对齐；多行继续沿正文列换行。

### 4.6 可视表格与结构操作

- GFM 表格使用 ProseMirror table schema 和 serializer；单元格直接编辑，Tab/Shift-Tab、选择、IME、Undo/Redo 与其他正文一致，任何操作都不要求切回管道源码。
- 表格块拥有自己的横向滚动容器、稳定滚动条和最小单元格宽度；宽表格不扩大主页面，也不把列压成不可读窄条。
- 官方 `columnResizing`/`TableView` 提供列边界拖动。ProseMirror `colwidth` 只作为当前 visual view state；serializer 忽略它，拖动不调用正文 `onChange`、不标 dirty、不进入 Markdown。模式重建或重开可以恢复默认宽度。
- 非表格位置只显示紧凑的“插入表格”动作，尺寸网格仅在用户明确点击后临时展开，选择行列或点击外部即关闭；代码/文本 Tab 不显示任何 Markdown 表格入口。
- 光标位于已有表格时显示就地工具栏：可直接调整目标行数/列数、增删当前行列，并设置当前列左/中/右对齐。尺寸和对齐变化都是可 Undo、可保存和可重开的正文 transaction。
- 表格右键补充在前/后插入行列、删除当前行列和删除整个表格；普通可视右键还提供段落/标题、引用、列表、行内格式、代码块、水平分割线和 3×3 表格入口。结构命令是正常、可 Undo 的正文 transaction。
- 所有工具、网格、状态和右键分支同时提供中文与英文标签和可访问名称；不建立通用菜单 DSL 或富文本格式私有存储。

### 4.7 当前页查找与长链接编辑

- `⌘F` / `Ctrl+F`、原生编辑菜单和应用菜单进入当前活动页查找，不搜索其他 Tab 或整个工作区。
- 可视 Markdown 正文、Markdown 源码和普通 CodeMirror 代码/文本均支持普通文本匹配、结果计数、前后匹配与循环；Enter/Shift-Enter 前后定位，Esc 退出。查找状态仅属当前编辑表面，不写正文、不标 dirty、不进 Undo 或持久化导航历史。
- 可视查找消费渲染后的可见文本，源码查找消费源码文本；二者不承诺相同匹配数量。查找栏可展开字面替换；单项/全部替换作为正常编辑事务，全部替换一次 Undo，IME/增长/Base64 防护保留；只读浮层不允许替换。不引入全文索引、正则或跨文件替换框架。
- 链接地址编辑使用可换行的多行控件与合适的弹层宽度，完整地址可查看和修改；长 URL 不应被固定单行宽度裁切，不改变原有打开/复制/编辑链接语义。

### 4.8 当前文档统计

- 底部统计跟随活动 Tab 的共享 session 正文；Markdown 可视/源码和代码/文本使用统一源码口径，编辑、撤销和外部干净重载都会更新。不因统计重新读取文件，也不修改正文、dirty 或 Undo。
- 中文等 CJK 按 Unicode code point 逐字，其他连续字母数字计词，标点/emoji 不计词；链接地址和代码计入。字符数按 code point 分为含空白/不含空白，保留源码标记；CRLF 算一次换行，空文档为 0 行。点击字数展开详情与口径说明，不将其误称为排除语法后的可见字数。
- 120 ms 防抖、32 Ki UTF-16 分片让出主线程；最多 32 个会话最新结果的弱引用缓存，正文/类型变化失效，缓存回收后可重算。无解析器、worker、统计数据库或正文持久化。
- 侧栏原静态“离线”改为中性的“本地文件”，说明直接读写本地文件，不代表网络连接健康或保存成功；演示模式继续标识“演示”。

### 4.9 数学分隔符与渲染投影

- Markdown 接受 `$...$`、`$$...$$`、`\(...\)` 和 `\[...\]`。进入解析器前先由普通 Markdown AST 标记 code/inlineCode/HTML/link/image/definition/既有数学范围，再只规范化安全正文中的成对 TeX 分隔符；未闭合内容与受保护范围保持字面量。
- 桌面 Crepe 的初始值、源码切回和外部干净更新使用同一规范化投影。投影不替换 session 权威正文，因此仅查看或切换模式仍为零差异；首次真实可视编辑后允许 serializer 输出语义等价的美元分隔符。
- 移动阅读使用 remark-math AST 和固定 KaTeX；错误只回退当前公式。分享 HTML 使用 script-free MathML，不引用 CDN、字体或脚本；macOS PDF 继承同一结构化公式。详细边界见 [ADR-0026](decisions/0026-math-delimiter-compatibility.md)。

## 5. 状态模型与生命周期

### 5.1 核心模型

```ts
interface DocumentSession {
  id: string; // 规范化绝对路径；未保存时为 untitled://...
  path: string;
  text: string;
  diskMtimeMs: number;
  diskRevision?: string; // 最近一次磁盘读取/保存的轻量版本，不持久化到浏览快照
  externalChange?: {
    status: "modified" | "missing" | "unreadable" | "blocked";
    revision?: string;
  };
  dirty: boolean;
  mode: "normal" | "sourceOnly";
  kind: "markdown" | "text";
  language: string;
}

interface ViewState {
  anchor?: string;
  editorMode: "visual" | "source";
  sourceScrollTop: number;
  visualScrollTop: number;
  selectionFrom: number;
  selectionTo: number;
  visualSelectionFrom: number;
  visualSelectionTo: number;
}

interface HistoryEntry {
  documentId: string;
  path: string;
  view: ViewState;
}

interface Tab {
  id: string;
  preview: boolean;
  current: HistoryEntry;
  back: HistoryEntry[];
  forward: HistoryEntry[];
}

interface EditorGroup {
  id: string;
  tabIds: string[];
  activeTabId: string | null;
  keepEmpty?: boolean; // 明确保留的空白分组，例如移动唯一标签后的左组
}

interface NavigationTrail {
  visits: { tabId: string; entry: HistoryEntry }[];
  index: number;
}

interface WorkspaceHistoryState {
  openWorkspaces: RememberedWorkspace[];
  recentWorkspaces: RememberedWorkspace[];
  recentFiles: RememberedFile[];
  activeWorkspacePath: string | null;
}
```

### 5.2 不变量

- 同一路径最多一个 session；多个主 Tab 可引用同一 session，但 history/view 独立。
- history 只存 document ID/path/view，不复制正文。
- 顶部使用窗口级 `navigation`，最多 200 项；前台打开/替换、Tab/组激活和显式 anchor/Outline 记录访问，输入/滚动/重复 focus/后台打开不新增。遍历不追加，新导航截断窗口 forward；恢复目标 Tab 当前所在组，不创建新 Tab。关闭/删除过滤失效访问，Save As 同步迁移；轨迹不持有额外 dirty session。
- AppState 使用扁平 `editorGroups` 与 `activeEditorGroupId`；全局 `tabOrder`/`activeTabId` 与组状态保持一致，每个 Tab 恰属一组。每组最多一个可替换预览，编辑/固定/分屏/移动后不再被树单击替换。
- 打开请求捕获目的组和源 Tab，源 Tab 移组/关闭或用户已进行新的导航/后退后，旧请求不得覆盖；焦点改变本身不改变原目的地，也不被迟到结果夺回。
- Tab 未保存标记与关闭判断都按该 Tab 的 current/back/forward 聚合 dirty session；窗口 close/quit 聚合全部 Tab。所有关闭入口使用应用内非阻塞确认，取消时不得改变正文、Tab、窗口或进程。
- 仍被其他 Tab/history 引用的 dirty 正文不因关闭一个副本而丢失；最后引用确认放弃后清理孤立 dirty session，重开重新读取磁盘。保存完成立即更新关闭检测读取的状态，避免“已保存却仍拦截退出”。
- 无引用的 closed clean 缓存不拥有正文，重新打开使用新磁盘内容和对应锚点位置。重载校验路径、预期正文/磁盘版本及当前引用；排队写入和保存结果还绑定原 Tab 所有者，不能更新后来重开的同名会话。
- 关闭工作区不删除文件、不关闭已打开主 Tab，也不清除最近项。文件侧栏同时渲染全部已打开工作区根的文件树，每根折叠状态独立；活动根只表示当前归属和新动作上下文，不隐藏其他根。最近项只存路径/名称/时间/顺序与每根显示偏好，最多 12 个最近工作区和 12 个最近文件；浏览恢复另用白名单元数据，不存正文或导航历史。
- 移到废纸篓只允许规范化工作区根的严格后代；根本身、根外和不存在目标拒绝。取消或系统废纸篓失败时正文、dirty、session/history、树和磁盘都保持；成功后才刷新树并清理对应 session/history 引用。
- `restore` 启动只恢复首次加载时记录的候选；工作区恢复合并用户期间新开的根并清除失效 open/active，标签恢复遇到用户新建/打开/导航后失效，不能用迟到结果覆盖用户动作。`empty` 不自动枚举旧工作区或读取旧标签。
- 文件属于多个嵌套工作区时，以最长匹配根为 owner；Quick Open 多根时显示来源。

### 5.3 新建、Save As 与路径迁移

1. 新建 Markdown/文本创建 `untitled://<name>.md|txt` 内存 session 和新前台主 Tab。
2. 首次保存或强制 Save As 收集除当前 session 外、仍被某个 Tab `current/back/forward` 引用的已保存路径，调用 `save_document_as(suggestedFileName, content, excludedPaths)`；取消不报错、不改 session，Rust 比较规范化路径并在写盘前拒绝当前仍打开的其他目标。已关闭且无历史引用的幽灵 session 不得阻止 Save As。
3. Rust picker 确定目标，使用与普通保存相同的同目录原子写入。
4. 前端重开目标取得 mode/kind/language，再执行 `relocateDocument(oldId, reopened, savedText)`。
5. reducer 同时迁移 session key/id/path 与所有 Tab `current/back/forward` 的 documentId/path；保存期间出现的新编辑必须保留 dirty。
6. 新路径加入最近文件，并刷新包含它的最长匹配工作区。

目标路径已在其他 session 打开时必须在覆盖和迁移前拒绝；不能形成两个 session 指向同一路径。保存失败保留旧文件与 dirty，并把具体错误绑定到该文档持续显示，不能立刻被通用“未保存”状态覆盖。

### 5.4 手动/自动保存生命周期

1. `autoSaveMode: "manual"` 是默认值。用户编辑后 session 保持 dirty，直到显式保存；关闭 Tab、窗口或应用继续检查 current/back/forward 引用并允许取消。
2. `afterDelay` 模式为每个仍被 Tab/history 引用、已有磁盘路径、dirty 且无外部变化提示的 session 维护 inactivity timer；延迟经设置归一化为 1–300 秒，默认预置 5 秒。
3. 同一 session 正文变化会取消旧计时并按新文本重排。触发时再次核对 session 存在、仍 dirty、不是 `untitled://` 且正文与排程快照相等；迟到任务直接退出。
4. 手动与自动保存对同一 document 共用串行写入链。后续文本可排队或合并，但绝不允许旧异步写入在新文本已落盘后再覆盖磁盘。Save As 也要等待该 document 已在执行的普通保存收敛。
5. 自动保存调用现有 `save_document` 并带当前 `diskRevision` 前提，成功更新磁盘基线并按写入文本清 dirty；后续本地编辑仍 dirty。外部版本冲突转入提示条，不再普通手动/自动写回；其他失败绑定可见保存错误并保留 dirty。未命名文档不会自动唤起 Save As。
6. 切回 manual、修改延迟、session 不再被引用或 Shell 卸载时清除/重排对应计时器。设置只保存在 `markdown-workspace.settings.v1`，不写文档和 history。

### 5.5 工作区文件动作与系统文件管理器

1. 根下不显示常驻工具栏。根/目录/局部空白右键在该目录新建，文件右键在其父目录新建；整个侧栏底部空白使用活动根。输入 trim，无扩展名的文件补 `.md`；目录名不补后缀。
2. `create_workspace_text_file(workspaceRoot, directoryPath, fileName)` 规范化根与已存在父目录，要求父目录在根内、`fileName` 是单一非空名称、扩展属于 Rust 当前文本 registry，并用 `create_new` 创建空文件而不覆盖。
3. 创建成功返回 `OpenDocumentResult`；前端刷新所属根、激活该根，并以前台主 Tab 打开。失败显示普通非阻断错误，不制造空 session 或中间目录。
4. `reveal_in_file_manager(path)` 只接受现存文件/目录并以无 shell 参数调用平台文件管理器：macOS 文件 `open -R`、目录 `open`；Windows Explorer；Linux 文件打开父目录、目录 `xdg-open`。
5. 每个工作区根的折叠状态互相独立且只属于当前视图；复制路径写入精确绝对路径。关闭工作区只更新本窗口的打开集合，保留最近项、已开 Tab 和磁盘。
6. 文件/目录“移到废纸篓”先显示应用内确认；若目标范围含被 current/back/forward 引用的 dirty session，文案明确说明未保存正文也会丢弃。取消不调用 Rust、不改状态。
7. `move_workspace_entry_to_trash(workspaceRoot, path)` 规范化两条路径，要求目标存在、是文件或目录且为根的严格后代；工作区根、根外与不存在路径拒绝。执行系统废纸篓移动，不使用永久 `remove_file/remove_dir_all`。
8. 废纸篓移动失败时保留文件、dirty、session/history 和树状态；成功后刷新所属树，移除被删除路径对应的 session 与各 Tab current/back/forward，只有无剩余历史的 Tab 才关闭并回到相邻 Tab 或 Welcome。
9. `create_workspace_folder(workspaceRoot, directoryPath, folderName)` 仅在规范化根内已有父目录下创建单层空目录，以 `create_dir` 拒绝覆盖。文件右键另外复用打开/新 Tab，查找只打开现有文件名 Quick Open；不提供重命名、移动、复制文件内容、永久删除或批量文件操作。
10. 菜单使用 13 px 独立 UI 字体、分组和轻阴影，挂到文档顶层并按实际尺寸避免窗口边界；右键不先打开/选择正文。删除/未保存确认框使用可收缩单列、独立换行路径、可滚动正文和始终可见的按钮区。
11. 根右键“显示隐藏文件”是每根独立的持久偏好，默认 `false`，变更后按 `listWorkspace(rootPath, showHidden)` 重读该根及子树；不改正文/dirty、文件本身或其他根。开启后仍跳过版本控制元数据、依赖/构建缓存和 symlink，不等于无过滤地扫描磁盘。

### 5.6 启动浏览恢复

- `startupBehavior` 默认 `restore`；旧设置缺少此项时采用默认。`empty` 在下次启动跳过工作区/标签自动打开，保留最近工作区和文件以供手动选择。
- `markdown-workspace.session.v1` 只白名单保存已保存路径、工作区顺序/活动根、分组/标签顺序、活动组/页、临时或固定状态、编辑模式和各表面的数值滚动/选择偏移。明确保留的空分组可恢复；未命名页、正文/dirty 草稿、选择文本、语义摘录、anchor 文本、Undo、Tab back/forward 和窗口访问轨迹均不保存。
- 元数据限制为最多 8 组、100 个标签、32 个工作区，路径和总存储长度均有上限；损坏、未知版本或不可用 storage 回退。它不是文档备份、崩溃恢复日志或窗口快照，不保存分隔线宽度和原生窗口位置。
- 每个路径通过现有 `open_document` 预检重新读取一次；同路径跨组复用 fresh session，各 Tab 视图独立。磁盘当前 `sourceOnly/text` 分类优先，偏移限制到有效范围，失效/blocked 路径跳过；全部失效回空白页。
- 恢复结束后再开始去抖持久化元数据，关闭/pagehide 尽力刷新；新建、打开或导航等用户动作使未完成恢复失效，窗口已经确认关闭或组件卸载后不提交迟到结果。取消 dirty 关闭仍保留当前编辑状态；浏览恢复不绕过手动保存或未保存确认。

### 5.7 外部文件变化

- 外部新增/修改/删除通知只重新枚举受影响的工作区根，聚焦/兜底检查可刷新全部根；继续遵循该根隐藏偏好和现有类型过滤。刷新成功或失败均检查请求版本，不能覆盖较新的隐藏开关、刷新或重开根结果。根不可用时可清空该根树并提示，但不删除已打开缓冲区。
- 外部重命名作为删除旧路径、增加新路径处理；不自动迁移 session 或改写文档链接。
- 仅对 current/back/forward 实际引用的已保存文档做元数据检查；自己的在途保存暂不参与。未改变版本不读正文，确实变化且干净时才走原有固定缓冲预检并重载共享 session。
- 重载不新增 Tab/组/访问，不抢焦点或重设各 Tab 独立位置；新的 sourceOnly/text 分类必要时将所有引用视图规范为源码。读取期间新编辑、保存、关闭或迁移使旧结果失效。
- dirty 磁盘冲突、missing、unreadable、blocked 均保留内存正文及原 dirty 状态，以中英文提示条显示；普通手动保存和自动保存暂停。相同 blocked/unreadable 版本不重复预检；磁盘恢复原基线时清除提示但不清草稿。
- 重载会丢弃 dirty 编辑时先确认；覆盖外部文件始终先确认，并使用已观察到的外部 revision 作为保存前提。`missing` 只提供 Save As，不自动重建原路径；不可读/blocked 可重试或 Save As。用户选择后的异步操作仍核对原引用与正文，后来编辑不被覆盖。
- 原 Tab 所有者包括 current/back/forward；正常切页、移组和共享编辑可保持所有权。最后原引用已关闭时，迟到读写不能误更新新开的同名 session；不增加正文快照或 session 持久日志。

## 6. 导航与本地预览

### 6.1 链接路由顺序

1. 可识别图片链接进入专门图片查看器；本地相对路径以实际来源 Tab 的文档目录解析。
2. 非图片 `http(s)` 链接通过 `open_external_url` 交给系统默认浏览器，正文/hover 卡片共用路由；成功后提示已打开，失败显示本地化错误且保留当前页。仅用户点击时启动浏览器，不在应用中请求网页。`mailto` 保持原有平台链接行为。
3. 按实际来源文档目录解析 `.md/.markdown`（大小写不敏感）、绝对/file 路径和 heading anchor，不要求文件已在树中；有限扩展补全/目录 index 只匹配现有 Markdown 节点，工作区回退仅限来源最长匹配根。普通跨文档点击按 preview/固定状态选择原位或新预览；显式 background/foreground 保持原手势。
4. 仅当目标未解析为 Markdown 时，才尝试本地代码/文本引用，`:line` 可省略。

相对/绝对路径、反引号/尖括号和末尾 `:positiveLine` 可作为本地引用；排除 `http(s)`、`mailto`、`data`。代码/文本引用识别在去包装、剥离行号后排除 `*`、`?`、残留尖括号、`${...}`、`{{...}}` 和逗号式 `{a,b}`，不把通配符/占位模板推断为具体文件，不展开或探测这些模式。保留中文/空格、Windows 盘符/UNC/长路径前缀、file URL 和 `[slug]` 等字面目录名；真正的具体文件读取失败仍显示非阻断错误并保留当前位置。此规则不改变显式 Markdown、图片或 HTTP 链接的独立路由。

可视正文、Crepe hover 链接卡片和源码链接都由编辑器回调路由，阻止 WebView 默认跳转。只有 Markdown 解释文档间链接导航；局部代码浮层和图片查看器不写窗口轨迹，代码进入普通编辑组后遵循普通 Tab 的导航规则。历史遍历废弃所有组此前的原位读取；晚到的正常读取不抢回后来切换的分屏焦点。

### 6.2 局部浮层与普通编辑组

| 目的地     | 内容                                | 可编辑 | 状态语义                                                  |
| ---------- | ----------------------------------- | ------ | --------------------------------------------------------- |
| 浮层       | `preview_local_file` 返回的局部片段 | 否     | 有界、临时、关闭不导航                                    |
| 右邻编辑组 | `open_document` 返回的完整文件      | 是     | 普通预览 Tab；干净临时页替换，固定/dirty 保留，复用现有组 |
| 当前编辑组 | `open_document` 返回的完整文件      | 是     | 普通 session、dirty、保存、Tab/history                    |

浮层 hover 延迟 320 ms。目标行时 Rust 返回前后各 20 行（最多 41 行），无目标返回前 80 行；每行最多 600 个 Unicode 字符。返回 `startLine/targetLine` 使 CodeMirror 显示真实 gutter 并高亮目标。

只有浮层不写 `DocumentSession`，Copy 复制显示片段。“打开文件”进入当前可编辑组并定位目标行，“在右侧打开”进入右邻编辑组；只有一个组时创建右组，已有右组时直接复用。来源已在最右组时复用本组，但先保留来源 Markdown，不用新预览覆盖它。不再另外创建只读辅助栏；右侧代码与其他 Tab 一样可编辑、保存、拖动、关闭，双击或编辑会固定，重复路径复用该组已有 Tab 和共享正文。异步解析与读取使用递增请求标识，较早结果不得覆盖最新点击。分隔线由统一编辑组布局管理，不扩展任意 pane 树。

代码/配置/纯文本编辑 Tab 和只读浮层统一使用 CodeMirror。已注册语言加载本地语法高亮、真实行号和独立滚动，并使用明确的浅色高亮主题保证 token 与选区文字都有足够对比；替换预览路径时必须为新 CodeMirror view 重新装载语言支持，即使新旧文件语言相同也不能退化为纯文本。未知语言回退为不解释内容的纯文本，绝不经过 Markdown/Milkdown 渲染。最后一个 Tab 也可关闭，全部标签关闭后回到 Welcome，不隐式关闭工作区。

### 6.3 图片链接查看器

图片链接和内联图片路径不要求行号，支持 PNG/JPEG/GIF/WebP/AVIF/BMP/SVG/ICO 的本地相对/绝对路径、`file://` 与 HTTP(S) URL。解析包含百分号路径、查询串和 fragment；拒绝 data/javascript 等不支持协议，不做网络探测。图片链接查看器只在用户点击后以 `<img>` 加载目标，SVG 不作为原文 HTML 执行；该查看器的远程请求使用 `no-referrer`，不上传文档。CSP 仅给 `img-src` 增加 HTTP(S)，其他网络、脚本与框架策略不放宽。静态 asset scope 保持 `$HOME/**`；实际显示本地图片前通过 `prepare_local_image(path)` 规范化存在的支持图片并仅授权该文件，保证隐藏目录及外部卷图片重启后可显示，不扩大目录权限。图片来源更新或卸载后忽略旧准备结果，失败使用既有可关闭提示。

复用图片查看器的缩放、拖拽平移、Fit、100% 与 Esc 返回。失败显示双语错误，始终可关闭；不修改正文、Tab、分组或其中已打开的代码。文内嵌入图片继续沿现有图片节点预览链路，不改变保存语义。

文内图片加载失败或本地文件不存在时，原位置显示“图片不存在或无法加载”占位、可换行的完整原始路径及“编辑引用…”/“删除引用”按钮，包括没有替代文字的图片。占位只是 NodeView 投影，不替换 `src/alt/title`、不 dirty、不进入 Undo；其他正文编辑或替代文字修改不清除失败状态。地址改变时重新加载，过期加载事件不影响新图片。删除只移除对应 Markdown 图片节点，和当前光标位置无关，支持正常 Undo/Redo；不删除任何磁盘文件。

图片右键优先于通用段落/格式菜单，不为右键建立整张图片的蓝色文本选择。文内图片提供预览、复制已加载图片、复制原始地址/Markdown、编辑引用，以及本地文件管理器定位；只读查看器保留复制和可用的本地定位，不提供正文编辑。地址解析使用实际来源文档，不把资源显示 URL 当成 Markdown 路径；远程图片没有本地定位动作。Mermaid 是生成图表，只提供预览/编辑图表源码，不伪造原图片路径。

编辑图片引用使用模态多行地址框，保留原始 `src`、`alt`、`title`；确认通过单次可撤销 ProseMirror 事务更新目标图片，取消或值未改变不产生正文修改。目标已失效或属性被其他编辑改变时拒绝旧对话框提交；模态期间阻止后台新建、保存和关闭，关闭对话框后正常恢复。编辑的是 Markdown 引用，不移动、覆盖或删除原图片，也不新增文件 API；拒绝空地址、内嵌 data URI 与不支持的协议。

复制图片只将当前已解码像素写成剪贴板 PNG，不额外 fetch/reload、不写磁盘或正文；未加载、超过 3200 万像素、剪贴板不支持或跨域画布限制时明确报错，地址/Markdown 复制仍可用。本地 Tauri asset 图片使用既有协议允许的 CORS，远程图片不为复制重新加载或改变现有加载策略。复制 Markdown 必须正确转义地址、替代文字与标题。

## 7. Rust 与 Tauri 接口

Rust 负责原生 chooser、目录枚举、轻量文件监听/元数据检查、工作区内文件创建、系统文件管理器定位、受边界约束的系统废纸篓移动、文件预检/读取、局部预览、原子保存、截图写入和原生菜单。前端不使用浏览器文件系统 API，也不把图片或文件正文编码成巨型 Base64 IPC。

桌面编辑器基础保留下列 27 个命令（导出见 ADR-0017，模板见 ADR-0018，更新检查见 ADR-0019，文件关联见 ADR-0020）：

```text
pick_workspace() -> WorkspaceSelection | null
pick_document() -> DocumentSelection | null
pick_image_directory(locale?) -> string | null
list_workspace(rootPath, showHidden?) -> WorkspaceNode[]
search_workspaces(workspaces, query, caseSensitive, useRegex, fileFilter?) -> WorkspaceSearchResponse
check_for_update() -> UpdateCheckResult
export_html(suggestedFileName, html, excludedPaths, images?, allowRemoteImages?) -> ExportHtmlResult | null
export_pdf(suggestedFileName, html, excludedPaths, images?, allowRemoteImages?) -> ExportHtmlResult | null
list_document_templates() -> DocumentTemplateLibrary
read_document_template(path) -> CustomDocumentTemplate & { markdown: string }
save_document_template(name, content) -> CustomDocumentTemplate
open_document(path) -> DocumentOpenResult
take_opened_document_paths() -> string[]
inspect_documents(paths) -> DocumentInspection[]
watch_filesystem(workspaceRoots, documentPaths) -> void
open_external_url(url) -> void
reveal_in_file_manager(path) -> void
create_workspace_text_file(workspaceRoot, directoryPath, fileName) -> DocumentOpenResult
create_workspace_folder(workspaceRoot, directoryPath, folderName) -> void
move_workspace_entry_to_trash(workspaceRoot, path) -> void
preview_local_file(reference, documentPath) -> LocalFilePreview
save_document(path, content, expectedRevision?) -> SaveDocumentResult
save_document_as(suggestedFileName, content, excludedPaths) -> SaveDocumentResult | null
clipboard_has_image() -> boolean
save_clipboard_image(documentPath, directoryPath?) -> SavedClipboardImage
prepare_local_image(path) -> string
set_native_menu_locale(locale) -> void
```

ADR-0025 另为桌面 host 注册服务状态、启动和停止的窄命令，并为 Android client 注册 mDNS 发现命令；桌面文件写命令和移动只读 client 仍按目标分离。局域网共享/发现能力进入普通 Debug 与 Release 构建，后者也包含该 HTTP transport 所需的定向 CSP 和 Android 网络/多播能力；共享默认停止且空根不能启动。精确命令名称与数量由纵向实现的最终注册清单同步，不预生成占位接口。

参数名按 Tauri `camelCase` 边界表示。`search_workspaces` 的 `useRegex` 只控制正文匹配，`fileFilter` 是独立、忽略大小写的工作区相对路径/文件名正则；两者继续由 Rust 在既有预算内扫描磁盘正文。搜索历史仅由前端保存条件，不新增扫描命令。`check_for_update` 只请求固定 GitHub latest release API，返回当前/最新版本、经过校验的发布页与 `available/upToDate/noPublishedRelease` 状态，不接收 URL、文档或路径。`take_opened_document_paths` 只清空读取原生有界路径队列，不传正文；关联文件仍由 `open_document` 完成预检。`save_clipboard_image` 由 Rust 直接读取系统剪贴板，只接收文档路径和可选图片目录，不传图片 bytes/Base64。`clipboard_has_image` 用于未命名粘贴的 Save As 前置检查；`prepare_local_image` 仅准备实际显示文件的 asset 访问。`set_native_menu_locale` 只接受 `zh-CN/en-US` 并重建菜单。新增功能时再新增类型和测试，不建设全仓库 schema 生成器。

`open_external_url` 只接受带有效主机的 HTTP/HTTPS URL，通过平台默认浏览器入口打开；拒绝其它 scheme，不拼接 shell 命令，本命令不读取目标网页或上传文档。更新检查的网络客户端仅存在于 `check_for_update`，端点、超时、响应大小和发布页主机/路径均固定。

前端 adapter 与命令一一对应，并可选监听原生动作、文件系统变化和关联文件信号：

```ts
interface DesktopAdapter {
  checkForUpdate?(): Promise<UpdateCheckResult>;
  listDocumentTemplates?(): Promise<DocumentTemplateLibrary>;
  readDocumentTemplate?(
    path: string,
  ): Promise<CustomDocumentTemplate & { markdown: string }>;
  saveDocumentTemplate?(name: string, content: string): Promise<CustomDocumentTemplate>;
  searchWorkspaces?: WorkspaceSearch;
  exportHtml?(
    suggestedFileName: string,
    html: string,
    excludedPaths: readonly string[],
    images?: readonly { id: string; source: string }[],
    allowRemoteImages?: boolean,
  ): Promise<{ path: string; bytesWritten: number } | null>;
  exportPdf?(
    suggestedFileName: string,
    html: string,
    excludedPaths: readonly string[],
    images?: readonly { id: string; source: string }[],
    allowRemoteImages?: boolean,
  ): Promise<{ path: string; bytesWritten: number } | null>;
  pickWorkspace(): Promise<WorkspaceSelection | null>;
  pickDocument(): Promise<DocumentSelection | null>;
  openExternalUrl?(url: string): Promise<void>;
  listWorkspace(rootPath: string, showHidden?: boolean): Promise<readonly WorkspaceNode[]>;
  openDocument(path: string): Promise<DocumentOpenResult>;
  inspectDocuments?(paths: readonly string[]): Promise<readonly DocumentInspection[]>;
  watchFileSystem?(
    workspaceRoots: readonly string[],
    documentPaths: readonly string[],
  ): Promise<void>;
  listenFileSystemChanges?(
    listener: (changes: { paths: readonly string[] }) => void,
  ): Promise<Unlisten>;
  revealInFileManager(path: string): Promise<void>;
  createWorkspaceTextFile(
    workspaceRoot: string,
    directoryPath: string,
    fileName: string,
  ): Promise<DocumentOpenResult>;
  moveWorkspaceEntryToTrash(workspaceRoot: string, path: string): Promise<void>;
  createWorkspaceFolder?(
    workspaceRoot: string,
    directoryPath: string,
    folderName: string,
  ): Promise<void>;
  previewLocalFile(reference: string, documentPath: string): Promise<LocalFilePreview>;
  saveDocument(
    path: string,
    content: string,
    expectedRevision?: string,
  ): Promise<SaveDocumentResult>;
  saveDocumentAs(
    suggestedFileName: string,
    content: string,
    excludedPaths: readonly string[],
  ): Promise<SaveDocumentResult | null>;
  pickImageDirectory?(locale: "zh-CN" | "en-US"): Promise<string | null>;
  hasClipboardImage?(): Promise<boolean>;
  saveClipboardImage(
    documentPath: string,
    directoryPath?: string,
  ): Promise<SavedClipboardImage>;
  setNativeMenuLocale?(locale: "zh-CN" | "en-US"): Promise<void>;
  listenNativeMenuAction?(listener: (id: NativeMenuActionId) => void): Promise<Unlisten>;
  listenOpenedDocumentPaths?(
    listener: (paths: readonly string[]) => void,
  ): Promise<Unlisten>;
}
```

`opened-document-paths-available` 只是提示前端读取队列，事件 payload 不含文件路径或正文。adapter 在注册监听后立即调用一次 `take_opened_document_paths()`，后续信号触发串行 drain；Shell 再按队列顺序调用既有 `openDocument(path)`。原生队列最多 32 条、单路径最多 4096 字符，重复待处理路径和非 Markdown 后缀不进入队列。

### 7.1 枚举、打开和预检

- `list_workspace` 返回目录、Markdown 及 Rust extension registry 认可的代码/配置/文本；`showHidden` 默认为 `false`，同一次枚举递归应用于该根子树。开启后仍忽略常见 VCS、依赖/构建缓存、虚拟环境目录和 symlink；隐藏开关不是权限扩张。前端 inline local-ref 后缀集合必须覆盖同一批当前扩展，避免树中可开而文内不可引用。
- 受支持类型包括 txt/log/config、JSON/YAML/TOML/XML/HTML/CSS、JS/TS、Python、Rust、Java、C/C++/C#、Go、Shell、SQL、Ruby/PHP/Swift/Kotlin/Lua/Dart/Scala/Groovy/Perl、Protobuf、GraphQL 等普通 UTF-8 文件。高亮未知时可退回 text。
- Rust 以固定 64 KiB 缓冲扫描总字节、UTF-8、最长物理行和大型 data-image marker。
- 原生 editable open 返回与所读正文匹配的 `diskRevision`；读期间文件身份/版本变化会失败，不把不一致的正文与版本当作基线。blocked 仍不返回正文。TypeScript 的可选 revision 保持 Demo/旧 adapter 兼容，不表示正常原生打开省略版本。
- 桌面包只声明 `.md/.markdown` 的编辑关联。系统通过启动参数或 macOS `RunEvent::Opened` 传入的文件按前台新标签顺序打开；应用不修改系统默认处理器，不自动打开父目录工作区，也不绕过本节预检。

| 分类         | 当前条件                                                  | 前端行为                                |
| ------------ | --------------------------------------------------------- | --------------------------------------- |
| `normal`     | 不大于 8 MiB，最长行不大于 256 KiB                        | Markdown 可视编辑；text CodeMirror 编辑 |
| `sourceOnly` | 超过 8 MiB 的普通 UTF-8 多行文本，或较长但未阻止的行      | Markdown 强制源码；text 仍用 CodeMirror |
| `blocked`    | 非 UTF-8、超过 512 KiB 的 data-image 行，或单行超过 1 MiB | 不返回正文，显示说明页                  |

阈值是性能预算，不是威胁模型；约 10 MiB 普通多行文件必须能降级打开。

### 7.2 原子保存

1. 普通已打开文件保存带 `expectedRevision`；Rust 写入前核对高分辨率 mtime、大小与平台文件身份组成的版本，缺失/变化返回外部冲突。
2. 在目标同目录创建唯一临时文件，写完整 UTF-8 字节并 flush/sync。
3. rename 前再次核对有传入的版本，然后替换目标。
4. 成功返回所写句柄的 `diskRevision`，而非稍后可能被其他应用再次替换的目标路径版本。失败只清理本调用创建的精确临时文件，旧文件保持完整。

版本检查是 best-effort，不是文件锁或原子 compare-and-swap，检查到 rename 之间仍有很小竞争窗口。未提供版本的 Demo/兼容调用保留旧接口；原生打开/保存结果均携带版本。Save As 保留用户明确选择目标的现有语义。不实现持久 journal、prepare/ack、自动合并或崩溃恢复中心。

### 7.3 截图粘贴

- 前端统一检查 `items/files/types`，不依赖 `getAsFile()`；Files-only/空载荷可使用原生 fallback，普通文字/HTML/URI 与非图片文件保持正常粘贴。右键入口同样走编辑器 paste 事件和前置大 Base64 阻断。
- 明确图片信号同时带有单图 HTML 包装或空白/对象占位符时仍按图片处理；空 item MIME 不否决其他明确图片信号，空 MIME 文件只接受已知图片后缀。HTML 检查使用惰性模板，不加载地址；真正的正文、富文本、多图与复制的路径不被接管。大型内嵌图片护栏先于该检查执行。
- 在可视代码块内粘贴明确图片时提示将光标移到正文，不读取/写入图片或改变代码；空载荷只保留选择，不让 CodeMirror 用空文字删除已选代码。
- 图片位置由实际来源文档的最长匹配工作区决定：默认 Markdown 父目录，可在根右键选择指定目录。每根 `imageDirectoryPath` 为 null 或有界绝对路径，保存到现有工作区便利状态，不修改正文或移动旧图片。
- 未保存文档先用 `clipboard_has_image` 确认有图，再走 Save As；成功迁移后向新表面发送有界插图请求，以正常事务插入并支持 Undo，取消不写图。迟到结果必须仍属于原 Tab/文档/正文/表面。
- Rust 直接读取系统剪贴板；macOS 从同一个 NSPasteboard 优先读取 PNG，TIFF 使用 AppKit `NSBitmapImageRep` 转 PNG 后进入现有受限解码流程，其他平台保留 arboard。原生编码载荷先限制 128 MiB，TIFF 转码前检查 3200 万像素；这不是 AppKit 内部内存用量的绝对上限。统一生成 PNG，图片 bytes/MIME/Base64 不经过 IPC。
- PNG/TIFF 解码失败保留各阶段原因，但不记录图片内容；前端图片错误独立于 dirty 状态，绑定来源 Tab/文档，下次图片粘贴开始清除，不被“未保存”提示遮住。
- 名称 `paste-<timestamp>-<counter>.png` 且 `create_new` 不覆盖；默认/自定义目录必须有效。写入成功后返回百分号编码的相对 URI，跨卷无法相对引用时返回文件 URI，前端才插入 Markdown。
- 写入失败/取消不改变正文；Undo 只撤销链接，不删除文件。每次实际加载本地图先做单文件 asset 准备，旧图片无需移动也可继续显示。

### 7.4 工作区创建、reveal 与废纸篓

- `create_workspace_text_file` 只接收根路径、父目录路径和单个文件名，不接收正文。根/父目录必须已存在且规范化父目录仍位于根内；复用当前文本扩展 registry，并以 `create_new` 拒绝覆盖。
- 空文件是有效 UTF-8；创建后复用 `open_document` 结果形状返回 kind/language/preflight，避免第二套 document contract。
- `create_workspace_folder` 复用规范化根/父目录校验，只接受单一非空名称并使用非递归 `create_dir`；同名文件/目录、路径名和根外父目录拒绝。成功后前端刷新树，不创建文档 session。
- `reveal_in_file_manager` 先区分现存文件/目录，再生成平台命令参数；使用 `std::process::Command` 而不是 shell 字符串。测试只验证纯命令映射和失败边界，不真的唤起 Finder。
- `move_workspace_entry_to_trash` 接收 `workspaceRoot + path`，规范化后只允许根的严格后代且目标必须仍存在并为文件/目录；根本身、根外路径和不存在目标拒绝。命令只执行系统废纸篓移动，前端负责确认和成功后的 session/history/tree 收敛。
- 这些是明确的日常文件动作，不扩展为永久删除、重命名、移动、复制文件内容、批量操作、路径授权系统、虚拟文件系统或通用 opener service。

### 7.5 原生文件监听与检查

- 固定依赖 `notify 8.2.0`：工作区根递归监听，未被根覆盖的独立文件以父目录非递归监听；订阅替换/关闭时释放旧 watcher。显式打开的文件即使位于通常过滤的目录也可观察。
- `filesystem-changed` 事件只包含 `{ paths: string[] }`。原生 150 ms 批处理并限制路径数量，前端去重后 250 ms 刷新，连续事件最多 1 秒发起一批；过量/不明确事件降级完整检查，不传文件正文。
- 前端先订阅事件再配置路径，配置完成后检查一次；窗口聚焦/可见及每 30 秒兜底复查并重配，以恢复丢失通知、根/父目录重建或失败监听。旧监听清理与新配置串行，不让卸载后的迟到回调影响新窗口状态。
- `inspect_documents` 返回 path、`present/missing/unreadable` 与可用 revision，只检查元数据/可读性；干净变更文件才另外预检读取。被预检阻止时前端记录 blocked 并保留旧正文。
- 枚举与事件层过滤重目录、symlink 和应用保存临时项；OS 的递归 watcher 本身可能仍观察被过滤的子目录，不承诺消除其底层开销。隐藏项仍按各根显示偏好枚举，通知不是权限或文件类型扩张。

## 8. Mermaid 与视觉查看器

- Mermaid 按需动态加载；每次渲染绑定唯一 DOM marker，卸载或源码变更后丢弃迟到结果。
- 生成 SVG 的局部文字样式在临时测量容器、正文和查看器中保持一致；字体就绪后再测量，避免正文段落行距放大 `foreignObject` 内容而裁切中文。默认 Dagre flowchart 恢复连线的预留标签位置并按需扩展 viewBox，不改节点、连线路径或源文本；显式布局引擎及无法可靠识别的 SVG metadata 保留原样，不引入通用碰撞排版引擎。
- 失败只在当前图块显示错误；源码仍可通过显式源码模式编辑。
- 查看器只消费渲染结果，不修改 Markdown；SVG 保持矢量，支持滚轮/触控板缩放、拖拽、双击 Fit、`+/-/0` 和 Esc。
- 图片使用同一 viewer shell，支持 100%、Fit、缩放和平移。
- production CSP 允许 Mermaid 生成的内联样式，但不开放远程脚本或文档上传。
- standalone Debug 与 Release 使用的 `font-src` 和开发模式一致，仅允许 `'self' data:`，兼容 Vite 内嵌的 KaTeX 小字体；不开放远程字体、脚本或连接。字体加载策略与原生截图读取/保存是不同链路。

## 9. 前端架构

```text
src/
├─ app/
│  ├─ i18n/                # zh-CN/en-US 同键字典
│  ├─ settings/            # 十三项 AppSettings 与 localStorage
│  ├─ shell/               # 主画布、多工作区、菜单、预览组装
│  └─ state/               # sessions / tabs / navigation / relocation reducer
├─ features/
│  ├─ code-preview/        # 各编辑组的代码 Tab、只读浮层 CodeMirror
│  ├─ context-menu/        # 本地化编辑/链接/只读菜单
│  ├─ editor/              # Milkdown、源码 CM、同步、语义位置、fence 补全
│  ├─ editor-groups/       # 扁平编辑组、标签拖动、统一分隔线
│  ├─ external-changes/    # 路径通知、元数据同步、冲突提示条
│  ├─ find/                # 当前页查找投影、匹配导航与双语查找栏
│  ├─ favorites/           # 有界路径收藏、可见性标题交互与失效状态
│  ├─ navigation/          # Markdown 链接、本地引用、Tab/history
│  ├─ session-restore/     # 有界浏览元数据白名单、fresh disk 恢复
│  ├─ settings/            # 设置对话框
│  ├─ update/              # 当前/最新版本状态、跳过版本与提示弹窗
│  ├─ workspace-search/    # 自绘范围、正文/路径正则、最近条件与磁盘结果
│  ├─ viewer/              # Mermaid/图片 zoom、pan、Fit
│  └─ workspace/           # 文件树、Outline、workspace history
├─ mobile/                 # 独立移动入口、只读 transport、浏览/阅读状态与移动样式
└─ infrastructure/tauri/   # 27 命令 adapter、原生菜单/文件路径事件 listener
```

Shell 当前是小型编排层；第二个真实消费者出现前不抽取通用 command bus、pane registry 或资产框架。应用状态使用 React reducer/context，不引入 Redux。

### 9.1 浏览器开发模式

纯浏览器 `pnpm dev` 使用内存 demo adapter，便于组件测试；`pnpm mobile:dev` 使用移动内存 transport，验证手机布局与导航。真实文件、原生菜单和系统剪贴板只在桌面 Tauri 构建启用；真实无认证 HTTP/mDNS 属于桌面与 Android 普通构建能力，浏览器 demo 不监听局域网，也不替代 macOS/Android 原生 smoke。

## 10. Rust 架构

```text
src-tauri/src/
├─ application/mod.rs    # 当前空命名空间；不承载产品逻辑
├─ commands/mod.rs       # 文件命令与可单测文件逻辑
├─ commands/filesystem.rs # notify watcher、版本元数据与外部变化检查
├─ commands/clipboard_image.rs # 原生剪贴板读取、图片写入、路径与单文件准备
├─ commands/workspace_search.rs # 多根磁盘文本搜索与扫描预算
├─ commands/update_check.rs # 固定 GitHub latest release 查询与版本比较
├─ commands/html_export.rs # 独立导出选择器、目标保护与原子写入
├─ commands/document_templates.rs # 当前应用用户数据目录下有界 Markdown 模板库
├─ lan_share/            # 所选根注册表、有界只读数据与普通构建 HTTP host
├─ infrastructure/mod.rs # 当前空命名空间；不承载通用 adapter 框架
├─ native_menu.rs        # zh-CN/en-US 菜单、19 个 action ID、custom close/quit
├─ opened_documents.rs   # 启动参数/macOS Opened 文件路径有界队列
└─ lib.rs                # 按 desktop/mobile cfg 注册各自最小入口与命令
```

命令保持薄；文件预检、局部读取、原子保存、资产写入和局域网根边界用临时目录单测。桌面文件/菜单模块不进入 Android 构建，移动端不携带写文件命令。不要引入 Ruby、公共服务端或巨型 IPC schema。

## 11. 性能预算

| 场景                       | 初始目标                                                                         |
| -------------------------- | -------------------------------------------------------------------------------- |
| 普通文档打开（约 250 KiB） | 约 300 ms 进入可编辑状态                                                         |
| 主 Tab/history 切换        | UI 约 100 ms 响应，内容异步恢复                                                  |
| 连续输入                   | 60 fps 体感，无 composition 抖动或块高度跳变                                     |
| 输入后立即保存             | 不等待 debounce，磁盘包含最后一次输入                                            |
| inactivity autosave        | 1–300 秒；文本变化重排，迟到任务不覆盖新正文                                     |
| 外部文件变化               | 原生 150 ms + 前端 250 ms 合并，前端最长 1 秒；30 秒兜底，仅变更的干净文档读正文 |
| 约 10 MiB 普通多行文档     | `sourceOnly`，不冻结窗口                                                         |
| 大型 data-image            | Rust/前端预检阻止正文进入 EditorView                                             |
| 局部预览                   | IPC 只返回 ±20/前 80 行；每行 600 字符上限                                       |
| Mermaid                    | 迟到结果不覆盖新源码；单块失败不影响正文                                         |
| 移动目录/正文              | 逐层返回且有硬预算；断线不销毁当前已渲染正文                                     |
| 局域网传输                 | 默认端口 `49920`；mDNS 多地址逐一探测；I/O 无全局锁；停止可取消长任务            |
| 移动离线工作区             | 单快照 128 MiB/5,000 目录/5,000 文档；完整后原子替换，失败保留旧快照             |

优化顺序：测量 → 关闭昂贵投影 → 增量计算；不先写分块编辑器、虚拟文件系统或任意 pane framework。

## 12. 验证策略

### 12.1 自动测试

- reducer：同 session 多 Tab、独立 history/view、Save As 全历史迁移及保存期间继续编辑。
- Markdown editor：CJK composition、Undo/Redo、未编辑零差异、可视 serializer、即时保存、语义位置映射、fence 补全、表格滚动/列宽/网格/行列、图片、Mermaid；四种数学分隔符在初始/源码切回/外部更新后渲染，代码和链接保持字面，首次可视编辑后公式语义无损。
- 代码/文本：各组 Tab 编辑/dirty/保存，真实 gutter/target，只有浮层只读；右侧复用普通组而非额外辅助栏。各已注册语言有可见 token/selection 对比度，同语言路径替换仍重新装载语言支持。
- 导航：Markdown route first、固定/临时策略、窗口跨 Tab/组前进后退、修饰键 disposition、nested workspace longest match、Outline、local-ref 浮层与编辑组去向；已有右组直接打开，临时替换/固定与 dirty 保留、最右来源保护和快速连续请求 latest-wins。同组切换标签（含离开再返回）或新建页使旧原位读取失效，单纯聚焦另一组仍允许来源组更新。
- 外部网页：HTTP/HTTPS 正文/hover/源码入口、系统 opener 参数与协议验证、启动错误本地化；不改变正文/Tab/访问轨迹，图片后缀仍进入图片查看器。
- Mermaid：缓存/失败重试、字体测量屏障、图表局部文字样式、默认 flowchart 标签预留位置及画布扩展、未知布局回退；实际 TD/LR/带子图中文回路检查裁切与标签/节点相交。
- workspace history/shell：多根文件树同时显示且独立折叠、根层级标识/活动状态、最近项上限、损坏 storage、延迟恢复合并用户动作、全部失效候选清理、独立文件、根/子目录创建、复制路径与关闭工作区；隐藏偏好每根隔离/默认关闭并递归生效，重目录仍排除。
- 浏览恢复：白名单及数量/长度边界、无正文/未命名/选中文本/历史、fresh disk、缺失或 blocked 路径跳过、共享 session/独立视图、空白启动保留最近项、元数据关闭刷新和取消关闭、用户新建/打开后迟到恢复失效。
- 菜单/i18n/settings：中英文同键、19 个原生 action ID（含 `edit.find`）、应用内历史 dirty 对话框、自定义 close/quit、取消保持窗口/进程、主窗口销毁后退出进程、结构/表格/工作区/标签右键、仅顶部工具栏例外的平台菜单策略、debug 原生 DevTools、十三项设置归一化和恢复默认；macOS 自动编辑/窗口项目使用包内本地化资源；收藏右键菜单必须明确选择关闭且不清路径，启动更新检查可关闭。
- 全文搜索：自绘全部根/单根范围的鼠标与键盘操作、清晰 SVG 箭头、长路径和范围切换迟到保护；普通/正则正文、独立路径筛选、Unicode/大小写、无效表达式和既有 Rust 扫描预算，始终排除未保存正文；紧凑历史只显示查询文字，默认 15、可配 1–30 条成功条件，覆盖去重、立即裁剪、清空、坏存储与只回填不自动搜索；结果跳转后重开恢复内存结果、滚动和最后激活项且不重复扫描，退出应用不保留结果。
- 文件关联：打包元数据含 `.md/.markdown`、Editor 与 Markdown 类型；启动参数/macOS Opened 队列的后缀、去重、32 条/4096 字符边界，冷启动首次 drain、后续信号、顺序前台打开与监听卸载。
- 更新检查：固定 GitHub latest release 端点、稳定语义版本比较、404/失败/限时/响应上限、拒绝重定向与非仓库发布页；启动开关、只跳过一个版本、About 手动检查、固定状态区和用户手势打开。
- 编辑分组：斜体预览替换、双击/编辑固定、各组活动 Tab 和打开焦点、内部标签拖放；向右分屏保留原 Tab ID/current/view/history/dirty、复用右邻组和可激活空左组；共享正文/独立视图与 IME、最后 dirty 引用关闭和放弃后重读；过期打开不能复活关闭/移组的 Tab 或抢回焦点。
- 当前页查找与编辑细节：可视/源码/代码、中文、无匹配、循环、Esc，不写正文/dirty/Undo；代码块失焦后旧活动选区清理，长链接多行编辑保持完整 URL。
- 图片链接：实际来源 Tab 相对路径、普通/内联路径、无行号、远程后缀解析、加载失败和关闭返回，且不改变已有编辑组/正文/dirty。
- 保存策略：manual 默认、1–300 秒归一化、继续输入重排、未命名跳过、迟到正文校验、失败仍 dirty 与计时器清理。
- 保存完整性：Save As `excludedPaths` 逐层传递并在 Rust 写前拒绝；保存错误在 dirty 状态持续可见。
- 外部文件：合成目录新增/修改/删除/重命名、隐藏与重目录过滤、独立文件原子替换；监听去重/限时批处理、聚焦/兜底重试及卸载清理。共享干净正文重载且位置/历史保持，dirty/missing/unreadable/blocked 保留缓冲区并暂停普通保存，重载/覆盖确认可取消；原版本恢复清提示不清草稿。
- 外部变化竞态：正文/版本/引用守卫、原所有者关闭后同路径重开、迟到保存不误标新会话 dirty、closed clean 缓存刷新及源码锚点；新树刷新/隐藏偏好不被旧成功或失败覆盖。Rust 版本检查在写前/rename 前拒绝变化，读取正文与返回 revision 一致。
- Rust：扩展枚举、预检分类、10 MiB 普通多行、blocked 无正文、±20/前 80 行预览、原子保存、Save As 冲突、工作区内 create-new、跨平台 reveal 参数、废纸篓成功/根与根外拒绝/失败保持、截图、原生菜单、磁盘正则搜索与固定 GitHub 更新检查。
- 移动端：内存 transport 的演示回归，以及普通构建 HTTP transport 的默认 `49920`、host-only/显式端口地址归一化、mDNS 多候选逐一探测、超时、协议版本、错误映射、逐层浏览、搜索、阅读位置与断线保留；四种数学分隔符生成受限 KaTeX、无效公式局部回退且代码/HTML 不执行；Rust host 覆盖启停、HTTP/CORS、无全局 I/O 锁的多请求并发、`activeRequestCount` 和长任务取消，共享核心继续覆盖 opaque ID、根外/符号链接/隐藏/类型拒绝及读取/搜索预算。
- 移动离线：逐工作区开启/清除、占用空间/同步时间、IndexedDB 恢复、目录/正文/搜索/最近离线读取、重连自动与手动刷新；完整候选单事务替换，电脑新增/修改/删除收敛，断线/取消/读取/配额/事务失败保留旧快照，并覆盖 128 MiB/5,000 目录/5,000 文档上限及图片/附件/Mermaid 渲染资产不落盘。

### 12.2 桌面 smoke

- 新建 Markdown/文本 → Save As → 编辑 → 保存 → 重开磁盘一致。
- 打开代码文件编辑/另存为；Markdown 始终保持默认真可视。
- 两个工作区树同时显示并独立折叠、活动根切换、聚合 Quick Open、独立文件打开；各根隐藏开关默认关闭、独立保持、重目录仍过滤；在根/子目录新建并 reveal，复制根/文件/目录路径并关闭一个工作区。
- `restore` 重启恢复路径/分组/固定状态与阅读位置，但显示新磁盘正文；`empty` 不自动打开旧根/页，最近项仍可手动打开；保存/取消关闭和恢复期间主动打开不会被旧状态覆盖。
- Markdown 链接、back/forward、可视/源码语义定位、浮层→普通右编辑组；已有右组时新代码引用直接复用并定位行、编辑/固定页保留，无第三辅助栏。
- 中文/英文原生菜单及 macOS 自动编辑/窗口项目、自定义结构/表格/工作区右键、整段历史 dirty 的应用内关闭/退出对话框；取消保持窗口/进程，确认后窗口与 macOS 进程都结束；文件/目录废纸篓取消、成功及失败保持；manual/afterDelay 保存；真实系统截图成功/失败路径。
- 宽表格横向滚动、列宽拖动不 dirty、网格插入、行列增删、保存重开。
- Mermaid/图片 viewer、外部 URL 和最终 production bundle。
- 用含 `$...$`、`$$...$$`、`\(...\)`、`\[...\]`、无效公式及代码字面量的合成文档检查可视/源码往返；导出单文件 HTML 与 macOS PDF，确认公式可选择、离线可见且无外部脚本/字体请求。
- 标签右键向右分屏移动原页、可保留空左组继续打开、物理拖放、双击固定、点击不同组后从树打开；共享文档关闭/放弃后的重读；无行号图片链接与失败回退；窄窗口内活动编辑组可见。
- 当前页 `⌘F` / `Ctrl+F` 在可视/源码/代码中定位中文和普通文本、循环、Esc 返回且不 dirty；代码块转入正文后无旧活动选区，长链接可完整多行查看/编辑。
- `Cmd/Ctrl+Shift+F` 的自绘范围在全部根/单根间切换，正文普通/正则和路径筛选结果正确，未保存编辑不出现；点击结果后重开恢复结果、滚动和最后点击项，历史数量设置可裁剪到 1–30；隐藏收藏分组后记录仍在，设置重新开启可恢复。
- 联网时由 About 手动检查固定 GitHub 发布；检查前后和长状态文本不改变弹窗外框高度，启动开关、稍后提醒、只跳过当前版本和用户点击发布页符合预期。断网/失败不阻断本地编辑且不尝试自动下载或安装。
- 使用合成工作区在外部新建/修改/删除文件，观察树刷新与干净正文重载；制造 dirty 冲突并取消/确认重载或覆盖，缺失文件保持可读缓冲区且只提供 Save As。检查独立文件、失去焦点后恢复及删除/重建目录，不使用真实用户文档作为写入测试数据。

### 12.3 Android smoke

- `pnpm mobile:android:build:debug` 只构建 Android ARM64 可安装 APK，并在 API 36 模拟器启动移动入口而非桌面编辑器；产物不包含其他 ABI 或 Rust DWARF 调试信息。
- 使用内存 transport 回归四个底部入口和阅读状态；使用 Android 真实 HTTP transport 验证 mDNS 自动发现、只填主机自动补 `49920`、自定义 `host:port` 回退、逐层目录、Markdown 阅读、搜索跳转、断线提示与返回后位置保持。
- 用合成工作区完成桌面显式勾选/启动/停止，确认同一服务可被多个手机并发浏览，桌面只显示瞬时活跃请求数；停止后 listener 拒绝连接、在途长任务取消且旧 ID 失效，根外/符号链接/隐藏/超限目标仍拒绝。Android 模拟器使用 `10.0.2.2:<port>` 验证手动连接，真机用于 mDNS 多地址/同 Wi-Fi/多客户端验收。
- 核对桌面与 Android 的 Debug/Release 均包含相应共享/发现能力，桌面共享默认关闭，手机和桌面无 Debug/无认证常驻提示。逐工作区保存后断网浏览/搜索/最近可用；进入或切换离线阅读、当前连接中断时提示短暂出现并自动消失，普通重渲染和页面跳转不应使其反复出现，重新联网立即清除。重连完整刷新；图片/资源不进入离线存储。
- 本轮不把移动更新列入 APK smoke。后续更新器另行验证固定 GitHub Release、用户确认、系统安装器、稳定发布签名，以及 Play 分发时改用 Play In-App Updates。

### 12.4 门禁

标准自动门禁为 `pnpm verify`，覆盖 Node repo check、Prettier、lint、typecheck、Vitest、Rust fmt/clippy/test、Web build 和 Tauri debug binary build。测试数量、桌面验收与构建结果随修订变化，不在设计文档复制历史结果。

## 13. 多代理实现规则

| 轨道                       | 独占路径                                         | 依赖输出                                 |
| -------------------------- | ------------------------------------------------ | ---------------------------------------- |
| Native file/menu           | `src-tauri/**`                                   | 当前命令、结果类型、action IDs           |
| App state/navigation       | `src/app/state/**`, `src/features/navigation/**` | reducer 与 routing API                   |
| Editor                     | `src/features/editor/**`                         | editor props、语义位置、fence completion |
| Code preview               | `src/features/code-preview/**`                   | editable/read-only variants              |
| I18n/settings/context menu | 对应 app/feature 目录                            | locale/settings/menu contracts           |
| Workspace UI/history       | `src/features/workspace/**`                      | tree/outline/history contracts           |
| Assets/diagrams            | 对应 feature 目录                                | paste/viewer API                         |
| Mobile reader              | `src/mobile/**`                                  | transport、reader state 与移动 UI        |
| LAN share core             | `src-tauri/src/lan_share/**`                     | opaque IDs、读取边界与 pairing state     |
| Integration                | shell、根清单、lockfile、状态文档                | 合并与端到端验证                         |

不同代理不要同时编辑 Shell、根清单或 `PROJECT_STATE.md`。每个任务交付当前小接口和有价值的失败测试，不为未来功能先建框架。

## 14. 扩展路线

1. P1：完成 ADR-0025 的普通构建局域网阅读、统一默认端口、逐工作区离线快照和 Android 真机验收。移动更新按当前决定继续暂缓；以后实现时使用固定 GitHub Release → 用户确认 → Android 系统安装器，不做静默/JavaScript 热更新，进入 Play 后改用 Play In-App Updates。数学四种分隔符及桌面/移动/分享一致渲染已由 ADR-0026 纳入基线；后续再处理大目录性能、反向链接、其他平台 PDF 与图像导出。当前页查找替换、工作区磁盘全文搜索/高亮/正则筛选/最近条件、可分享 HTML、macOS PDF、格式快捷键设置、收藏/专注/模板、Markdown 文件关联、固定 GitHub 更新提示与轻量外部变化属于桌面基线；不扩展持久索引、批量文件修改或移动编辑。
2. P2：Git diff/history 等明确的本地增强。
3. P3：知识图谱、AI 检索与引用；需单独隐私决策。

ADR-0011 接受扁平水平编辑分组；ADR-0013 将右侧引用统一为普通编辑组，并使“向右分屏”移动原标签。旧独立只读辅助栏属于历史设计，不再作为当前扩展入口。纵向/递归布局、多窗口和 IDE docking 不是自然下一步，只有新的真实场景和 ADR 才能扩边界。

## 15. 决策索引

- [ADR-0001：应用技术栈](decisions/0001-application-stack.md)（编辑内核由 ADR-0006 修订）
- [ADR-0002：source-first 编辑](decisions/0002-source-first-editor.md)（被 ADR-0006 取代）
- [ADR-0003：Session、Tab 与导航分离](decisions/0003-session-tab-navigation-separation.md)
- [ADR-0004：病态输入保护](decisions/0004-pathological-input-guard.md)
- [ADR-0005：普通本地编辑器的精简边界](decisions/0005-lean-local-editor-boundary.md)
- [ADR-0006：默认真可视编辑与显式源码模式](decisions/0006-visual-editor-explicit-source-mode.md)
- [ADR-0007：本地文件、多工作区与单一右侧只读预览](decisions/0007-local-files-multiple-workspaces-and-split-preview.md)
- [ADR-0008：保存策略、多根文件树与可视表格工具](decisions/0008-save-workspace-files-and-visual-tables.md)
- [ADR-0009：可恢复的工作区删除与可靠 dirty 关闭](decisions/0009-recoverable-workspace-delete-and-dirty-close.md)
- [ADR-0010：工作区右键入口与单层目录创建](decisions/0010-workspace-context-actions-and-folder-creation.md)
- [ADR-0011：编辑分屏、临时标签与图片链接预览](decisions/0011-editor-groups-preview-tabs-and-image-links.md)
- [ADR-0012：Markdown 固定标签策略与跨标签导航](decisions/0012-markdown-link-policy-and-window-navigation.md)
- [ADR-0013：浏览恢复与统一编辑分屏](decisions/0013-browsing-restore-and-unified-editor-panes.md)
- [ADR-0014：外部文件变化与受保护的重载/保存](decisions/0014-external-filesystem-changes.md)
- [ADR-0015：可靠截图粘贴与每工作区图片位置](decisions/0015-workspace-clipboard-images.md)
- [ADR-0016：工作区搜索、HTML 导出与恢复提示](decisions/0016-workspace-search-html-export-and-restore-notice.md)
- [ADR-0017：写作工具与可分享导出](decisions/0017-writing-tools-and-shareable-exports.md)
- [ADR-0018：收藏分组、全局搜索与本地模板库](decisions/0018-organized-favorites-global-search-and-local-templates.md)
- [ADR-0019：搜索筛选、收藏显示与 GitHub 更新检查](decisions/0019-search-favorites-and-github-update-checks.md)
- [ADR-0020：搜索历史、收藏关闭菜单与 Markdown 文件关联](decisions/0020-search-history-favorites-menu-and-markdown-associations.md)
- [ADR-0021：全文搜索会话与桌面界面本地化收尾](decisions/0021-search-session-and-desktop-ui-localization.md)
- [ADR-0022：局域网移动阅读器与可信配对](decisions/0022-mobile-lan-reader.md)
- [ADR-0023：Debug 局域网无配对只读共享](decisions/0023-debug-lan-sharing-without-pairing.md)
- [ADR-0024：Debug 局域网共享的运行时语义与 Release 隔离](decisions/0024-debug-lan-runtime-and-release-isolation.md)
- [ADR-0025：普通构建的局域网阅读与移动离线快照](decisions/0025-lan-offline-reader.md)
- [ADR-0026：数学分隔符兼容与跨表面一致渲染](decisions/0026-math-delimiter-compatibility.md)
