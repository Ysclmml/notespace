# 项目状态与持久化交接

最后更新：2026-09-03

状态版本：29

设计基线：Approved baseline 1.1（ADR-0014）

这是上下文压缩、换代理和中断后的唯一状态入口。先读根 `AGENTS.md`，再读本文件、`DESIGN.md`、`REQUIREMENTS.md` 与 `ADR-0005`～`ADR-0014`。

## 1. 当前结论

- 产品名称：英文 `NoteSpace`，中文“笔记空间”。产品定位是普通单用户、本地优先 Markdown/文本编辑器；Typora 风格主画布 + 浏览器式 Tab/历史 + 统一水平可编辑分屏 + 可关闭的只读浮层。
- 侧栏“离线”已改成中性“本地文件”及说明：它只表示直接读写本地文件，不是网络故障或保存成功指示。底部字数跟随活动文档和正文修改/撤销/外部干净重载，点击可看字符（含/不含空白）及行数；CJK 逐字、其他连续字母数字计词，明确采用源码口径，包含代码和链接地址。120 ms 防抖、32 Ki UTF-16 分片与最多 32 个弱引用缓存，不额外读盘、不持久化正文、不 dirty。
- 图片右键优先使用图片专属菜单，不再出现通用段落菜单和整图蓝色选择；支持预览、复制已加载像素/原地址/Markdown、编辑引用及本地图片定位。Markdown 图片多行编辑框可改 `src/alt/title`，单次事务支持 Undo，取消/相同值不修改；不移动/修改原图片。只读查看器没有正文编辑，Mermaid 只提供预览/编辑源码。菜单/弹窗双语，模态期间后台应用命令暂停、关闭弹窗后正常恢复。
- Tauri 产品名、窗口标题、应用内品牌、双语原生菜单、Web 元数据、包/可执行文件和当前文档已同步改名。为兼容旧版本原地升级，bundle identifier `app.markdownworkspace.desktop`、既有 localStorage 键和内部事件/临时文件前缀保持不变。
- 外部文件变化已接通：原生通知监听当前工作区和实际被 Tab/历史引用的独立文件，合并事件后刷新相关文件树；聚焦/恢复可见及 30 秒检查兜底。先检查磁盘元数据，只有版本变化的干净文档才预检重读；共享正文更新但不新增标签、导航或抢焦点。外部重命名按旧路径删除、新路径新增处理，不猜测迁移。
- dirty、缺失、不可读和预检 blocked 保留内存正文并显示双语提示条，暂停该文档普通手动/自动保存；丢弃草稿重载和覆盖磁盘都明确确认，覆盖使用所见外部版本作为前提；缺失不隐式重建，可另存为。即使通知尚未到达，普通保存也检查预期磁盘版本；这是 best-effort 保护，不是文件锁或原子 compare-and-swap。
- 外部读/写与关闭重开竞态有原 Tab 所有权检查；旧保存不会把新重开的同路径文件标 dirty 或触发旧正文回写。无引用 clean 缓存重新打开采用新磁盘正文与锚点；Save As 到已关闭 clean 缓存路径的身份迁移也已修复，不再把缓存当成已打开冲突。
- 运行时技术栈：React 19、TypeScript、Milkdown/ProseMirror（Markdown 默认可视编辑）、CodeMirror 6（Markdown 显式源码、`sourceOnly` 和代码/文本编辑）、Tauri 2、Rust。Node 只用于构建、测试和轻量检查；不引入 Ruby 运行时或工具链，`.rb` 只是受支持的普通文本扩展名。
- Markdown、代码、配置和普通文本均可从工作区树、Quick Open 或原生单文件选择器打开。Markdown 在可视/源码双表面编辑；受支持的 UTF-8 非 Markdown 文件在主 Tab 用 CodeMirror 编辑，可保存或另存为，不显示可视/源码切换。
- 可新建未命名 `.md` 或 `.txt`。首次保存和另存为使用原生文件选择器与同目录原子保存；`excludedPaths` 在写盘前拒绝其他已打开 session 的目标路径，成功后 `DocumentSession`、所有 Tab 及其历史项迁移到新路径。默认仍为手动保存和 dirty 关闭提示；可选 1–300 秒停止输入后自动保存，默认预置延迟 5 秒，未命名文档不自动 Save As，失败仍保持 dirty 与错误。
- 一个窗口可同时打开多个工作区；文件侧栏同时显示全部已打开根及各自文件树，每个根可独立折叠，活动根高亮，Quick Open 聚合全部根。根右键可复制路径或从当前窗口关闭；关闭工作区不删除磁盘内容，也不强制关闭已打开 Tab。打开/最近工作区、最近文件和当前工作区只以路径、名称、顺序写入本地存储，并在启动时尽力恢复；恢复期间新打开的根会合并保留，失效 open/active 记录会清除，独立文件无需属于工作区。
- 工作区根或现有子目录可直接新建空 UTF-8 Markdown/常见代码文本或单层空文件夹；文件无扩展名默认补 `.md`，文件夹名不补后缀，Rust 保证父目录仍在所选根内且不覆盖、不递归。移除每根常驻的新建/定位工具栏；根/目录/局部空白的右键作用于该目录，文件右键可在同级新建，侧栏剩余空白作用于活动根。菜单提供打开、新 Tab、按文件名查找、折叠/展开、复制路径、系统文件管理器定位、关闭根及受控废纸篓操作。文件和目录只有在应用内明确确认后才能移入系统废纸篓；Rust 拒绝工作区根、根外目标和失效路径，失败时保留磁盘内容、Tab 与 dirty 状态。当前不提供永久删除、重命名、移动或复制文件内容。
- 工作区右键采用独立 13px 字号、紧凑行距、分组分隔和轻量 macOS 风格表面；挂载到侧栏裁剪之外并根据实际尺寸避让窗口边缘。默认不高亮第一项，右键不选中文件名文本，支持键盘导航和外部点击关闭；侧栏空白请求一次性消费，切换大纲/文件不会重开旧菜单。删除与 dirty 关闭确认框使用可收缩单列网格，长路径独立换行、正文滚动、按钮保持可见；确认期间阻止后台应用命令和第二个关闭确认，Tab 焦点保持在框内。
- 浏览导航采用窗口级最多 200 项访问轨迹，可跨 Tab/编辑组前进后退并恢复文档与阅读位置；每个 Tab 的正文引用和视图仍独立，同文档共享 session。普通 Markdown 跨文档点击在未固定 Tab 原位替换，固定/编辑后新开预览 Tab；同文档 anchor/Outline 留原页并使用现有正文，不读取未保存文档的磁盘路径。`⌘`/中键后台、`⌘⇧` 前台保留。可视正文/hover 卡片/源码统一导航，显式 `.md/.markdown` 路径不依赖文件树收录，支持独立文件、跨根、编码和 file URL；代码/图片仍专用预览。
- 后退后新导航截断窗口 forward，但会将该 Tab 唯一持有的未保存 forward 文档去重保留到 back，dirty 标记、自动保存和关闭提示仍能看到它。窗口轨迹不复制正文、不额外拥有 session、不记录被动滚动/编辑/重复 focus；关闭/删除过滤对应访问，Save As 同步迁移。历史跳转和 Outline 明确作废先前原位读取，迟到读取不会覆盖当前位置或夺回分屏焦点。
- 同组切换到其他标签（含切走再返回）或新建标签后，先前未完成的原位链接读取会失效；只聚焦另一分屏时仍允许来源分屏更新，但不抢回全局焦点。普通 `worker.py:12` 会先剥离行号再识别协议，不会误判为 URI；file URL 和 Windows 盘符路径仍保留，不支持的 URI 不进入本地代码预览。
- 修复可视初始化导航竞态：首次位置恢复完成前，新的 anchor/reveal 暂存在最新请求中；初始帧先恢复旧视图再消费最新跳转，避免标题已跳转后又归零。独立标记不改变正文 ready 状态；普通和 StrictMode 的确定性暂停帧测试覆盖连续请求、共享正文同步及卸载。
- HTTP/HTTPS 网页链接从可视正文、链接悬浮卡片或源码点击后，通过新的 `open_external_url` 交给系统默认浏览器。Rust 验证协议/主机并以 URL 单参数调用系统入口，Windows 使用 ShellExecuteW，不拼接 shell；不抓取网页或上传文档。启动失败显示中英文错误；正文、Tab 与访问轨迹不变，图片链接仍优先进入专用查看器。
- Mermaid 图中文字样式与测量阶段隔离于正文段落行距；默认 Dagre flowchart 将被挤移的连线标签恢复到预留位置，必要时扩展画布。图表源码、节点与连线路径不变；显式其他布局引擎或未知输出保留原样。合成中文 TD/LR/带子图回路已实际检查无裁切、标签互相重叠或标签压住节点，不将这些样例扩大解释为任意复杂图的排版保证。
- 默认只有一个左侧编辑分屏。标签右键向右分屏会移动原 Tab 而非复制；单页右移可留下可继续打开文件的空左组，同文档显式另开 Tab 时仍共享正文；每个分屏独立管理标签和当前页。内部标签可拖到其他分屏或使用右键“移到分屏”；相邻分隔线支持拖动、键盘调整和复位，过多分屏局部横向滚动。激活/新增分屏或视口缩窄时最小横向定位到活动组；正文编辑、分隔线调整不会抢回手动滚动，也不改变正文纵向位置。Tauri 主窗口关闭原生文件拖放接管（`dragDropEnabled: false`），让 WKWebView 收到 HTML5 内部标签拖放，不增加外部文件拖放或任意嵌套 pane 框架。
- 文件树单击使用当前分屏的斜体预览标签；后续单击可替换干净的预览标签。双击文件、双击标签、右键“保持打开”或正文编辑会固定为普通字体。未保存正文（包括该 Tab 历史中的正文）不会被预览替换；新文件和显式新 Tab 保持固定。文件树打开目标由最近点击或获得光标焦点的编辑分屏决定，默认左侧；异步读取不会抢回用户之后激活的分屏，来源 Tab 已关闭/移走或历史已跳转时丢弃过期结果。
- 活动文件在所属工作区树中高亮，导航到折叠目录中的文件会展开祖先并最小滚动定位；相同文件内编辑不会不断重开用户手动折叠的目录。嵌套工作区按最长匹配根归属。文件、标签的活动/悬浮色加深，活动编辑分屏与非活动分屏的标签状态可区分。
- 分屏中的同文档编辑用最小正文差异同步，远端同步不进入当前编辑器的 Undo，不抢焦点或滚动，并映射本地选择；可视结构、fenced code 与 IME composition 有回归。每个 Tab 独立保存模式和阅读位置；移动标签保留真实编辑器实例。关闭一个仍有其他 Tab 引用的 dirty 副本不重复提示，最后一个引用关闭才确认；放弃后删除无主 dirty 缓存，再打开从磁盘重读。
- 同一编辑表面的滚动与选区按 Tab 保存；可视/源码切换使用标题、附近文本和文档进度组成的语义位置尽力落到同一内容区域，不承诺像素或 offset 一一对应。
- 本地代码/文本引用（行号可选）保留有界只读浮层。“在右侧打开”改为普通可编辑预览 Tab：有右邻组时复用，没有分屏时新增右组；来自最右组时复用该组并保留源页，不增加第三辅助栏。固定/dirty Tab 不被替换，相同目标复用 Tab/共享正文；代码可编辑、查找、保存、拖动和关闭。连续点击 latest-wins；来源/目标组关闭、切页或新打开文件后，迟到读取不得复活或覆盖。浮层仍为目标行前后各 20 行或前 80 行、每行最多 600 字符。
- 代码/文本引用自动识别排除 `handlers/**/urls.py`、`run_<app>.py` 等非具体路径：去包装/拆行号后拒绝 `*`、`?`、残留尖括号、`${...}`、`{{...}}` 与逗号式 brace expansion。内联代码悬浮/点击不会为这些示例排程/读取预览、报不存在或覆盖右栏；不做 glob 搜索。中文/空格、Windows 盘符/UNC/长路径前缀、file URL 和 `[slug]` 等真实字面路径保留，具体文件读取失败仍有提示；图片/显式 Markdown/HTTP 先行路由不变。
- 普通 Markdown 图片链接和可点击的行内图片路径可直接进入专门图片查看器，不要求 `:line`。支持 PNG/JPEG/GIF/WebP/AVIF/BMP/SVG/ICO、相对/绝对/file URL 与 HTTP(S) 图片后缀（含查询参数/锚点）；相对路径基于实际来源 Tab 的文档。仅点击链接才加载该链接图片，不在悬浮时探测；远程查看器图片不发送 referrer，SVG 只作 `<img>` 展示。Fit、100%、缩放、拖动与关闭保留，失败显示可关闭的中英文提示，不改变文档/dirty/Tab/右侧代码栏。CSP 只增加 `img-src` 的 HTTP(S)，其他网络与脚本策略不放宽；本地 asset scope 仍为 `$HOME/**`。现有 Tauri Unix glob 默认不匹配隐藏路径段，HOME 外或隐藏目录中的图片可能被拒绝并显示加载失败，不承诺任意磁盘位置。
- 可视代码块采用浅色纸面、正常行号、常显 Copy 和语言选择器；代码/配置主 Tab、浮层和右栏共享明确的浅色语法配色，JSON、Shell、Python、JavaScript/TypeScript、CSS、Rust、Java 和 C# 等支持对应高亮；即使右栏从一个文件替换为另一个相同语言文件，也会为新 EditorView 重新装载语言支持。源码、主 Tab、浮层、右栏和可视 fenced code 使用高对比度蓝灰选区，选中文本不会再被活动行或语法色吞没。输入三个反引号加语言前缀时出现本地语言自动补全，可用方向键选择并以 Enter/Tab 创建代码块，Esc 关闭。提示/补全浮层不进入 Markdown 或历史；列表 marker 已与首行对齐。
- GFM 表格保持真可视单元格编辑；宽表格在自身容器横向滚动，列宽可拖动但只属于 view、不写 Markdown。尺寸网格只在用户明确选择“插入表格”后临时出现；已有表格可直接修改行列数、增删行列并设置整列左/中/右对齐，均使用单次正文事务且支持 Undo。
- 默认 `zh-CN`，可切换 `en-US`；应用内菜单、自定义右键菜单和 macOS 原生菜单同步本地化。右键菜单采用紧凑的 Typora/macOS 纸面样式，支持编辑、链接、普通结构、表格、工作区和标签动作，并保持右键前的编辑选择和触控板右键语义。浏览器默认 Reload/Inspect 菜单只允许在顶部工具栏的非弹层区域出现；其他区域只阻止原生默认行为，不阻断应用自定义右键。debug 原生“显示”菜单可打开开发者工具，release 不显示该入口。
- 原生红色关闭、`window.close` 与 `app.quit` 共用同一个可取消的 dirty 检查和一次性 `destroy()` 路径；dirty 汇总覆盖每个 Tab 的 `current/back/forward` 全历史，并使用应用内中英文关闭对话框。用户取消时窗口与进程都保留，确认或 clean 时销毁主窗口。Tauri capability 明确只增加 `allow-close`、`allow-destroy`；销毁失败会记录错误、复位状态并允许重试。Rust 在主窗口 `Destroyed` 后调用 `app_handle.exit(0)`，因此 macOS 不再留下无窗口驻留进程。
- locale、字号、正文宽度、代码行号、代码换行、输入提示、保存模式、自动保存延迟和启动行为使用 `markdown-workspace.settings.v1`。工作区/最近项与每根 `showHidden` 使用 `markdown-workspace.workspaces.v1`。新增 `markdown-workspace.session.v1` 只记路径、标签分组和阅读位置。macOS 实机存储位于 `~/Library/WebKit/app.markdownworkspace.desktop/WebsiteData/Default/` 下按来源散列的 `LocalStorage/localstorage.sqlite3`；不在仓库，不上传。文档仍在原文件路径，粘贴图片在相邻 `assets/`。
- 截图粘贴链路已实现：Rust 直接读取系统剪贴板，先写文档相邻 `assets/`，成功后才插入相对链接。自动化覆盖成功/失败与“成功后才插链接”；物理剪贴板回归留作用户验收。
- 只保留三项实用护栏：大 Base64/data-image 预检、截图先落盘后插链接、同目录原子保存。不得恢复通用安全平台、巨型 IPC、通用 feature flag 或 Ruby 工具链。

