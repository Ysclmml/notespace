# NoteSpace（笔记空间）需求基线

状态：Approved baseline 1.3（ADR-0016，产品版本 0.1.1）

日期：2026-09-03

ADR-0016 补充工作区磁盘全文搜索、静态 HTML 导出和失效恢复路径提示；保留既有数据与导航规则。新功能遵循以下验收：

| ID | 状态 | 验收 |
| --- | --- | --- |
| `RESTORE-NOTICE-001` | Done | 失效工作区/文件显示完整路径与重试/选择文件夹/移除记录；只改变便利元数据，不关闭现有标签或创建/删除磁盘内容，迟到结果不覆盖用户操作。 |
| `SEARCH-WORKSPACE-001` | Done | 左侧入口与 Cmd/Ctrl+Shift+F，提交后读取多根磁盘文本；大小写、CJK、隐藏/后缀/重目录/symlink规则、无持久索引。有限文件/字节/深度/200匹配行；截断、跳过、不可读根不伪装为完整无结果。结果在活动分屏按临时标签策略打开并定位，不丢dirty或抢迟到焦点。 |
| `EXPORT-HTML-001` | Done | 从最新内存Markdown生成完整静态HTML，GFM、代码、资源引用与UTF-8正确；危险标记/协议不执行，不读编辑器DOM/网络。原生chooser取消或写失败保持原文件；拒绝覆盖已开文件、非HTML目标与符号链接；原子写入，不清dirty。 |

导出暂不支持 source-only 文档；当前正文在解析前检查 8 MiB UTF-8 上限（含打开后增长的 normal 文档），超限清晰提示且不进入解析。Mermaid 保留源码，不打包图片。普通本地引用转换为 file URI，未命名页相对资源无法解析时显示地址提示。新增 `search_workspaces(workspaces, query, caseSensitive)` 返回有限行结果及覆盖状态，`export_html(suggestedFileName, html, excludedPaths)` 返回 path/bytesWritten 或取消 null；原生菜单新增 `edit.findWorkspace`、`file.exportHtml`，共 15 项前端 action。

本文件保存稳定需求 ID，供实现、测试和上下文压缩后继续执行。优先级：MVP、P1、Later。状态：Active、Deferred、Done。

当前基线：Markdown 默认真可视、显式源码；代码/文本 Tab 可编辑，右侧引用复用普通编辑组而不叠加辅助栏；向右分屏移动原 Tab，可保留空左组继续打开。启动默认恢复路径/标签/分组/数值阅读位置，也可空白启动；正文重新读磁盘，不恢复未命名页、正文快照或导航历史。当前页查找覆盖可视/源码/代码；每根隐藏项偏好默认关闭，根层级标识明确，代码失焦选区与长链接多行编辑保持清晰。树单击预览/双击固定、焦点路由、图片查看器、手动/可选 autosave、dirty 关闭、新建/Save As、多根/最近项、废纸篓、可视表格和双语菜单继续保留。最终自动门禁与桌面验收以当前修订的实际执行结果为准。

ADR-0013 明确取代 ADR-0007/0011 的独立只读辅助栏、分屏复制标签和不恢复浏览元数据限制；ADR-0014 接受外部文件新增/修改/删除的轻量监听、干净正文重载及草稿冲突处理，外部修改不再后置；ADR-0015 接受每工作区截图位置、原生剪贴板兼容和图片单文件访问准备，取代固定相邻 assets 及范围外图片不可见的限制。相关旧需求 ID 保留用于追踪，但验收语义以本基线为准。

## 1. 当前产品需求

