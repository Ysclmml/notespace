# macOS Release 与 Homebrew 分发

当前产品版本为 `0.1.0`，Apple Silicon DMG 已发布到 [GitHub 预发布版本](https://github.com/Ysclmml/notespace/releases/tag/v0.1.0)。Homebrew 分发定义维护在 [Ysclmml/homebrew-tap](https://github.com/Ysclmml/homebrew-tap)。现有产品 GitHub Actions 生成的是临时 Debug artifact，不会自动创建 Release。

## 1. 分发结构

- `Ysclmml/notespace`：产品源码、版本 tag 和 GitHub Release 的 DMG 附件。
- `Ysclmml/homebrew-tap`：公开安装源，使用 `Casks/notespace.rb` 描述版本、下载地址、校验值和卸载范围。
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

## 5. 维护 Homebrew 安装源

[Casks/notespace.rb](https://github.com/Ysclmml/homebrew-tap/blob/main/Casks/notespace.rb) 是安装定义的唯一维护位置，不在产品仓库复制另一份模板。`0.1.0` 的公开 DMG 下载校验值为：

```text
8973594d28d7a5fb975536f38ee607e8e55abe4f814d96dbedc4b57c211ee981
```

更新版本时先公开新的 Release 附件，重新下载验证 SHA-256，再更新 Cask 的版本及校验值，运行 tap 内的策略测试和 Homebrew 样式检查后提交推送。不要覆盖旧版本 DMG。

这个自有 tap 的普通卸载会清理应用数据。不能直接使用 `uninstall trash:`：Homebrew 升级和重装也会执行它，`on_upgrade: false` 不会跳过 `trash`。当前使用自有 tap 的卸载钩子区分明确的 `brew uninstall` 与升级/重装；命令上下文或原生废纸篓接口不可用时保留数据并提示，而不猜测后删除。它们属于 Homebrew 内部接口，Homebrew 更新后需要复验。`.rb` 只由 Homebrew 读取，不为 NoteSpace 增加 Ruby 运行时。[Cask 定义与卸载钩子](https://docs.brew.sh/Cask-Cookbook)

通过完整名称安装：

```sh
brew install --cask ysclmml/tap/notespace
```

完整名称可避免同名包歧义，并只信任这个 Cask，而不是整个 tap 的所有内容。[Homebrew tap 信任说明](https://docs.brew.sh/Tap-Trust#installing-from-a-tap)

## 6. 安装、升级与卸载边界

升级、卸载前先保存所有未保存内容并正常退出 NoteSpace。不要靠强杀进程完成卸载，也不要在应用运行时清理设置，避免数据被重新写回。

| 操作             | 应用本体                                 | 设置、最近文件与浏览恢复 | Markdown、代码及粘贴图片 |
| ---------------- | ---------------------------------------- | ------------------------ | ------------------------ |
| 首次安装         | 通常安装到 `/Applications/NoteSpace.app` | 不主动清除已有数据       | 不修改                   |
| 正常升级         | 替换为新版本                             | 保留                     | 不修改                   |
| `brew reinstall` | 重新安装                                 | 保留                     | 不修改                   |
| 普通卸载         | 移除                                     | 移入系统废纸篓，可恢复   | 不修改                   |

升级：

```sh
brew update
brew upgrade --cask ysclmml/tap/notespace
```

普通卸载：

```sh
brew uninstall ysclmml/tap/notespace
```

**无需 `--zap`，普通卸载已经清理以下三个应用专属路径：**

- `~/Library/Caches/app.markdownworkspace.desktop`
- `~/Library/Preferences/app.markdownworkspace.desktop.plist`
- `~/Library/WebKit/app.markdownworkspace.desktop`

清理只针对这些明确路径，不跟随符号链接，不触及工作区或自选图片目录，不自动清空废纸篓。应用仍在运行或进程检查失败时拒绝卸载；清理失败会明确报错。不要在卸载过程中重新启动应用。当前版本的数据范围已经在本机核查；未来出现其他应用专属文件时再逐项确认，不能扩大到整个 `Library` 或 WebKit 目录。

普通卸载后再 `brew install --cask ysclmml/tap/notespace`，得到清除已声明应用数据后的安装。若此前手动安装了同一版本，可先保存并退出，再尝试接管：

```sh
brew install --cask --adopt ysclmml/tap/notespace
```

接管要求已有应用与下载产物一致；失败时确认来源，只将旧应用包移到废纸篓再安装，不使用 `--force` 盲目覆盖。[Homebrew 接管说明](https://docs.brew.sh/Tips-and-Tricks#adopt-a-manually-installed-app-as-a-cask)

这里的干净卸载不承诺删除 macOS 管理的日志、索引、备份或 Homebrew 自己的安装包缓存。

如还要清理 Homebrew 自己缓存的安装包，可先预览，再仅清理本软件；这不等同于清理应用设置：

```sh
brew cleanup --dry-run --prune=all ysclmml/tap/notespace
brew cleanup --prune=all ysclmml/tap/notespace
```

确认不再需要该安装源后，可选执行 `brew untap ysclmml/tap`。[Homebrew cleanup 手册](https://docs.brew.sh/Manpage#cleanup-options-formulacask-)

## 7. 分发回归

tap 内的隔离测试使用生成的临时用户目录，并拦截进程和废纸篓操作，不接触真实用户数据：

```sh
HOMEBREW_DEVELOPER=1 brew ruby test/notespace_policy_test.rb
brew style --cask Casks/notespace.rb
```

覆盖普通卸载、升级/重装保留、运行中拒绝、检测失败保留、路径白名单、符号链接拒绝和清理失败。实际安装回归只使用合成笔记和图片：

1. 从公开 Release 通过完整 Cask 名称安装；检查架构、版本、应用路径与系统启动提示。
2. 编辑/保存合成 Markdown、粘贴图片、改变设置并重启，确认功能和浏览恢复。
3. `brew reinstall` 后确认设置保留；有新版本时实际测试升级，不能用同版本重装冒充升级结果。
4. 正常退出后普通卸载，检查应用本体和三个声明路径已移除；合成笔记与图片仍完整。
5. 再次安装，确认默认设置及空的最近记录；检查是否有新增的应用专属数据路径。

准确的已执行结果记录在 [项目状态](PROJECT_STATE.md)。关闭应用只退出进程，不清除设置；“干净卸载”的范围是应用本体及明确声明的应用数据，而不是用户的写作成果。