- 启动设置默认“恢复上次浏览”，可选“打开空白窗口”。恢复重新读取原文件，重建固定/预览 Tab、分组、活动页/组、模式和数值滚动/选择；保留显式空左组，缺失或预检拒绝文件跳过。限制 8 组/100 页/32 根/4 MiB 元数据，不保存正文、未命名文档、选中文本、Undo 或前进后退轨迹；不恢复分隔线比例。新操作可取消迟到的 Tab 恢复，旧快照不会覆盖正在使用的窗口。
- 当前页查找由 `Cmd/Ctrl+F`、顶部更多菜单和原生“编辑”菜单打开，只作用于活动编辑页。Markdown 可视/源码、代码文本支持中文/多处匹配、计数、上下一个和 Esc；可视搜索跨行内样式及代码块正文，不把 URL 属性、工具栏和 Mermaid SVG 重复算入。查找装饰不 dirty、不进正文 Undo。查找栏使用独立布局行而非覆盖正文，短文件首行可见，关闭即恢复空间。
- 工作区根右键增加“显示隐藏文件和文件夹”勾选，默认关闭、每根独立记忆并递归应用。仍不遍历 `.git`、依赖/构建等重目录、符号链接和未知后缀。根标题用工作区图标/小标签与右侧折叠控件，一级目录额外缩进，和普通目录清晰区分。
- 可视代码块失去焦点后不再保留蓝色选区与活动行高亮，重新聚焦仍可恢复原选择；不改变正文/Undo。链接编辑框使用可自动换行的多行地址字段，完整地址可查看、滚动及编辑，保留确认/取消与 IME 语义。

