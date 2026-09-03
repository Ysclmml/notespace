# macOS Release 与 Homebrew 分发

本文是发布操作指南，不表示安装包或 Homebrew 安装源已经发布。当前产品版本为 `0.1.0`，只有 Apple Silicon 的本机验证记录；现有 GitHub Actions 生成的是临时 Debug artifact，不会自动创建 Release。

## 1. 分发结构

- `Ysclmml/notespace`：产品源码、版本 tag 和 GitHub Release 的 DMG 附件。
- `Ysclmml/homebrew-tap`：另建一个公开仓库，使用 `Casks/notespace.rb` 描述版本、下载地址、校验值和卸载范围。
- Homebrew 下载已构建的应用，不要求使用者安装 Node、pnpm 或 Rust，也不在安装时编译产品。

自己的 tap 不需要先进入 Homebrew 官方软件库。[Homebrew tap 文档](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap#casks)

## 2. 确定签名与发布版本

先选择分发方式：

- **个人试用**：Release 构建加 ad-hoc 签名。可以通过自己的 tap 安装，但首次打开仍可能需要在“系统设置 → 隐私与安全性”中针对这个应用允许打开。
- **面向普通用户分发**：使用 Developer ID Application 签名并完成 Apple 公证，按 Tauri 官方说明配置发布凭据。

Homebrew 安装成功不代表通过 Gatekeeper。不要在安装脚本中关闭 Gatekeeper、移除隔离标记或默认使用 `--no-quarantine`。[Tauri 签名与公证](https://v2.tauri.app/distribute/sign/macos/)、[Homebrew 安全模型](https://docs.brew.sh/Homebrew-Security-and-Supply-Chain#casks-have-a-different-trust-model)

下文以首个 `v0.1.0` 为例。发布前确认 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 的版本一致，相关 lockfile 同步；不要更改兼容旧版本的 bundle identifier `app.markdownworkspace.desktop`。以后每次发版使用新的版本/tag，不覆盖旧版本附件。

## 3. 构建并检查 Release DMG

在已提交、工作树干净的发布版本中运行：

```sh
pnpm install --frozen-lockfile
pnpm verify
```

个人试用的 ad-hoc 构建命令如下；正式签名版本使用已配置的 Developer ID，不要叠加下面的 `signingIdentity` 覆盖：

```sh
pnpm exec tauri build --bundles dmg --config '{"bundle":{"macOS":{"signingIdentity":"-"}}}'
```

此命令不带 `--debug`。Apple Silicon 原生构建的输出通常为：

```text
src-tauri/target/release/bundle/macos/NoteSpace.app
src-tauri/target/release/bundle/dmg/NoteSpace_0.1.0_aarch64.dmg
```

以实际构建输出文件名为准。不要使用旧 Debug 目录的 `.app`/DMG，也不要把它们放进源码 Git 历史。[Tauri DMG 构建](https://v2.tauri.app/distribute/dmg/)

先保存笔记并正常退出旧实例，再用合成测试文档检查新包的启动、编辑、截图粘贴、保存、退出和重新打开。验证签名并对**最终上传的 DMG**计算 SHA-256：

```sh
codesign --verify --deep --strict "src-tauri/target/release/bundle/macos/NoteSpace.app"
shasum -a 256 "src-tauri/target/release/bundle/dmg/NoteSpace_0.1.0_aarch64.dmg"
```

签名校验通过不等于通过公证/Gatekeeper。签名、公证、装订或重新打包后需重新计算 DMG 校验值，不能用应用内可执行文件的哈希代替。

## 4. 发布 GitHub Release

只有确认当前提交就是刚刚构建的版本后，创建并推送 tag：

```sh
git tag -a v0.1.0 -m "NoteSpace 0.1.0"
git push origin v0.1.0
```

在 [NoteSpace Releases](https://github.com/Ysclmml/notespace/releases) 中：

1. 点击 **Draft a new release**，选择刚推送的 `v0.1.0`。
2. 填写标题、功能与修复说明；明确 Apple Silicon 架构和签名/公证状态。
3. 上传刚验证的 DMG，可附校验值；GitHub 自动生成的 Source code ZIP 不是安装包。
4. 首次试用可以勾选 **This is a pre-release**。先保存草稿，检查附件，最后点击 **Publish release**。

草稿附件不能作为公开 Homebrew 下载源。发布后检查实际下载链接；后续 Cask 的 URL、文件名和 SHA-256 必须全部对应这个最终附件。[GitHub Release 操作说明](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository#creating-a-release)

## 5. 建立自己的 Homebrew 安装源

在 GitHub 创建公开仓库 `Ysclmml/homebrew-tap`，添加 `Casks/notespace.rb`。下面是首版 Apple Silicon 的模板，必须将 SHA-256 占位值替换后才能使用：

```ruby
cask "notespace" do
  version "0.1.0"
  sha256 "REPLACE_WITH_FINAL_DMG_SHA256"

  url "https://github.com/Ysclmml/notespace/releases/download/v#{version}/NoteSpace_#{version}_aarch64.dmg"
  name "NoteSpace"
  desc "Local Markdown and text editor"
  homepage "https://github.com/Ysclmml/notespace"

  depends_on :macos
  depends_on arch: :arm64

  app "NoteSpace.app"

  zap trash: [
    "~/Library/Caches/app.markdownworkspace.desktop",
    "~/Library/Preferences/app.markdownworkspace.desktop.plist",
    "~/Library/WebKit/app.markdownworkspace.desktop",
  ]
end
```

三个清理目标是开发机上已确认存在的、应用专属的缓存、偏好和 WebKit 数据。不要增加 `~/Library`、整个 WebKit 目录、工作区或自选图片目录等宽泛目标。发布版在隔离用户环境实测若产生其他应用专属文件，再逐项确认后补充；不能承诺删除 macOS 管理的全部日志、索引或备份。

`.rb` 只是 Homebrew 自己读取的 Cask 定义，不会为 NoteSpace 增加 Ruby 运行时。普通 `.app` 使用声明式 `app` 即可，不需要自定义安装/删除脚本。[Cask 定义](https://docs.brew.sh/Cask-Cookbook)

模板提交并推送到 tap、Release 附件公开后，使用完整名称安装：

```sh
brew install --cask ysclmml/tap/notespace
```

完整名称可避免同名包歧义，并只信任这个 Cask，而不是整个 tap 的所有内容。[Homebrew tap 信任说明](https://docs.brew.sh/Tap-Trust#installing-from-a-tap)

## 6. 安装、升级与卸载边界

升级、卸载前先保存所有未保存内容并正常退出 NoteSpace。不要靠强杀进程完成卸载，也不要在应用运行时清理设置，避免数据被重新写回。

| 操作            | 应用本体                                                             | 设置、最近文件与浏览恢复             | Markdown、代码及粘贴图片 |
| --------------- | -------------------------------------------------------------------- | ------------------------------------ | ------------------------ |
| 首次安装        | 安装到 Homebrew 管理的应用位置，通常为 `/Applications/NoteSpace.app` | 不主动清除已有数据                   | 不修改                   |
| 正常升级        | 替换为新版本                                                         | 保留                                 | 不修改                   |
| 普通卸载        | 移除                                                                 | 保留，方便重装                       | 不修改                   |
| 带 `--zap` 卸载 | 移除                                                                 | 将 Cask 明确列出的应用数据移到废纸篓 | 不修改                   |

升级：

```sh
brew update
brew upgrade --cask ysclmml/tap/notespace
```

普通卸载：

```sh
brew uninstall --cask ysclmml/tap/notespace
```

希望连同应用设置一起清除时，**改用**下面一条，不是接着重复执行普通卸载：

```sh
brew uninstall --cask --zap ysclmml/tap/notespace
```

之后重新 `brew install --cask ysclmml/tap/notespace`，便是清除已声明应用数据后的重新安装。若曾手动放入同名 `.app`，先确认那份应用的来源并正常退出，再单独移走旧应用包；不要通过 `--force` 盲目覆盖。

`--zap` 不默认执行，且按 Homebrew 规则不应删除用户直接创建的文件。这里使用可恢复的 `trash` 而非永久删除；不自动清空废纸篓。[Homebrew zap 规则](https://docs.brew.sh/Cask-Cookbook#stanza-zap)

如还要清理 Homebrew 自己缓存的安装包，可先预览，再仅清理本软件；这不等同于清理应用设置：

```sh
brew cleanup --dry-run --prune=all ysclmml/tap/notespace
brew cleanup --prune=all ysclmml/tap/notespace
```

确认不再需要该安装源后，可选执行 `brew untap ysclmml/tap`。[Homebrew cleanup 手册](https://docs.brew.sh/Manpage#cleanup-options-formulacask-)

## 7. 发布前的安装回归

在隔离 macOS 用户账户中、仅使用合成笔记和图片验证：

1. 从公开 Release 通过完整 Cask 名称安装；检查架构、版本、应用路径与系统启动提示。
2. 编辑/保存合成 Markdown、粘贴图片、改变设置并重启，确认功能和浏览恢复。
3. 普通卸载后重装，确认设置保留；模拟新版升级，确认笔记与图片不变。
4. 正常退出后 `--zap` 卸载，检查应用本体和三个声明路径已移除；合成笔记与图片仍完整。
5. 再次安装，确认默认设置及空的最近记录；检查是否有新增的应用专属数据路径。

当前没有执行过上述完整 Homebrew 安装回归。关闭应用只应退出进程，不应自动清除设置；“干净卸载”的范围是应用本体及明确声明的应用数据，而不是用户的写作成果。