| ID                          | 状态 | 需求                                             | 验收摘要                                                                                   |
| --------------------------- | ---- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `DATA-SOURCE-001`           | Done | Markdown/文本文件是唯一持久化正文                | 不保存 ProseMirror JSON；渲染、Outline、预览和最近项不参与正文落盘                         |
| `DATA-ROUNDTRIP-001`        | Done | 未编辑 Markdown 保存零差异                       | 模式切换不 dirty；首次可视编辑后允许等价规范化                                             |
| `WORKSPACE-OPEN-001`        | Done | 用户可选择本地目录作为工作区                     | 原生 chooser；侧栏展示目录与支持的文本文件                                                 |
| `WORKSPACE-MULTI-001`       | Done | 一个窗口可同时打开并显示多个工作区根             | 文件侧栏同时显示各根/树并标明活动根；各根独立折叠；Quick Open 聚合全部根                   |
| `WORKSPACE-RECENT-001`      | Done | 保存打开/最近工作区、最近文件和活动根元数据      | restore 合并新开根并清除失效记录；empty 不自动打开，最近项仍保留                           |
| `SESSION-RESTORE-001`       | Done | 启动可恢复浏览或打开空白窗口                     | 默认 restore；保存路径/组/标签/固定状态/数值视图，fresh disk；无正文或历史                 |
| `WORKSPACE-TREE-001`        | Done | 每个工作区树支持展开目录和打开文件               | 多根同时可见且独立折叠；Unicode/空格路径可用；列出支持的 Markdown/文本                     |
| `WORKSPACE-HIDDEN-001`      | Done | 根右键可独立切换是否显示隐藏文件/目录            | 默认 off、每根持久化、递归用于子树；VCS/依赖/构建缓存及 symlink 仍排除                     |
| `WORKSPACE-ROOT-STYLE-001`  | Done | 工作区根区别于普通子目录                         | 明确根标识/层级间距，保留折叠可访问名称与活动根状态                                        |
| `WORKSPACE-CREATE-FILE-001` | Done | 可在工作区根或现有子目录新建 UTF-8 文本文件      | 无扩展名补 `.md`；常见显式后缀保留；成功刷新树并前台打开；同名文件不覆盖                   |
| `WORKSPACE-CLOSE-001`       | Done | 工作区根可从当前窗口关闭                         | 只移出打开集合；保留最近项、已开 Tab 和磁盘文件                                            |
| `WORKSPACE-TEXT-001`        | Done | 常见 UTF-8 代码/文本文件可在主 Tab 编辑          | CodeMirror 高亮、正常行号、dirty、保存/另存为；不显示 Markdown 可视/源码切换               |
| `DOC-OPEN-001`              | Done | 文件树、内部链接和原生单文件 chooser 可打开文档  | 进入已有 session 或创建新 session；独立文件不要求属于工作区                                |
| `DOC-NEW-001`               | Done | 可新建未命名 Markdown 或纯文本                   | 内存 `untitled://` session；Markdown 默认可视，文本进入 CodeMirror                         |
| `DOC-SAVE-001`              | Done | `⌘S` 保存当前可编辑文档                          | 成功清 dirty；失败保留 dirty、旧文件和可见错误                                             |
| `DOC-SAVE-AS-001`           | Done | 未命名文件首次保存及已有文件另存为               | 写盘前排除其他已开 session 路径；成功后迁移 session 与全部历史引用                         |
| `SAVE-MODE-001`             | Done | 默认手动保存并在关闭 dirty 内容时提示            | 不自动写盘；Tab/window/quit 检查 current/back/forward 引用且允许取消                       |
| `SAVE-AUTOSAVE-001`         | Done | 可选停止输入后自动保存已有路径文档               | 延迟 1–300 秒；继续输入重排；未命名跳过；迟到任务不覆盖；失败仍 dirty                      |
| `DOC-CLOSE-DIRTY-001`       | Done | 关闭 Tab、窗口或应用不得静默丢失 dirty 正文      | 全历史聚合未保存标记；应用内对话框统一覆盖 Tab/原生 close/quit 且可取消                    |
| `EDIT-LIVE-001`             | Done | 普通 Markdown 默认真可视编辑                     | 光标经过标题、列表、链接和表格时不自动展开源码                                             |
| `EDIT-MODE-001`             | Done | 可视与源码是显式的 Tab 级模式                    | 工具栏/`⌘/` 切换；`sourceOnly` 强制源码；文本文件不显示切换                                |
| `EDIT-SEMANTIC-POS-001`     | Done | 可视/源码切换尽量停在同一语义区域                | 标题、附近文本、进度逐级回退；不写正文，不承诺像素或 offset 一致                           |
| `EDIT-SYNC-001`             | Done | 可视正文变更同步更新待保存 Markdown              | 输入后立即 `⌘S` 不漏字；权威正文禁止 200 ms 防抖                                           |
| `EDIT-IME-001`              | Done | 中文 IME composition 稳定                        | composition 中不重建相关装饰，不重复提交                                                   |
| `EDIT-UNDO-001`             | Done | Undo/Redo 只撤销正文编辑                         | 与浏览 back/forward 相互独立                                                               |
| `EDIT-TABLE-001`            | Done | GFM 表格在可视模式直接编辑且宽表格内部滚动       | Tab/Shift-Tab；列宽可拖但 view-only，不写 Markdown；源码模式才显示管道语法                 |
| `EDIT-TABLE-TOOLS-001`      | Done | 可视网格、工具栏和右键支持表格结构操作           | 选择尺寸插表；增删行列/删除表格可 Undo；中英文菜单完整                                     |
| `EDIT-CODEBLOCK-001`        | Done | fenced code 使用浅色稳定代码块                   | 语言选择在左、Copy 在右且始终可见；弹层不被裁切                                            |
| `EDIT-CODE-LINES-001`       | Done | 代码块和代码/文本表面默认显示正常行号            | 顺序 gutter 可读；active line 不出现深色块；可关闭                                         |
| `EDIT-CODE-WRAP-001`        | Done | 代码长行换行可配置                               | 同一设置影响可视 code block、代码/文本主 Tab 和只读预览                                    |
| `EDIT-CODE-SELECTION-001`   | Done | 代码选区保持清晰可读且失焦不残留活动选区         | token 可辨认；转入代码块外正文输入后清理旧活动选区，不修改正文/Undo                        |
| `EDIT-LINK-FIELD-001`       | Done | 长链接地址可完整查看与编辑                       | 多行换行控件，不因固定单行宽度裁切，保留原链接打开/复制/编辑语义                           |
| `SEARCH-PAGE-001`           | Done | 当前活动页面支持文本查找                         | Cmd/Ctrl+F；可视/源码/代码，计数/前后/循环/Esc，不修改正文/dirty/Undo                      |
| `DOC-STATISTICS-001`        | Done | 底部当前文档字数、字符及行数随正文更新           | 中文逐字/英文数字连续计词，统一源码口径；120 ms 防抖/分片/有界弱缓存，不额外读盘、不 dirty |
| `STATUS-LOCAL-001`          | Done | 明确本地文件标识，不误称网络离线                 | “本地文件”说明读写方式；网络连接与保存状态不由该静态标识推断                               |
| `EDIT-FENCE-HINT-001`       | Done | 可视模式提供 Typora 式 fence 语言补全            | 三个反引号加 prefix 触发最多 8 个本地候选；上下键、Enter/Tab、Esc 和点击可用               |
| `EDIT-LIST-ALIGN-001`       | Done | 有序/无序列表 marker 与首行文字对齐              | 换行沿正文缩进；marker 不漂移或挤压文字                                                    |
| `NAV-TAB-001`               | Done | 支持多个浏览器式主 Tab                           | 激活、关闭、dirty 标记、同文件 session 复用                                                |
| `NAV-GROUP-001`             | Done | 标签右键向右移动原页、各组独立标签与活动状态     | 默认左侧单组；复用右邻组、不复制 Tab，可留空左组；保留历史/正文/编辑器                     |
| `NAV-PREVIEW-TAB-001`       | Done | 文件树单击临时预览、双击固定                     | 预览文件名斜体；每组最多一个；编辑自动固定；不覆盖已固定/dirty 内容                        |
| `NAV-GROUP-FOCUS-001`       | Done | 新打开文件进入当前聚焦编辑组                     | 捕获读取起点；关闭/移组/新导航后的迟到结果不覆盖、不复活、不夺焦点                         |
| `WORKSPACE-FOLLOW-001`      | Done | 当前编辑文件在所属树中展开并突出显示             | 最长匹配根；仅滚动侧栏；相同路径编辑不反复打断手动折叠；hover/selection 清楚               |
| `NAV-HISTORY-001`           | Done | 窗口级前进/后退可跨 Tab 与编辑组                 | 恢复文档/位置；不重复记录 focus，关闭/删除过滤，最多 200 项，不复制正文                    |
| `NAV-LINK-001`              | Done | Markdown 普通点击按源标签固定状态跳转            | 预览原位，固定/编辑后新预览，同页 anchor 原位；`⌘`/中键后台，`⌘⇧` 前台                     |
| `NAV-LINK-PATH-001`         | Done | 独立文件/未收录树的显式 Markdown 路径可跳转      | 相对/绝对/file URL、编码、跨根；失败保持当前页，非 MD 专用预览                             |
| `NAV-ANCHOR-001`            | Done | 支持 heading anchor                              | 重复标题 slug 行为固定并有测试                                                             |
| `NAV-LOCAL-REF-001`         | Done | 内联代码/链接的本地 `path.ext:line` 可预览并打开 | 有界只读浮层，以及当前/右邻普通编辑组；完整文件可编辑/保存                                 |
| `NAV-ROUTING-PRIORITY-001`  | Done | Markdown 文档路由优先于本地引用预览              | `.md/.markdown` 不被 preview parser 截获，完整保留 Tab disposition                         |
| `NAV-AUX-PANE-001`          | Done | 右侧引用统一为普通编辑组，不再创建辅助栏         | 已有右组复用；临时页替换、固定/dirty 保留；最右来源不被覆盖、不增加第三辅助栏              |
| `OUTLINE-001`               | Done | 当前 Markdown 可显示标题大纲                     | 点击滚动并聚焦标题；文本文件不显示 Markdown Outline                                        |
| `ASSET-PASTE-001`           | Done | 粘贴截图自动落盘并插入链接                       | 写入成功后才修改正文；未命名文档先 Save As；失败正文不变                                   |
| `ASSET-ALT-001`             | Done | 图片 Markdown 语义往返不丢失                     | 可视编辑后保留原始 `src`、`alt` 和 `title`                                                 |
| `ASSET-BASE64-001`          | Done | 产品不主动生成内嵌 Base64 图片                   | 保存结果使用相对文件 URI，跨卷时使用文件 URI                                               |
| `WORKSPACE-IMAGE-DIR-001`   | Done | 每个工作区独立设置截图目录                       | 根右键双语入口；默认文档同目录或指定现存目录，最长根归属、取消不变、不移动已有图片         |
| `DIAGRAM-MERMAID-001`       | Done | Mermaid 可文内预览                               | production CSP 下清晰可读；失败不切换整个文档                                              |
| `DIAGRAM-VIEWER-001`        | Done | Mermaid/大图可放大、平移、Fit                    | Esc 返回原块；SVG 保持矢量                                                                 |
| `IMAGE-LINK-001`            | Done | 图片链接无需行号即可打开专门查看器               | 本地/file/HTTP(S) 图片地址，缩放/平移/Fit/100%；失败可关闭，不改变Tab或dirty               |
| `IMAGE-CONTEXT-001`         | Done | 图片使用专属右键，支持预览/复制/本地定位         | 不显示通用段落菜单或整图蓝色选择；查看器只读；Mermaid 只提供图表动作                       |
| `IMAGE-REFERENCE-EDIT-001`  | Done | 可视修改图片地址、替代文字及标题                 | 多行模态框、单次可撤销事务；取消/相同值不 dirty，不移动或修改原图片                        |
| `IMAGE-MISSING-001`         | Done | 失效图片在可视正文保留可操作占位                 | 无 alt 也显示失败和完整路径；可编辑或撤销式删除引用，占位本身不改正文，原文件不变          |
| `ABOUT-REPOSITORY-001`      | Done | 关于软件显示产品 GitHub 仓库                     | 应用内/原生入口一致，点击完整仓库地址交给系统浏览器；失败双语提示，不后台访问或改正文      |
| `FILE-PREFLIGHT-001`        | Done | Rust 在正文进入 WebView 前轻量预检               | 固定缓冲统计 size/UTF-8/最长行/data-image                                                  |
| `FILE-LARGE-001`            | Done | 约 10 MiB 普通多行 Markdown 可编辑               | `sourceOnly`，不运行昂贵投影                                                               |
| `SAFE-DATAURI-001`          | Done | 大型 data-image/病态长行不得卡死编辑器           | 文件正文不返回 JS；大粘贴不创建 transaction                                                |
| `FILE-SAVE-001`             | Done | 保存采用同目录临时文件原子替换                   | 故障时旧文件完整；成功时新文件完整                                                         |
| `FILE-EXTERNAL-001`         | Done | 检测外部磁盘变化并安全更新已打开文档             | 元数据未变不读正文；干净 session 重载，共享视图/历史保持，dirty 不自动覆盖                 |
| `WORKSPACE-EXTERNAL-001`    | Done | 外部新增/修改/删除后刷新对应文件树               | 工作区/独立文件监听、聚焦与 30 秒兜底；隐藏/类型过滤不变，旧刷新不覆盖新结果               |
| `DOC-EXTERNAL-CONFLICT-001` | Done | 草稿及缺失/不可读/blocked 文件保留内存缓冲区     | 双语提示条暂停普通手动/自动保存；重载丢草稿或覆盖先确认；missing 仅 Save As                |
| `SAVE-REVISION-001`         | Done | 保存检查读取基线，拒绝未确认的外部版本变化       | 写前/rename 前核对 expectedRevision；轻量 best-effort，不是锁或原子 CAS                    |
| `FILE-REVEAL-001`           | Done | 根、目录、文件和当前已保存文档可在文件管理器定位 | macOS 文件 reveal/目录 open；Windows/Linux 合理映射；不经过 shell                          |
| `FILE-COPY-PATH-001`        | Done | 根、目录和文件可复制绝对路径                     | 一次右键复制精确路径；不修改文件、Tab 或工作区状态                                         |
| `FILE-TRASH-001`            | Done | 工作区内文件/目录可经确认移到系统废纸篓          | 根/根外/不存在拒绝；取消或失败保持；成功刷新树并清理对应 session/history                   |
| `OPS-OFFLINE-001`           | Done | 本地功能离线可用、无账户、无遥测                 | 没有文档上传；图片链接不做悬浮网络探测，点击查看时才加载该目标                             |
| `OPS-BUILD-001`             | Done | macOS 可运行 Tauri 桌面应用                      | 自动门禁、debug `.app`/DMG、ad-hoc 签名验证和隔离核心 UI smoke 通过                        |
| `OPS-CONTEXT-001`           | Done | 新代理不依赖聊天恢复项目                         | 先读 AGENTS、DESIGN、REQUIREMENTS、适用 ADR；本地交接可选                                  |
| `I18N-UI-001`               | Done | 界面默认 `zh-CN`，可即时切换 `en-US`             | Shell、设置、代码控件、viewer、自定义菜单和原生菜单同步切换                                |
| `MENU-CONTEXT-001`          | Done | 编辑/表格/工作区/标签使用本地化自定义右键菜单    | 按目标裁剪并保留选择；默认禁用浏览器菜单，仅顶部工具栏例外                                 |
| `MENU-DEVTOOLS-001`         | Done | debug 顶部原生视图菜单可打开开发者工具           | 中英文；release 隐藏；不新增 invoke，确认期间页面默认菜单仍禁止                            |
| `MENU-APP-001`              | Done | 顶部“更多”和工作区文件动作本地化                 | 新建/reveal、折叠、复制路径、关闭工作区、移到废纸篓等当前动作可见                          |
| `MENU-NATIVE-001`           | Done | macOS 原生菜单中英文可切换                       | 15 个前端 action 含 file.reveal/edit.find；编辑项预定义；close/quit 经 dirty               |
| `SETTINGS-PERSIST-001`      | Done | 界面、编辑、保存与启动偏好持久化                 | 九项含 manual/afterDelay、1–300 秒延迟和 restore/empty；损坏值归一化                       |

