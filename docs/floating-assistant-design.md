# ClawOS 悬浮 AI 助理 — 设计与实现文档

> **文档版本**: 1.2  
> **日期**: 2026-02-14  
> **状态**: Phase 1A + 1B 已实现, Phase 2 / 3 待实现

---

## 1. 背景与目标

### 1.1 问题

ClawOS 当前作为 Android Launcher 运行，用户在全屏 UI 中与 AI 对话。当 AI 通过 OpenClaw 打开第三方 App（浏览器、抖音等），界面完全切换到该 App，用户失去 AI 辅助能力，只能手动操作。

### 1.2 目标

实现**全程 AI 助理**功能：

1. **悬浮对话窗口** — 无论用户处于哪个 App，始终有一个精简的 AI 对话界面悬浮在最前面
2. **文字 + 语音输入** — 用户可以随时通过文字或语音告诉 AI 需求
3. **AI 操控 App** — AI 通过 OpenClaw 工具链代替用户操控 App（点击、滑动、输入等）

---

## 2. 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                      ClawOS ROM (AOSP 12)                        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              系统级服务层 (始终运行)                         │  │
│  │  ┌──────────────────────┐  ┌───────────────────────────┐  │  │
│  │  │  OpenClaw Gateway    │  │  ClawOS A11yService       │  │  │
│  │  │  (Node.js :18789)    │  │  (AccessibilityService)   │  │  │
│  │  │  · LLM 通信          │  │  · 屏幕 UI 树读取          │  │  │
│  │  │  · 工具调用           │  │  · 操作执行 (点击/滑动)    │  │  │
│  │  │  · WebSocket 协议 v3  │  │  · 截图                   │  │  │
│  │  └──────────┬───────────┘  └───────────────────────────┘  │  │
│  └─────────────┼──────────────────────────────────────────────┘  │
│                │ WebSocket                                       │
│  ┌─────────────┼──────────────────────────────────────────────┐  │
│  │             │     悬浮层 (TYPE_APPLICATION_OVERLAY)          │  │
│  │  ┌──────────┴───────────┐                                  │  │
│  │  │ ClawOSFloatingService │ ← 前台 Service, 管理所有悬浮窗   │  │
│  │  │  ┌─────────────────┐ │                                  │  │
│  │  │  │ FloatingBubble  │ │ ← 56dp 可拖拽圆形气泡             │  │
│  │  │  └────────┬────────┘ │                                  │  │
│  │  │           │ 点击      │                                  │  │
│  │  │  ┌────────┴────────┐ │                                  │  │
│  │  │  │ FloatingChat    │ │ ← 320×480dp 迷你对话面板          │  │
│  │  │  │ · 消息列表       │ │                                  │  │
│  │  │  │ · 输入框 + 🎤    │ │                                  │  │
│  │  │  │ · 流式 AI 回复   │ │                                  │  │
│  │  │  └─────────────────┘ │                                  │  │
│  │  └──────────────────────┘                                  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    用户 App 层                              │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │  │
│  │  │ ClawOS   │  │ 浏览器   │  │  抖音    │  │  其他    │  │  │
│  │  │ Launcher │  │          │  │          │  │  App     │  │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                         ↕ 云端 LLM API
               (Gemini 3 Flash / Claude Opus)
