# NoteSpace（笔记空间）

一个以 Markdown 为中心的本地桌面编辑器。借鉴 Typora 的可视编辑体验，直接在排版后的正文中写作；结合浏览器式标签、分屏和前进后退，方便阅读相互引用的笔记与代码。

## 安装

macOS Apple Silicon 可通过 Homebrew 安装，也可在 [GitHub Releases](https://github.com/Ysclmml/notespace/releases) 下载 DMG。

```sh
brew install --cask ysclmml/tap/notespace
```

当前 `0.1.0` 为预览版，尚未完成 Apple 公证。Homebrew 安装仅移除 NoteSpace 的下载隔离标记，不改变系统全局安全设置；请确认信任来源后安装。直接下载 DMG 仍需遵循 macOS 的启动检查。

卸载前请保存文档并退出应用：

```sh
brew uninstall ysclmml/tap/notespace
```

普通卸载会将应用设置、最近文件、浏览恢复记录与缓存移入废纸篓，不删除笔记、工作区或图片。升级和重装保留这些应用数据。

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

## 核心特色

- **直接编辑排版后的 Markdown**：标题、列表和表格保持可视形态，光标进入时不自动展开源码；需要精确调整标记时，再主动切换源码模式。
- **像浏览器一样阅读文档**：点击本地 Markdown 链接继续阅读，前进与后退可跨标签、跨分屏返回原来的位置；可选择下次启动恢复上次浏览。
- **临时标签与分屏对照**：单击文件临时预览，双击或编辑后保持打开；标签可在分屏之间拖动。文中代码引用可按行预览，或在右侧打开，与笔记并排阅读、编辑。
- **截图与图表融入写作**：粘贴截图先保存为本地图片，再插入引用；每个工作区可指定图片目录。图片引用可直接修改，图片与 Mermaid 图表可放大查看。
- **本地文件夹就是工作区**：多个笔记目录可同时打开，无需导入专有格式；Markdown 与图片仍是普通文件，方便继续使用 Git 或其他工具管理。

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

## 构建 macOS 应用

生成可直接双击启动的 Debug 应用：

```bash
pnpm exec tauri build --debug --bundles app
open "src-tauri/target/debug/bundle/macos/NoteSpace.app"
```

应用位于 `src-tauri/target/debug/bundle/macos/NoteSpace.app`，已包含前端资源，启动时无需运行开发服务器。

产品设计与开发规范见 [技术文档](docs/README.md)。