### 1.1 编辑与保存的精确语义

- `normal/sourceOnly` 是 Rust 预检返回的 Markdown 能力；`visual/source` 是当前 Tab 的编辑表面。受支持非 Markdown 文本始终使用 CodeMirror，但不是只读资源。
- 同一 `DocumentSession` 的正文和 dirty 由多个 Tab 共享；每个 Tab 独立保存浏览历史和每个编辑表面的选择/滚动。
- 编辑区使用扁平横向组，默认仅左侧一个活动组。文件树单击替换该组干净临时标签；双击、编辑、拖动、分屏或“保持打开”固定。“向右分屏”移动同一 Tab 到右邻组，不存在时创建，不复制 Tab/session/history；移动唯一标签时可保留可激活的空左组继续打开。其他无保留标记空组收起，最后空组显示欢迎页。跨组移动保留 Tab/history/EditorView，工具栏/保存/大纲跟随聚焦组。
- 共享文档的被动同步使用最小差异，不进接收表面 Undo、不回传新编辑、不抢焦点/滚动；IME 期间推迟外部更新，不相交修改合并，重叠范围以当前草稿优先。最后引用确认放弃后不得留下可复活的孤立 dirty session。
- 可视/源码无编辑往返优先恢复该表面原有的滚动位置和完整选区；正文变化后不复用旧快照。首次进入另一表面使用 `progress + nearest heading + nearby text/textOffset` 尽力映射，处理普通行内格式和连续空白；先找靠近期望进度的正文片段，再找标题，最后按进度回退。快速滚动后立即切换也须保留最后位置；它不是持久化语义锚点，不保证两个编辑模型的 offset 一致。
- 新可视 view 的首次位置恢复必须先于待执行的 anchor/reveal；在这段异步初始化窗口收到的导航只消费最新请求，不能先跳转后又复位至旧滚动位置。等待初始位置恢复不阻断正文同步。
- 打开、导航、选择、滚动和模式切换不是正文编辑。Markdown 在第一次正文 transaction 前保存必须零差异；首次可视编辑后 serializer 可以规范化等价 Markdown，但不得破坏图片、链接、代码、表格或 Mermaid 语义。
- 新建 `.md/.txt` 使用内存 session。首次保存或 Save As 成功后，必须迁移 session ID/path，以及所有 Tab `current/back/forward` 中的旧引用；保存期间若又有编辑，仍保持 dirty。
- Save As 只把除当前 session 外、仍被某个 Tab `current/back/forward` 引用的已保存路径作为 `excludedPaths` 传给 Rust；Rust 必须在写盘前拒绝相同规范化目标。已关闭且无历史引用的 session 不得阻止 Save As。保存失败在文档仍 dirty 时持续可见，不能被通用状态文字覆盖。
- 每个 Tab 的未保存标记与关闭判断都检查 current/back/forward 引用的 dirty session；关闭窗口或应用时聚合全部 Tab。Tab 关闭、原生红色关闭、菜单关闭与退出统一使用应用内非阻塞对话框；取消必须阻止关闭且不改变正文、Tab、窗口或进程，确认后只执行一次对应关闭。
- 代码/配置/纯文本主 Tab 允许编辑、Undo/Redo、dirty、`⌘S` 和 Save As；它们不进入 Milkdown，也不显示 Markdown Outline、Mermaid 或可视/源码开关。
- 保存默认 `manual`。启用 `afterDelay` 后，每个已有路径且仍被 Tab/history 引用的 dirty session 在停止输入 1–300 秒后复用普通原子保存；新输入或延迟设置变化重排计时，触发时核对正文快照。同一 document 的手动/自动写入必须串行，旧写入不得在新写入后落盘；未命名文档不自动 Save As，失败保留 dirty/错误和关闭提示。
- 外部变化提示存在时暂停普通手动/自动保存；确认覆盖必须以已观察到的外部版本为前提。写入排队开始和完成状态更新都绑定原 Tab 所有者（current/back/forward），最后原引用关闭后，不得将结果提交到后来重开的同名 session。正常编辑/移组/切页仍可保留原所有权。

### 1.2 代码块、fence 补全、列表与表格

