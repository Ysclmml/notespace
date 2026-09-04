# ADR-0023：Debug 局域网无配对只读共享

- 状态：Accepted
- 日期：2026-09-04
- 取代范围：仅取代 ADR-0022 对开发期纵向原型的“一次性口令/配对”要求；ADR-0022 的移动阅读形态、只读、所选根、磁盘正文和未来正式发布门槛继续有效。

## 背景

当前目标是尽快让一台电脑上的 NoteSpace 工作区能被同一局域网中的多个 NoteSpace Mobile 实例真实浏览，用真机验证发现、连接、目录、正文和搜索体验。这个阶段不准备验证设备身份或加密传输；扫码、校验码、电脑批准、令牌、证书和撤销界面会干扰最短纵向链路。

“不做网络认证”不等于“允许任意文件路径”。桌面端仍然只能暴露用户本次明确勾选的已打开工作区；客户端仍只消费 opaque ID，服务仍必须阻止根外路径、符号链接、隐藏项、设备文件和超限读取。否则实现错误会把无认证局域网服务扩展成整机文件服务，偏离只读 Markdown 浏览目标。

## 决策

### 当前 Debug 原型

- 桌面端增加「移动访问」入口。共享默认关闭；用户勾选至少一个当前已打开工作区并明确启动后，才监听 `0.0.0.0` 的随机端口。停止共享、退出桌面应用或重新启动应用都会结束本次服务，不在后台常驻。
- 传输使用无认证的 HTTP/JSON，固定前缀 `/api/v1`。不启用 TLS、证书、密码、一次性口令、二维码、设备批准、bearer token 或设备数量白名单；既有 `PairingState` 在此原型中不进入命令、UI 或 HTTP 路由。
- 服务以 `_notespace._tcp.local.` 通过 mDNS/DNS-SD 发布名称、运行期实例 ID、协议版本和端口。Android App 自动发现同网电脑，同时保留 `host:port` 手动地址，便于 mDNS 不可用或模拟器使用 `10.0.2.2` 时调试。
- 多个手机可同时访问同一个桌面服务。请求无会话写状态，HTTP 监听器允许并发连接，并在桌面状态中显示当前活跃客户端数量；一个客户端断开不影响其他客户端。
- HTTP 只提供状态、工作区、单层目录、Markdown 正文、有限全文搜索、文档内本地资源解析和资源读取；收藏暂返回空投影。没有保存、上传、创建、重命名、删除、任意命令或客户端路径参数。
- 响应使用 `protocolVersion: 1` 包装；公开数据只含工作区名称、根内相对路径和 opaque ID。正文始终重新读取电脑磁盘，未保存编辑、模板、最近记录、设置和绝对路径不进入协议。
- Android Debug 允许明文流量并申请 mDNS 所需的普通网络/多播权限；WebView 只把 HTTP 当数据传输，不从电脑加载页面或执行服务端 HTML/JavaScript。

### 仍然保留的基础边界

- 桌面必须由用户本次手动开启，并且只共享本次明确勾选的已打开根；空选择不能启动。
- 服务继续使用 `LanShareRegistry` 的稳定目录句柄、真实根复核、no-follow 打开、类型过滤和文件/字节/深度/结果预算。移动端没有文件写接口。
- 错误、日志、mDNS TXT 和状态响应不返回电脑绝对路径或正文片段。关闭服务后旧 workspace/document/asset ID 全部失效。
- 这些是功能边界和误操作保护，不是对同网设备的身份认证。界面必须持续显示“Debug、无认证、同网设备可读取所选内容”的提示。

### 编译与发布边界

- 无认证桌面监听、mDNS 发布、移动真实 HTTP transport 和 Android 明文流量只在 Debug 构建启用。Release 的启动命令必须拒绝运行，桌面不显示可启动入口，Android Release 保持明文流量关闭。
- 本决策不把无认证 HTTP 变成正式发布方案，也不删除 ADR-0022 的未来安全路线。若要向普通用户发布真实共享，仍须另行恢复并验收加密、电脑身份和设备授权；在此之前只能分发明确标记的本地 Debug 包。

## 接口

```text
GET  /api/v1/status
GET  /api/v1/workspaces
GET  /api/v1/workspaces/{workspaceId}/directories/root
GET  /api/v1/workspaces/{workspaceId}/directories/{directoryId}
GET  /api/v1/documents/{documentId}
POST /api/v1/search
POST /api/v1/assets/resolve
GET  /api/v1/assets/{assetId}
GET  /api/v1/favorites
```

JSON 成功响应为 `{ "protocolVersion": 1, "data": ... }`，失败响应为 `{ "protocolVersion": 1, "error": { "code", "message" } }`。Debug 服务允许 Android WebView 的跨源请求和 `OPTIONS` 预检。

## 验证

- Rust 临时目录测试覆盖启动/停止、随机端口、多客户端并发、目录/正文/搜索/资源、CORS/预检、错误包装，以及旧 ID 在重启后失效。
- 既有根外、符号链接、隐藏项、FIFO、根替换、文档/资源/搜索预算测试继续通过；无认证不能绕过这些边界。
- TypeScript 以模拟 HTTP 验证地址规范化、超时、协议版本、错误映射和断线保留；原生自动发现失败时手动地址仍可用。
- Android Debug 合并清单必须为 `usesCleartextTraffic=true` 并包含 Internet/mDNS 权限；Release 合并清单必须保持明文关闭。模拟器用 `10.0.2.2:<port>` 验证手动连接，真实 Android 手机用于最终 mDNS/同 Wi-Fi/多手机并发验收。

## 结果

该决策把当前工作压缩成可真实使用的局域网阅读纵向链路，便于先验证产品体验和 Android 网络环境。代价是同网设备在服务开启期间无需许可即可读取被勾选工作区，所以它只能存在于显著标记的 Debug 构建，不能被误称为正式安全共享。
