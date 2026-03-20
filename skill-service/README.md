# ClawOS Skill Service

ClawHub skills 的 Android 兼容性分析和推荐服务。

## 架构

直接调用 ClawHub 底层的 Convex 数据库查询 API (`skills:listPublicPageV4`) 获取 skills 列表，与 clawhub.ai 网站前端使用相同的数据源。

> **为什么不用 ClawHub CLI/HTTP API？**
> - HTTP API `/api/v1/skills` (CLI `explore`) 已被官方废弃，handler 直接返回空数组
> - HTTP API 有 IP 级速率限制
> - CLI `search` 是向量搜索，必须提供关键词，无法列出全部 skills

## 环境要求

- Node.js 18+
- ClawHub CLI（用于 inspect/install/download 功能）
- 腾讯云翻译 API 密钥（用于中文翻译）

## 安装

```bash
cd /opt/ClawOS/skill-service
npm install
```

## 配置

`.env` 文件：
```
TENCENT_SECRET_ID=<your-secret-id>
TENCENT_SECRET_KEY=<your-secret-key>
```

ClawHub 登录（用于 install/download 功能）：
```bash
./node_modules/.bin/clawhub login --token <your-token> --no-browser
```

## 启动服务

```bash
npm start            # 默认端口 3000
PORT=3456 npm start  # 指定端口（Mac 上如 3000 被 Cursor 占用）
```

## 配置端口转发

```bash
# Mac 上 3000 端口可能被 Cursor 占用，使用端口映射
adb reverse tcp:3000 tcp:3456  # 手机 3000 → Mac 3456
adb reverse tcp:11434 tcp:11434
```

> **注意**: 手机 UI 使用 `http://127.0.0.1:3000` 访问。不能用 `localhost`，因为 Android 可能将其解析为 IPv6 `::1`，而 adb reverse 只监听 IPv4。

## API 端点

- `GET /api/skills` - 获取 top 100 skills（按下载量排序）
  - 首次请求：~4s（4 页 Convex 查询）
  - 缓存命中：<100ms（1 小时有效期）
  - 后台异步翻译为中文（~40s，不阻塞响应）
  - 返回字段：slug, name, description, descriptionZh, translated, downloads, stars, installs, owner

- `GET /api/skills/:slug/compatibility` - 检测兼容性（按需评估）

- `GET /api/skills/:slug` - 获取 skill 详情

- `POST /api/skills/:slug/download` - 下载 skill 文件

## 翻译机制

- 使用腾讯云翻译 API (TMT)
- 速率控制：350ms 间隔（~2.8 QPS，低于 5 QPS 限制）
- 首次请求返回英文原文，后台异步翻译
- 翻译完成后更新缓存，下次请求返回中文
- 翻译失败时 fallback 到原文

## 兼容性检测

检测 skills 的 Android 兼容性并评分（0-100%）：
- 系统工具：docker, kubectl, git clone, brew, apt-get
- 桌面路径：/home/, ~/, /Users/
- 权限要求：sudo, root

所有 skills 都返回给前端（不自动过滤），由前端 UI 提供过滤选项。