- 可视 fenced code 内部可使用 CodeMirror，但外观必须与 Paper & Ink 的浅色纸面一致，不得回退到深色默认主题。
- 代码块、代码/文本编辑 Tab 和浮层的 selection 背景与前景必须保持足够对比，选中后 token 仍可辨认，不能出现黑块或文字消失；转入代码块外正文输入后不显示其旧活动选区，不修改代码正文或 Undo。
- 链接编辑地址使用可换行多行控件，长 URL 可完整查看和修改，不被窄弹层或固定单行字段裁切；打开/复制链接语义不变。
- 语言选择器位于左侧、Copy 位于右侧且常显。语言弹层可搜索、滚动且不被 code block overflow 裁切；空语言本地化为“纯文本 / Plain Text”。
- 输入段落必须完整匹配 `/^```([a-z]{0,32})$/` 才出现补全；候选来自本地表，按语言 ID/alias 前缀匹配，最多 8 个。上下键改变选择，Enter/Tab 或点击把该段转为带语言的 code block，Esc 关闭当前补全。
- 补全浮层的出现、移动和关闭不写入 Markdown、不进入浏览历史、不额外触发 `onChange`；接受候选是正常、可 Undo 的正文 transaction。关闭 typing hints 后不出现。
- 有序数字、无序圆点与首行共用基线；多行文字沿内容列换行，不在 marker 下方重新起行。
- 宽表格只在自身容器横向滚动；单元格保持可读最小宽度。列边界拖动产生的 `colwidth` 只属于当前 view，serializer 忽略，不写 Markdown、不标 dirty、不进入正文 Undo。
- 非表格位置只显示“插入表格”动作，尺寸网格仅在明确点击后出现并在选择/取消后关闭；代码与普通文本 Tab 不得显示该入口。
- 已有表格的就地工具栏可直接调整目标行数/列数、添加/删除当前行列，并设置当前列左/中/右对齐；右键可在前/后插入行列、删除当前行列或整表。结构与 alignment 变化是正常正文 transaction，可 Undo、保存和重开。
- 可视右键除基础剪贴板动作外，提供正文/标题、引用、列表、常用行内格式、代码块、水平分割线与表格入口；不要求用户切源码完成普通结构编辑。

### 1.3 多工作区、最近项和本地引用

- 一个窗口维护 `workspaces[]` 与活动根。文件侧栏按顺序同时显示全部已打开根及其树，每个根可独立折叠，活动根高亮；根用明确工作区标识和层级间距区别于子目录，折叠按钮保持可访问。Quick Open 聚合全部根，多根时显示来源。折叠只改变侧栏 view，不改变活动根、Tab、session 或磁盘；点击某根文件会先激活所属根，嵌套工作区仍使用最长匹配根。
- `markdown-workspace.workspaces.v1` 保存 `openWorkspaces`、`recentWorkspaces`、`recentFiles`、`activeWorkspacePath` 和每根 `showHidden` 偏好；最近工作区/文件各最多 12 个。存储损坏或不可用不阻塞编辑；restore 模式只处理初始候选，合并期间用户新开的根并清除失效 open/active，empty 模式不自动枚举旧根但保留最近项。
- 根右键提供双语勾选的“显示隐藏文件”，默认 `false`，按根独立持久化；刷新使用 `listWorkspace(rootPath, showHidden?)`，递归应用到该根子树。开启后仍排除版本控制元数据、依赖/构建缓存、虚拟环境和符号链接；该偏好不修改磁盘、正文或权限。
- 根右键可复制精确绝对路径或关闭工作区。关闭只移出本窗口的打开集合，不删除磁盘文件、不清除最近项、不关闭已经打开的 Tab。单文件 chooser 打开的独立文件记入最近文件，但不虚构工作区。
- 不保留常驻根工具栏。根/目录及局部空白右键在该目录新建，文件右键在同级目录新建，侧栏剩余空白使用活动根；菜单复用打开/新 Tab、查找文件、折叠/展开和已有路径/关闭/废纸篓动作。文件无扩展名补 `.md`，Rust 验证父目录在根内、单个名称与支持后缀，并以 `create_new` 拒绝覆盖；成功刷新所属根并以前台主 Tab 打开。
- 新建文件夹只创建根内已有父目录下的单层空目录，不补后缀、不递归、不覆盖；同名文件/目录、空名、`.`/`..`、路径式名称、根外父目录均拒绝。成功只刷新所属树，不创建文档 session。
- 工作区根、目录、文件和当前已保存文档可调用平台文件管理器。macOS 文件使用 reveal、目录直接打开；该动作只定位，不修改磁盘。文件与目录右键可复制精确绝对路径。
- 文件/目录“移到废纸篓”先显示可取消的应用内确认；若范围含 current/back/forward 引用的 dirty session，文案明确未保存正文也会丢弃。Rust 只接受规范化工作区根的严格后代且目标必须仍存在并为文件或目录；根本身、根外和不存在目标拒绝。取消或系统废纸篓失败时保留目标、dirty、session/history 和树；成功后刷新所属树并移除已删除路径的 session/history，只有无剩余历史的 Tab 才关闭。
- 当前仍不提供递归目录创建、重命名、移动、复制文件内容、永久删除或批量文件操作；废纸篓动作不得演化为通用 VFS/文件管理器。
- 图片链接先进入专门查看器；其他链接先处理外部 URL，再解析 Markdown/anchor，只有未解析为 Markdown 的受支持文本引用才进入代码 preview；文件行号可以省略。
- 代码/文本引用不得仅凭后缀把 `handlers/**/urls.py`、`run_<app>.py` 等通配符或占位模板当成具体文件；内联代码悬浮/点击不排程预览、不调用文件读取、不替换编辑组页面，也不改变正文/dirty/历史。真实路径（含中文/空格、Windows/file URL、`[slug]` 等字面目录）仍支持预览，真实读取错误仍可见；不增加 glob 搜索或模板展开。
- HTTP/HTTPS 网页链接在用户点击正文、链接悬浮卡片或源码链接后交给系统默认浏览器；不在编辑器内加载网页，不修改正文、Tab 或导航轨迹。原生层校验协议和主机，启动失败显示本地化错误；已有图片后缀链接仍优先进入图片查看器，不后台探测网络。
- `preview_local_file` 有目标行时返回目标前后各 20 行（含目标最多 41 行），无目标时返回前 80 行；每行最多 600 个 Unicode 字符，并返回真实 `startLine/targetLine`。
- 浮层只读且有界；“在右侧打开”复用普通右邻编辑组，仅一个组时创建右组，不再增加独立辅助栏。已有右组时新代码引用直接进入该组，干净临时页可替换，固定/dirty 页保留；来源已在最右组时复用本组并保留来源 Markdown，不附加第三辅助栏。快速连续点击 latest-wins，完整文本进入普通可编辑 Tab，双击/编辑固定，可保存、拖动及按 dirty 规则关闭。分隔线由统一编辑组布局管理，不建立任意 pane 树。
- 受支持代码/配置/文本在各编辑组与只读浮层均使用 CodeMirror：已注册语言显示清晰可见且正确的本地语法高亮、真实行号、可读 selection 对比度和独立滚动；替换文件路径后必须为新 view 装载对应语言支持，新旧文件同语言时也不得退化为纯文本。未知语言按纯文本显示，任何非 Markdown 正文都不得进入可视 Markdown renderer。
- 单个独立文件或最后一个 Tab 必须保留可用的关闭按钮；dirty 文档仍经过既有可取消确认，成功关闭后显示 Welcome。
- 图片链接支持常见扩展名、本地相对/绝对路径与 `file://`，以及 HTTP(S) 查询串/fragment；不预抓取，不转换成文本 Tab。点击才创建查看器图片，使用 no-referrer；关闭回原分屏，失败提示可关闭。静态 `$HOME/**` 本地资源 scope 不变；实际显示本地图前仅为规范化的支持图片文件补充访问，覆盖 HOME 外及 Unix 隐藏目录的图片，不扩大整个目录权限。

### 1.4 国际化、菜单与设置