## 2. 已实现事实

| 能力                                    | 状态             | 证据/说明                                                                                                                                                                                                 |
| --------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tauri 2 + React/Vite/Rust desktop shell | DONE             | `NoteSpace.app`/DMG 已重建；ad-hoc runtime 签名、DMG 校验、ARM64 架构和兼容 bundle identifier 均通过                                                                                                      |
| Markdown 可视/源码双表面                | DONE             | Milkdown/ProseMirror 默认可视；CodeMirror 显式源码或 `sourceOnly`；同步 serializer、表格和 IME 有回归                                                                                                     |
| 代码/文本主 Tab 编辑                    | DONE             | JSON/Shell/Python 等受支持 UTF-8 文件用 CodeMirror 明确浅色语法高亮、真实行号、滚动、dirty、`⌘S` 与 Save As；同语言换文件也会重装 parser；源码、主 Tab 和只读预览的选区对比度有 DOM 回归；不进入 Milkdown |
| 保存策略与 Save As                      | DONE             | 默认手动与全历史 dirty 关闭对话框；可选 1–300 秒 inactivity autosave；Save As 路径冲突与历史迁移保持不变                                                                                                  |
| 外部文件变化与冲突保护                  | DONE             | 原生通知及聚焦/定时兜底；树增删刷新、干净重载、dirty/删除保留；重载/覆盖确认、保存前版本保护与迟到读写所有权有回归                                                                                        |
| 多工作区、独立文件与最近项              | DONE             | 全部根/树同时显示、每根独立折叠、活动根、复制路径/关闭根、聚合 Quick Open、延迟恢复合并、失效 open/active 记录清理                                                                                        |
| 工作区新建、定位与可恢复删除            | DONE             | 根/目录/文件同级及侧栏空白可新建文件或单层空目录且不覆盖；无常驻根工具栏；路径/废纸篓动作保留，长路径删除框、焦点及多根目标有回归                                                                         |
| Tab、导航、Outline 与语义位置           | DONE             | Markdown 路由优先；每 Tab 历史/同表面视图独立；跨表面按语义尽力定位                                                                                                                                       |
| 可编辑分屏与预览标签                    | DONE             | 标签右键向右分屏、跨分屏拖动/菜单移动、宽度调整；树单击斜体预览，双击/编辑固定；打开文件跟随编辑焦点；共享正文而位置/历史独立，异步关闭/移动/历史跳转竞态有回归                                           |
| 活动文件跟随与右键策略                  | DONE             | 所属树自动展开与定位、深色选中/悬浮；同路径编辑不覆盖手动折叠；仅顶部工具栏保留浏览器默认菜单，debug 原生菜单有 DevTools                                                                                  |
| 本地文件三种去向                        | DONE             | 有界只读浮层、当前组和右侧编辑组；右侧不额外建立辅助栏，临时替换/fixed/dirty/关闭保护共用正常 Tab 逻辑                                                                                                    |
| 原生/应用内/右键菜单双语                | DONE             | 原生菜单新增 `file.reveal`；结构/表格/工作区菜单与自动保存设置均有中英文；自定义右键菜单使用紧凑 Typora/macOS 样式；红色关闭、窗口关闭与退出共用 dirty 确认并真正终止进程                                 |
| 关闭与共享编辑完整性                    | DONE             | 历史 dirty、跨组同文档关闭、最后引用放弃后磁盘重读、保存后立即关闭、被关闭/移动 Tab 的迟到读取、共享视图/IME/Undo 均有回归；既有删除与右栏 latest-wins 继续通过                                           |
| 浅色代码块与 fence 自动补全             | DONE             | 常显语言/Copy、行号、换行、最多 8 个本地候选、键盘/点击创建和列表对齐均有回归                                                                                                                             |
| 可视表格工具                            | DONE             | 内部横向滚动、view-only 列宽、显式命令后的临时尺寸网格、已有表格行列数调整、行列操作与整列左/中/右对齐；Markdown 不持久化列宽                                                                             |
| 持久设置                                | DONE             | 九项设置含 `autoSaveMode/autoSaveDelaySeconds`；默认 manual，延迟归一化为 1–300 秒                                                                                                                        |
| 启动浏览恢复                            | DONE             | 默认恢复磁盘文件、标签分组和阅读位置；设置可空白启动；元数据白名单，不恢复正文草稿、未命名页或导航轨迹                                                                                                    |
| 当前页查找                              | DONE             | 可视/源码/代码三表面支持中文、计数、前后匹配和 Esc；独立布局行不遮正文，不 dirty，跨组请求隔离                                                                                                            |
| 文档统计与本地文件标识                  | DONE             | 字数/字符/行数随活动正文变化；分片弱缓存不读盘，中文逐字；“本地文件”不冒充网络或保存状态                                                                                                                  |
| 图片右键与引用编辑                      | DONE             | 文内/查看器按目标给出图片动作，src/alt/title 可撤销修改，原文件不变；失效目标拒绝提交，模态关闭后恢复应用操作                                                                                             |
| 隐藏项与编辑可读性                      | DONE             | 每根隐藏项偏好递归应用，根标题和首级缩进明确；失焦代码块隐藏陈旧选区，链接地址多行完整编辑                                                                                                                |
| 大文件预检与 `sourceOnly`               | DONE             | 64 KiB 固定缓冲；约 10 MiB 普通多行文档可降级打开；blocked 不返回正文                                                                                                                                     |
| 截图落盘后插入相对链接                  | DONE (automated) | Rust 直接读取系统剪贴板并生成 PNG；成功/失败前端行为有测试；物理剪贴板留作用户验收                                                                                                                        |
| Mermaid/图片查看器                      | DONE             | 既有 Mermaid/嵌入图片查看器保留；新增无行号图片链接/行内路径、来源 Tab 相对路径解析、加载失败回退、不影响代码栏和 dirty；zoom/pan/Fit/100% 均有回归                                                       |

