# ClawOS IM 接入功能

## 概述

ClawOS 提供了一键式 IM（即时通讯）平台接入向导，支持将 ClawOS AI 助手连接到主流 IM 平台。用户通过简单的分步引导即可完成 Bot 创建和配置，无需手动编辑配置文件。

### 支持平台

| 平台 | 类型 | 需要的凭据 | 安装难度 |
|------|------|-----------|---------|
| Telegram | 内置 | Bot Token | 最简单 |
| Discord | 内置 | Bot Token | 简单 |
| Slack | 内置 | Bot Token + App Token | 中等 |
| 飞书 / Lark | 插件 | App ID + App Secret | 中等 |
| 钉钉 | 插件 | Client ID + Client Secret | 中等 |

---

## 用户使用指南

### 进入 IM 接入向导

1. 在 ClawOS 主界面的**顶部状态栏**（HUD）中，找到 💬 图标按钮
2. 点击后进入 **IM 通道管理** 面板
3. 点击「添加通道」进入向导

### Telegram 接入（推荐，最简单）

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | 选择 Telegram | 在平台列表中点击 Telegram |
| 2 | 创建 Bot | 点击「打开 Telegram 创建页面」，系统会打开 @BotFather |
| 3 | 在 BotFather 中操作 | 发送 `/newbot` → 输入 Bot 名称 → 输入用户名 → 复制返回的 Token |
| 4 | 粘贴 Token | 回到 ClawOS，将 Token 粘贴到输入框 |
| 5 | 验证 | 系统自动调用 Telegram API 验证 Token，显示 Bot 名称确认 |
| 6 | 保存 | 点击「保存并完成」，系统自动写入配置并重启 Gateway |

**Token 格式**: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`

**默认配置**:
- DM 策略: `pairing`（仅配对用户可私聊）
- 群组: 需要 @提及 才回复

### Discord 接入

| 步骤 | 操作 |
|------|------|
| 1 | 选择 Discord |
| 2 | 在 Developer Portal 创建 Application → 进入 Bot 页面 → Reset Token → 复制 |
| 3 | 粘贴 Bot Token |
| 4 | 验证成功后，系统自动生成**邀请链接** |
| 5 | 点击「复制邀请链接」，在浏览器中打开并选择服务器 |
| 6 | 保存并完成 |

> **注意**: 在 Bot 设置中需要启用 **Message Content Intent**，否则 Bot 无法读取消息内容。

### Slack 接入

| 步骤 | 操作 |
|------|------|
| 1 | 选择 Slack |
| 2 | 在 Slack API 控制台创建 App（From scratch） |
| 3 | 启用 Socket Mode，创建 App-Level Token（`xapp-` 开头） |
| 4 | 启用 Event Subscriptions，添加 `message.im`、`message.channels`、`app_mention` 等事件 |
| 5 | 配置 App Home，启用 Messages Tab |
| 6 | 安装到 Workspace，复制 Bot Token（`xoxb-` 开头） |
| 7 | 粘贴两个 Token → 验证 → 保存 |

**连接模式**: Socket Mode（无需公网 URL，适合本地部署）

### 飞书 / Lark 接入

| 步骤 | 操作 |
|------|------|
| 1 | 选择飞书 |
| 2 | **自动安装插件**（系统从 ROM 预置包安装飞书插件到 Gateway） |
| 3 | 在飞书开放平台创建企业自建应用 → 添加机器人能力 |
| 4 | 配置权限（可使用批量导入） |
| 5 | 配置事件订阅（WebSocket 长连接模式） |
| 6 | 复制 App ID 和 App Secret |
| 7 | 粘贴凭据 → 验证 → 保存 |

> 飞书插件已预置在系统 ROM 中，无需手动下载。
> Lark（国际版）用户需在配置中设置 `domain: "lark"`。

### 钉钉 接入

| 步骤 | 操作 |
|------|------|
| 1 | 选择钉钉 |
| 2 | **自动安装插件**（系统从 ROM 预置包安装钉钉插件到 Gateway） |
| 3 | 在钉钉开放平台创建企业内部应用 → 添加机器人能力 |
| 4 | 配置权限（企业内机器人发送消息、读取群消息等） |
| 5 | 复制 Client ID 和 Client Secret |
| 6 | 粘贴凭据 → 验证 → 保存 |

> 钉钉插件已预置在系统 ROM 中，无需手动下载。

### 管理已配置的通道

在 IM 通道管理面板中，可以：
- **查看** 所有已配置通道的状态（已启用/已禁用）
- **启用/禁用** 通道（不删除配置，仅切换开关）
- **删除** 通道（完全移除配置）
- **添加更多** 通道

---

## 技术设计文档

### 架构

```
用户 → HUD 💬 按钮 → IMChannelList (管理面板)
                         ↓ "添加通道"
                    IMSetupWizard (全屏向导)
                         ↓
                    选择平台 → [插件安装 (飞书/钉钉)] → 引导步骤 → 输入凭据 → API 验证
                         ↓
                    ClawOSBridge.patchJsonFile()  // 写入 openclaw.json
                    ClawOSBridge.restartGateway() // 重启 Gateway
                         ↓
                    Gateway 重新加载配置，连接 IM 平台
