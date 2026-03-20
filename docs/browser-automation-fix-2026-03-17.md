# 浏览器自动化修正 (2026.3.17)

## 问题描述

CDP (Chrome DevTools Protocol) bridge 连接失败，导致浏览器自动化功能不可用。

## 根本原因

1. **cdp-bridge.mjs 连接逻辑错误**
   - WebSocket 连接未正确处理 CDP 端点发现
   - 未正确解析 `/json/version` 返回的 `webSocketDebuggerUrl`

2. **openclaw-default.json 配置缺失**
   - 缺少 `browser.cdp` 配置块
   - Gateway 无法启用 CDP 功能

## 修正方案

### 1. 修复 cdp-bridge.mjs

**文件**: `aosp/device/clawos/gateway/cdp-bridge.mjs`

修复 WebSocket 连接逻辑，正确解析 CDP 端点：

```javascript
// 获取 WebSocket URL
const versionRes = await fetch(`http://${host}:${port}/json/version`)
const versionData = await versionRes.json()
const wsUrl = versionData.webSocketDebuggerUrl

// 建立 WebSocket 连接
const ws = new WebSocket(wsUrl)
```

### 2. 更新 openclaw-default.json

**文件**: `aosp/device/clawos/gateway/openclaw-default.json`

添加完整的 `browser.cdp` 配置：

```json
{
  "browser": {
    "cdp": {
      "enabled": true,
      "host": "127.0.0.1",
      "port": 9222
    }
  }
}
```

## 验证步骤

### 1. 启动 Chrome 远程调试

```bash
adb shell am start -n com.android.chrome/com.google.android.apps.chrome.Main \
  --es args "--remote-debugging-port=9222"
```

### 2. 检查 CDP 端点

```bash
adb shell curl http://127.0.0.1:9222/json/version
```

预期输出包含 `webSocketDebuggerUrl` 字段。

### 3. 查看 Gateway 日志

```bash
adb logcat -s clawos_gateway | grep -i cdp
```

成功连接时应看到类似日志：
```
CDP bridge connected to ws://127.0.0.1:9222/devtools/browser/...
```

## 相关文件

| 文件 | 说明 |
|------|------|
| `aosp/device/clawos/gateway/cdp-bridge.mjs` | CDP WebSocket 连接实现 |
| `aosp/device/clawos/gateway/openclaw-default.json` | Gateway 默认配置 |
| `CLAUDE.md` | 项目主文档（已更新配置说明） |

## 影响范围

- ✅ 浏览器自动化功能恢复
- ✅ CDP 工具调用正常工作
- ✅ 不影响其他 Gateway 功能