## 3. 当前 Tauri 命令

只定义当前实现使用的 16 个命令：

```text
pick_workspace()
pick_document()
list_workspace(rootPath, showHidden?)
open_document(path)
inspect_documents(paths)
watch_filesystem(workspaceRoots, documentPaths)
open_external_url(url)
reveal_in_file_manager(path)
create_workspace_text_file(workspaceRoot, directoryPath, fileName)
create_workspace_folder(workspaceRoot, directoryPath, folderName)
move_workspace_entry_to_trash(workspaceRoot, path)
preview_local_file(reference, documentPath)
save_document(path, content, expectedRevision?)
save_document_as(suggestedFileName, content, excludedPaths)
save_clipboard_image(documentPath)
set_native_menu_locale(locale)
```

`create_workspace_text_file` 只创建受支持的空 UTF-8 文本且使用 `create_new`；`create_workspace_folder` 只在规范化后的根内现有父目录下以 `create_dir` 新建一个空目录，拒绝同名、非法名称、根外父目录和根外符号链接；`reveal_in_file_manager` 不经 shell。`move_workspace_entry_to_trash` 只接受规范化后的工作区根后代，拒绝根本身和根外路径，并调用系统废纸篓而非永久删除。`save_clipboard_image(documentPath)` 由 Rust 直接读取系统剪贴板，不接收 bytes、MIME 或 Base64。不要恢复预生成 37 命令、巨型 schema 或通用 IPC 层。

原生菜单当前固定 13 个前端应用 action ID；ADR-0007 的 11 项基础上新增 `file.reveal` 与 `edit.find`。debug 的 `view.openDevtools` 由原生层直接执行，不增加 IPC 命令或前端 action。Undo/Redo/Cut/Copy/Paste/Select All 仍使用平台预定义菜单命令，不计入应用 action ID。

## 4. 当前不可变决策

