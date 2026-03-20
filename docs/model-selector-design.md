# ClawOS 模型选择系统 — 设计与实现文档

> **版本**: Phase 1 (v0.2)
> **日期**: 2026-02-19
> **状态**: Phase 1 完成 ✅ · 前端 + Native Bridge + APK + AOSP 镜像全部构建通过

---

## 1. 背景与目标

### 1.1 问题

当前 ClawOS 的模型配置存在以下局限:

- **硬编码模型**: `openclaw-default.json` 中预置了 Google Antigravity OAuth + Ollama 两个提供商，用户无法自行添加或切换
- **硬编码认证**: `auth-profiles-default.json` 包含开发者的 OAuth Token，无法发布给最终用户
- **简陋的 UI**: `ModelSwitcher.tsx` 只是一个 Cloud / Local 二选一的开关，不支持多模型场景
- **发布阻塞**: 真实用户拿到设备后无法配置自己的 API Key 或模型

### 1.2 目标

1. 设计一个通用的、适合 Android 触屏交互的 **模型选择器** (Bottom Sheet)
2. 提供 **添加模型服务向导** (AddProviderWizard)，支持用户自行配置 API Key 或本地 Ollama
3. 实现 **Dev/Prod 构建模式切换**: 开发模式保留预配置模型，生产模式从空白开始
4. 未配置模型时 **禁用对话输入** 并引导用户配置

---

## 2. 系统架构

### 2.1 整体数据流

```
┌──────────────┐        ┌──────────────────┐        ┌──────────────────┐
│              │ models  │                  │ RPC     │                  │
│  ModelConfig │ ◀────── │  OpenClaw Gateway │ ◀───── │  openclaw.json   │
│    Store     │ .list   │  (WebSocket)     │        │  auth-profiles   │
│              │        │                  │        │                  │
└──────┬───────┘        └────────┬─────────┘        └────────▲─────────┘
       │                         │                           │
       │ state                   │ sessions.patch            │ write
       │                         │                           │
┌──────▼───────┐        ┌────────▼─────────┐        ┌───────┴──────────┐
│ ModelSwitcher │ tap    │  ModelSelector    │ add    │ AddProviderWizard│
│ (状态指示器)   │ ────▶ │  (Bottom Sheet)   │ ────▶ │  (分步配置)       │
└──────────────┘        └──────────────────┘        └──────────────────┘
```

### 2.2 关键 Gateway RPC 方法

| 方法 | 说明 | 请求参数 | 响应 |
|------|------|---------|------|
| `models.list` | 获取所有可用模型 | `{}` | `{ models: AvailableModel[] }` |
| `sessions.patch` | 切换当前会话的模型 | `{ key: 'main', model: 'provider/model-id' }` | `{ resolved: { modelProvider, model } }` |

`AvailableModel` 类型:

```typescript
interface AvailableModel {
  id: string          // e.g. "gemini-3-flash"
  name: string        // e.g. "Gemini 3 Flash"
  provider: string    // e.g. "google-antigravity"
  contextWindow?: number  // e.g. 1048576
  reasoning?: boolean     // 是否支持推理
}
```

### 2.3 构建模式

通过 `CLAWOS_BUILD_MODE` Makefile 变量控制:

```makefile
CLAWOS_BUILD_MODE ?= dev

ifeq ($(CLAWOS_BUILD_MODE),prod)
  CLAWOS_CONFIG_JSON  := device/clawos/gateway/openclaw-prod.json     # 空 providers
  CLAWOS_AUTH_JSON    := device/clawos/gateway/auth-profiles-prod.json # 空 profiles
else
  CLAWOS_CONFIG_JSON  := device/clawos/gateway/openclaw-default.json  # 预配置模型
  CLAWOS_AUTH_JSON    := device/clawos/gateway/auth-profiles-default.json # 开发者 Token
endif
```

使用方式:
```bash
# 开发构建 (默认，保留预配置模型)
make sdk_phone_arm64

# 生产构建 (空白配置，用户自行设置)
CLAWOS_BUILD_MODE=prod make sdk_phone_arm64
```

---

## 3. UI 设计

### 3.1 模型状态指示器 (ModelSwitcher)

原来的 Cloud/Local 切换按钮被重构为一个 **状态指示器**，位于输入框上方:

**未配置状态** (amber 警告色):
```
┌────────────────────────────────┐
│  ⚠ 未配置模型  ▾  ●           │  amber 边框 + 发光
│       点击配置模型              │  小字提示
└────────────────────────────────┘
```

**已配置状态** (cyan 正常色):
```
┌────────────────────────────────┐
│  ⟁ Gemini 3 Flash  ▾  ●      │  cyan 边框 + 发光
│       点击切换模型              │  小字提示
└────────────────────────────────┘
```

**交互**:
- 点击 → 打开 ModelSelector Bottom Sheet
- 未连接 Gateway 时禁用 (opacity 0.4)

### 3.2 模型选择器 (ModelSelector Bottom Sheet)

<!-- 模型选择器 UI 截图 (本地路径已移除) -->

