# 导航、Tab 与链接设计

> **历史参考（baseline 0.1）**：Session/Tab/history 分离仍有效；复杂异步协议和旧门禁不再规范。当前范围以 [DESIGN.md](../DESIGN.md) 与 [REQUIREMENTS.md](../REQUIREMENTS.md) 为准。

> 状态：Approved design baseline 0.1  
> 所有者：Workspace / Navigation  
> 主要需求：NAV-MODEL-001、NAV-HISTORY-001、NAV-RESTORE-001、NAV-DISPOSITION-001、NAV-ANCHOR-001、NAV-ASYNC-001  
> 契约依赖：[03-domain-model-and-contracts.md](03-domain-model-and-contracts.md)

## 1. 心智模型

Tab 不是固定文件，而是一条独立浏览会话。

~~~text
DocumentSession 1 ─────┬─ DocumentView A in Tab A
                      └─ DocumentView B in Tab B / Pane B

Tab A history: 导航页 → 架构文档 → MQ 文档
Tab B history: 搜索结果 → 同一架构文档#某标题
~~~

内容状态属于 DocumentSession；历史属于 Tab；光标和滚动属于 DocumentView 或 `NavEntry.viewState`。

## 2. ResourceRouter

所有打开行为统一进入：

~~~ts
type OpenDisposition =
  | "current"
  | "newForegroundTab"
  | "newBackgroundTab"
  | "splitRight"

interface NavigateIntent {
  target: ResourceRef | UnresolvedLink
  disposition: OpenDisposition
  source: NavigationSource
  originTabId?: TabId
  originViewId?: DocumentViewId
}
~~~

上述名称与字段以第 03 章为 canonical contract；本章不得建立第二套 `NavigateRequest`。Peek 使用第 03 章的独立 `PreviewIntent`，不是新的 disposition。

禁止：

- 内部链接直接赋值 window.location。
- 组件自行创建 Tab。
- 插件绕过路由器打开文件。
- 外部 URL 在有本地权限的主 WebView 中加载。

## 3. 默认点击矩阵

| 操作 | 行为 |
|---|---|
| 单击本地 Markdown 链接 | 当前 Tab 跳转并压入历史 |
| Cmd/Ctrl + 单击 | 后台新 Tab |
| Cmd/Ctrl + Shift + 单击 | 前台新 Tab |
| 中键 | 后台新 Tab |
| 单击 heading anchor | 当前 Tab 跳转并压入历史 |
| 右键 | 当前、新 Tab、Peek、右分栏、定位、复制链接 |
| 单击外部 http/https | 交给系统浏览器 |
| 编辑态单击链接源码 | 仅移动光标 |
| 编辑态 Cmd/Ctrl+Enter | 打开链接 |

文件树、正文链接、Outline、搜索结果和反向链接必须复用同一矩阵。

## 4. 历史模型

每个 Tab 拥有：

- `history.entries`：有序 NavEntry 列表。
- `history.index`：当前历史位置。
- `navigationEpoch`：导航世代，用于拒绝迟到结果。

P1 关闭时间只属于 `WindowStateSnapshotV1.recentlyClosedTabs[].closedAt`，不是每个活动 Tab 的第二套字段。

导航规则：

1. 当前 entry 先保存 `viewState`。
2. 普通新导航截断 `history.index` 之后的 forward entries。
3. 创建目标 entry 并异步解析资源。
4. 目标准备完成后绑定 DocumentView。
5. goBack 和 goForward 只移动 index，不创建新 entry。
6. 当前目标与新目标完全相同且没有新 anchor 时不重复压栈。
7. 滚动、光标移动、查找下一个仅更新当前 `NavEntry.viewState`。

## 5. 位置恢复

不能只存绝对 scrollTop。图片、表格和 Mermaid 异步布局会改变高度。

持久化结构必须直接使用第 03 章的 ViewState、ScrollAnchor 和 BlockLocator；本章不得定义第二套 resume 类型。selection 使用源码 anchor/head，scroll.topBlock 保存 BlockLocator，yWithinBlock 保存块内像素偏移，foldedRanges 保存带可选 fingerprint 的源码范围。

BlockLocator 使用多级回退：

1. headingPath + fingerprint。
2. sourceOffset/sourceLine 附近的相同 syntaxKind。
3. sourceOffset。
4. fallbackScrollTop。

恢复分两阶段：

1. 文本加载后恢复选择和大致顶部块。
2. 可见 Widget 布局稳定后按 `ScrollAnchor.yWithinBlock` 校正一次。

## 6. 链接解析

### 6.1 支持

- 相对和工作区内绝对 Markdown 路径。
- 文件名含中文、空格和百分号编码。
- file.md#heading 和当前文件 #heading。
- 重复标题 slug 序号。
- 显式 HTML anchor 的受限兼容。
- P1 Wiki link 和文件 ID 链接。

### 6.2 解析顺序

1. 解析 URL scheme。
2. 百分号解码。
3. 按来源文档目录解析相对路径。
4. 规范化路径但保留展示形式。
5. 解析符号链接后的实际目标。
6. 校验工作区和 capability。
7. 解析扩展名省略规则。
8. 解析 anchor。

