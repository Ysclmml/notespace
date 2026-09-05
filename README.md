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

### 阅读与编辑

文件树、标签与清晰的正文排版，顶部一键切换阅读与编辑，阅读时也能选择和复制文字、表格与代码。

![NoteSpace 阅读模式与顶部阅读编辑切换入口](docs/screenshots/notespace-editor.jpg)

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
- **一键切换阅读与编辑**：默认可编辑，点击顶部「阅读」即可保护当前窗口所有标签和分屏，避免误输入；仍可选择文字、复制正文与代码、查找和跳转链接。专注模式也保留切换入口，返回编辑后继续使用原有内容和撤销记录。
- **像浏览器一样阅读文档**：点击本地 Markdown 链接继续阅读，前进与后退可跨标签、跨分屏返回原来的位置；可选择下次启动恢复上次浏览。
- **更稳定的阅读与输入**：修复中文输入时的页面跳动，减少代码块、公式和图表滚动浏览时的正文位移；可视与源码往返保留各自的撤销记录。
- **临时标签与分屏对照**：单击文件临时预览，双击或编辑后保持打开；标签可在分屏之间拖动。文中代码引用可按行预览，或在右侧打开，与笔记并排阅读、编辑。
- **截图与图表融入写作**：粘贴截图先保存为本地图片，再插入引用；每个工作区可指定图片目录。图片引用可直接修改，图片与 Mermaid 图表可放大查看。
- **常见数学写法直接可用**：行内与块公式同时兼容 `$...$`、`$$...$$`、`\(...\)` 和 `\[...\]`，桌面可视编辑、手机阅读及分享 HTML/PDF 使用一致的公式语义。
- **搜索与分享**：按正文、文件名或路径搜索工作区，支持正则筛选和最近搜索；当前页可查找，编辑模式下也可替换并撤销。导出 HTML/PDF 时包含当前编辑、图片与 Mermaid 图表，方便离线分享。
- **常用写作工具**：收藏常读文件，使用会议、周报和自定义模板开始写作；专注模式收起周边界面，离线帮助提供功能与快捷键说明。
- **本地文件夹就是工作区**：多个笔记目录可同时打开，无需导入专有格式；Markdown 与图片仍是普通文件，方便继续使用 Git 或其他工具管理。
- **系统直接打开 Markdown**：打包版可通过 Finder/系统「打开方式」接收 `.md` 与 `.markdown` 文件，并在前台标签中打开；是否设为默认应用由你在系统中决定。
- **手机局域网与离线阅读**：桌面开启共享后，NoteSpace Mobile 可在同一局域网浏览、搜索和阅读已保存的 Markdown 文字与公式。完整离线副本让阅读在断网后继续，重连后可刷新内容并从最近记录找回阅读位置。

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

当前默认只构建 Android ARM64 安装包；Tauri 的输出目录仍沿用 `universal` 名称，实际 APK 位于 `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`。局域网阅读按 [ADR-0025](docs/decisions/0025-lan-offline-reader.md) 作为普通桌面与移动构建能力提供，Android Debug 和 Release 均启用同网电脑发现；`debug` 命令只是本地开发打包方式：

1. 电脑和 Android 手机连入同一局域网，在桌面版打开需要浏览的工作区。
2. 打开桌面「移动访问」，明确勾选至少一个已打开工作区并启动服务。
3. 手机端会通过 mDNS 列出同网电脑，并依次探测该电脑发布的多个局域网地址。自动发现不可用时可只输入电脑 IP 或主机名，手机会补上默认端口 `49920`；桌面改过端口时输入完整 `host:port`。Android 模拟器可直接使用 `10.0.2.2`。
4. 同一台电脑可供多个手机同时浏览目录、阅读 Markdown 和搜索。电脑重启共享后，手机最近记录仍可找到原工作区中的文档，继续上次阅读位置。
5. 在手机上为某个工作区开启离线保存后，会下载完整 Markdown 副本，并显示占用空间与最近同步时间；断网后仍可浏览、搜索和从最近记录打开。重新连接后自动刷新，也可手动更新或清除；目录未完整读取或更新失败时，会提示并保留上一份完整副本。离线提示只短暂出现，随后保留紧凑状态，不持续占用正文空间。

手机当前以文字与公式阅读为主，尚不支持图片、Mermaid 图表和文档内链接导航；图片与附件也不进入离线副本。

桌面面板显示的是当前尚未完成的 **活跃请求数**，不是在线手机数或已配对设备数；手机停留在已经打开的阅读页时，这个值可以是 `0`。

当前局域网传输不使用 TLS 或设备配对；服务只在你明确启动期间开放，并且只读所选工作区内已保存的内容。根外路径、符号链接、隐藏/不支持文件和超限读取仍会被拒绝。

## 构建 macOS 应用

生成可直接双击启动的 Debug 应用：

```bash
pnpm exec tauri build --debug --bundles app
open "src-tauri/target/debug/bundle/macos/NoteSpace.app"
```

应用位于 `src-tauri/target/debug/bundle/macos/NoteSpace.app`，已包含前端资源，启动时无需运行开发服务器。

产品设计与开发规范见 [技术文档](docs/README.md)。