1. 本地 Markdown/文本文件是唯一持久化正文；不保存 ProseMirror JSON。未编辑 Markdown 必须零差异；首次可视正文编辑后 serializer 可规范化等价 Markdown。
2. `DocumentSession != Tab != HistoryEntry != EditorGroup`；同文档共享正文，文档引用和阅读位置按 Tab 隔离，活动 Tab 按编辑分屏管理。工具栏前进/后退使用独立的窗口访问轨迹，不受当前 Tab 栈限制。
3. `normal/sourceOnly` 是 Markdown 文档能力，`visual/source` 是 Tab 视图状态；代码/文本固定使用 CodeMirror，但可编辑和保存。
4. Save As 必须把当前 session、所有引用它的 Tab 和 back/forward 历史项一起迁移到新规范化路径，不能留下旧 ID。
5. 可视模式的标题、列表、链接、代码和表格不因光标自动展开源码；源码只由显式切换进入。
6. 每个 ProseMirror 正文 transaction 同步更新待保存 Markdown；输入后立即 `⌘S` 不能漏字。
7. Markdown 链接解析优先于本地代码引用；多个工作区有包含关系时，用最长匹配根解析归属。
8. 代码右侧打开与普通 Tab 共用扁平 EditorGroup；不再保留额外只读辅助栏。仅浮层只读；右移原 Tab、复用右组、dirty 不被替换和迟到关闭保护必须保持。
9. 同表面恢复精确的本表面位置；跨可视/源码只承诺语义相近位置，使用标题、附近文本和进度回退。
10. 截图先写相邻 `assets/`，成功后才插链接；产品不生成 Base64 Markdown。未命名文档先 Save As。
11. 大 data-image/病态长行在进入 EditorView 前阻止；约 10 MiB 普通多行文档走 `sourceOnly`。
12. 保存使用同目录临时文件 + flush/sync + rename；失败保留旧文件。
13. 最近项和设置只是本机便利状态；不保存正文、不复制历史正文、不建设项目数据库或正文快照系统；允许可丢失的有界浏览元数据。
14. 只为当前命令定义类型；不新增服务端、账户、遥测、网络上传、IDE/LSP/debug/build/run 或通用插件框架。
15. 关闭 Tab、窗口或应用时，dirty 判断必须覆盖仍被 `current/back/forward` 引用的 session；必须使用应用内关闭对话框，原生红色关闭、close 与 quit 必须经过同一可取消的 `destroy()` 路径，主窗口销毁后应用进程必须退出。
16. 手动保存是默认策略；自动保存只处理已有路径的 dirty session，延迟 1–300 秒，迟到计时器必须校验正文，失败不得清 dirty。
17. 文件侧栏同时展示全部打开根且每根可独立折叠；活动根与最长匹配 owner 仍是工作区归属依据，关闭根不删除文件或强制关闭 Tab。
18. 工作区内新建必须使用现有根/父目录、受支持后缀和不覆盖语义；reveal 只调用系统文件管理器；复制路径只写剪贴板，不改变磁盘内容。
19. 表格列宽只属于可视 view；拖动列宽不得写 Markdown、标 dirty 或进入正文 Undo。
20. 非 Markdown 文本只能进入 CodeMirror 主表面；后缀语言识别失败时使用纯文本高亮，不得送入 Milkdown 或显示 Markdown 可视/源码切换。
21. 工作区文件/目录删除必须先显示明确确认；Rust 只允许将严格根后代移入系统废纸篓，拒绝根、根外和失效目标。调用失败时不得丢弃 session、历史、Tab 或 dirty 状态。
22. 不保留常驻根工具栏；新建、查找、路径与关闭动作由根/目录/文件同级和空白区右键提供。文件夹创建只接受单个名称，不递归或覆盖；菜单不展示尚未实现的重命名、副本或新窗口。
23. 预览/固定属于 Tab，不属于 DocumentSession；只可自动替换当前组的干净预览标签，正文编辑必须固定。文件读取目标在发起时绑定来源组/Tab，过期结果不得复活已关闭/移动的标签或抢回后续焦点。
24. 共享编辑的被动同步不进入本地 Undo、不抢焦点/滚动；IME 期间排队，不能销毁正在输入的编辑器。关闭最后引用并放弃时清除无主 dirty 缓存；其他仍引用同文档的分屏必须保留正文。
25. 图片链接使用实际来源文档解析，不依赖文件行号；查看器不执行 SVG 脚本、不上传、不做悬浮网络探测。浏览器原生菜单仅顶部工具栏可用，应用自定义菜单照常收到事件。
26. 外部文件通知只携带路径，检查只返回元数据；磁盘版本不写入浏览快照。冲突保留正文且不能隐式覆盖/重建；原子写入前检查版本但不承诺无竞争窗口。迟到结果必须仍属于发起时的 Tab 引用，不能污染同名重开会话。

## 5. 真实语料结论

真实工作文档只做过只读聚合，没有复制、提交或写回：

- 约 79 篇 Markdown、总计约 1.02 MiB；最大单篇约 243 KiB。
- 大量 GFM 表格和约千条本地链接，因此表格可读性、导航、中文输入和零差异保存优先。
- Mermaid 数量较少但现有查看体验很差，因此 viewer 是第一版明确功能。
- 多年使用只出现过一次误粘贴约 10 MiB Base64；只需要低成本防卡死，不需要完整修复系统。

任何实现与测试都不得把真实语料内容或其个人路径带入仓库。

## 6. 当前工作包

| 工作包                         | 状态    | 说明                                                                                                                          |
| ------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 精简边界与 Node tooling        | DONE    | baseline 0.8；仅新增用户明确要求的水平编辑分屏、预览标签与图片链接查看；无 Ruby 工具链或重型框架                              |
| Rust 本地文件纵向切片          | DONE    | 16 个当前命令；新增原生监听与元数据检查；保留系统浏览器、文件/空目录创建、定位、废纸篓和原子保存；新增轻量版本前提保护        |
| Markdown 双表面与代码/文本编辑 | DONE    | 主 Tab 可编辑/保存；新建、Save As 与路径迁移已接通                                                                            |
| 多工作区与本地最近项           | DONE    | 多根文件树同时显示、独立折叠、活动根、复制路径/关闭根、打开集合和最近工作区/文件尽力恢复                                      |
| 浏览器式导航与统一右组         | DONE    | 当前组/右组共享 Tab 状态；有界浮层只读；右组代码直接编辑和定位，固定/dirty 保留                                               |
| 水平编辑分屏与预览标签         | DONE    | 每组 Tab/焦点、共享正文、独立视图、移动保留编辑器、in-flight 导航隔离、预览双击/编辑固定、内部标签拖放与分隔线调整            |
| 图片链接、活动文件与菜单策略   | DONE    | 无行号图片链接专用查看器/错误回退；工作区树跟随与对比度；浏览器默认右键限顶部，debug 原生 DevTools                            |
| 文件动作、自动保存与表格工具   | DONE    | 根/子目录新建、reveal/复制路径、确认后移入废纸篓、manual/afterDelay、view-only 列宽、临时插入网格、已有表格行列数与对齐已接通 |
| 中英文菜单、右键与设置         | DONE    | 中文“笔记空间”/英文 `NoteSpace`；新增文件/表格/自动保存表面双语；紧凑 Typora/macOS 右键样式；九项持久设置已接通               |
| 保存、关闭与恢复完整性收尾     | DONE    | 写前 Save As 冲突、持久错误、全历史 dirty、`00 → 01 → close/quit`、删除取消/确认、恢复竞态/失效项和菜单作用域有自动回归       |
| 外部磁盘变化                   | DONE    | 真实 macOS 监听、元数据比较、树刷新、干净重载、dirty/缺失保护、保存版本检查与迟到所有权均有自动回归                           |
| 文档统计、图片右键与引用编辑   | DONE    | 活动正文统计与缓存；图片专用动作、多行引用编辑、Undo、模态退出保护；无新 IPC 或文件写入                                       |
| 本轮自动化门禁                 | DONE    | `pnpm verify` 完整通过：51 个前端测试文件、616 项测试，Rust 52 项；格式/类型/lint、Web 与 debug no-bundle 构建通过            |
| 本轮界面回归                   | DONE    | 1280×720 合成 Demo 验证字数编辑/撤销更新、图片菜单/长地址编辑/取消/Undo、真实剪贴板 PNG/地址、只读查看器和 Mermaid 源码焦点   |
| 本轮最终桌面验收               | PENDING | debug `.app`/DMG 已重建并校验；不自动安装/重启正常实例；原生图片复制/定位及退出/恢复留作新版实机验收                          |

## 7. 唯一下一步

交用户保存并退出旧实例，启动本轮 standalone debug `.app`，以测试文件验收图片右键/引用修改、本地图片复制/定位和实时字数。完整门禁、Browser UI 与产物校验已通过，不代替原生桌面完整联调；不自动安装、重启或修改真实工作文档。

### 已知边界