从底部滑出的面板，最大高度 80vh，包含:

1. **拖拽把手** — 顶部居中的灰色短条
2. **标题** — "🧠 模型选择" + 右侧关闭按钮
3. **模型列表** — 按 Provider 分组:
   - Provider 分组头 (大写, 带 Cloud/Server 图标)
   - 模型卡片: 图标 + 名称 + context window + 当前选中标记
   - 选中的模型高亮 cyan，显示 ✓
   - 切换中显示旋转加载图标
4. **未配置服务** — 底部列出已知但未配置的 Provider (如 Ollama)，点击直接进入配置向导
5. **空状态** — 无模型时显示 CPU 图标 + "尚未配置任何模型"
6. **添加按钮** — 虚线边框 "＋ 添加模型服务"

**动画**:
- 入场: `translateY(100%) → translateY(0)`, cubic-bezier(0.32, 0.72, 0, 1)
- 背景遮罩: `opacity 0 → 1`, blur(4px)

### 3.3 添加模型服务向导 (AddProviderWizard)

<!-- 添加模型服务截图 (本地路径已移除) -->

全屏覆盖层，针对不同 Provider 有不同流程:

**流程 A: API Key 提供商 (Google, OpenAI 等)**
1. **输入**: API Key (密码框) + Base URL (可选)
2. **验证**: 点击下一步，系统尝试用 Key 调用简单 API (`/v1/models` 或 `list_models`)
3. **保存**: 验证通过后写入配置并重启 Gateway

**流程 B: 本地 Ollama**
1. **连接**: 输入 Base URL (默认 `http://10.0.2.2:11434`)，点击 "连接"
2. **发现**: 系统从 Ollama `/api/tags` 或 `/v1/models` 获取已安装模型列表
3. **选择**: 显示模型列表卡片，用户勾选要透出的模型 (如 `llama3`, `gemma`)
4. **保存**: 将选中的模型写入配置并重启 Gateway

**安全机制**:
- "认证信息仅保存在本设备上，不会上传到任何服务器"
- Android 12 WebView 兼容性处理 (使用 `AbortController` 替代 `AbortSignal.timeout`)

### 3.4 输入禁用

模型未配置时 (`isConfigured === false`):
- InputBar 的 `placeholder` 显示 "请先配置模型"
- 输入框 `readOnly`，发送按钮不可用
- 语音按钮也不可用

---

## 4. 实现详情

### 4.1 文件清单

#### 新增文件

| 文件 | 行数 | 说明 |
|------|------|------|
| `ui/src/store/modelConfig.ts` | 129 | Zustand store — 模型配置全局状态 |
| `ui/src/components/ModelSelector.tsx` | 313 | Bottom Sheet — 模型列表 + 切换 |
| `ui/src/components/AddProviderWizard.tsx` | ~400 | 多步向导 — 动态 Ollama 发现 + API Key 验证 |
| `aosp/device/clawos/gateway/openclaw-prod.json` | 52 | 生产模式 OpenClaw 配置 (空 providers) |
| `aosp/device/clawos/gateway/auth-profiles-prod.json` | 4 | 生产模式 auth (空 profiles) |

#### 修改文件

| 文件 | 变更说明 |
|------|---------|
| `ui/src/components/ModelSwitcher.tsx` | 重构为状态指示器 ("点击配置模型 →" CTA) |
| `ui/src/components/ChatPanel.tsx` | 传递 `disabled` 状态 |
| `ui/src/components/InputBar.tsx` | 禁用逻辑 |
| `ui/src/App.tsx` | 初始化逻辑，`handleProviderAdded` 重启 Gateway |
| `ui/src/gateway/bridge.ts` | 新增 `restartGateway` 等方法 |
| `ui/android/.../ClawOSBridge.java` | Native 实现 `patchJsonFile`, `restartGateway` |
| `aosp/device/clawos/gateway/start-gateway.sh` | **权限修复**: `chmod 666` 配置文件, `chmod 777` 目录 |

### 4.2 状态管理 (modelConfig.ts)

```typescript
// Store 状态
interface ModelConfigStore {
  isConfigured: boolean        // 是否有可用模型 (且已选中一个 active)
  isSelectorOpen: boolean      // Bottom Sheet 是否打开
  isWizardOpen: boolean        // 向导是否打开
  activeModelRef: string | null   // 当前模型 ref (如 "google/gemini-3-flash")
  activeModelName: string | null  // 当前模型显示名
  availableModels: AvailableModel[] // 来自 Gateway 的模型列表
  loading: boolean
}
```

### 4.3 模型初始化流程 (App.tsx)

```
Gateway 连接成功 (onConnected)
  │
  ▼
fetchModels(client)
  │
  ├── client.listModels() → models.list RPC
  │
  ├── models.length > 0 ?
  │   ├── YES → setAvailableModels(models)
  │   │         isConfigured = !!activeModelRef (不自动选中)
  │   │
  │   └── NO  → setAvailableModels([])
  │             isConfigured = false
  │
  └── 出错 → 设为 unconfigured
```

### 4.4 Provider 添加流程 & 重启 Gateway