- 默认 locale 为 `zh-CN`，可切换 `en-US`。切换立即更新 Shell、设置、代码控件、viewer、应用内菜单、自定义右键菜单，并调用 `set_native_menu_locale(locale)` 重建原生菜单。
- 原生菜单只发送当前 15 个小型 action ID：`file.new`、`file.open`、`workspace.open`、`file.save`、`file.saveAs`、`file.reveal`、`file.exportHtml`、`edit.find`、`edit.findWorkspace`、`app.settings`、`app.quit`、`view.toggleSource`、`view.toggleSidebar`、`window.close`、`help.open`。编辑菜单的 Undo/Redo/Cut/Copy/Paste/Select All 使用 Tauri 预定义命令；Rust 不复制前端文档状态。
- `window.close` 和 `app.quit` 是自定义项：前端调用当前 Tauri 窗口的 close，`onCloseRequested` 再检查所有被 Tab current/history 引用的 dirty session并显示应用内非阻塞对话框；用户取消时阻止销毁并保持窗口和应用进程，确认或无 dirty 时只销毁一次窗口。macOS 主窗口销毁后应用进程必须实际退出，不能留下只能强制结束的后台进程。
- 自定义右键菜单在 capture phase 捕获编辑器/链接/只读代码/工作区树上的右键或 Control-click，避免破坏现有选择或先触发普通打开。菜单采用紧凑、分组清晰的 macOS/Typora 风格，并有明确 hover、禁用、快捷键和子菜单状态。可写表面包含编辑、普通 Markdown 结构和表格动作；链接增加打开、在新 Tab 打开、复制链接；只读代码只显示复制/全选；标签提供保持打开/向右分屏/移组/关闭。根/文件菜单沿用既有能力。默认阻止平台右键但不停止自定义事件，仅显式顶部工具栏例外；菜单/对话框和确认期间不例外。点击外部、滚动、缩放或 Esc 关闭自定义菜单。
- debug 原生视图菜单以本地 Rust 调用打开开发者工具，release 不显示该项；不新增前端应用 action 或 invoke。Tauri 主窗口关闭原生文件拖放捕获，把应用内部 HTML5 标签拖动交给 WebView；不新增外部文件拖放功能。
- 设置键 `markdown-workspace.settings.v1` 包含 locale、编辑器字号、正文宽度、代码行号、代码换行、输入提示、`autoSaveMode`、`autoSaveDelaySeconds` 和 `startupBehavior` 九项。默认 `zh-CN`、16 px、920 px、开、开、开、`manual`、5 秒、`restore`；字号 12–28 px，正文宽度 640–1600 px，延迟 1–300 秒，启动模式只接受 `restore/empty`。
- 设置和工作区历史都是本机便利状态：不改写文档、不标 dirty、不进入浏览 history/Undo；损坏、越界或 storage 不可用时回退到可用状态。

### 1.5 启动浏览恢复与当前页查找

- 默认 `restore`，旧设置缺少该项时采用默认；`empty` 下次启动不读取旧标签正文或枚举旧工作区，最近项仍可手动打开。
- `markdown-workspace.session.v1` 只保存已保存文件路径、工作区/分组/标签顺序、活动根/组/页、固定或预览状态、编辑模式和数值滚动/选择偏移；可保留显式空组。不保存未命名页、正文/dirty 草稿、选择文本、语义摘录、anchor 文本、Undo、Tab back/forward 或窗口访问轨迹，也不保存分隔线宽度/原生窗口位置。
- 元数据有白名单、最多 8 组/100 个标签/32 个工作区及路径/存储长度上限；损坏、未知版本或 storage 不可用安全回退。恢复按每个路径一次重新走磁盘预检；同文档共享 fresh session，各 Tab 保留独立视图，当前 sourceOnly/text 分类优先，失效或 blocked 文件跳过。
- 恢复期间用户新建/打开/导航使迟到标签结果失效；工作区恢复仍合并新开的根。恢复结束后才开始元数据去抖保存，关闭/pagehide 尽力刷新；确认关闭或卸载后不提交旧结果。取消 dirty 关闭不丢当前状态，恢复便利元数据不能替代保存或关闭确认。
- `⌘F` / `Ctrl+F` 或编辑菜单查找当前活动页，可视正文、Markdown 源码和普通代码均支持普通文本匹配、计数、前后定位/循环、Enter/Shift-Enter 与 Esc 退出。它是本地视图投影，不改正文、dirty 或 Undo，不进行跨工作区全文搜索；可视与源码基于各自文本，不要求匹配数量一致。

### 1.6 外部文件变化与冲突处理

- Rust 使用固定 `notify 8.2.0`，递归监听已打开工作区根；独立文件若未被根覆盖，监听其父目录且不递归。文档路径来自 Tab current/back/forward 的真实引用，不包含未命名页或仅剩 closed clean 缓存。
- 原生事件按 150 ms 合并，只发送路径；前端去重后 250 ms 刷新，连续通知最多等待 1 秒提交一批。监听配置完成后检查一次，重新聚焦/可见时检查，每 30 秒兜底检查并重配监听；失败保持可重试，旧订阅/卸载不能清除新配置或提交迟到结果。
- 事件刷新受影响根；聚焦/兜底可刷新全部根。外部新增/删除遵循原有支持后缀、隐藏项和 symlink 过滤；重目录与应用保存临时文件在枚举/事件层排除，但 OS 递归 watcher 可能仍覆盖过滤目录，不保证零底层监听开销。显式打开文件仍可被观察。
- 目录刷新成功和失败都检查请求版本；旧结果不能清空或覆盖新隐藏偏好、刷新或重开根。外部重命名按旧路径删除、新路径新增处理，不迁移 session 或修改 Markdown 链接。
- `inspect_documents` 只检查元数据/可读性。已有磁盘版本未变时不读正文；确实变化且干净时才走原有固定缓冲预检，成功后更新共享 session，不新建 Tab/组/访问、不夺焦点，保留各 Tab 独立位置。新 sourceOnly/text 分类可将相关引用视图规范为源码。
- dirty 外部修改、missing、unreadable、blocked 均保留正文和原 dirty 状态，并显示双语提示条；不因外部删除强制关闭页或将干净缓冲区伪标为编辑。相同 blocked/unreadable 版本不反复预检。
- 重载丢弃 dirty 草稿前必须明确确认；覆盖磁盘始终确认，并且仅针对有可用 revision 的 modified 状态。确认后仍核对原引用、预期正文与基线；期间新编辑/保存/关闭/迁移使旧结果失效。missing 只提供 Save As，不隐式重建文件；不可读/blocked 可重试或 Save As。
- 文件恢复原基线时可清提示但不清本地草稿。成功安全保存更新 diskRevision 并清外部提示，期间的新编辑仍 dirty。版本/外部状态只存内存，浏览恢复仍只记录路径/视图，不保存正文或冲突快照。
- 已关闭、无引用的 clean session 重新打开必须采用新磁盘读取；源码锚点同样按新正文计算。被其他 Tab/current/back/forward 引用的共享或 dirty 正文，不因普通打开被磁盘结果静默替换。
- 不新增网络、云同步、三方合并、文件锁服务、重命名身份跟踪、正文快照或崩溃恢复引擎。原生检测与跨平台参数单测不能替代实际桌面通知验收，验收须保留对应修订的真实执行证据。

## 2. 三项实用护栏

### `SAFE-DATAURI-001`

- 前端只在粘贴文本大于 1 MiB 且含 `data:image/...;base64,` 时拒绝。
- 拒绝发生在 CodeMirror 或 ProseMirror transaction 前；正文、选择和 Undo 栈不变。
- Rust 使用 64 KiB 级固定缓冲扫描文件，不把 blocked 正文放进返回对象。
- 不要求 Base64 解码、自动提取、修复 token、隔离、备份或恶意混淆检测。

### `ASSET-PASTE-001`

