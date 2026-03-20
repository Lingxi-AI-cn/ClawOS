# ClawOS UI

ClawOS 的主要用户界面，基于 React + Vite + Capacitor 构建。它不仅仅是一个 Web 应用，更是一个深度集成的 Android Launcher 和系统 Shell。

## 架构概览

- **Core**: React 19, TypeScript
- **Build**: Vite 7
- **Native Bridge**: Capacitor 7 (Android) / Electron IPC (Desktop)
- **State**: Zustand (Store)
- **Styling**: Tailwind CSS v4 + Inline Styles (for Android WebView compat)
- **Animation**: Motion (framer-motion)

## 目录结构

```
src/
├── components/        # UI 组件 (ChatPanel, ModelSelector, HUD...)
├── gateway/           # OpenClaw Gateway连接与协议处理
├── store/             # Zustand 状态管理 (chat, modelConfig, system...)
├── voice/             # 语音模块 (Sherpa-ONNX 插件封装)
├── scene/             # 3D 场景 (Three.js)
├── android/           # Android 原生工程 (Capacitor)
└── electron/          # Electron 主进程 (Desktop)
```

## 关键功能模块

### 1. Gateway Client
UI 通过 WebSocket 连接到本地运行的 OpenClaw Gateway (`ws://loopback:18789`)，负责所有 LLM 对话、工具调用和 Agent 交互。

### 2. 模型选择系统 (ModelSelector)
- **多模型支持**: 支持 Google Gemini, OpenAI, Anthropic, Ollama 等
- **动态配置**: 用户可通过向导添加 API Key 或连接本地 Ollama
- **状态管理**: `src/store/modelConfig.ts`

### 3. Native Bridge
通过 Capacitor 插件 (`ClawOSBridge`) 调用 Android 原生能力：
- 系统信息 (CPU/Mem/Batt)
- 文件读写 (用于修改 Gateway 配置)
- 服务控制 (重启 Gateway)
- 沉浸模式 (Kiosk)

### 4. 语音模块
集成 Sherpa-ONNX 离线语音识别 (STT) 和合成 (TTS)。

## 开发构建

### 环境准备

确保已安装 `pnpm` 和 `jdk-21`。

### 安装依赖

```bash
pnpm install
```

### 调试运行 (浏览器预览)

```bash
pnpm dev
# 访问 http://localhost:5173
# 注意: 浏览器环境中无 Native Bridge，部分功能可能不可用
```

### Android 构建

构建 Web 资源并同步到 Android 项目：

```bash
# 1. 构建 Web 产物
pnpm build

# 2. 同步到 Android
npx cap sync android

# 3. 构建 APK
cd android
./gradlew assembleDebug
```

生成的 APK 位于: `android/app/build/outputs/apk/debug/app-debug.apk`

## 注意事项

- **Android WebView 样式**: Android 12 WebView 对某些现代 CSS 特性支持不佳，关键布局建议使用内联样式。
- **配置权限**: 应用需要 `WRITE_EXTERNAL_STORAGE` 或特定目录权限来修改 Gateway 配置。
