# ClawOS 浏览器控制集成 — 设计与实现

## 背景

OpenClaw 是一个 AI 驱动的命令行工具，内置了 `browser` 工具，可以通过 Chrome DevTools Protocol (CDP) 控制 Chromium 浏览器。在桌面环境中，OpenClaw 可以启动本地 Chrome 并通过 CDP 进行自动化操控。

然而在 ClawOS Android 环境中，没有桌面 Chrome 可用。我们需要利用 Android 系统自带的 **WebView** 组件作为浏览器引擎，并让 OpenClaw 通过 CDP 控制它。

## 核心挑战

1. **Android WebView 的 CDP 端点是 Unix 抽象 socket**，格式为 `@webview_devtools_remote_<PID>`，不能被 Playwright/Puppeteer 等 Node.js 库直接连接（它们需要 TCP 端点）。

2. **WebView 的 CDP 实现不完整** — 不支持 `Browser.setDownloadBehavior`、`Target.createTarget`、`Target.setAutoAttach` 等 Playwright 依赖的命令，直接连接会失败。

3. **需要在开机时自动启动**浏览器，但不能抢占 ClawOS Launcher 的前台位置。

## 架构设计

```
AI Agent ──→ OpenClaw Gateway ──→ Playwright
                                       │
                                       ▼
                              CDP Shim (port 9223)
                              Session Multiplexing
                                       │
                                       ▼
                             CdpProxyService (port 9222)
                             TCP → Unix Socket Proxy
                                       │
                                       ▼
                              Android WebView (CDP)
                              @webview_devtools_remote_<PID>
```

### 四层代理架构

| 层 | 组件 | 技术 | 作用 |
|---|---|---|---|
| **1** | `BrowserActivity` | Android Activity + WebView | 宿主 WebView 实例，启用 CDP 调试 |
| **2** | `CdpProxyService` | Java TCP Server | Unix 抽象 socket → TCP (localhost:9222) |
| **3** | `cdp-shim.mjs` | Node.js WebSocket Proxy | 拦截 Playwright 不兼容的 CDP 命令，实现 session multiplexing (localhost:9223) |
| **4** | OpenClaw Gateway | Playwright `connectOverCDP` | 通过标准 Playwright API 控制浏览器 |

## CDP Shim 详细设计

`cdp-shim.mjs` 是本次集成的核心创新组件。它解决了 Android WebView CDP 与 Playwright 之间的兼容性问题。

### 拦截的 CDP 命令

| 命令 | WebView 行为 | Shim 处理方式 |
|---|---|---|
| `Browser.setDownloadBehavior` | 不支持，报错 | 返回空成功 `{}` |
| `Target.createTarget` | 不支持 | 返回已有 page 的 targetId + 触发 `attachedToTarget` |
| `Target.setAutoAttach` | 不支持 | 枚举所有 page targets，建立 session 连接，发射 `attachedToTarget` 事件 |
| `Target.getTargetInfo` | 不支持 | 从 `/json/list` 获取信息并返回（含 `browserContextId`） |
| `Browser.getWindowForTarget` | 不支持 | 返回固定窗口尺寸 |
| `Browser.getBrowserContexts` | 不支持 | 返回空 `browserContexts` 数组 |
| `Browser.createBrowserContext` | 不支持 | 返回默认 context ID |
| `Browser.setWindowBounds` | 不支持 | 返回空成功 |
| `Target.setDiscoverTargets` | 不支持 | 返回空成功 |
| `Target.activateTarget` | 不支持 | 返回空成功 |
| `Target.closeTarget` | 不支持 | 返回 `success: true` |
| `Target.attachToTarget` | 不支持 | 建立 page session 并返回 sessionId |
| `Target.detachFromTarget` | 不支持 | 关闭对应 page session |

### Session Multiplexing

Playwright 使用 "flat session" 模式：所有命令通过单个 browser WebSocket 发送，用 `sessionId` 区分不同 page。但 WebView 只提供独立的 per-page WebSocket 端点。

Shim 的解决方案：
- 为每个 page target 建立独立的 WebSocket 连接 (`/devtools/page/<id>`)
- 客户端发送带 `sessionId` 的命令 → Shim 路由到对应的 page WebSocket（去掉 sessionId）
- Page 响应 → Shim 添加 `sessionId` 后转发给客户端

### 关键时序

Playwright 的 `connectOverCDP` 期望 `Target.attachedToTarget` 事件在 `Target.setAutoAttach` 响应**之前**到达。Shim 严格遵循这个时序：

1. 收到 `Target.setAutoAttach` 请求
2. 获取所有 page targets (`/json/list`)
3. 并行建立所有 page session WebSocket
4. 发射 `Target.attachedToTarget` 事件（带 `browserContextId: "CLAWOS_DEFAULT_CONTEXT"`）
5. **最后**才发送 `setAutoAttach` 的成功响应

这个时序保证了 Playwright 在收到 `setAutoAttach` 确认前已经发现了所有存在的 page。

### browserContextId

Playwright 内部断言 `browserContextId` 不能为空字符串。WebView 的 CDP 不提供这个字段。Shim 在所有涉及 targetInfo 的响应中注入 `browserContextId: "CLAWOS_DEFAULT_CONTEXT"`。

## 开机启动流程