- 字数统一采用源码口径，不是移除 Markdown 语法/链接地址/代码后的排版字数。缓存可被回收并重算，不写入设置目录。
- 复制图片只复制已加载像素为 PNG；未加载、超过 3200 万像素、跨域画布或系统剪贴板限制会显示错误，可改用地址/Markdown 复制。没有额外网络下载或修改原图；本地 asset 范围仍保持既有限制。
- 外部重命名目前按删除/新增显示，不自动移动已打开标签或修改文内链接。磁盘版本保护不是文件锁，检查与 rename 之间仍有极小竞争窗口。
- 实际原生监听只在 macOS 合成临时目录验证，Windows/Linux 未实机验收。递归 OS watcher 可能覆盖重目录，应用层枚举/事件过滤不代表底层完全没有监听成本。
- Save As 已关闭 clean 缓存路径的既有问题本轮已修复并通过 Shell 回归；实际仍被标签/历史引用的路径仍禁止冲突写入。

## 8. 最近主线决策

- `ADR-0014`：轻量原生外部变化通知、元数据检查、干净自动重载、dirty/缺失保留与显式确认、保存前磁盘版本检查；不引入正文快照、自动合并、文件锁或网络同步。
- `ADR-0013`：启动浏览元数据恢复/空白设置，代码右侧合并编辑分组，右分屏移动原 Tab，当前页查找、递归隐藏项偏好、根标题和编辑细节修复。

- `ADR-0005`：确立普通本地编辑器的精简边界，Ruby 工具链和重型安全实验退役。
- `ADR-0006`：旧 source-first live preview 退役，改为 Milkdown/ProseMirror 默认真可视 + CodeMirror 显式源码。
- `ADR-0007`：代码/文本可编辑、新建/Save As、多工作区与最近项、单一右侧只读辅助预览、双语原生菜单、丰富右键、fence 自动补全和跨表面语义位置成为当前基线。
- `ADR-0008`：默认手动/可选 inactivity autosave、多根文件树同时显示、工作区内新建、文件管理器定位、view-only 表格列宽与可视结构工具成为当前基线。
- `ADR-0009`：dirty 汇总覆盖 Tab 全历史；多根独立折叠、复制路径和关闭根；文件/目录确认后移入系统废纸篓，Rust 严格拒绝根与根外目标。
- `ADR-0010`：取消常驻根工具栏，根/目录/文件同级与侧栏空白使用紧凑双语右键菜单；增加单层目录创建，长路径确认框可收缩并保持模态焦点。
- `ADR-0011`：用户明确要求后，新增一维水平可编辑分屏与 VS Code 风格预览/固定标签；按活动编辑组打开文件，跨组共享正文但隔离视图；活动文件树跟随、顶部限定原生右键和无行号图片链接查看器成为当前基线。
- `ADR-0012`：只让本地 Markdown 链接参与文档间跳转；按源标签固定/临时状态新开预览或原位替换，同页锚点/Outline 留原页；窗口级有界轨迹跨 Tab/组恢复，关闭/删除与脏历史所有权保持一致。可视链接 hover 卡片也必须进入应用路由。
- 2026-09-03 用户明确追加网页访问：只在点击 HTTP/HTTPS 网页链接后启动系统默认浏览器；不新增内置网络客户端、自动抓取、上传或其他网络服务。图片链接保留专用预览。
- 既有完整性收尾：Save As 在 Rust 写盘前排除其他已打开路径；关闭/退出覆盖历史 dirty session；保存错误保持可见；延迟工作区恢复合并用户新开根并清理失效记录；本地引用扩展与 Rust 对齐；非 Markdown 文本固定走 CodeMirror；插表控件改为显式临时浮层；已有表格、右侧预览和最后 Tab 均可直接调整或关闭。原先“非编辑区保留平台右键”的规则已由 ADR-0011 收窄为仅顶部工具栏。
- 2026-09-01 真实回归收尾：代码选区改为明确蓝灰高对比度；右栏已开时本地代码引用直接替换且 latest-wins；`00` 修改后切到 `01` 仍显示 dirty 并可可靠关闭；标签/窗口/退出共用应用内确认；工作区根可折叠、复制路径和关闭，普通文件/目录只走确认后的系统废纸篓。
- 2026-09-02 品牌收尾：公开名称统一为英文 `NoteSpace`、中文“笔记空间”；应用包、原生可执行文件和构建产物采用新名称，保留旧 bundle identifier 与本地设置键以保证升级兼容。
- 2026-09-02 工作区交互修复：右键按目标提供打开/新 Tab、新建文件/文件夹、查找、折叠、路径与既有关闭/废纸篓动作；确认框长路径独立换行，正文与操作区不再被撑出窗口。确认期间不执行后台应用快捷键或叠加原生关闭请求。
- 2026-09-02 分屏集成收尾：保存和确认状态 ref 在提交时同步，避免保存后立即关闭仍读旧 dirty；移走/关闭来源 Tab 或后退时废弃迟到导航；最终放弃移除无主 dirty 缓存。关闭 Tauri 原生拖放接管以保留 WebKit HTML5 标签拖放；图片仅放宽 `img-src` 的 HTTP(S)，asset 范围保持不变。

## 9. 验证记录

本轮状态版本 29：文档统计与图片右键/引用编辑已集成，定向测试、合成 Browser 界面、完整门禁和 debug bundle 校验均通过。

- **PASS (full gate)** — `PATH="$HOME/.cargo/bin:$PATH" pnpm verify` 完整通过：Vitest 51 个文件、616/616 tests；Rust 52/52；repository check、Prettier、ESLint、TypeScript、Web production build、Rust fmt/clippy 与 debug no-bundle build 全通过。保留既有 Vite 大 chunk 警告，不影响构建。
- **PASS (bundle)** — `pnpm tauri build --debug --config '{"bundle":{"macOS":{"signingIdentity":"-"}}}'` 生成新版 `src-tauri/target/debug/bundle/macos/NoteSpace.app` 与 `src-tauri/target/debug/bundle/dmg/NoteSpace_0.1.0_aarch64.dmg`，已内嵌前端，可直接启动无需 Vite。`codesign --verify --deep --strict`、`hdiutil verify` 和 ARM64 架构检查通过；DMG SHA-256：`c0dbd15d74e7011b77e091ea5f4163240b7010e7b6a3578e38c0dfe647f52ae2`。仅 ad-hoc 签名，无 Apple Developer ID 签名/公证；未自动安装/启动或覆盖用户正常应用。
- **PENDING (native UI)** — 本地 Tauri asset 图片像素复制/系统定位与原生退出/重启的完整桌面联调仍需新版实机验收；自动化与 Browser 同源图片复制不能替代该项。

