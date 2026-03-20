# ClawOS Skill 推荐和安装系统 - 实现方案

## 📋 系统概述

一个完整的 skill 市场系统，允许用户浏览、搜索和安装来自 ClawHub 的 Android 兼容 skills。

## 🏗️ 架构

```
┌──────────────────────────────────────────────────────────┐
│                    ClawOS App (React)                     │
│  ┌────────────────┐                                       │
│  │ SkillMarketplace│  http://localhost:3000               │
│  └────────────────┘                                       │
└───────────────────────┬──────────────────────────────────┘
                        │ HTTP (via adb reverse)
┌───────────────────────▼──────────────────────────────────┐
│              Skill Service API (Node.js)                  │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │ Recommend   │  │ Compatibility│  │ Download Manager│ │
│  │ (Top 20)    │  │ Analysis     │  │                 │ │
│  └─────────────┘  └──────────────┘  └─────────────────┘ │
└───────────────────────┬──────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────┐
│                   ClawHub CLI (npm)                       │
│         clawhub search / inspect / install                │
└───────────────────────────────────────────────────────────┘
```

## 🔧 实现步骤

### Step 1: 部署 Skill Service

**服务器要求**：
- Node.js 18+
- ClawHub CLI: `npm install clawhub`（本地安装）

**部署**：
```bash
cd /opt/ClawOS/skill-service
npm install
npm start  # 运行在 http://localhost:3000
```

**ClawHub 登录**：
```bash
# 获取 token: https://clawhub.ai
./node_modules/.bin/clawhub login --token <your-token> --no-browser
```

**API 端点**：
- `GET /api/skills` - 获取推荐的 skills（top 20，按下载量排序，缓存1小时）
- `GET /api/skills/:slug` - 获取 skill 详情
- `POST /api/skills/:slug/download` - 下载 skill 文件

### Step 2: 设置端口转发

使用 adb reverse 让手机访问开发机的服务：

```bash
adb reverse tcp:3000 tcp:3000
```

### Step 3: ClawOSBridge 方法

已在 `ClawOSBridge.java` 中添加 `writeFile()` 方法用于写入 skill 文件。

### Step 4: 集成到 ClawOS UI

已集成 SkillMarketplace 组件到 App.tsx，在 HUD 中添加橙色 Package 图标入口。

### Step 5: 兼容性检测规则

**自动检测的不兼容模式**：
- 系统工具：`docker`, `kubectl`, `git clone`, `brew`, `apt-get`
- 桌面路径：`/home/`, `~/`, `/Users/`
- 权限要求：`sudo`, `root`

**兼容性评分**：
- 100分：完全兼容
- 80-99分：高度兼容
- 60-79分：中等兼容
- <60分：不显示

**实现细节**：
- 使用 `clawhub search` 获取 skill 列表
- 使用 `clawhub inspect --json` 获取详细信息（包括下载量）
- 基于 summary 进行简化的兼容性分析
- 按下载量排序，返回 top 20

## 📱 用户体验流程

1. **打开 Skill 市场**
   - 点击 HUD 右上角橙色 Package 图标
   - 进入全屏 Skill Marketplace 界面

2. **浏览推荐 Skills**
   - 自动显示 top 20 skills（按下载量排序）
   - 显示兼容性评分、下载量
   - 首次加载约5秒，之后有1小时缓存

3. **搜索 Skills**
   - 输入关键词实时过滤
   - 支持名称和描述搜索

4. **安装 Skill**
   - 点击"安装"按钮
   - 自动下载 skill 文件
   - 写入到 `/data/local/tmp/clawos/workspace/skills/<slug>/`
   - 重启 Gateway 加载新 skill
   - 显示安装成功

## 🔒 安全考虑

1. **代码审查**：
   - 在安装前显示 SKILL.md 内容
   - 允许用户审查代码

2. **权限控制**：
   - Skills 运行在 shell 用户权限下
   - 无法访问敏感系统资源

3. **沙箱隔离**：
   - 每个 skill 在独立目录
   - 限制文件系统访问

4. **VirusTotal 集成**：
   - 服务器端集成 VirusTotal API
   - 自动扫描新 skills

## 📊 数据缓存策略

**服务器端缓存**：
- Skills 列表缓存 1 小时
- Skill 详情缓存 24 小时
- 自动后台更新

**客户端缓存**：
- 使用 localStorage 缓存列表
- 离线可浏览已缓存的 skills
- 安装需要网络连接

## 🚀 未来扩展

1. **评分和评论系统**
2. **Skill 推荐算法**（基于使用习惯）
3. **自动更新机制**
4. **Skill 开发者工具**
5. **本地 Skill 创建和分享**

## 📝 配置示例

**服务器配置** (`skill-service/config.json`):
```json
{
  "port": 3000,
  "cacheDir": "./cache",
  "cacheTTL": 3600,
  "clawhubCLI": "clawhub",
  "compatibilityThreshold": 60
}
```

**客户端配置** (`ui/src/config/skills.ts`):
```typescript
export const SKILL_SERVICE_URL = 'http://your-server:3000'
export const MIN_COMPATIBILITY_SCORE = 60
export const SKILLS_PER_PAGE = 20
```

## 🔗 相关资源

- [ClawHub Skills Registry](https://clawhub.ai/skills)
- [OpenClaw Documentation](https://openclaw.ai)
- [ClawHub CLI GitHub](https://github.com/openclaw/clawhub-cli)

## 🎯 实际实现总结

**已完成功能：**
- ✓ Skill Service API（推荐、详情、下载）
- ✓ Convex 直接查询（替代已废弃的 ClawHub HTTP API）
- ✓ 腾讯云翻译集成（后台异步翻译，350ms 间隔）
- ✓ 兼容性分析系统
- ✓ SkillMarketplace React 组件
- ✓ HUD 入口（橙色 Package 图标）
- ✓ ClawOSBridge.writeFile() 方法
- ✓ 缓存机制（1小时）

**性能指标：**
- 首次加载：~4秒（100个skills，4 页 Convex 查询）
- 缓存命中：<100ms
- 翻译：~40秒（后台异步，不阻塞响应）

**技术栈：**
- 后端：Node.js + Express + Convex HTTP API + 腾讯云翻译
- 前端：React + TypeScript + Capacitor
- 通信：HTTP + adb reverse
- 数据源：Convex `skills:listPublicPageV4`（与 clawhub.ai 网站相同）

**关键配置：**
```typescript
// ui/src/components/SkillMarketplace.tsx
const SKILL_SERVICE_URL = 'http://127.0.0.1:3000'  // 必须用 127.0.0.1，不能用 localhost
```

```javascript
// skill-service/server.mjs
const CONVEX_URL = 'https://wry-manatee-359.convex.cloud'  // ClawHub Convex 部署
```

**使用方法：**
```bash
# 1. 启动服务（注意端口冲突）
cd /opt/ClawOS/skill-service
PORT=3456 npm start  # Mac 上 3000 可能被 Cursor 占用

# 2. 设置端口转发（端口映射）
adb reverse tcp:3000 tcp:3456  # 手机 3000 → Mac 3456
adb reverse tcp:11434 tcp:11434

# 3. 在手机上打开 ClawOS，点击 HUD 的 Package 图标
```

**已知注意事项：**
- Android WebView 中 `localhost` 可能解析为 IPv6 `::1`，必须使用 `127.0.0.1`
- adb reverse 只转发 IPv4 连接
- 腾讯云翻译 QPS 限制为 5，服务端控制在 ~2.8 QPS