- 可视/源码与右键入口识别 PNG/TIFF 等图片，支持 WebKit `items/files/types` 和原生 fallback；普通文字与 HTML 不被吞掉，巨大内嵌 Base64 在事务前阻断。
- PNG 等图片同时附带单图 HTML/空白占位符时不误判为正文；空 item MIME 不否决明确图片信号。真正的混合正文、富文本、多图和非图片文件仍走正常粘贴，不能只为兼容截图吞掉文字。
- Rust 直接读取系统剪贴板像素并在后台编码 PNG，限制 3200 万像素；IPC 不传图片 bytes、MIME 或 Base64。
- 已保存文档默认写入 Markdown 父目录，每工作区可指定现存绝对目录；不存在/不可写时报错，不回退到别的位置。未保存文档先检查有图，再 Save As，取消不写图。
- 文件名避免覆盖已有资源；成功后前端才以正常事务插入相对 URI，跨卷使用文件 URI。Save As 重挂载后仍可 Undo；来源切换/正文变化/关闭后的迟到结果不污染新页。Undo 只移除 Markdown 链接，图片保留。

### `FILE-SAVE-001`

- 临时文件与目标位于同一目录；完整写入、flush/sync 后 rename。
- 已打开原生文档保存带 expectedRevision：高分辨率 mtime、大小和平台文件身份组成轻量基线，Rust 写前及 rename 前核对；不匹配/缺失返回外部变化错误，不覆盖目标。
- 写入或 rename 失败不破坏旧目标，只清理当前调用创建的精确临时文件。
- 原生成功保存返回所写文件句柄的 diskRevision，editable open 返回与读取正文一致的 revision；TypeScript 可选字段只为 Demo/旧 adapter 兼容。检查与 rename 非同一个原子操作，不承诺文件锁或原子 compare-and-swap。
- 第一版不要求持久化 save journal、prepare/ack 协议或崩溃恢复中心。

## 3. 状态不变量

| ID                         | 不变量                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `NAV-MODEL-001`            | `DocumentSession != Tab != HistoryEntry`                                                            |
| `NAV-SESSION-001`          | 同一路径一个 session；多个主 Tab 共享正文/dirty                                                     |
| `NAV-VIEW-001`             | 每 Tab 的模式、各表面滚动/选择、back/forward 独立                                                   |
| `NAV-WINDOW-TRAIL-001`     | 顶部遍历窗口访问轨迹，后台/被动更新不新增，遍历不追加，新导航截断 forward；不复活关闭/删除内容      |
| `NAV-GROUP-ONE-001`        | 每 Tab 恰属一组，默认一左组；focused group 与全局activeTab一致                                      |
| `NAV-PREVIEW-ONE-001`      | 每组最多一个临时Tab；编辑固定，固定与dirty不被单击替换                                              |
| `NAV-DISPOSITION-001`      | 点击修饰键只决定 current/background/foreground，不改变资源解析                                      |
| `NAV-NO-COPY-001`          | 内存 history 不复制正文；持久浏览元数据不保存正文、选择文本或任何导航历史                           |
| `NAV-REVEAL-001`           | anchor reveal 按 Tab 排队且只消费一次                                                               |
| `NAV-ROUTE-FIRST-001`      | Markdown 路由在 local-ref 预览之前                                                                  |
| `NAV-AUX-ONE-001`          | 右侧引用复用普通编辑组，不另加辅助栏；干净临时替换，fixed/dirty 与最右来源保留                      |
| `NAV-MOVE-IDENTITY-001`    | 向右分屏移动原 Tab，不复制 ID/current/view/history/session；可留空左组并继续打开                    |
| `SESSION-RESTORE-SAFE-001` | restore 从磁盘重读；empty 不自动读取；迟到恢复不覆盖用户新操作或复活关闭页面                        |
| `SAVE-AS-MIGRATE-001`      | Save As 后 session 与所有历史引用使用新路径                                                         |
| `SAVE-AS-EXCLUDE-001`      | Save As 在写盘前拒绝其他已打开 session 的规范化目标                                                 |
| `CLOSE-DIRTY-001`          | Tab 未保存标记及 Tab/window/quit 判断包含 current/back/forward；关闭使用应用内对话框                |
| `WORKSPACE-LONGEST-001`    | 嵌套工作区以最长匹配根作为文件归属                                                                  |
| `WORKSPACE-RESTORE-001`    | restore 合并用户新开根并清理失效候选；empty 保留最近项但不自动枚举旧根                              |
| `WORKSPACE-VISIBLE-001`    | 文件侧栏同时显示全部打开根；活动状态不隐藏其他树                                                    |
| `WORKSPACE-COLLAPSE-001`   | 各根折叠状态独立且只影响侧栏 view，不改变活动根/Tab/session/磁盘                                    |
| `WORKSPACE-HIDDEN-001`     | 每根隐藏开关默认 off、独立持久化且递归生效；VCS/依赖/构建缓存及 symlink 始终排除                    |
| `WORKSPACE-CREATE-001`     | 新建只在规范化根内现有父目录发生，并以 create-new 绝不覆盖                                          |
| `WORKSPACE-CLOSE-001`      | 关闭根只移出打开集合；最近项、已开 Tab 与磁盘保留                                                   |
| `FILE-TRASH-BOUNDARY-001`  | 废纸篓仅允许规范化根的严格后代；根、根外、不存在目标拒绝                                            |
| `FILE-TRASH-FAIL-001`      | 取消或失败不改目标/dirty/session/history/tree；成功后才收敛状态                                     |
| `SAVE-MANUAL-001`          | manual 是默认；仍 dirty 的 current/history session 关闭必提示                                       |
| `SAVE-DELAY-001`           | 自动保存核对排程正文；同文档写入串行，旧文本不得最后落盘                                            |
| `EXTERNAL-BUFFER-001`      | 外部 dirty 冲突/missing/unreadable/blocked 保留正文与原 dirty，暂停普通写入；丢草稿和覆盖需明确确认 |
| `EXTERNAL-RELOAD-001`      | 重载核对路径、引用、预期正文/版本，不新建访问，不覆盖新编辑或复活关闭会话                           |
| `SAVE-OWNER-001`           | 保存开始/完成仅作用于仍有原 Tab 所有者的会话，不误标后来同名重开文档 dirty                          |
| `EXTERNAL-CACHE-001`       | 无引用 clean 缓存重开读新磁盘；仍有 current/back/forward 引用的共享正文不被普通打开替换             |
| `TABLE-WIDTH-VIEW-001`     | 列宽只属于 visual view，不写 Markdown、不标 dirty、不进正文 Undo                                    |
| `FIND-VIEW-ONLY-001`       | 当前页查找不改正文/dirty/Undo，不持久化查询或匹配文本                                               |

## 4. 当前 Tauri 接口

当前共 21 个命令（新增命令参数与约束见 ADR-0016）：

```text
pick_workspace()
pick_document()
pick_image_directory(locale?)
list_workspace(rootPath, showHidden?)
search_workspaces(workspaces, query, caseSensitive)
export_html(suggestedFileName, html, excludedPaths)
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
clipboard_has_image()
save_clipboard_image(documentPath, directoryPath?)
prepare_local_image(path)
set_native_menu_locale(locale)
```

新增原生事件 `filesystem-changed: { paths: string[] }`，只传路径而非正文。`watch_filesystem([], [])` 清理订阅；前端 Demo 可不实现 watcher/inspection，原生 adapter 精确转发路径和可选保存前提。