- **PASS (focused)** — `pnpm exec vitest run src/app/shell/AppShell.statistics.test.tsx src/features/document-statistics src/app/i18n/translations.test.ts` 4 文件 30/30；图片 Shell 接线 4/4，覆盖定位图片而非文档、远程不定位、失败不改正文，以及模态关闭后窗口可正常销毁。
- **PASS (images, focused)** — `pnpm exec vitest run src/features/image-actions src/features/context-menu src/features/viewer/VisualViewer.test.tsx src/features/editor/VisualMarkdownEditor.dom.test.tsx` 7 文件 85/85；真实可视 DOM 28/28。覆盖地址/alt/title 语义转义、失效目标、Undo/Redo、Mermaid 源码聚焦、查看器只读与失败菜单避让。本轮未放宽测试时限或断言。
- **PASS (integration, focused)** — `pnpm exec vitest run src/features/navigation/imageReference.test.ts src/app/shell/AppShell.imageActions.test.tsx src/features/document-statistics src/app/shell/AppShell.statistics.test.tsx` 5 文件 57/57，含活动分屏/切页、外部干净重载、缓存和模态恢复。
- **PASS (browser)** — 1280×720 隔离新建合成文档验证中文 `6 → 8 → Undo → 6`；源码/可视切换一致，详情字符/行数可见。图片专属右键不选蓝整图，长地址/alt 修改可 Undo，非法协议拒绝且取消后计数不变；已加载合成 SVG 实际复制为 PNG，地址复制保留原值；只读查看器裁剪编辑项，Mermaid 菜单打开源码并聚焦 CodeMirror。未读写真实用户文档；临时 SVG、独立测试页及 Vite 服务已清理。

### 以下为状态版本 28 验证记录（非本轮交付证据）

本轮 baseline 1.1：外部变化实现、完整门禁、隔离 UI 和新版 debug bundle 均已完成。

- **PASS (full gate)** — `PATH="$HOME/.cargo/bin:$PATH" pnpm verify` 完整通过：Vitest 46 个文件、558/558 tests；Rust 52/52；repository check、Prettier、ESLint、TypeScript、Web production build、Rust fmt/clippy 与 debug no-bundle build 全通过。Vite 的既有大 chunk 警告保留，不阻断构建。

- **PASS (native, focused)** — `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked` 52/52；Rust fmt/clippy 通过。临时目录实测新增/修改/原子替换/删除、独立父目录删除重建、监听替换/停止；打开前后预检和保存写前/rename 前版本检查均有故障回归。未读写真实用户文档。
- **PASS (frontend, focused)** — 状态外部变化 30 项、监听调度 12 项、同步器 11 项、Shell 外部变化 6 项、adapter 16 项通过。覆盖干净重载、树增删、dirty 自动保存暂停、确认取消/确定、通知前手动保存拒绝、删除不隐式重建、关闭同路径重开的迟到保存，以及 Save As 已关闭缓存路径。
- **PASS (browser)** — 1100×800 隔离 Chrome 页使用真实 AppShell/MarkdownEditor 与合成 adapter：clean 自动重载、树增删、双分屏各自草稿保留、读取取消/确认仅影响目标页、删除后正文保留且普通保存调用仍为 0。两组提示条均完整占据独立布局行，按钮无遮挡/溢出。仅既有 Crepe/Vue feature-flag warning，无控制台 error。临时夹具、浏览器页、视口覆盖与 Vite 服务均已清理。
- 一次全量测试在源码链接用例中遇到 CodeMirror 初始 20 ms 解析预算尚未覆盖目标位置。仅在该 DOM 测试显式等待语法树解析完成后触发点击，保留全部手势、单次回调和不 dirty 断言；未改运行时逻辑。目标文件 13/13、重复用例与最终完整门禁均通过。
- **PASS (bundle)** — `pnpm tauri build --debug --config '{"bundle":{"macOS":{"signingIdentity":"-"}}}'` 生成新版 `src-tauri/target/debug/bundle/macos/NoteSpace.app` 与 `src-tauri/target/debug/bundle/dmg/NoteSpace_0.1.0_aarch64.dmg`。前端已内嵌，可直接启动无需 Vite。`codesign --verify --deep --strict`、`hdiutil verify` 与 ARM64 架构检查通过；DMG SHA-256：`14428cf623091986f923c3111a79244bc55f1cfae6ba10c02d2a4d97cc8d465c`。仅 ad-hoc 签名，未做 Apple Developer ID 签名/公证。
- **PENDING (native UI)** — 本轮不安装/覆盖应用或重启正常实例；跨应用完整联调及退出/重启恢复仍需新版实机验收。

### 以下为状态版本 27 验证记录（非本轮交付证据）

baseline 1.0：功能、自动门禁、UI 与 debug bundle 已完成。

- **PASS (full gate)** — `PATH="$HOME/.cargo/bin:$PATH" pnpm verify` 最终完整通过：Vitest 42 个文件、496/496 tests；Rust 42/42；repository check、Prettier、ESLint、TypeScript、Web production build、Rust fmt/clippy 与 debug no-bundle build 全通过。Vite 的既有大 chunk 警告保留，不阻断构建。

- **PASS (browser)** — 隔离 Demo 的 1100×800 窗口验证：右移原 Tab、空左组继续打开、只保留两组的代码右开与真实行号/高亮、焦点组查找、中文计数/前后匹配/Esc、源码切换、工作区层级与隐藏项复选菜单。实测发现零高查找浮层遮住短代码首行，已改为三表面独立布局行并复验首行完整可见；关闭查找还原空间。独立真实界面回归同时确认失焦代码选区和多行长链接编辑。临时浏览器页、视口覆盖与 Vite 服务已清理；未读写用户文档。
- **PASS (automated, focused)** — 恢复/设置/统一分组 34 项、当前页查找 8 项、关闭在途预览 7 项通过。恢复用模拟重启验证重新读取磁盘、共享 session/独立视图、空白启动不读旧根/旧文档、取消迟到恢复；不是原生进程重启验收。
- 初始化焦点回归先复现后修复：初始 RAF 尚未执行时切换组，可视编辑器使用最新 `autofocus`，不会依据旧快照夺回焦点；确定性暂停帧测试与两项旧 anchor 测试通过。最终关闭、隐藏树和初始根恢复的迟到结果均有取消/版本检查。
- 一次全量复跑的失焦选区测试超过默认 5 秒。分段计时确认完整 Crepe/CodeMirror 在 jsdom 挂载约 3.7 秒，后续选区/样式及回正文约 0.2 秒，所有断言通过；长链接两次真实浮层的 jsdom 样式计算约 35 秒。仅给这两个完整 DOM 集成测试设 15/90 秒时限，不放宽全局、不删断言、不改运行时；干净目标 2/2 通过。真实小窗口交互另行验证。
- **PASS (bundle)** — `pnpm tauri build --debug --config '{"bundle":{"macOS":{"signingIdentity":"-"}}}'` 生成 `src-tauri/target/debug/bundle/macos/NoteSpace.app` 与 `src-tauri/target/debug/bundle/dmg/NoteSpace_0.1.0_aarch64.dmg`。已内嵌前端，直接启动无需 Vite。`codesign --verify --deep --strict`、`hdiutil verify` 及 ARM64 架构检查通过；DMG SHA-256：`40aee571bb16f294b7dad058a61c1cee041cbc9961f7a104ce11dfad110cd628`。仅 ad-hoc 签名，无 Apple Developer ID 签名/公证。
- **PENDING (native UI)** — 本轮未安装/覆盖系统应用或重启用户旧实例；原生退出、重启浏览恢复与桌面拖放仍需新版实机验收。自动化和浏览器结果不能代替这项。

### 以下为状态版本 26 及此前验证记录（非本轮交付证据）