```

### 2.1 关键交互流程

```
用户 → 点击悬浮气泡 → 展开迷你对话面板
用户 → "帮我在抖音搜索猫咪视频"
FloatingChatView → FloatingGatewayClient → Gateway (WebSocket)
Gateway → LLM → Tool Call: android_launch("com.ss.android.ugc.aweme")
Gateway → A11yService → 启动抖音
LLM → Tool Call: android_tap(搜索框), android_type("猫咪视频")
A11yService → 操控抖音 UI
Gateway → FloatingChatView → "已为你搜索猫咪视频"
```

---

## 3. 分阶段实施方案

### Phase 1A: 悬浮气泡 + 基础对话 ✅ 已完成

> 核心: 让 AI 对话界面在任何 App 上方持续可见

| 组件 | 技术选型 | 状态 |
|------|----------|------|
| 悬浮窗口 | `Service` + `WindowManager` + `TYPE_APPLICATION_OVERLAY` | ✅ |
| 对话 UI | 原生 Android View (programmatic, 非 XML 布局) | ✅ |
| Gateway 通信 | OkHttp 4.12 WebSocket Client (Java) | ✅ |
| 生命周期 | 前台 Service + Notification | ✅ |
| 显隐控制 | Launcher 在前台→隐藏, 切到其他 App→显示 | ✅ |
| AOSP 镜像 | 已构建并打包 `emu_img_zip` (823MB) | ✅ |

### Phase 1B: 语音集成 ✅ 已完成

| 组件 | 技术选型 | 状态 |
|------|----------|------|
| STT 引擎抽取 | `SherpaSTTEngine.java` — 独立可复用模块 (从 ClawOSVoice 抽取) | ✅ |
| TTS 引擎抽取 | `SherpaTTSEngine.java` — 独立可复用模块 (从 ClawOSVoice 抽取) | ✅ |
| Capacitor 插件重构 | `ClawOSVoice.java` 改为委托调用抽取的引擎 | ✅ |
| 悬浮面板麦克风按钮 | `FloatingChatView` 输入栏添加 🎤 按钮, 点击切换录音状态 | ✅ |
| 悬浮面板 STT 集成 | `ClawOSFloatingService` → `SherpaSTTEngine` → partial/final → 输入框 | ✅ |
| 悬浮面板 TTS 集成 | AI final 消息自动朗读 (≤500 字), 可通过 `ttsEnabled` 开关 | ✅ |

### Phase 2: AI 操控 App ⏳ 待实现

| 子阶段 | 方案 | 说明 |
|--------|------|------|
| **2A (快速验证)** | Shell 命令 | `input tap x y`, `input text`, `am start` — 通过 Gateway 的 `child_process.exec` 调用 |
| **2B (完整方案)** | AccessibilityService | `getRootInActiveWindow()` 获取 UI 树 + `performAction()` 执行操作 |

**Phase 2B 详细设计**:

- 新增 `ClawOSA11yService.java` — 注册为 AccessibilityService
- 新增 `A11yBridge.java` — A11yService ↔ Gateway 本地通信桥
- init.clawos.rc 添加自动启用 Accessibility 的 system property
- Gateway 注册自定义 Tool: `android_tap`, `android_swipe`, `android_type`, `android_back`, `android_home`
- LLM 通过 Tool Call 驱动操控

### Phase 3: 视觉理解增强 ⏳ 待实现

| 能力 | 实现方式 |
|------|----------|
| 屏幕理解 | 截图 → Gemini Vision API → UI 元素语义描述 |
| 智能操控 | LLM 规划多步操作序列 → 逐步执行 + 验证 |
| 操作确认 | 关键操作 (支付/授权) 弹出悬浮确认框 |

---

## 4. Phase 1A 实现详情

### 4.1 文件清单

#### 新增文件 (5 个, 共 1430 行)

| 文件 | 行数 | 所在包 | 职责 |
|------|------|--------|------|
| [`GatewayProtocol.java`](file:///opt/ClawOS/ui/android/app/src/main/java/com/clawos/gateway/GatewayProtocol.java) | 157 | `com.clawos.gateway` | Gateway v3 协议帧构造与解析 |
| [`FloatingGatewayClient.java`](file:///opt/ClawOS/ui/android/app/src/main/java/com/clawos/gateway/FloatingGatewayClient.java) | 359 | `com.clawos.gateway` | OkHttp WebSocket 客户端, 复用 Gateway 协议 |
| [`ClawOSFloatingService.java`](file:///opt/ClawOS/ui/android/app/src/main/java/com/clawos/services/ClawOSFloatingService.java) | 351 | `com.clawos.services` | 前台 Service, 管理悬浮窗生命周期 |
| [`FloatingBubbleView.java`](file:///opt/ClawOS/ui/android/app/src/main/java/com/clawos/views/FloatingBubbleView.java) | 149 | `com.clawos.views` | 56dp 圆形悬浮气泡 (Canvas 自绘) |
| [`FloatingChatView.java`](file:///opt/ClawOS/ui/android/app/src/main/java/com/clawos/views/FloatingChatView.java) | 414 | `com.clawos.views` | 320×480dp 迷你对话面板 |

#### 修改文件 (3 个)

| 文件 | 变更 |
|------|------|
| [`AndroidManifest.xml`](file:///opt/ClawOS/ui/android/app/src/main/AndroidManifest.xml) | +权限 `SYSTEM_ALERT_WINDOW`, `FOREGROUND_SERVICE`; +Service 声明 |
| [`build.gradle`](file:///opt/ClawOS/ui/android/app/build.gradle) | +`com.squareup.okhttp3:okhttp:4.12.0` |
| [`MainActivity.java`](file:///opt/ClawOS/ui/android/app/src/main/java/com/clawos/app/MainActivity.java) | +启动悬浮服务, +`onResume`(hide)/`onPause`(show) |

### 4.2 包结构

```
com.clawos/
├── app/
│   └── MainActivity.java          # Capacitor 主 Activity + 悬浮服务管理
├── gateway/                        # [NEW] Gateway 通信层
│   ├── GatewayProtocol.java       # 协议帧定义
│   └── FloatingGatewayClient.java # WebSocket 客户端
├── services/                       # [NEW] 系统服务
│   └── ClawOSFloatingService.java # 悬浮窗前台服务
├── views/                          # [NEW] 悬浮窗 UI
│   ├── FloatingBubbleView.java    # 气泡 View
│   └── FloatingChatView.java      # 对话面板 View
└── plugins/
    ├── ClawOSBridge.java          # (已有) 系统信息桥接
    └── ClawOSVoice.java           # (已有) 语音 Capacitor 插件