| ID                      | 接口要求                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `IPC-WORKSPACE-001`     | chooser/list 返回简洁 serde 结构；listWorkspace(rootPath, showHidden?) 默认隐藏过滤且递归生效；多根编排留在前端                                        |
| `IPC-PICK-DOCUMENT-001` | `pick_document` 返回可选 path/name；取消不是错误                                                                                                       |
| `IPC-DOCUMENT-001`      | open 返回 editable/blocked union；原生 editable 携带 `normal/sourceOnly`、`markdown/text`、language 和一致 diskRevision；blocked 无正文                |
| `IPC-INSPECT-001`       | inspect_documents(paths) 返回 path、present/missing/unreadable 和可用 revision；检查元数据/可读性，不传正文                                            |
| `IPC-WATCH-001`         | watch_filesystem(workspaceRoots, documentPaths) 替换轻量订阅；filesystem-changed 只含 paths；空集合清理，事件/配置有界                                 |
| `IPC-CREATE-FILE-001`   | create 接收 root/directory/fileName；父目录必须位于根内、后缀受支持且 `create_new` 不覆盖；返回现有 open union                                         |
| `IPC-REVEAL-001`        | reveal 仅接受现存文件/目录；macOS/Windows/Linux 使用无 shell 的系统文件管理器命令，返回 void 或小型错误                                                |
| `IPC-TRASH-001`         | trash 接收 `workspaceRoot + path`；只允许根的严格后代且目标存在为文件/目录，调用系统废纸篓；根/根外/不存在拒绝                                         |
| `IPC-PREVIEW-001`       | preview 接收原始 reference 与当前文档路径，固定缓冲读取局部 UTF-8 行，返回 path/language/startLine/targetLine/content                                  |
| `IPC-SAVE-001`          | 原生 save/Save As 返回 path/bytesWritten/diskRevision；save 检查 expectedRevision；Save As 取消 null，excludedPaths 写前拒绝已打开目标；同目录原子保存 |
| `IPC-ASSET-001`         | Rust 直接读系统剪贴板；只接收 `documentPath/directoryPath?`，返回路径/URI/尺寸；另有图片存在检查、目录选择和单文件访问准备，不传 bytes/Base64          |
| `IPC-MENU-001`          | locale 仅为 `zh-CN/en-US`；Rust 重建原生菜单，15 个小型 action ID（含 file.reveal、edit.find 和自定义 close/quit）通知前端                             |
| `IPC-LEAN-001`          | 不预生成未来命令、错误码全集、巨型 schema 或通用事件总线                                                                                               |

## 5. 性能与体验目标

ADR-0010 补充验收：根/目录/文件同级与外部空白菜单的位置语义正确；中文/英文菜单独立 13 px 字号、分组清晰、不被侧栏或窗口边缘裁切。删除确认框的长路径独立完整换行，长内容局部滚动，按钮不溢出，Tab 焦点留在对话框内，取消不触发磁盘动作。

| ID                  | 目标                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `PERF-TYPE-001`     | 普通输入和 IME 无明显掉帧或光标跳动                                                                   |
| `PERF-LAYOUT-001`   | 移动光标/选择不切换源码、不改变块高或造成滚轮漂移                                                     |
| `PERF-OPEN-001`     | 典型 250 KiB 文档在开发机约 300 ms 进入可编辑状态                                                     |
| `PERF-LARGE-001`    | 约 10 MiB 普通多行 fixture 以 `sourceOnly` 打开、编辑、保存而不冻结窗口                               |
| `PERF-TREE-001`     | 大目录首屏可分批出现，不等待完整深度扫描才显示                                                        |
| `PERF-DIAGRAM-001`  | Mermaid 迟到结果不覆盖新源码；单块失败不拖垮页面                                                      |
| `PERF-PREVIEW-001`  | 浮层只经 IPC 读取 ±20/前 80 行，不传完整大文件                                                        |
| `PERF-AUTOSAVE-001` | 每文档最多一个 inactivity timer；正文变化替换旧排程，计时器自身不轮询磁盘；冲突时暂停                 |
| `PERF-EXTERNAL-001` | 路径事件去重/限时合并，30 秒元数据兜底；版本不变不读正文，干净变更才预检，不反复读同版本 blocked 文件 |
| `PERF-TABLE-001`    | 宽表格在局部容器滚动，列宽拖动不触发 Markdown serializer 写盘                                         |
| `PERF-RESTORE-001`  | 恢复仅使用有界元数据，每个路径读取一次；用户主动操作可使迟到结果失效                                  |
| `PERF-FIND-001`     | 当前页匹配属于本地可重建投影，不触发正文序列化或工作区全盘索引                                        |

性能数字是初始工程目标，不是发布 SLA；大量 Mermaid 的视口虚拟化尚未实现。

## 6. P1 / Later

| ID                     | 优先级 | 状态     | 内容                                                                 |
| ---------------------- | ------ | -------- | -------------------------------------------------------------------- |
| `NAV-SPLIT-001`        | P1     | Done     | ADR-0013 统一右侧编辑组与原 Tab 右移；不含额外辅助栏或任意 pane tree |
| `NAV-RECENT-001`       | P1     | Done     | 最近路径及可选标签/组/数值视图恢复；无正文快照或持久导航历史         |
| `TEXT-EDIT-001`        | P1     | Done     | 受支持代码/文本在主 Tab 编辑、保存和另存为                           |
| `SEARCH-WORKSPACE-001` | P1     | Done     | 有限工作区磁盘全文搜索；Quick Open 高级排序仍后置                     |
| `LINK-BACKREF-001`     | P1     | Deferred | 反向链接、断链和重命名修复                                           |
| `EDIT-MATH-001`        | P1     | Deferred | 数学渲染                                                             |
| `EXPORT-001`           | P1     | Deferred | PDF/SVG/PNG 导出；静态 HTML 已由 EXPORT-HTML-001 实现                  |
| `I18N-POLISH-001`      | P1     | Deferred | 少量 chooser、窗口标题、帮助动作等收尾                               |
| `GIT-001`              | Later  | Deferred | diff、历史与冲突工具                                                 |
| `GRAPH-001`            | Later  | Deferred | 文档图谱                                                             |
| `AI-001`               | Later  | Deferred | 工作区检索、引用与问答；需单独隐私决策                               |
| `PLUGIN-001`           | Later  | Deferred | 两个真实扩展需求出现后再定义插件 API                                 |

以下不属于当前路线：任意/递归 pane/grid、IDE/LSP/debug/build/run、正文/崩溃快照恢复或原生窗口布局快照、项目数据库、云最近项，以及 baseline 0.1 的资产 journal、HMAC/nonce、193 MiB IPC、14 flags、Ruby 验证器和 Hosted CI 前置门禁。有限路径/分组/数值视图恢复、当前页查找以及轻量外部文件变化已经属于 baseline 1.1，不应再列为 Deferred；外部自动合并和重命名跟踪仍不在当前范围。

## 7. 当前验收场景