- 本轮集成门禁：**PASS** — `pnpm verify`（PATH 中包含 Rust 工具链）完整通过：Vitest 37 个文件、438/438 tests；Rust 40/40；repository check、Prettier、ESLint、TypeScript、Web production build、Rust fmt/clippy 与 debug no-bundle build 全部通过。Vite 仍报告既有大 chunk 警告，不阻断构建。
- 本轮误报修复：**PASS (automated)** — 本地引用 parser 27/27，12 个通配/占位输入先红后绿；中文/空格、Windows/UNC/长路径、file URL、Next.js 方括号路由名保持。新增 2 个真实可视编辑器 Shell 回归覆盖无 320ms 预览排程、无读取/dirty/轨迹变化、已开右栏保持以及具体文件真实失败仍提示。未读写用户工作文档。
- 本轮初始化导航收尾：**PASS (automated)** — 初次整跑与门禁均暴露旧 anchor 用例 `scrollTop 164 → 0`，并非新 parser 拦截；延迟初始恢复帧后稳定复现。增加独立初始视图恢复标记，先恢复基线再消费最新 reveal，普通/StrictMode 2 项确定性回归先红后绿；正文 ready 不变、共享正文同步不 dirty、用户后续滚动和卸载保持。最终完整门禁含原失败用例通过，不靠延长超时掩盖。
- 上一稳定基线：baseline 0.8 的 Vitest 35 文件、314/314 tests 与 Rust 37/37 曾通过；本轮完整门禁覆盖并扩展该基线，旧数字不作为当前功能证据。
- 上一轮导航 UI smoke：**PASS (browser)** — 隔离 Demo 中实际点击正文 Markdown 链接，未固定页原位替换、固定页新建预览；顶部后退/前进可跨标签返回，并在分屏后恢复正确活动组。自动化进一步覆盖 mounted hover 卡片、源码、同页锚点、同组切页/新建和跨组迟到读取、dirty forward 所有权及 URI/代码行号区分。
- 上一轮 Mermaid UI 回归：**PASS (browser, production assets)** — 使用应用正文 CSS 和合成中文往返回路对照：旧图 14 个非空 HTML 标签内容超过测量边界、2 对边标签相交；修复后超界、边标签相交和标签压节点均为 0。同源改为 LR、另造含子图和外部入/出边的图也通过相同检查。保持源码、节点与边路径不变；临时 QA 页面/服务已清理，没有改用户原图或文档。
- 本轮网页链接：**PASS (automated)** — Rust 协议/主机/控制字符验证及 macOS/Linux/Windows 启动参数、adapter 转发与错误、正文/真实 mounted hover/源码入口全部覆盖；Shell 验证 HTTP/HTTPS 不改正文/Tab/轨迹，失败本地化且图片仍走专用查看器。未在用户桌面实际唤起外部浏览器，Windows/Linux 也未做原生运行验收。
- 上一轮分屏/图片 UI smoke：**PASS (browser)** — 隔离 Demo 检查活动树文件颜色与展开、树预览标签、菜单固定后打开新标签、标签右键分屏、分别点击左右编辑器后从树打开文件、跨分屏菜单移动保留当前真实正文。自造无行号本地图片链接进入查看器，实际图标加载、Fit/100% 与关闭正常；缺失图片显示中英文词条对应的中文错误和可用关闭按钮，返回后分屏/dirty/正文不变。全部测试数据仅存在隔离 Demo 状态，未读取或改动用户工作文档。
- 分屏追加回归：**PASS (automated)** — 双击异步打开、跨组共享正文/独立视图、CM/PM 结构与 IME 同步、移动保留编辑器、内部拖放 MIME 边界、宽度调整、最后共享引用关闭、放弃后磁盘重读、保存后立即 beforeunload、过期导航不复活 Tab/抢焦点有覆盖；图片路由覆盖来源 Tab、普通/行内链接、无行号、远程后缀和失败回退。新增 4 项窄窗口测试覆盖活动组最小横向定位；960×640 浏览器检查确认右侧活动组不再藏在视口外。
- 确认框追加回归：**PASS (automated)** — `⌘K`/`⌘,` 不会打开后台弹层；Tab 可从意外外部焦点回到确认框；原生设置、新建、退出与红色关闭不会覆盖删除确认，取消后仍可正常销毁窗口。
- 上一轮原生 UI 验收：**PARTIAL** — 使用单独名称/identifier 且 `incognito: true` 的临时 debug 测试包，启动确认未读取旧版工作区记录；临时配置只用于测试包，最终交付包不启用 incognito。已实际验证标签自定义右键和向右分屏、左源码/右可视同文档同步、无行号图片链接加载（含百分号编码路径）、100% 与关闭返回后两组正文/dirty 不变；隐藏目录图片由既有 asset scope 拒绝时可正常关闭错误提示。原生拖动尝试可进入半透明拖动状态，但未观察到移动完成，不计为通过；随后 Mac 锁屏，停止桌面操作，DevTools 与原生关闭未复验。仅停止自建隔离测试进程和开发服务器，未操作用户正常应用或工作文档。旧隔离 smoke 的退出证据与本轮自动化不能替代最终桌面拖动/关闭验收。

当前自动证据对应命令：

```text
PATH="$HOME/.cargo/bin:$PATH" pnpm verify
PATH="$HOME/.cargo/bin:$PATH" pnpm tauri build --debug --config '{"bundle":{"macOS":{"signingIdentity":"-"}}}'
codesign --verify --deep --strict 'src-tauri/target/debug/bundle/macos/NoteSpace.app'
hdiutil verify 'src-tauri/target/debug/bundle/dmg/NoteSpace_0.1.0_aarch64.dmg'
pnpm repo:check
pnpm exec prettier --check AGENTS.md README.md docs/PROJECT_STATE.md docs/DESIGN.md docs/REQUIREMENTS.md docs/decisions/0014-external-filesystem-changes.md
```

上一版本产物（2026-09-03）位于 `src-tauri/target/debug/bundle/macos/NoteSpace.app` 与 `src-tauri/target/debug/bundle/dmg/NoteSpace_0.1.0_aarch64.dmg`。DMG SHA-256 为 `138727161136918d8b009a0c3273dd6e424b5d4f551fd6f4df1cb43497ab74ae`。本轮最终构建增加通配/模板代码引用误报与可视初始化 anchor 复位修复，保留 ADR-0012 导航、系统浏览器打开、Mermaid 中文/边标签布局和 ADR-0011 能力；ad-hoc runtime 签名、DMG checksum 与 ARM64 架构均通过。未做 Apple Developer ID 签名或公证，未自动安装或重启用户旧实例。debug `.app` 已内嵌前端，可直接双击启动，不需要另启 Vite。

## 10. 退役记录

旧 `P0-CI/CONTRACT/FIXTURE/FLAG/HOST-SMOKE/SPIKE-02/TRANSPORT` 与 CodeMirror `livePreview.ts` 实验仅存在于 Git 历史。除非用户提出新需求且新 ADR 接受，否则后续代理不得恢复 HMAC/nonce、quarantine、durable journal、193 MiB IPC、37 命令、14 flags、Ruby 验证器或活动块源码显隐路线。