```

### 4.3 核心组件设计

#### 4.3.1 ClawOSFloatingService

**前台服务**, 管理悬浮窗的显示、隐藏和交互。

**状态机**:
```
HIDDEN ←→ BUBBLE ←→ EXPANDED
  ▲                      │
  │  Launcher onResume   │ Launcher onPause
  └──────────────────────┘
```

- `HIDDEN`: Launcher 在前台时, 不需要悬浮窗 (全屏 ClawOS UI 已有对话能力)
- `BUBBLE`: 仅显示 56dp 圆形气泡, 可拖拽至任意位置, **松手自动吸附最近屏幕边缘** (OvershootInterpolator 弹性动画, 250ms)
- `EXPANDED`: 气泡展开为 320×480dp 对话面板

**关键实现**:
- `WindowManager.addView()` 添加 `TYPE_APPLICATION_OVERLAY` 窗口
- `FLAG_NOT_FOCUSABLE` (气泡) / `FLAG_NOT_TOUCH_MODAL` (面板) 控制焦点
- 通过 `Intent action` (`ACTION_SHOW`/`ACTION_HIDE`) 控制显隐
- 初始化 `FloatingGatewayClient` 连接 Gateway, 处理 `chat`/`agent` 事件
- **键盘适配**: `ViewTreeObserver.OnGlobalLayoutListener` 检测键盘高度, 自动上移聊天面板
- **聊天历史恢复**: 展开面板时调用 `chat.history` 获取之前的对话记录
- **Overlay 权限回调**: `startActivityForResult` + `onActivityResult` 完整处理权限授予流程

#### 4.3.2 FloatingGatewayClient

镜像 TypeScript `client.ts` 的 Java 实现, 使用 OkHttp WebSocket:

- **连接握手**: `connect` RPC, 发送 client info + token
- **聊天**: `chat.send`, `chat.abort`, `chat.history` RPC
- **Session 隔离**: 使用 `sessionKey: "floating"` (Launcher 使用 `"main"`), 避免流式响应冲突
- **事件**: 处理 `chat` (delta/final/error/aborted), `agent` (tool call), `connect.challenge`
- **重连**: 指数退避, 最多 10 次
- **配置**: 从 `/data/data/com.clawos.app/files/openclaw.json` 读取 token 和端口

#### 4.3.3 FloatingBubbleView

Canvas 自绘圆形气泡, 视觉设计延续 ClawOS 赛博朋克风格:

- **背景**: `#0A0F1E` 深色 + 高透明度
- **连接指示**: 边框颜色 — 青色 (已连接) / 黄色 (连接中) / 红色 (错误) / 灰色 (断开)
- **展开指示**: 展开时显示青→紫渐变光晕
- **未读角标**: 红色小圆点 + 数字 (最大 "9+")
- **拖拽**: `OnTouchListener` 处理 MOVE 事件, 10px 阈值区分点击和拖拽, **松手吸附边缘**

