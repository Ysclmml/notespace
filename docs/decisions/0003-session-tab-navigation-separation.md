# ADR-0003：文档、Tab 与导航历史分离

状态：Accepted  
日期：2026-08-29

## 决策

DocumentSession、DocumentView、Tab、NavEntry 是不同领域对象。

- DocumentSession：共享文本、revision、保存和 dirty 状态。
- DocumentView：某个 Pane 中的光标、选择、折叠和滚动。
- Tab：独立浏览会话。
- NavEntry：Tab 历史中的资源目标与恢复状态。

## 背景与原因

- 同一文件可在多个 Tab 或分栏中显示而不产生多个可编辑副本。
- 每个 Tab 可以拥有浏览器式独立前进后退。
- dirty 文档即使不在当前页面也能安全保留。
- 搜索、图谱、Git 和 AI 页面可作为 virtual Resource provider 进入相同导航系统。

## 后果与代价

- 多 View 需要 revision 和 ChangeSet 同步。
- 会话恢复比“一 Tab 一文件”复杂。
- dirty 状态不能只显示在当前 Tab，需要全局文档状态。

## 备选与被拒绝方案

- 一 Tab 一文件一 buffer：实现简单，但同文件多 Tab 会分叉正文，无法同时满足共享 dirty 与独立历史。
- 全局浏览历史：不符合浏览器心智，多个 Tab 会互相污染 back/forward。
- NavEntry 保存正文快照：恢复简单但内存不可控，并混淆编辑 Undo 与浏览历史。
- 每 Tab 一个 WebView：隔离强但内存、IPC、IME 和共享会话同步成本过高。

## 迁移与回滚

- P0 从一开始使用分离模型，不创建需要后续迁移的一 Tab 一 buffer 格式。
- 持久化窗口状态带 schemaVersion；无法迁移的旧 Tab/历史摘要可以丢弃并回到 Quick Open，但 dirty recovery 绝不能随之丢弃。
- P1 分栏只增加 DocumentView 和 TabGroup，不改变 DocumentSession 或 NavEntry。
- 若位置恢复算法退化，可回滚到较粗 BlockLocator/fallbackScrollTop，不得合并 Undo 与导航历史。

## 安全与数据影响

- NavEntry、Tab 和窗口状态禁止保存正文、恢复内容或完整绝对路径。
- dirty DocumentSession 在无可见 View 时仍受 checkpoint 和显式丢弃规则保护。
- 过期异步导航必须校验 tabId/navigationEpoch，避免错误资源覆盖当前视图。

## 受影响契约

- NAV-MODEL-001、NAV-HISTORY-001、NAV-RESTORE-001、NAV-ASYNC-001。
- DOM-INV-001 至 DOM-INV-018 中的 session/identity 规则。
- docs/design/05-navigation-tabs.md 和 P1 window-state schema。

## 验证

- NAV-CORE-001、NAV-CORE-002。
- HISTORY-001、HISTORY-RESTORE-001、NAV-DISP-001。
- AC-NAV-001、AC-NAV-003、AC-NAV-004。
