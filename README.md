# NoteSpace（笔记空间）

一个以 Markdown 为中心的本地桌面编辑器。借鉴 Typora 的可视编辑体验，直接在排版后的正文中写作；结合浏览器式标签、分屏和前进后退，方便阅读相互引用的笔记与代码。

## 安装

macOS Apple Silicon 可通过 [NoteSpace Homebrew Tap](https://github.com/Ysclmml/homebrew-tap) 安装，也可在 [GitHub Releases](https://github.com/Ysclmml/notespace/releases) 下载 DMG。首次安装先添加 Tap，再安装 NoteSpace：

```sh
brew tap ysclmml/tap
brew install --cask ysclmml/tap/notespace
```

当前版本为预览版，尚未完成 Apple 公证。Homebrew 安装仅移除 NoteSpace 的下载隔离标记，不改变系统全局安全设置；请确认信任来源后安装。直接下载 DMG 仍需遵循 macOS 的启动检查。

Android ARM64 用户可在同一个 [GitHub Releases](https://github.com/Ysclmml/notespace/releases) 页面下载 `NoteSpace-Mobile` APK。本版移动端使用现有测试签名，适合局域网阅读预览和从此前测试包直接覆盖安装；它还不是 Google Play 或长期正式签名版本。

已有 Homebrew 版本时，保存文档并退出应用后升级：

```sh
brew update
brew upgrade --cask ysclmml/tap/notespace
```

卸载前请保存文档并退出应用：

```sh
brew uninstall --cask ysclmml/tap/notespace
```

普通卸载会将应用设置、最近文件、浏览恢复记录与缓存移入废纸篓，不删除笔记、工作区或图片。升级和重装保留这些应用数据。

确认不再通过这个 Tap 安装其他软件后，可移除 Tap：

```sh
brew untap ysclmml/tap
```

## 软件截图

以下截图均使用合成测试文档，在应用的浏览器演示模式中实拍。

### 可视化编辑

文件树、标签与清晰的正文排版，直接编辑标题、列表和表格。

![NoteSpace 可视化编辑界面](docs/screenshots/notespace-editor.jpg)

### 分屏阅读与代码编辑

并排查看笔记和代码，支持语法高亮、独立标签与可调整的分屏宽度。

![NoteSpace Markdown 与代码分屏界面](docs/screenshots/notespace-split.jpg)

### 图表预览

Mermaid 图表可放大查看，支持缩放、平移和适应窗口。

![NoteSpace Mermaid 图表预览](docs/screenshots/notespace-diagram.jpg)

### 手机局域网阅读

在 Android App 中浏览桌面端共享的工作区、逐层打开目录，并以只读模式阅读 Markdown。

![NoteSpace Mobile 工作区与阅读界面](docs/screenshots/notespace-mobile.jpg)

## 核心特色

- **直接编辑排版后的 Markdown**：标题、列表和表格保持可视形态，光标进入时不自动展开源码；需要精确调整标记时，再主动切换源码模式。
- **像浏览器一样阅读文档**：点击本地 Markdown 链接继续阅读，前进与后退可跨标签、跨分屏返回原来的位置；可选择下次启动恢复上次浏览。
- **临时标签与分屏对照**：单击文件临时预览，双击或编辑后保持打开；标签可在分屏之间拖动。文中代码引用可按行预览，或在右侧打开，与笔记并排阅读、编辑。
- **截图与图表融入写作**：粘贴截图先保存为本地图片，再插入引用；每个工作区可指定图片目录。图片引用可直接修改，图片与 Mermaid 图表可放大查看。
- **常见数学写法直接可用**：行内与块公式同时兼容 `$...$`、`$$...$$`、`\(...\)` 和 `\[...\]`，桌面可视编辑、手机阅读及分享 HTML/PDF 使用一致的公式语义。
- **本地文件夹就是工作区**：多个笔记目录可同时打开，无需导入专有格式；Markdown 与图片仍是普通文件，方便继续使用 Git 或其他工具管理。
- **系统直接打开 Markdown**：打包版可通过 Finder/系统「打开方式」接收 `.md` 与 `.markdown` 文件，并在前台标签中打开；是否设为默认应用由你在系统中决定。
- **手机局域网阅读**：桌面明确开启并选择工作区后，NoteSpace Mobile 可在同一局域网浏览、搜索和阅读磁盘上的 Markdown；需要离开电脑时，可逐工作区保存离线副本并在重连后刷新。

## 0.2.2 新增

- **更安静的离线提示**：进入离线阅读、切换离线电脑或当前连接断开时，大提示只显示约 3 秒；目录和正文随后只保留紧凑的离线/重连入口，普通导航不会反复弹出。
- **稳定的移动布局**：断线、错误与普通通知不再挤压正文或底部导航；重新进入同一离线电脑仍会获得一次完整提示。
- **发布与说明完善**：Android 构建固定输出 ARM64 预览 APK，README 补充移动端安装说明、真实构建路径和合成数据示意图。

## 0.2.1 新增

- **Android 局域网阅读**：手机 App 可自动发现同网电脑，也可输入 IP/主机名后使用默认端口连接；桌面明确选择共享工作区并启动后，多个手机可浏览目录、全文搜索和只读 Markdown。
- **离线工作区**：手机可保存完整 Markdown 副本，断网后继续浏览、搜索和打开最近文档；重连同一电脑后自动刷新，失败不会破坏旧副本。
- **四种公式分隔符**：桌面、手机及可分享 HTML/PDF 统一支持 `$...$`、`$$...$$`、`\(...\)` 与 `\[...\]`，无需先改写已有 LaTeX/MathJax 笔记。
- **更小的测试 APK**：ARM64 可安装 Debug 包省略仅供 Rust 原生调试器使用的 DWARF 信息，保留日志、WebView 调试和局域网能力；需要原生调试时仍可使用完整符号入口。

## 0.2.0 新增

- **全文搜索**：工具栏「全文搜索」或 `Cmd/Ctrl+Shift+F` 打开独立弹窗，通过应用自绘范围控件选择全部已打开工作区或单个根。正文可切换普通文本/正则，另有独立的文件名或路径正则筛选。最近记录紧凑显示查询文字，默认保留 15 条，可在设置中调整为 1–30 条、点选回填或手动清空；回填不会自动读盘。点击结果后再次打开搜索，会回到上次结果、滚动位置和最后点击项，不重复扫描；结果只保留到退出应用。搜索磁盘文件，不包含未保存修改；无效表达式、过大文件和扫描上限会提示。右上角「快速打开」仍只查找文件名/路径。
- **分享导出**：「文件」或更多菜单 →「导出」→ HTML/PDF。HTML 自带图片与 Mermaid 图表，离线也能分享；macOS PDF 保留文字与分页。包括未保存编辑、不修改原文。联网图片须每次勾选后下载，缺图或图表失败会提示；正文上限 8 MiB，source-only 暂不导出。不会递归打包链接指向的其他文档。
- **写作工具**：当前页查找栏可展开单项/全部替换并撤销。文件右键或星标收藏，统一放在文件侧栏顶部的可折叠分组；可在设置中显示/隐藏，也可右键分组标题后选择「关闭收藏」，收藏记录不会被清空。工作区关闭后仍能独立打开，失效项保留并可重试/取消。更多菜单也可进入专注模式。
- **模板与帮助**：更多菜单 →「从模板新建」，包含会议/周报/技术方案及「自定义模板」。当前正文可另存模板，普通 Markdown 文件放在本机用户数据目录，点击「打开模板文件夹」管理，不在安装包内。更多菜单 →「使用帮助」可离线阅读功能说明与当前快捷键。
- **格式快捷键**：Mac 用 Cmd，Windows/Linux 用 Ctrl；1–6 标题、0 正文，B/I/E 粗体/斜体/行内代码。设置 → 快捷键支持搜索、重新录入、冲突提示与恢复默认。`Cmd/Ctrl+Shift+Enter` 切换专注模式，Esc 可退出。
- **版本更新提示**：「关于笔记空间」显示当前版本并可手动检查；启动检查默认开启，也可在设置中关闭。检查只读取 [NoteSpace GitHub Releases](https://github.com/Ysclmml/notespace/releases) 的最新稳定版本，发现新版后可稍后提醒或只跳过该版本；发布页仅在点击后打开，不自动下载或安装，也不上传文档或路径。
- **恢复提示**：上次浏览的文件夹或文件暂不可用时显示路径，可重试、选择工作区或移除最近记录，不自动创建或删除文件。

更新记录见 [CHANGELOG](CHANGELOG.md)。

## 技术栈

- 桌面：Tauri 2 + Rust
- 前端：React 19 + TypeScript + Vite
- 编辑器：Milkdown/ProseMirror + CodeMirror 6 + Lezer
- 工具：Node 24 + pnpm 10

## 本地开发

在 macOS 上安装 Node.js 24、pnpm 10.32.1、Rust 工具链和 Xcode Command Line Tools 后运行：

```bash
pnpm install --frozen-lockfile
pnpm desktop:dev
```

运行检查、测试与构建：

```bash
pnpm verify
```

## Android 移动阅读

安装 Android Studio、Android SDK/NDK 和 Rust Android targets 后，可构建独立的 NoteSpace Mobile 开发 APK：

```bash
pnpm mobile:android:build:debug
```

这个可安装测试包会省略仅供 Rust 原生调试器使用的 DWARF 信息，但仍保留 Android Debug 签名、应用/WebView 调试、日志与局域网能力。需要连接原生调试器时使用 `pnpm mobile:android:dev`，该入口继续保留完整符号。

当前默认只构建 Android ARM64 安装包；Tauri 的输出目录仍沿用 `universal` 名称，实际 APK 位于 `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`。局域网阅读按 [ADR-0025](docs/decisions/0025-lan-offline-reader.md) 作为普通桌面与移动构建能力提供，`debug` 命令只是本地开发打包方式：

1. 电脑和 Android 手机连入同一局域网，在桌面版打开需要浏览的工作区。
2. 打开桌面「移动访问」，明确勾选至少一个已打开工作区并启动服务。
3. 手机端会通过 mDNS 列出同网电脑，并依次探测该电脑发布的多个局域网地址。自动发现不可用时可只输入电脑 IP 或主机名，手机会补上默认端口 `49920`；桌面改过端口时输入完整 `host:port`。Android 模拟器可直接使用 `10.0.2.2`。
4. 同一台电脑可供多个手机同时浏览目录、阅读 Markdown 和搜索；桌面停止共享或退出后，listener 与本次文档 ID 立即失效，在途长任务会取消。
5. 在手机上为某个工作区开启离线保存后，会下载其完整 Markdown 快照，并显示占用空间与最近同步时间；电脑不在线时仍可浏览、搜索和从最近记录打开。进入离线阅读、切换离线电脑或当前连接中断时只短暂提示一次，之后由紧凑状态标识表示离线，不持续占用正文空间。重新连接后自动刷新，也可手动更新或清除。图片、附件和已渲染 Mermaid 资产暂不进入离线包。

桌面面板显示的是当前尚未完成的 **活跃请求数**，不是在线手机数或已配对设备数；手机停留在已经打开的阅读页时，这个值可以是 `0`。

当前局域网传输不使用 TLS 或设备配对；服务只在你明确启动期间开放，并且只读所选工作区内已保存的内容。根外路径、符号链接、隐藏/不支持文件和超限读取仍会被拒绝。

手机应用更新本轮暂未接入。后续直接分发 APK 时采用「检查固定 GitHub Release → 用户确认下载 → Android 系统安装器」的方式，不做静默安装或 JavaScript 热更新；进入 Google Play 分发后再切换 Play In-App Updates。

## 构建 macOS 应用

生成可直接双击启动的 Debug 应用：

```bash
pnpm exec tauri build --debug --bundles app
open "src-tauri/target/debug/bundle/macos/NoteSpace.app"
```

应用位于 `src-tauri/target/debug/bundle/macos/NoteSpace.app`，已包含前端资源，启动时无需运行开发服务器。

产品设计与开发规范见 [技术文档](docs/README.md)。