```

### 核心组件

#### 1. IMSetupWizard (`ui/src/components/IMSetupWizard.tsx`)

全屏向导组件，处理 5 个平台的完整接入流程。

**向导步骤流转**:
```
pick → [plugin-install (飞书/钉钉)] → guide → credentials → verify → options → save → done
```

**关键特性**:
- 每个平台有独立的 API 验证逻辑（直接调用平台 API）
- Discord 验证成功后自动计算邀请链接（基于 application.id）
- 飞书使用 `tenant_access_token` API 验证凭据
- 钉钉使用 `accessToken` API 验证凭据
- 所有平台提供安全的默认配置值

#### 2. IMChannelList (`ui/src/components/IMChannelList.tsx`)

IM 通道管理面板，显示已配置通道并支持启用/禁用/删除操作。

**数据来源**: 直接读取设备上的 `openclaw.json` 文件中的 `channels` 字段。

#### 3. 状态管理 (`ui/src/store/imChannels.ts`)

- `IM_PLATFORMS`: 平台元数据定义（ID、标签、颜色、凭据字段、验证 URL 等）
- `useIMChannelStore`: Zustand store 管理向导打开/关闭状态

#### 4. 原生桥接 (`ClawOSBridge.java`)

`installPlugin` 方法：
```java
@PluginMethod
public void installPlugin(PluginCall call)
```
- 从 ROM 路径 `/product/etc/clawos/extensions/{pluginId}/` 复制插件到 Gateway 可写目录
- 支持 `feishu` 和 `dingtalk` 两个插件 ID
- 先尝试 `su` 执行 `cp -r`（真机），失败则回退到 Java 文件复制（模拟器）

#### 5. TypeScript 桥接声明 (`ui/src/gateway/bridge.ts`)

```typescript
installPlugin(options: { pluginId: string }): Promise<{ ok: boolean; pluginId: string; path: string }>
```

#### 6. AI 自动化 Skill (`SKILL.md`)

AI 可以自动引导用户完成 IM 配置。每个平台的 AI Skill 流程：
- **Telegram**: 全自动（安装 APK → 引导登录 → BotFather 创建 Bot → 写入配置）
- **Discord**: 引导式（指导用户在开发者平台操作 → 用户提供 Token → AI 验证并写入配置）
- **Slack**: 引导式（指导用户在 Slack API 控制台操作 → 用户提供两个 Token → AI 验证并写入配置）
- **飞书**: 引导式（指导用户在飞书开放平台操作 → 用户提供凭据 → AI 验证并写入配置）
- **钉钉**: 引导式（指导用户在钉钉开放平台操作 → 用户提供凭据 → AI 安装插件 + 验证并写入配置）

### 配置写入格式

向导保存时，通过 `ClawOSBridge.patchJsonFile` 写入 `openclaw.json` 的 `channels.<platform>` 字段。

**Telegram 配置示例**:
```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "123456:ABC-DEF...",
      "dmPolicy": "pairing",
      "groups": { "*": { "requireMention": true } }
    }
  }
}
```

**Discord 配置示例**:
```json
{
  "channels": {
    "discord": {
      "enabled": true,
      "token": "MTIz...",
      "dmPolicy": "pairing",
      "guilds": { "*": { "requireMention": true } }
    }
  }
}
```

**Slack 配置示例**:
```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "dmPolicy": "pairing"
    }
  }
}
```

**飞书配置示例**:
```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "dmPolicy": "pairing",
      "accounts": {
        "main": {
          "appId": "cli_xxx...",
          "appSecret": "..."
        }
      }
    }
  }
}
```

**钉钉配置示例**:
```json
{
  "channels": {
    "dingtalk": {
      "enabled": true,
      "clientId": "ding...",
      "clientSecret": "...",
      "dmPolicy": "pairing"
    }
  }
}
```

### 验证 API

| 平台 | 验证端点 | 请求方式 |
|------|---------|---------|
| Telegram | `https://api.telegram.org/bot{token}/getMe` | GET |
| Discord | `https://discord.com/api/v10/users/@me` | GET, Bot Auth header |
| Slack | `https://slack.com/api/auth.test` | POST, Bearer token |
| 飞书 | `https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/` | POST JSON |
| 钉钉 | `https://api.dingtalk.com/v1.0/oauth2/accessToken` | POST JSON (`appKey` + `appSecret`) |

### AOSP 构建集成

飞书和钉钉插件通过 `PRODUCT_COPY_FILES` 预置到 ROM:

```makefile
# clawos_arm64.mk
# Feishu
$(foreach f,$(shell cd device/clawos && find extensions/feishu -type f 2>/dev/null),\
  $(eval PRODUCT_COPY_FILES += device/clawos/$(f):$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/$(f)))

# DingTalk
$(foreach f,$(shell cd device/clawos && find extensions/dingtalk -type f 2>/dev/null),\
  $(eval PRODUCT_COPY_FILES += device/clawos/$(f):$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/$(f)))
```

运行时路径映射:
- ROM (只读): `/product/etc/clawos/extensions/<pluginId>/`
- Gateway (可写): `/data/local/tmp/clawos/.openclaw/extensions/<pluginId>/`

### 文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `ui/src/components/IMSetupWizard.tsx` | 新增 | IM 接入向导组件 |
| `ui/src/components/IMChannelList.tsx` | 新增 | IM 通道管理面板 |
| `ui/src/store/imChannels.ts` | 新增 | 平台元数据 + Zustand store |
| `ui/src/components/HUD.tsx` | 修改 | 新增 💬 入口按钮 |
| `ui/src/App.tsx` | 修改 | 集成向导和管理面板 |
| `ui/src/gateway/bridge.ts` | 修改 | 新增 installPlugin 声明 |
| `ui/android/.../ClawOSBridge.java` | 修改 | 新增 installPlugin 原生实现 |
| `aosp/device/clawos/clawos_arm64.mk` | 修改 | 飞书 + 钉钉插件 PRODUCT_COPY_FILES |
| `aosp/device/clawos/extensions/feishu/` | 新增 | 飞书插件占位目录 |
| `aosp/device/clawos/extensions/dingtalk/` | 新增 | 钉钉插件占位目录 |
| `aosp/device/clawos/gateway/skills/im-setup-automation/SKILL.md` | 修改 | AI 自动化 Skill（含 5 个平台） |
