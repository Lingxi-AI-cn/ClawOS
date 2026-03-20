# ClawOS ROM 测试指南

欢迎试用 ClawOS！这是一个 AI 驱动的实验性操作系统，通过自然语言与设备交互。本文档将指导你在模拟器或真机上运行 ClawOS ROM。

---

## 目录

- [下载 ROM](#下载-rom)
- [方式一：模拟器运行](#方式一模拟器运行)
- [方式二：真机刷入](#方式二真机刷入)
- [首次启动](#首次启动)
- [设备兼容性](#设备兼容性)
- [常见问题](#常见问题)
- [反馈与贡献](#反馈与贡献)

---

## 下载 ROM

从 [SourceForge](https://sourceforge.net/projects/clawos/files/) 下载预编译镜像：

| 文件 | 说明 | 适用场景 |
|------|------|---------|
| [`pixel8pro/vX.X/system.img`](https://sourceforge.net/projects/clawos/files/pixel8pro/) | GSI 真机系统镜像 (~4.5 GB) | 已解锁 Bootloader 的 ARM64 真机 |
| [`pixel8pro/vX.X/vbmeta.img`](https://sourceforge.net/projects/clawos/files/pixel8pro/) | 禁用 AVB 验证的 vbmeta | 真机刷入时需要 |
| [`emulator/vX.X/`](https://sourceforge.net/projects/clawos/files/emulator/) | 模拟器系统镜像 (~1.5 GB) | ARM64 主机上的 Android Emulator |

每个版本目录下都有 `SHA256SUMS.txt` 文件用于校验下载完整性。

---

## 方式一：模拟器运行

> ⚠️ **架构限制**：AOSP 模拟器镜像为 ARM64 架构，**仅支持 ARM64 主机**：
> - ✅ Mac (Apple Silicon: M1/M2/M3/M4) — 推荐，原生 ARM64 性能
> - ✅ Windows ARM64 (如 Surface Pro X, 需启用 Hyper-V)
> - ❌ **x86_64 Windows / Intel Mac 不支持** (无法高效运行 ARM64 镜像)

### 前置条件

1. 安装 [Android Studio](https://developer.android.com/studio)
2. 打开 Android Studio → SDK Manager → SDK Tools，确保已安装：
   - Android Emulator
   - Android SDK Platform-Tools
   - Android SDK Command-line Tools

### 自动安装（推荐）

**Mac:**

```bash
# 克隆仓库（或只下载 aosp/run-emulator-mac.sh 脚本）
git clone https://github.com/Lingxi-AI-cn/ClawOS.git
cd ClawOS

# 将从 SourceForge 下载的模拟器镜像 zip 放到 ~/clawos-emulator-images/
mkdir -p ~/clawos-emulator-images
cp ~/Downloads/sdk-repo-*.zip ~/clawos-emulator-images/

# 一键安装并启动
bash aosp/run-emulator-mac.sh --clean
```

**Windows ARM64 (PowerShell):**

```powershell
# 克隆仓库
git clone https://github.com/Lingxi-AI-cn/ClawOS.git
cd ClawOS

# 将从 SourceForge 下载的模拟器镜像 zip 放到用户目录下
mkdir "$env:USERPROFILE\clawos-emulator-images"
Copy-Item "$env:USERPROFILE\Downloads\sdk-repo-*.zip" "$env:USERPROFILE\clawos-emulator-images\"

# 一键安装并启动
.\aosp\run-emulator-win.ps1 -Clean
```

脚本会自动完成：解压镜像 → 创建 AVD → 配置 → 启动模拟器。

### 手动安装

如果自动脚本不适用，可以手动操作：

```bash
# 1. 创建系统镜像目录
IMAGES=~/clawos-emulator-images
mkdir -p $IMAGES && cd $IMAGES

# 2. 解压镜像
unzip ~/Downloads/clawos-emu-arm64-*.zip

# 3. 确认 source.properties 存在且包含正确架构
cat $IMAGES/arm64-v8a/source.properties
# 应包含: SystemImage.Abi=arm64-v8a

# 4. 安装为 SDK 系统镜像
SDK_DIR=~/Library/Android/sdk
IMG_DIR=$SDK_DIR/system-images/android-16-clawos/default/arm64-v8a
mkdir -p $IMG_DIR
cp -r $IMAGES/arm64-v8a/* $IMG_DIR/

# 5. 创建 AVD
$SDK_DIR/cmdline-tools/latest/bin/avdmanager create avd \
  -n ClawOS_ARM64 \
  -k "system-images;android-16-clawos;default;arm64-v8a" \
  -d pixel_7 --force

# 6. 启动模拟器
$SDK_DIR/emulator/emulator -avd ClawOS_ARM64 -no-snapshot -gpu auto
```

### 模拟器使用提示

- **首次启动**需要 1-2 分钟完成系统初始化
- **麦克风**：Extended Controls → Microphone → 勾选 "Virtual microphone uses host audio input"
- **GPU 问题**：如果黑屏，尝试 `-gpu swiftshader_indirect` 替代 `-gpu auto`
- **内存建议**：至少分配 4 GB RAM 给模拟器

---

## 方式二：真机刷入

> ⚠️ **风险警告**：刷入第三方 ROM 存在变砖风险。请确保你了解 fastboot 操作，并做好原始 ROM 的备份。

### 前置条件

1. 设备已解锁 Bootloader
2. 电脑已安装 `adb` 和 `fastboot` 工具
3. 设备电量 > 50%
4. USB 数据线连接正常

### 解锁 Bootloader（以 Pixel 为例）

```bash
# 1. 在手机上: 设置 → 关于手机 → 连续点击"版本号" 7 次启用开发者选项
# 2. 设置 → 系统 → 开发者选项 → 启用 "OEM 解锁"
# 3. 连接电脑
adb reboot bootloader
fastboot flashing unlock
# 4. 按手机上的音量键确认解锁
```

### 刷入 GSI (A/B 动态分区设备)

适用于：Pixel 6/7/8/9 系列，以及大部分 2021 年后出厂的旗舰机。

**使用一键刷机脚本（推荐）：**

从 SourceForge 下载 `system.img` 和 `vbmeta.img` 后：

```bash
# Mac / Linux
bash aosp/flash-pixel8pro-mac.sh
```

```powershell
# Windows (PowerShell)
.\aosp\flash-pixel8pro-win.ps1        # 交互模式，逐步确认
.\aosp\flash-pixel8pro-win.ps1 -Auto  # 全自动模式
```

**手动刷入：**

```bash
# 1. 进入 Bootloader 模式
adb reboot bootloader

# 2. 刷入 vbmeta（禁用验证引导）
fastboot flash vbmeta_a vbmeta.img
fastboot flash vbmeta_b vbmeta.img

# 3. 切换到 fastbootd 模式（动态分区必须）
fastboot reboot fastboot

# 4. 刷入 ClawOS 系统镜像
fastboot flash system system.img

# 5. 清除用户数据（首次必须）
fastboot -w

# 6. 重启
fastboot reboot
```

### 刷入 GSI (A-only 非动态分区设备)

适用于：2019-2020 年的部分中低端设备。

```bash
adb reboot bootloader
fastboot flash system system.img
fastboot --disable-verity --disable-verification flash vbmeta vbmeta.img
fastboot -w
fastboot reboot
```

### 恢复原厂 ROM

- **Pixel 设备**：访问 [flash.android.com](https://flash.android.com) 一键恢复
- **其他设备**：请参考设备厂商的官方刷机工具

---

## 首次启动

1. 系统启动后，你会看到 ClawOS 开机动画
2. 进入主界面后，中央的 AI Brain 动画表示系统就绪
3. 在底部输入框中用自然语言与 AI 交互
4. 首次使用需要配置 LLM 提供商（点击设置图标）

### 配置 AI 模型

ClawOS 支持两种 AI 后端：

**云端模型（推荐）**：
- 进入设置 → 添加模型提供商 → 选择 Google Gemini
- 输入你的 API Key
- 选择模型（推荐 Gemini Flash）

**本地模型**：
- 在电脑上安装并运行 [Ollama](https://ollama.com)
- 设置 `adb reverse tcp:11434 tcp:11434` 端口转发
- 在 ClawOS 中切换到本地模型

---

## 设备兼容性

### 官方测试设备

| 设备 | SoC | 状态 |
|------|-----|------|
| Google Pixel 8 Pro | Tensor G3 | ✅ 完全支持 |

> 目前我们只在 Pixel 8 Pro 上完成了完整测试。以下兼容性信息基于技术分析，**欢迎社区用户帮助验证其他设备**。

### 兼容性要求

ClawOS GSI 基于 AOSP 16 (Android 16) 构建，你的设备需要满足：

- ✅ **ARM64 架构** (几乎所有 2017 年后的手机)
- ✅ **Project Treble 支持** (Android 9+ 出厂的设备)
- ✅ **已解锁 Bootloader**
- ✅ **system 分区 ≥ 4.5 GB** (动态分区设备通常可自动调整)

### 可能兼容的设备

**很可能工作 — Pixel 系列** (与 Pixel 8 Pro 相同的 AOSP 基础)：

| 设备 | 解锁方式 |
|------|---------|
| Pixel 6 / 6 Pro / 6a | 设置中启用 OEM 解锁 |
| Pixel 7 / 7 Pro / 7a | 设置中启用 OEM 解锁 |
| Pixel 8 / 8a | 设置中启用 OEM 解锁 |
| Pixel 9 / 9 Pro / 9 Pro Fold | 设置中启用 OEM 解锁 |

**可能工作 — 第三方设备**：

| 品牌 | 设备 | 解锁难度 |
|------|------|---------|
| OnePlus | 9/10/11/12/13 系列 | ⭐ 简单 (OEM 解锁即可) |
| Nothing | Phone 1/2/2a | ⭐ 简单 |
| Motorola | Edge 系列 | ⭐ 简单 (官方提供解锁工具) |
| Xiaomi | 12/13/14 系列 | ⚠️ 中等 (需申请，7天等待期) |
| Samsung | Galaxy S21-S24 (Exynos 版) | ⚠️ 因地区而异 (Snapdragon 版通常无法解锁) |

**已知不兼容**：

| 品牌 | 原因 |
|------|------|
| 华为 / 荣耀 (2019年后) | 无法解锁 Bootloader |
| vivo / iQOO | 大部分无法解锁 Bootloader |
| OPPO / realme (近期机型) | 解锁政策收紧 |

### 可能遇到的问题

| 问题 | 说明 |
|------|------|
| 摄像头不工作 | GSI 通常不支持设备特有的相机 HAL |
| 指纹识别不工作 | 需要设备特定的 vendor 驱动 |
| WiFi/蓝牙异常 | 部分设备的 vendor HAL 与 AOSP 16 不完全兼容 |
| 开机卡在动画 | 可能是 system 分区大小不够或内核不兼容 |
| 显示异常 | 尝试在 fastboot 中执行 `fastboot -w` 清除数据后重试 |

---

## 常见问题

### Q: 模拟器启动很慢 / 黑屏

确保使用 ARM64 镜像并启用 GPU 加速：
```bash
emulator -avd ClawOS_ARM64 -no-snapshot -gpu swiftshader_indirect
```

### Q: 模拟器提示 "x86 based AVD"

ARM64 镜像在 x86 主机上需要软件模拟，速度会较慢。建议在 Apple Silicon Mac 上运行获得原生性能。

### Q: 真机刷入后无限重启

可能原因：
- system.img 过大，超出设备分区限制
- 设备内核与 AOSP 16 不兼容
- 解决方案：使用原厂恢复工具恢复出厂 ROM

### Q: ClawOS 启动后没有网络

- 模拟器：检查主机网络连接
- 真机：ClawOS 支持 WiFi，打开设置连接 WiFi 网络

### Q: 如何查看系统日志

```bash
# 查看 Gateway (AI 后端) 状态
adb shell getprop clawos.gateway.status

# 查看系统日志
adb logcat -s ClawOS.Prepare clawos_gateway

# 查看 Node.js 进程
adb shell ps -A | grep node
```

---

## 反馈与贡献

### 报告问题

请在 [GitHub Issues](https://github.com/Lingxi-AI-cn/ClawOS/issues) 中报告，包含以下信息：

- **设备型号和 SoC**
- **原厂 Android 版本**
- **问题描述和复现步骤**
- **相关日志** (`adb logcat` 输出)
- **截图或视频** (如适用)

### 设备兼容性反馈

如果你成功在其他设备上运行了 ClawOS，请提交 Issue 告诉我们：

- 设备型号、SoC、分区方案
- 刷写方式和步骤
- 哪些功能正常 / 异常

### 参与开发

- Fork 仓库并提交 Pull Request
- 查看 `aosp/GUIDE.md` 了解构建流程
- 查看 `CLAUDE.md` 了解项目架构

---

*ClawOS — AI-Driven Next-Gen Operating System*