| ID                         | 场景                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `AC-EDIT-001`              | 普通 Markdown 全程可视编辑；标题/列表/代码/表格不因光标泄露源码                                                                |
| `AC-MODE-001`              | 同一编辑器实例内可视/源码切换落到语义相近区域；切换不 dirty；返回原表面恢复其视图                                              |
| `AC-SYNC-001`              | 可视输入字符后不等待，立即 `⌘S`；磁盘包含最后输入                                                                              |
| `AC-TEXT-EDIT-001`         | 打开 Python/txt 等受支持文件，在主 Tab 编辑并保存/另存为；不出现 Markdown 可视开关                                             |
| `AC-NEW-SAVE-AS-001`       | 新建 `.md` 与 `.txt`；目标已由其他 session 打开时写盘前拒绝；成功后全部 Tab/back/forward 指向新路径                            |
| `AC-SAVE-FAILURE-001`      | 注入保存失败后文档和旧文件保持，dirty 与具体错误持续可见，直到再次保存或离开该文档                                             |
| `AC-AUTOSAVE-001`          | 默认 manual 不自动写盘；1 秒 afterDelay 在停止输入后保存，继续输入重排；untitled 跳过，失败仍 dirty/关闭提示                   |
| `AC-WORKSPACE-MULTI-001`   | 两个根/树同时可见并标明活动根；延迟恢复时用户新开根会合并；失效 open/active 清除；Quick Open 来源正确                          |
| `AC-WORKSPACE-ACTIONS-001` | 两根可独立折叠；根右键复制精确路径或关闭一个根，另一个根、最近项、已开 Tab 与磁盘保持                                          |
| `AC-WORKSPACE-HIDDEN-001`  | 两根隐藏偏好默认 off、可独立开启/保持、递归显示普通隐藏项；VCS/依赖/构建缓存和 symlink 仍排除，根层级与折叠标识清楚            |
| `AC-SESSION-RESTORE-001`   | 重启恢复已保存路径、组/标签顺序、固定状态、模式/数值位置；重读磁盘而非草稿，失效路径跳过，不保存文本/历史                      |
| `AC-SESSION-EMPTY-001`     | empty 启动无工作区枚举/旧正文读取，最近项仍可选择；restore 期间新建/打开/导航使迟到旧标签失效，关闭与取消不丢状态              |
| `AC-WORKSPACE-CREATE-001`  | 根和子目录新建无扩展名 Markdown、显式 txt/代码并刷新/前台打开；越界、路径名、未知后缀和同名目标不创建/不覆盖                   |
| `AC-FILE-REVEAL-001`       | 文件与目录调用各平台正确 reveal/open 参数；adapter 精确转发；自动测试不实际启动文件管理器                                      |
| `AC-FILE-TRASH-001`        | 文件/目录复制绝对路径；废纸篓确认取消保持，成功刷新并清理引用；根/根外/不存在及模拟失败均保持目标与 UI 状态                    |
| `AC-FILE-EXTERNAL-001`     | 合成工作区外部新增/修改/删除与目录变化刷新树；独立文件原子替换可检测；隐藏/重目录/type 规则不变，旧成功/失败不覆盖新刷新       |
| `AC-EXTERNAL-RELOAD-001`   | 干净共享 session 重载且各 Tab 位置/历史保持；dirty/missing/unreadable/blocked 留缓冲区，普通/自动保存暂停，重载/覆盖确认可取消 |
| `AC-EXTERNAL-LATE-001`     | 新编辑/保存/关闭/同名重开/Save As 后迟到结果不覆盖；closed clean cache 与源码锚点使用新正文，旧保存不误标新会话 dirty          |
| `AC-WATCH-LIFECYCLE-001`   | 监听先订阅后配置；150/250 ms 批处理、前端最长 1 秒、聚焦/30 秒兜底重配；失败可重试，StrictMode/卸载不影响后续订阅              |
| `AC-SAVE-REVISION-001`     | 原生正文与 revision 一致；写前/rename 前外部改动被拒绝且旧目标保持；missing 不隐式重建，确认覆盖仍核对所见版本                 |
| `AC-TABLE-001`             | GFM 单元格真可视；插表网格只按需出现；列宽拖动不 dirty；已有表可改行列数/对齐；Undo、保存重开正确                              |
| `AC-NAV-001`               | A 点击 B，再后退/前进；每 Tab 历史独立，同文档多 Tab 共享编辑结果                                                              |
| `AC-LOCAL-REF-001`         | `src/worker.py:40` 浮层显示 20 行前后文和真实行号；在当前或右邻普通编辑组打开完整文件，可修改与保存                            |
| `AC-AUX-ONE-001`           | 已有右组时引用直接进入该组且 latest-wins；临时替换、fixed/dirty 保留、最右来源保护，无第三辅助栏，复用统一分隔线               |
| `AC-TEXT-SURFACE-001`      | JSON/shell/Python 等编辑组/浮层有正确高亮、行号、滚动和可读选区；同语言路径替换仍高亮；未知后缀纯文本                          |
| `AC-MOVE-TAB-001`          | 向右分屏保留原 Tab ID/current/view/history/dirty，不复制；可留空左组继续打开，已有右邻组复用，拖动与普通关闭行为保持           |
| `AC-TAB-CLOSE-001`         | 单文件/最后一个 Tab 可关闭；dirty 可取消，确认关闭后回到 Welcome                                                               |
| `AC-ROUTING-001`           | 正文/hover 卡片/源码 `.md` 链接按固定/预览决定普通跳转；`⌘`/中键后台、`⌘⇧` 前台，非 MD 专用预览                                |
| `AC-WINDOW-NAV-001`        | 链接/树替换及跨 Tab/组前进后退恢复；新导航截断、关闭过滤、Save As 迁移、dirty 仍可确认、迟到读取不覆盖                         |
| `AC-EXTERNAL-LINK-001`     | HTTP/HTTPS 正文/hover/源码点击交给系统浏览器；拒绝非网页协议，启动失败本地化，正文/Tab/轨迹不变，图片预览优先                  |
| `AC-CONTEXT-MENU-001`      | 编辑选择不丢；结构/表格/链接/只读/工作区/标签按目标裁剪；双语且一次右键触发；浏览器默认菜单仅顶部工具栏例外，确认期间禁用      |
| `AC-DIRTY-CLOSE-001`       | 编辑历史页后导航：Tab 仍标 dirty；应用内对话框可取消 Tab/红色关闭/退出，确认才丢弃且窗口销毁后进程退出                         |
| `AC-NATIVE-MENU-001`       | 中英文原生菜单含 file.reveal/edit.find；close/quit 进入同一 dirty 流程；确认或无 dirty 后主窗口销毁且 macOS 进程退出           |
| `AC-CODEBLOCK-001`         | 中英文下浅色 code block、行号、语言选择、常显 Copy、换行设置正常                                                               |
| `AC-CODE-BLUR-001`         | 代码块选中后转入外部正文输入，不残留旧活动选区；代码内容与 Undo 不变                                                           |
| `AC-LONG-LINK-001`         | 长 URL 在链接编辑浮层完整换行显示/编辑；保存链接、复制与打开语义不变，不被窄字段截断                                           |
| `AC-IMAGE-CONTEXT-001`     | 文内图片/只读查看器/Mermaid 右键按目标裁剪，复制地址/Markdown 保留原语义，本地定位作用于图片，失败提示不越窗且不 dirty         |
| `AC-IMAGE-EDIT-001`        | 图片长地址、alt/title 修改可 Undo/Redo，取消/原值不改正文，失效目标拒绝旧提交；模态阻止后台命令，关闭后可正常退出应用          |
| `AC-IMAGE-MISSING-001`     | 本地准备失败/加载失败均显示占位，空 alt 与行内图片可操作；删除只作用目标并可 Undo/Redo，长路径换行，旧加载结果不覆盖新地址     |
| `AC-ABOUT-REPOSITORY-001`  | 中英文关于对话框展示完整 GitHub URL，点击与中键调用系统浏览器，失败保留弹窗可重试；模态不触发后台命令，关闭恢复焦点            |
| `AC-DOC-STATISTICS-001`    | 中文逐字/连续英文数字计词；切页、编辑、Undo/Redo、干净外部重载更新，含字符与行数详情；分片/缓存不额外读盘或 dirty              |
| `AC-FIND-PAGE-001`         | Cmd/Ctrl+F 与原生编辑菜单定位当前可视/源码/代码页；中文、无匹配、循环、Enter/Shift-Enter/Esc，不改变正文/dirty/Undo            |
| `AC-FENCE-LIST-001`        | 输入三个反引号加 `pyt` 出现 python 等候选；上下键 + Enter/Tab 创建并可 Undo，Esc/关闭设置隐藏；列表 marker 对齐                |
| `AC-I18N-SETTINGS-001`     | 默认中文，新增查找/隐藏项/启动设置双语同步；九项持久化，恢复默认回到中文/16/920/三项开启/manual/5 秒/restore                   |
| `AC-ASSET-001`             | 键盘/右键粘贴后文件存在并正确引用；失败/取消/过期时正文不变；未命名文档先 Save As，迁移插入可 Undo；空剪贴板不删除选区         |
| `AC-WORKSPACE-IMAGE-001`   | 默认 Markdown 同级目录，每根可选现存目录并记忆；嵌套根独立、失效目录报错、不迁移旧图；隐藏/外部目录实际图片先授权再加载        |
| `AC-BASE64-001`            | 约 10 MiB data-image 粘贴/文件均不进入 editor transaction                                                                      |
| `AC-LARGE-001`             | 约 10 MiB 普通多行 Markdown 以 `sourceOnly` 编辑并保存                                                                         |
| `AC-DIAGRAM-001`           | production CSP 下 Mermaid 清晰；缩放/平移/Fit/Esc 正常                                                                         |
| `AC-OFFLINE-001`           | 断网状态下核心工作流完整可用                                                                                                   |

历史 ADR-0007 等验收记录只说明当时基线，不代表当前 ADR-0016 的交付结果。本轮新增能力的总测试数、全局 format/lint/typecheck/build、Rust fmt/clippy/test、UI smoke 与最终桌面产物由集成者统一确认，历史通过记录不代替当前修订的验证。