### 6.3 失效链接

显示明确错误页，不静默创建文件。错误页提供：

- 在工作区搜索可能目标。
- 手动 Locate。
- 修复当前链接。
- 用户确认后创建新文档。
- 返回上一页。

## 7. Tab 生命周期

- 新 Tab 默认显示最近文档和工作区 Quick Open。
- 空 Tab 第一次导航不保留空白历史。
- 关闭当前 Tab 后优先激活最近使用的相关 Tab；没有记录时依次选择左侧、右侧邻居。
- P1 恢复关闭 Tab 时从 `WindowStateSnapshotV1.recentlyClosedTabs` 恢复完整 `NavigationHistory` 和每项 `viewState`。
- 同一文件已在其他 Tab 打开时仍按 disposition 创建新浏览上下文，但复用 DocumentSession。
- Tab 标题显示当前资源标题；tooltip 显示完整位置。
- 固定 Tab 只影响关闭行为，不改变链接打开规则。

一个 Tauri Window 只有一个前端应用。Tab 不创建独立 WebView。非活动 Tab 保留轻量状态；DocumentSession 按引用和 dirty 状态管理；重型 EditorView 可以销毁后按 ViewState 恢复。

## 8. dirty 文档

- 导航离开 dirty 文档不弹保存框。
- dirty 状态属于 DocumentSession，并在所有引用它的 Tab、文件树和全局未保存列表中同步。
- 即使引用它的 Tab 暂时导航到其他页面，Session 仍保留。
- 已保存文件关闭最后一个可达 View 不等于丢弃；dirty session 进入全局“未保存文档”列表并 checkpoint。
- 未命名 draft 关闭最后一个 View，以及关闭工作区/应用时，按第 01/06 章统一确认。
- 退出、关闭工作区或明确丢弃时统一处理。

## 9. Peek

P1 Peek 是短暂只读资源视图：

- 对聚焦链接或文件按住 Space 打开。
- 松开 Space 或 Esc 关闭。
- Enter 提交到当前 Tab。
- Cmd/Ctrl+Enter 在新 Tab 打开。
- Peek 不进入历史、不允许编辑、不建立长期 DocumentView。
- 默认只加载目标标题附近的有限上下文。

## 10. 分栏

P1 PaneLayout 只建模左右两个 TabGroup：

~~~ts
interface PaneLayoutV1 {
  left: { paneId: PaneId; tabGroupId: string; activeTabId?: TabId }
  right?: { paneId: PaneId; tabGroupId: string; activeTabId?: TabId }
  ratio?: number
  focusedPaneId: PaneId
}
~~~

每个 Pane 有独立 TabGroup 和 activeTabId。splitRight 在没有右栏时创建右栏，已有右栏时复用其 TabGroup；只创建新 View，不改变来源 Tab 历史。P1 禁止嵌套 split 和 splitDown；P2 若要开放任意树必须先更新产品规格、持久化 schema 和契约。

## 11. 异步与竞态

- 每次导航递增 Tab 的 `navigationEpoch` 并创建 AbortController；结果落地前必须同时匹配 `tabId + navigationEpoch`。
- 用户开始更新导航后，旧加载结果即使完成也只能进入缓存，不能覆盖当前页面。
- 资源加载错误绑定到对应 NavEntry，不影响 Tab 其余历史。
- 外部文件变化到达时由 DocumentSession 处理，不由 NavEntry 直接刷新。
- 后退到安全模式文件时仍重新预检，不信任历史缓存。

## 12. 会话持久化（P1）

会话文件只保存：

- Window、Pane 和 Tab 布局。
- `ResourceRef`、`NavigationHistory.entries/index` 和 `recentlyClosedTabs`。
- `NavEntry.viewState`。
- 当前工作区和 UI 状态。

不保存完整干净文档文本。P0 dirty 内容始终进入独立恢复快照/journal，不依赖本 P1 窗口快照。

持久化防抖后原子写入；恢复时先显示应用 Shell，再懒加载当前资源，后台 history 不预加载。

## 13. 外链安全

- http、https、mailto 默认交给系统应用。
- javascript、data、vbscript、shell 等 scheme 拒绝。
- file 或工作区外路径需要明确确认和 capability。
- 可执行文件仅允许在文件管理器定位，不直接运行。
- 未来内置网页资源必须运行在无 Tauri IPC、无文件权限的隔离 WebView。

## 14. 验收

### 14.1 P0

1. 从导航页进入目标后，Back 回到原链接的阅读位置。
2. 每个 Tab 的 back/forward 相互独立。
3. 后退后新导航正确清空 forward 分支。
4. Cmd/Ctrl+Click、中键和上下文菜单行为跨入口一致。
5. 同一文件两个 Tab 编辑时内容同步、选择独立。
6. 慢加载迟到结果不能覆盖更新目标。
7. 中文路径、空格、相对路径、重复标题和坏链接均有测试。
8. 外部链接不能获得本地应用能力。

### 14.2 P1

1. 关闭和恢复 Tab 后完整 `NavigationHistory` 与每项 `viewState` 不变。