#### 4.3.4 FloatingChatView

全部 programmatic 布局 (无 XML), 原生 Android View:

- **Header**: 连接状态指示灯 + "ClawOS AI" 标题 + 状态文字 + 关闭按钮
- **消息区**: ScrollView + LinearLayout, 支持:
  - 用户气泡 (青色系, 右对齐)
  - AI 气泡 (紫色系, 左对齐, 支持流式追加)
  - 系统消息 (居中, 半透明)
  - 工具调用指示器 ("🔧 toolName")
- **输入栏**: EditText (圆角, 深色背景) + 发送按钮
- **气泡样式**: GradientDrawable 实现圆角 + 边框 + 半透明背景, user 和 AI 使用不同圆角组合
- **历史恢复**: 展开时支持 `clearMessages()` + 重新填充历史消息

### 4.4 设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 悬浮窗 UI 技术 | **原生 Android View** | WebView 内存占用高 (~60-100MB), 启动慢 (~1-2s), 悬浮窗兼容性差。原生 View 仅 ~5-10MB, 启动即时 |
| Gateway 通信 | **独立 Java WebSocket** | 悬浮窗与 Launcher WebView 运行在不同上下文, 需要独立连接 |
| 布局方式 | **Programmatic (无 XML)** | `TYPE_APPLICATION_OVERLAY` 窗口不依赖 Activity, 动态创建 View 更可靠 |
| 窗口类型 | `TYPE_APPLICATION_OVERLAY` | 自定义 ROM 可自动授予 `SYSTEM_ALERT_WINDOW`, 无需用户手动开启 |
| 气泡绘制 | **Canvas 自绘** | 自定义绘图效果 (渐变光晕、状态色变) 比 XML drawable 更灵活 |

### 4.5 Phase 1A 后续修复 (v1.1)

| # | 问题 | 修复 |
|---|------|------|
| 1 | `FloatingChatView.createBubble()` 内部调用 `addView`, 导致 `addBubble()` 再次 addView → `IllegalStateException: child already has a parent` | 移除 `createBubble()` 内的 `addView`, 由调用者统一负责 |
| 2 | `startFloatingService()` 请求 Overlay 权限后无回调, 用户授权后服务不会自动启动 | 改用 `startActivityForResult` + `onActivityResult` 回调启动服务 |
| 3 | 气泡拖拽松手后停留在任意位置, 视觉不整洁 | 添加 `snapBubbleToEdge()`: 松手后 `ValueAnimator` + `OvershootInterpolator` 动画吸附最近边缘 |
| 4 | 悬浮窗和 Launcher 共用 `sessionKey: "main"`, 两条 WebSocket 流式响应可能冲突 | 悬浮窗改用 `sessionKey: "floating"`, 独立会话上下文 |
| 5 | `TYPE_APPLICATION_OVERLAY` 窗口不响应系统 `SOFT_INPUT_ADJUST_RESIZE` | 添加 `ViewTreeObserver.OnGlobalLayoutListener` 监听键盘高度, 手动上移面板 |
| 6 | 面板关闭后再打开, 之前的聊天记录丢失 | 展开时调用 `chat.history` RPC 恢复历史消息 |
| 7 | `appendAiText` 创建新气泡时未 addView (createBubble 不再 addView) | 在 `appendAiText` 中创建气泡后手动 addView 到 messagesContainer |

### 4.6 构建验证

```
# Java 编译
> Task :app:compileDebugJavaWithJavac
BUILD SUCCESSFUL in 947ms

# APK 组装
BUILD SUCCESSFUL — app-debug.apk (103MB)

# AOSP 镜像构建
#### build completed successfully (45 seconds) ####
sdk-repo-linux-system-images-eng.user.zip (823MB)
```

---

## 5. Phase 1B 实现详情

### 5.1 架构重构: 语音引擎模块化