在 `start-gateway.sh` 中实现了分步延迟启动：

```
sys.boot_completed=1
        │
        ▼
[init.clawos.rc] start clawos_gateway
        │
        ▼
[start-gateway.sh]
  1. 首次启动: 解压 gateway bundle
  2. 部署配置 (openclaw.json, auth-profiles.json)
  3. 部署 cdp-shim.mjs 和 AGENTS.md
  4. 启动 OpenClaw Gateway (前台进程)
  5. 后台子进程:
     └─ sleep 20s (等待 Launcher 稳定)
     └─ am start BrowserActivity --ez background true
     └─ sleep 2s → input keyevent KEYCODE_HOME (强制回到 Launcher)
     └─ sleep 2s → 启动 cdp-shim.mjs
```

### BrowserActivity 后台模式

`BrowserActivity` 支持 `background=true` intent extra：
- 加载 `about:blank`（不耗费网络）
- 500ms 后调用 `moveTaskToBack(true)` 移到后台
- 配合启动脚本发送的 `KEYCODE_HOME` 确保 Launcher 保持前台
- WebView 和 CdpProxyService 在后台持续运行，CDP 端点保持可用

### 配置升级逻辑

`start-gateway.sh` 包含智能升级机制：
- 如果已有 `openclaw.json` 不含 `"browser"` 配置，自动从 ROM 默认配置覆盖
- `AGENTS.md` 每次启动都从 ROM 更新（确保 AI 始终有最新指令）
- `cdp-shim.mjs` 仅在不存在时部署（避免覆盖可能的自定义修改）

## OpenClaw 配置增强

在 `openclaw.json` 中新增 `browser` 配置块：

```json
"browser": {
  "enabled": true,
  "attachOnly": true,
  "cdpUrl": "http://127.0.0.1:9223",
  "defaultProfile": "openclaw",
  "profiles": {
    "openclaw": {
      "cdpUrl": "http://127.0.0.1:9223",
      "color": "22d3ee"
    }
  }
}
```

| 字段 | 说明 |
|---|---|
| `enabled: true` | 激活 browser 工具 |
| `attachOnly: true` | 不尝试启动 Chrome，只连接已有 CDP 端点 |
| `cdpUrl` | CDP Shim 地址（顶层 legacy 兼容 + profile 级别） |
| `defaultProfile: "openclaw"` | AI 默认使用 openclaw profile 而非 Chrome 扩展 |
| `color: "22d3ee"` | Profile 标识色（ClawOS 青色，Zod schema 必填字段） |

## AI 系统上下文 (AGENTS.md)

在 workspace 目录 (`/data/local/clawos/workspace/`) 部署 `AGENTS.md`，告知 AI：

- 运行在 ClawOS Android 上，不是桌面环境
- 浏览器是 Android WebView (Chrome 91 引擎)
- **必须**使用 `profile="openclaw"` 操控浏览器（不存在 Chrome 扩展）
- 可用操作：navigate、snapshot、screenshot、act（click/type/scroll）、tabs、open、status 等
- Google 搜索在模拟器中可能不可用，建议使用百度或 Bing
- 始终用中文与用户交流

## 文件清单

| 状态 | 文件 | 说明 |
|---|---|---|
| **新增** | `aosp/device/clawos/gateway/cdp-shim.mjs` | CDP Session Multiplexing Proxy (467 行) |
| **新增** | `aosp/device/clawos/gateway/AGENTS.md` | AI 系统上下文提示 |
| **新增** | `ui/android/.../browser/BrowserActivity.java` | WebView 宿主 Activity (含后台模式) |
| **新增** | `ui/android/.../browser/CdpProxyService.java` | TCP→Unix Socket CDP 代理服务 |
| **修改** | `aosp/device/clawos/gateway/openclaw-default.json` | 添加 browser 配置 |
| **修改** | `aosp/device/clawos/gateway/start-gateway.sh` | 添加 CDP 启动流程和配置升级 |
| **修改** | `aosp/device/clawos/clawos_arm64.mk` | PRODUCT_COPY_FILES 添加新文件 |
| **修改** | `ui/android/app/src/main/AndroidManifest.xml` | 注册 BrowserActivity 和 CdpProxyService |

## 已验证能力

| 测试项 | 结果 |
|---|---|
| CDP 端点可达 (`/json/version`) | ✓ Chrome/91.0.4472.114 |
| Playwright `connectOverCDP` via Shim | ✓ |
| 页面导航 (`page.goto`) | ✓ |
| DOM 读取 (`page.$eval`) | ✓ |
| 截图 (`page.screenshot`) | ✓ |
| JavaScript 执行 (`page.evaluate`) | ✓ |
| 元素点击 (`page.click`) | ✓ |
| 链接跳转追踪 | ✓ |
| OpenClaw AI 百度搜索 | ✓ |

## 已知限制

- **WebView 引擎版本**: Chrome 91（2021 年），部分现代 Web API 可能不支持
- **单 WebView 实例**: 同一时间只有一个主浏览器标签页可靠运行
- **不支持文件下载**: WebView 不支持文件下载到设备
- **Google 搜索**: 模拟器环境中可能触发安全验证，建议使用替代搜索引擎
- **启动延迟**: BrowserActivity 在开机后约 20 秒才启动，CDP 端点约 24 秒后可用