配置保存路径:
OpenClaw Gateway 进程启动时读取配置文件。写入新配置后，Gateway **不会自动热加载**。
解决方案：在 `handleProviderAdded` 中调用 Bridge 重启服务。

1. **写入配置**: `ClawOSBridge.patchJsonFile(...)`
2. **重启服务**: `ClawOSBridge.restartGateway()`
   - Native: `setprop ctl.restart clawos_gateway`
3. **等待重连**: 前端轮询 `fetchModels` 直到成功

### 4.5 Native Bridge 扩展

**TypeScript 接口** (`bridge.ts`):

```typescript
interface ClawOSBridgePlugin {
  // ... 原有方法 ...
  readTextFile(options: { path: string }): Promise<{ content: string }>
  writeTextFile(options: { path: string; content: string }): Promise<{ ok: boolean }>
  patchJsonFile(options: { path: string; jsonPath: string; value: string }): Promise<{ ok: boolean }>
  restartGateway(): Promise<{ ok: boolean }>
}
```

**Android 实现** (`ClawOSBridge.java`) — ✅ 已完成:

| 方法 | 功能 | 实现细节 |
|------|------|------|
| `patchJsonFile` | 修补 JSON | 读取 → 导航路径 → 写入 |
| `restartGateway` | 重启服务 | `Runtime.exec("setprop ctl.restart clawos_gateway")` |

---

## 5. 构建验证

### 5.1 前端构建 (TypeScript + Vite)

```bash
cd ui && pnpm build
```

### 5.2 Capacitor Sync & Android APK

```bash
npx cap sync android
cd ui/android && ./gradlew assembleDebug
```
产物: `app-debug.apk`

### 5.3 AOSP 系统镜像 (Prod 模式)

```bash
# Prod 模式构建 (空配置)
cd /opt/aosp
source build/envsetup.sh
lunch clawos_arm64-userdebug
CLAWOS_BUILD_MODE=prod make -j$(nproc) emu_img_zip
```

**产物**: `sdk-repo-linux-system-images-eng.user.zip` — 1.1 GB

---

## 6. 已完成 & 待完成

### 6.1 Phase 1 已完成 ✅

| 任务 | 说明 |
|------|------|
| ✅ Dev/Prod 构建模式切换 | `CLAWOS_BUILD_MODE` 变量 + prod 配置文件 |
| ✅ modelConfig Zustand Store | 模型配置状态管理 |
| ✅ ModelSelector Bottom Sheet | 按 Provider 分组、未配置服务列表、CTA 按钮 |
| ✅ AddProviderWizard | **Ollama 动态发现** + **API Key 验证** (AbortController 兼容) |
| ✅ ModelSwitcher 重构 | 状态指示器 ("点击配置模型 →") |
| ✅ Gateway 重启机制 | Native Bridge `restartGateway` + 权限修复 |
| ✅ 权限修复机制 | `start-gateway.sh` 启动时修正目录/文件权限 (777/666) |
| ✅ APK 构建 | 含最新 Bridge 和 UI |
| ✅ AOSP 镜像构建 | Prod 模式验证通过 |

### 6.2 Phase 2 进行中 🔄

| 任务 | 状态 | 说明 |
|------|------|------|
| ✅ API Key 验证 | 完成 | 保存前验证 Google/OpenAI/Anthropic/OpenRouter API Key |
| ✅ OAuth UI 流程 | 完成 | 前端 OAuth 授权界面和状态管理 |
| ✅ OAuth Bridge 接口 | 完成 | TypeScript 接口定义 `startOAuthFlow()` |
| ⏳ OAuth Native 实现 | 待完成 | Android 端 Chrome Custom Tabs + Token Exchange |
| ⏳ Google OAuth 配置 | 待完成 | 创建 OAuth 2.0 Client ID |

### 6.3 后续迭代 (Phase 3+)

| 优先级 | 任务 | 说明 |
|--------|------|------|
| 🔴 高 | 模拟器端到端测试 | 在 Mac 模拟器中测试完整的 Provider 添加 → 模型切换 → 对话流程 |
| 🟡 中 | Provider 删除/编辑 | 长按 Provider 卡片进行管理 |
| 🟢 低 | 更多 OAuth 提供商 | 支持其他需要 OAuth 的服务 |

---

## 7. 配置文件示例

### 7.1 生产模式配置 (openclaw-prod.json)

```json
{
  "models": {
    "providers": {}
  },
  "agents": {
    "defaults": {
      "workspace": "/data/local/clawos/workspace"
    }
  },
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "loopback",
    "auth": {
      "mode": "token",
      "token": "clawos-device-token"
    }
  }
}
```

### 7.3 用户添加 Ollama 后的配置

```json
{
  "models": {
    "providers": {
      "ollama": {
        "api": "openai-completions",
        "apiKey": "ollama-local",
        "baseUrl": "http://10.0.2.2:11434/v1",
        "models": {
           "llama3": { "id": "llama3" },
           "gemma": { "id": "gemma" }
        }
      }
    }
  }
}
```