```
com.clawos.audio/                     ← [NEW] 独立音频引擎包
├── SherpaSTTEngine.java (240 行)    — 可复用 STT 引擎
└── SherpaTTSEngine.java (180 行)    — 可复用 TTS 引擎

com.clawos.plugins/
└── ClawOSVoice.java (重构)          — 改为委托调用, 代码量从 544→165 行

com.clawos.services/
└── ClawOSFloatingService.java (扩展) — +initVoice(), +startSTT/stopSTT, +speakAiResponse

com.clawos.views/
└── FloatingChatView.java (扩展)      — +micButton, +setMicActive(), +setPartialText()
```

### 5.2 STT 集成流程

```
用户点击 🎤 → FloatingChatView.toggleMic()
  → OnMicListener.onMicToggle(true)
  → ClawOSFloatingService.startSTT()
  → SherpaSTTEngine.startListening()
  → [录音循环]
  → onPartialResult("你好") → chatView.setPartialText("你好")  (输入框实时显示)
  → onFinalResult("你好世界") → chatView.setPartialText("你好世界")
  → 用户点击 ➤ 发送 或 点击 🎤 停止
```

### 5.3 TTS 集成流程

```
Gateway chat event (state="final", text="...")
  → chatView.finalizeAiMessage(runId, text)
  → ClawOSFloatingService.speakAiResponse(text)
  → SherpaTTSEngine.speak(text)  (限制 ≤500 字)
  → 音频输出
```

### 5.4 设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 引擎抽取为独立类 | `audio` 包下独立模块 | Capacitor 插件和悬浮服务都需要使用, 避免代码重复 |
| STT 不自动发送 | partial→输入框, 用户手动发送 | 给用户检查和修改的机会, 避免误发 |
| TTS ≤500 字限制 | 长文本跳过 | 避免长篇回复阻塞 TTS 队列, 用户可自行阅读 |
| `ttsEnabled` 开关 | 默认 true | 后续可通过 UI 添加开关按钮让用户控制 |
| 麦克风按钮位置 | 输入框右侧, 发送按钮左侧 | 符合常见 IM 界面布局习惯 |

---

## 6. 后续计划

### 6.1 优先级

| 优先级 | 阶段 | 预计工时 | 描述 |
|--------|------|----------|------|
| ~~P0~~ | ~~Phase 1B~~ | ~~1 天~~ | ~~语音输入/输出集成到悬浮面板~~ ✅ 已完成 |
| P0 | Phase 2A | 1-2 天 | Shell 命令操控 (`input tap`, `am start`) |
| P1 | Phase 2B | 2-3 天 | Accessibility Service 完整操控 |
| P2 | Phase 3 | 3-5 天 | 视觉理解 + 智能操控规划 |

### 6.2 当前阻塞

- **模拟器验证**: Phase 1A 代码 (含修复) 需重新构建 ROM 后在 Mac 模拟器验证悬浮窗显示效果和 Gateway 连接
- **WebSocket 并发**: Launcher (`sessionKey: "main"`) 和悬浮窗 (`sessionKey: "floating"`) 各自维护独立 WebSocket 连接, 需确认 Gateway 支持并发
- **键盘适配**: `ViewTreeObserver` 方案在部分 AOSP 版本上可能行为不一致, 需实机验证

---

## 7. 相关文件索引

| 类别 | 文件路径 |
|------|----------|
| **悬浮服务** | `ui/android/.../services/ClawOSFloatingService.java` |
| **悬浮气泡** | `ui/android/.../views/FloatingBubbleView.java` |
| **对话面板** | `ui/android/.../views/FloatingChatView.java` |
| **Gateway 协议** | `ui/android/.../gateway/GatewayProtocol.java` |
| **Gateway 客户端** | `ui/android/.../gateway/FloatingGatewayClient.java` |
| **STT 引擎** | `ui/android/.../audio/SherpaSTTEngine.java` |
| **TTS 引擎** | `ui/android/.../audio/SherpaTTSEngine.java` |
| **语音插件** | `ui/android/.../plugins/ClawOSVoice.java` |
| **主 Activity** | `ui/android/.../app/MainActivity.java` |
| **Manifest** | `ui/android/app/src/main/AndroidManifest.xml` |
| **Gradle** | `ui/android/app/build.gradle` |
| **项目总文档** | `.cursor/rules/clawos-project.mdc` |
| **AOSP 构建脚本** | `aosp/scripts/03-build-aosp.sh` |
| **设备树同步** | `aosp/scripts/05-setup-device-tree.sh` |
