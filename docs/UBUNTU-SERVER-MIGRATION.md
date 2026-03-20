# Ubuntu 服务器迁移指南：ClawOS_AOSP → ClawOS

本文档记录从旧私有仓库 (`ClawOS_AOSP`) 切换到新公共仓库 (`ClawOS`) 时，Ubuntu 构建服务器上需要执行的操作。

## 前置条件

- Ubuntu 服务器已有旧项目 `/opt/ClawOS_AOSP`
- AOSP 源码树 `/opt/aosp` → `/opt/aosp16` 符号链接正常
- 已安装 Node.js (pnpm)、JDK 21、AOSP 构建工具链

## 前提

已将新仓库克隆到 `/opt/ClawOS`（你正在阅读此文件说明已经完成）。

## 第一步：恢复 git 未跟踪的文件

以下文件在 `.gitignore` 中，不在 git 仓库里，需要从旧项目复制。

### 1.1 必须恢复的文件

```bash
OLD=/opt/ClawOS_AOSP
NEW=/opt/ClawOS

# Gateway token 和运行时配置 (包含 API key 等敏感信息)
cp "$OLD/ui/.env.local" "$NEW/ui/.env.local"

# Node.js ARM64 预编译二进制 (~68MB)
cp "$OLD/aosp/device/clawos/prebuilt/node" "$NEW/aosp/device/clawos/prebuilt/node"

# Sherpa-ONNX AAR (~38MB)
cp "$OLD/ui/android/app/libs/sherpa-onnx.aar" "$NEW/ui/android/app/libs/sherpa-onnx.aar"

# 语音模型 (STT/TTS/VAD, ~123MB)
cp -r "$OLD/aosp/device/clawos/models/" "$NEW/aosp/device/clawos/models/"

# ClawOS APK (如果之前构建过, ~108MB)
cp "$OLD/aosp/device/clawos/apps/ClawOS.apk" "$NEW/aosp/device/clawos/apps/ClawOS.apk" 2>/dev/null || true

# CLI 工具 (jq 等)
cp -r "$OLD/aosp/device/clawos/prebuilt/tools/" "$NEW/aosp/device/clawos/prebuilt/tools/" 2>/dev/null || true

# Cromite Browser APK (~164MB)
cp "$OLD/aosp/device/clawos/apps/CromiteBrowser.apk" "$NEW/aosp/device/clawos/apps/CromiteBrowser.apk" 2>/dev/null || true
cp "$OLD/aosp/device/clawos/apps/CromiteWebView.apk" "$NEW/aosp/device/clawos/apps/CromiteWebView.apk" 2>/dev/null || true

# 其他安装器二进制
for f in cromite-browser.bin telegram-installer.bin gboard-installer.bin trime-installer.bin rime-data.tar.gz; do
    cp "$OLD/aosp/device/clawos/gateway/$f" "$NEW/aosp/device/clawos/gateway/$f" 2>/dev/null || true
done

# WebView APK
cp "$OLD/aosp/device/clawos/webview/webview.apk" "$NEW/aosp/device/clawos/webview/webview.apk" 2>/dev/null || true
```

### 1.2 安装前端依赖

```bash
cd /opt/ClawOS/ui
pnpm install
```

## 第二步：配置环境变量

确保 `JAVA_HOME` 已正确设置。在 `~/.bashrc` 或 `~/.profile` 中添加（如果还没有的话）：

```bash
export JAVA_HOME=/home/$(whoami)/tools/jdk-21.0.5+11
export PATH="$JAVA_HOME/bin:$PATH"
```

> `CLAUDE.md` 和 `.cursor/rules/clawos-project.mdc` 中的 JDK 路径已改为 `$JAVA_HOME` 占位符。
> 实际路径请根据你的服务器环境设置。

## 第三步：验证构建流程

### 3.1 构建 APK (验证前端 + Android 构建链)

```bash
cd /opt/ClawOS/ui
pnpm run build
npx cap sync android
cd android && ./gradlew assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk ../../aosp/device/clawos/apps/ClawOS.apk
```

### 3.2 同步设备树 (验证 rsync 到 AOSP 源码树)

```bash
cd /opt/ClawOS
bash aosp/scripts/05-setup-device-tree.sh
```

### 3.3 AOSP 编译 (验证完整构建链)

```bash
cd /opt/aosp && source build/envsetup.sh && lunch clawos_gsi_arm64-trunk_staging-userdebug && m -j$(nproc)
```

## 第四步：更新 Cursor SSH Remote

如果 Cursor 的 SSH Remote 连接指向旧路径 `/opt/ClawOS_AOSP`，需要更新为 `/opt/ClawOS`。

在 Cursor 中：
1. Remote Explorer → 右键连接 → Open Configuration
2. 修改 workspace 路径为 `/opt/ClawOS`

## 速查：哪些文件不在 git 中

| 文件 | 大小 | 来源 | 必须 |
|------|------|------|------|
| `ui/.env.local` | <1KB | 手动创建 / 从旧项目复制 | ✅ 是 |
| `aosp/device/clawos/prebuilt/node` | ~68MB | 交叉编译 / 从旧项目复制 | ✅ 是 |
| `aosp/device/clawos/apps/ClawOS.apk` | ~108MB | `gradlew assembleDebug` 构建生成 | ✅ 是 |
| `ui/android/app/libs/sherpa-onnx.aar` | ~38MB | GitHub Releases 下载 | ✅ 是 |
| `aosp/device/clawos/models/` | ~123MB | Hugging Face 下载 | ✅ 是 |
| `aosp/device/clawos/prebuilt/tools/` | ~几MB | `download-cli-tools.sh` | 推荐 |
| `aosp/device/clawos/apps/Cromite*.apk` | ~440MB | GitHub Releases 下载 | 可选 |
| `aosp/device/clawos/gateway/*.bin` | 各异 | 下载 | 可选 |
| `aosp/device/clawos/webview/webview.apk` | ~88MB | AOSP 提取 | 可选 |

## 脱敏变更摘要

迁移到公共仓库时做了以下脱敏处理，**不影响构建**：

| 文件 | 变更 | 影响 |
|------|------|------|
| `.cursor/rules/clawos-project.mdc` | `/home/elton/tools/jdk-*` → `$JAVA_HOME` | 无，AI 助手上下文 |
| `.cursor/rules/clawos-project.mdc` | `/opt/ClawOS_AOSP` → `/opt/ClawOS` | 无，AI 助手上下文 |
| `CLAUDE.md` | 同上 | 无，AI 助手上下文 |
| `env.example` | `ClawOS_AOSP` → `ClawOS` | 无，仅示例文件 |
| `aosp/GUIDE.md` | 个人用户名/域名 → 通用占位符 | 无，仅文档 |
| 各 `.sh` / `.ps1` 脚本 | 个人默认值 → 空/占位符 | 无，运行时从 `.env.local` 或参数获取 |

所有脚本和构建配置 (`build-env.conf`) 都使用 `$USER`、`$JAVA_HOME` 等环境变量，不依赖硬编码的个人路径。
