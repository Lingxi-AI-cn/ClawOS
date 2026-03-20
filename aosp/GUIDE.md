# ClawOS AOSP 构建指南

在 Ubuntu 服务器上构建 AOSP Android 16 镜像，支持 GSI 真机 (Pixel 8 Pro) 和模拟器两种部署方式。

---

## 目录

- [环境要求](#环境要求)
- [当前环境](#当前环境)
- [快速开始](#快速开始)
- [详细步骤](#详细步骤)
  - [Step 1: 传输脚本到 Linux 机器](#step-1-传输脚本到-linux-机器)
  - [Step 2: 安装构建依赖](#step-2-安装构建依赖)
  - [Step 3: 同步 AOSP 源码](#step-3-同步-aosp-源码)
  - [Step 3.5: 构建 ClawOS APK](#step-35-构建-clawos-apk)
  - [Step 4: 编译 AOSP](#step-4-编译-aosp)
  - [Step 5: 传输镜像并测试](#step-5-传输镜像并测试)
- [GSI 真机部署](#gsi-真机部署)
- [Gateway 服务架构](#gateway-服务架构)
- [Node.js 交叉编译](#nodejs-交叉编译)
- [SSH 远程开发](#ssh-远程开发)
- [网络配置（国内用户）](#网络配置国内用户)
- [Ubuntu 24.04 兼容性](#ubuntu-2404-兼容性)
- [Android 16 vs Android 12 差异](#android-16-vs-android-12-差异)
- [常见问题](#常见问题)
- [构建参数配置](#构建参数配置)

---

## 环境要求

### Linux 构建机

| 项目 | 最低要求 | 推荐配置 |
|------|---------|---------|
| 操作系统 | Ubuntu 20.04/22.04/24.04 x86_64 | Ubuntu 22.04/24.04 LTS |
| CPU | 8 核 | 16+ 核 |
| 内存 | 16 GB | 32-64 GB |
| 磁盘 | 300 GB 可用 | 500 GB SSD |
| 网络 | 稳定连接 | 有线连接 |

> **Ubuntu 24.04 注意**: 完全支持，但 AOSP 预编译工具链需要 ncurses5 兼容性符号链接。`01-setup-build-env.sh` 已自动处理。详见 [Ubuntu 24.04 兼容性](#ubuntu-2404-兼容性)。

### 客户端 (Mac / Windows)

| 平台 | 用途 | 要求 |
|------|------|------|
| **Mac (Apple Silicon)** | 模拟器运行、Git 管理、代码审查 | Android Studio (含 Emulator)、3 GB 可用空间 |
| **Windows (ARM64)** | 模拟器运行、镜像拉取、真机刷写 | Android Studio / Platform Tools、Hyper-V、SSH 客户端 (内置) |
| **Windows (x86_64)** | 镜像拉取、真机刷写 | Android Platform Tools、SSH 客户端 (内置) |

> **Windows 模拟器注意**: ClawOS 的模拟器镜像是 ARM64 (arm64-v8a) 架构。只有 **ARM64 主机** (Apple Silicon Mac 或 ARM64 Windows) 才能通过硬件加速高效运行。x86_64 Windows 无法运行 ARM64 模拟器镜像（会直接崩溃），只能用于真机刷写。

---

## 当前环境

| 项目 | 值 |
|------|------|
| 服务器主机名 | `legion` |
| 系统 | Ubuntu 24.04 x86_64 |
| CPU / RAM | 20 核 / 64 GB |
| 项目路径 | `/opt/ClawOS` |
| AOSP 源码 | `/opt/aosp` → 符号链接到 `/opt/aosp16` (Android 16) |
| AOSP 12 源码 (旧) | `/opt/aosp12` (已归档，不再主要使用) |
| AOSP 构建产物 | `/opt/aosp/out/target/product/clawos_gsi_arm64/` |
| JDK (Gradle) | `$JAVA_HOME` |
| ccache 目录 | `~/.ccache` (50G) |
| 开发方式 | Cursor SSH Remote → legion |

### AOSP 目录结构

`/opt/aosp` 是一个符号链接，指向 `/opt/aosp16`（Android 16 源码树）。这样即使上下文丢失，`cd /opt/aosp` 始终进入正确的 Android 16 目录。

旧的 Android 12 源码树已重命名为 `/opt/aosp12`，不再是默认构建目标。

---

## 快速开始

如果你已经熟悉 AOSP 构建流程，以下是最简流程：

```bash
# ── 在 Linux 服务器上 (项目已在 /opt/ClawOS) ──
cd /opt/ClawOS/aosp

# 1. 安装依赖 (需要 sudo，约 5 分钟)
sudo bash scripts/01-setup-build-env.sh

# 2. 配置 git (如果还没配置)
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
source ~/.bashrc

# 3. 同步源码 (建议在 tmux 中运行，约 1-4 小时)
tmux new -s aosp
bash scripts/02-sync-source.sh

# 4. 构建 APK (如果修改了 UI 代码)
cd /opt/ClawOS/ui
pnpm run build
npx cap sync android
export JAVA_HOME=$JAVA_HOME
cd android && ./gradlew assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk ../../aosp/device/clawos/apps/ClawOS.apk

# 5. 同步设备树
cd /opt/ClawOS && bash aosp/scripts/05-setup-device-tree.sh

# 6. 编译 AOSP (建议在 tmux 中运行，约 1-4 小时)
cd /opt/aosp && source build/envsetup.sh && lunch clawos_gsi_arm64-trunk_staging-userdebug && m -j$(nproc)

# ── 在 Mac 上 ──
# 方式 A: 一条命令拉取 + 启动模拟器
bash aosp/run-emulator-mac.sh --pull --lan --clean

# ── 在 Mac/Windows 上 — 真机 Pixel 8 Pro ──
# 拉取镜像后使用 fastboot 刷写 (详见 GSI 真机部署章节)
```

---

## 详细步骤

### Step 1: 传输脚本到 Linux 机器

在 Mac/Windows 上，将 `aosp/` 目录传到 Linux 构建机：

```bash
# 替换 <user> 和 <linux-ip> 为你的实际值
scp -r aosp/ <user>@<linux-ip>:/tmp/clawos-aosp/
```

然后 SSH 登录到 Linux 机器：

```bash
ssh <user>@<linux-ip>
cd /tmp/clawos-aosp
```

### Step 2: 安装构建依赖

此步骤安装 AOSP 编译所需的所有系统包、Google `repo` 工具和 `ccache`。

```bash
sudo bash scripts/01-setup-build-env.sh
```

**安装内容包括：**
- 编译工具链：gcc, g++, make, flex, bison 等
- 库文件：zlib, libx11, libgl, libxml2 等
- 工具：git, curl, zip, unzip, ccache, tmux
- Google `repo` 工具（安装到 `~/bin/repo`）

安装完成后，配置 git 用户信息（`repo sync` 需要）：

```bash
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
```

刷新 shell 环境：

```bash
source ~/.bashrc
```

**验证安装：**

```bash
repo version     # 应显示 repo 版本
ccache -s        # 应显示 ccache 统计
```

### Step 3: 同步 AOSP 源码

下载 AOSP 源码，约 80-100 GB。**强烈建议在 `tmux` 或 `screen` 中运行**，防止 SSH 断连导致中断。

```bash
# 启动 tmux 会话
tmux new -s aosp

# 运行同步（默认使用清华 TUNA 镜像，国内无需 VPN）
bash scripts/02-sync-source.sh
```

**耗时预估：**
- 国内镜像 + 百兆宽带：1-2 小时
- 国外 VPN：2-4 小时
- 低速网络：可能需要半天

**如果中断了**（SSH 断连、网络故障等），可以断点续传：

```bash
bash scripts/02-sync-source.sh --retry
```

**如果使用 VPN 而非镜像：**

```bash
# Clash 代理 (端口 7890)
bash scripts/02-sync-source.sh --google --proxy http://127.0.0.1:7890

# Sing-box 代理 (端口 2080)
bash scripts/02-sync-source.sh --google --proxy http://127.0.0.1:2080
```

**detach tmux（安全断开 SSH）：**

按 `Ctrl+B` 然后按 `D` 可以 detach tmux 会话。重新连接：

```bash
tmux attach -t aosp
```

### Step 3.5: 构建 ClawOS APK

如果修改了 UI 代码 (`ui/src/`) 或 Android 原生代码 (`ui/android/`)，需要重新构建 APK。

> **重要**: 必须使用 `assembleDebug` 而非 `assembleRelease`。
> AOSP 设备树中 `LOCAL_CERTIFICATE := PRESIGNED` 要求 APK 自带签名证书。
> `assembleRelease` 生成**未签名**的 APK，会导致系统无法安装 Launcher，卡在 "Phone is starting" 画面。
> `assembleDebug` 自动使用 debug keystore 签名。

```bash
cd /opt/ClawOS/ui

# 1. 构建 Web UI
pnpm build

# 2. 同步到 Android 项目
npx cap sync android

# 3. 构建签名 APK (必须使用 JDK 21，不是 AOSP 的 JDK 11)
export JAVA_HOME=$HOME/tools/jdk-21.0.5+11
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
cd android && ./gradlew assembleDebug

# 4. 复制到 AOSP 设备树
cp app/build/outputs/apk/debug/app-debug.apk \
   /opt/ClawOS/aosp/device/clawos/apps/ClawOS.apk
```

> **注意**: 如果之前执行过 AOSP 的 `source build/envsetup.sh`，它会将 `JAVA_HOME` 覆盖为
> AOSP 内置的 JDK。必须在**新的 shell** 中构建 APK，或手动重设 `JAVA_HOME`。

### Step 4: 编译 AOSP

源码同步完成后，先同步设备树，再开始编译。同样建议在 tmux 中运行。

```bash
# 同步设备树到 AOSP 源码树
cd /opt/ClawOS && bash aosp/scripts/05-setup-device-tree.sh

# 编译 AOSP (三条命令必须在同一个 shell 中)
cd /opt/aosp && source build/envsetup.sh && lunch clawos_gsi_arm64-trunk_staging-userdebug && m -j$(nproc)
```

> **重要**: lunch 目标使用三段式格式 `clawos_gsi_arm64-trunk_staging-userdebug`。
> - `clawos_gsi_arm64` — ClawOS GSI 产品 (ARM64)
> - `trunk_staging` — Android 16 release 参数
> - `userdebug` — 构建变体
>
> `source`/`lunch`/`make` 必须在**同一个 shell** 中执行，不能用管道接 `source`。

### 生产模式构建 (Clean Config)

默认构建 (`dev`) 会预装 Google Antigravity 的 OAuth Token 和硬编码的 Ollama 模型，方便开发调试。
如果要构建 **没有任何预设配置** 的生产镜像 (用户需自行添加 API Key 或连接 Ollama)，请使用 `CLAWOS_BUILD_MODE=prod`：

```bash
CLAWOS_BUILD_MODE=prod m -j$(nproc)
```

**耗时预估：**

| 配置 | 首次编译 | 增量编译 (改少量代码) |
|------|---------|---------------------|
| 20 核 + 64 GB RAM | ~2 小时 | ~30-60 分钟 |
| 16 核 + 32 GB RAM | ~3 小时 | ~45 分钟 |
| 8 核 + 16 GB RAM | ~5 小时 | ~1.5 小时 |

**编译成功后**，核心构建产物位于：

```
/opt/aosp/out/target/product/clawos_gsi_arm64/
├── system.img          # GSI 系统镜像 (~3.5 GB)
├── vbmeta.img          # AVB 验证元数据
└── ...
```

> **已知问题**: ninja 编译可能在非关键后处理步骤返回 exit code 1，即使核心产物 (system.img, vbmeta.img)
> 已正确生成。检查 `soong.log` 最后几行确认关键产物是否存在即可。
> `Build sandboxing disabled due to nsjail error` 是正常警告，不影响编译。

### Step 5: 传输镜像并测试

#### Pixel 8 Pro 真机 (主力)

参见 [GSI 真机部署](#gsi-真机部署) 章节。

#### 模拟器 (Mac)

**前提：安装 Android Studio**

1. 下载安装 [Android Studio](https://developer.android.com/studio)
2. 打开 Android Studio → SDK Manager → SDK Tools
3. 确保已安装：Android Emulator、Android SDK Platform-Tools

**在 Mac 上一条命令拉取 + 启动：**

```bash
bash aosp/run-emulator-mac.sh --pull --lan --clean
```

SSH 连接参数在 `config/build-env.conf` 中配置 (`LINUX_HOST`, `LINUX_PORT`, `LINUX_USER`)，也可以命令行覆盖：

```bash
# 指定 Linux 主机
bash run-emulator-mac.sh --pull --linux-host <host> --linux-port <port>

# 仅拉取和配置, 不启动模拟器
bash run-emulator-mac.sh --pull --setup
```

**Windows 模拟器 (仅 ARM64 Windows):**

> ⚠️ ClawOS 模拟器镜像为 ARM64 架构，**仅支持 ARM64 Windows** (如 Snapdragon X Elite/Plus、Microsoft SQ 系列)。x86_64 Windows (Intel/AMD 处理器) 无法运行此镜像。x86_64 Windows 用户请使用 Pixel 8 Pro 真机测试。

```powershell
# 一条命令拉取 + 启动 (局域网模式)
.\aosp\run-emulator-win.ps1 -Pull -Lan -Clean

# 后续启动 (已有本地镜像)
.\aosp\run-emulator-win.ps1

# 仅创建 AVD (不启动)
.\aosp\run-emulator-win.ps1 -Setup
```

**ARM64 Windows 额外要求:**
- 需要开启 Hyper-V (设置 → 可选功能 → Hyper-V)
- 建议使用最新版 Android Studio (2024+ 对 ARM64 Windows 模拟器支持成熟)

**手动启动模拟器 (Mac / Windows)：**

```bash
# Mac
~/Library/Android/sdk/emulator/emulator -avd ClawOS_ARM64 -no-snapshot -gpu auto

# Windows (PowerShell)
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd ClawOS_ARM64 -no-snapshot -gpu auto
```

**模拟器注意事项：**
- **架构限制**: ClawOS 模拟器镜像为 ARM64。仅支持 Apple Silicon Mac 和 ARM64 Windows (Snapdragon X 等)。x86_64 主机无法运行
- `--clean` 标志: 更新 ROM 后必须加 `--clean`，否则可能使用旧的 AVD 缓存
- 麦克风: 启动后需手动开启 Extended Controls → Microphone → "Virtual microphone uses host audio input"
- macOS 权限: 首次需授权麦克风给 `qemu-system-aarch64` (System Settings → Privacy & Security → Microphone)
- ADB: 模拟器默认开启 ADB over TCP (端口 5555)
- SELinux: 模拟器以 `permissive` 模式运行

---

## GSI 真机部署

ClawOS 支持通过 GSI (Generic System Image) 方式部署到 Project Treble 兼容的 ARM64 设备。

### 已验证设备

| 设备 | SoC | 分区方案 | 原厂 Android | AOSP 源码 | lunch 目标 | 刷写方式 | 状态 |
|------|-----|---------|-------------|----------|-----------|---------|------|
| **Google Pixel 8 Pro** | Tensor G3 | A/B, 动态分区 | Android 16 | `/opt/aosp` (→ aosp16) | `clawos_gsi_arm64-trunk_staging-userdebug` | vbmeta(bootloader) → system(fastbootd) | ✅ 主力 |
| Lenovo Tab M10 FHD Plus (TB-X606F) | MT8768 | A-only, 非动态 | Android 10 | `/opt/aosp12` | `clawos_gsi_arm64-userdebug` | bootloader 直接刷 | ✅ 可用 |

### 拉取 GSI 镜像

**Mac:**
```bash
# 使用专用拉取脚本 (rsync 增量同步，支持断点续传)
bash aosp/pull-pixel8pro-images-mac.sh          # 外网模式
bash aosp/pull-pixel8pro-images-mac.sh --lan    # 局域网模式

# 或手动 SCP 拉取
mkdir -p ~/clawos-pixel8pro
scp -P <port> <user>@<linux-host>:/opt/aosp/out/target/product/clawos_gsi_arm64/system.img ~/clawos-pixel8pro/
```

**Windows (PowerShell):**
```powershell
# 使用专用拉取脚本 (自动生成 disabled-verity vbmeta + SHA256 校验)
.\aosp\pull-pixel8pro-images-win.ps1          # 外网模式
.\aosp\pull-pixel8pro-images-win.ps1 -Lan     # 局域网模式

# 或手动 SCP 拉取
mkdir -Force $env:USERPROFILE\clawos-pixel8pro
scp -P <port> <user>@<linux-host>:/opt/aosp/out/target/product/clawos_gsi_arm64/system.img $env:USERPROFILE\clawos-pixel8pro\
scp -P <port> <user>@<linux-host>:/opt/aosp/out/target/product/clawos_gsi_arm64/vbmeta.img $env:USERPROFILE\clawos-pixel8pro\
```

### 刷写 Pixel 8 Pro (动态分区, A/B slot)

**使用刷机脚本 (推荐):**

```bash
# Mac
bash aosp/flash-pixel8pro-mac.sh

# Windows (PowerShell)
.\aosp\flash-pixel8pro-win.ps1
```

脚本会交互式引导每一步，也可以加 `--auto` (Mac) 或 `-Auto` (Windows) 跳过确认。

**手动刷入:**

> ⚠️ **重要**: Pixel 8 Pro 使用动态分区和 A/B 分区方案，刷写流程与传统设备不同。
> - `system.img` 必须在 **fastbootd** 模式下刷入 (bootloader 模式会报 `Invalid command resize-logical-partition`)
> - `vbmeta.img` 必须在 **bootloader** 模式下刷入 (fastbootd 中会报 `No such file or directory`)

```bash
# 1. 进入 bootloader 模式
adb reboot bootloader

# 2. 刷 vbmeta (禁用验证) — 在 bootloader 模式下
#    需要先生成 disabled-verity vbmeta (pull-pixel8pro-images-mac.sh 会自动处理)
#    或手动: avbtool make_vbmeta_image --flags 2 --padding_size 4096 --output vbmeta_disabled.img
fastboot flash vbmeta_a /path/to/vbmeta.img
fastboot flash vbmeta_b /path/to/vbmeta.img

# 3. 切换到 fastbootd 模式 — 动态分区必须
fastboot reboot fastboot

# 4. 刷入 system (fastbootd 模式下)
fastboot flash system /path/to/system.img

# 5. 重启 (加 -w 清除用户数据，首次刷写必须)
fastboot -w
fastboot reboot
```

**刷写顺序总结**: bootloader 刷 vbmeta → fastbootd 刷 system → reboot

### 刷写 Lenovo Tab M10 (A-only, 非动态分区)

```bash
# 简单的直接刷写
adb reboot bootloader
fastboot flash system system.img
fastboot --disable-verity --disable-verification flash vbmeta vbmeta.img
fastboot -w
fastboot reboot
```

### 首次启动与验证

- 首次启动可能需要 3-5 分钟
- 应看到 ClawOS 自定义启动动画，然后进入 ClawOS Launcher

| 功能 | 验证方式 | 预期结果 |
|------|---------|---------|
| **ClawOS Launcher** | 观察主界面 | ClawOS 界面正常显示 |
| **触控** | 点击/滑动 | 响应正常 |
| **WiFi** | 设置 → WiFi | 能扫描并连接网络 |
| **Node.js Gateway** | `adb shell ps -A \| grep node` | 看到 node 进程 |
| **Gateway 状态** | `adb shell getprop clawos.gateway.status` | 显示 `running` |
| **语音 STT** | ClawOS 对话界面语音输入 | 能识别中英文语音 |
| **语音 TTS** | ClawOS AI 回复时的朗读按钮 | 能正常朗读 |

### ADB 调试命令

```bash
# 检查 Gateway 状态
adb shell getprop clawos.gateway.status

# 查看 Gateway 日志
adb logcat -s ClawOS.Prepare clawos_gateway

# 检查 node 进程
adb shell ps -A | grep node

# 检查运行时目录
adb shell ls -laZ /data/local/tmp/clawos/

# 手动重启 Gateway
adb root
adb shell setprop ctl.stop clawos_gateway
adb shell setprop ctl.start clawos_gateway
```

### GSI 关键配置

| 配置 | 说明 |
|------|------|
| `ro.control_privapp_permissions=disable` | 禁用特权应用权限检查，防止 system_server 崩溃 |
| `persist.sys.disable_rescue=true` | 禁用 RescueParty，防止反复重启进入安全模式 |

这些配置在 `clawos_gsi_arm64.mk` 和 `clawos_gsi_arm64/BoardConfig.mk` 中定义。

---

## Gateway 服务架构

ClawOS 的 OpenClaw Gateway 作为 Android init 服务运行，为 ClawOS Launcher 提供 LLM 和工具调用能力。

### 启动流程

```
sys.boot_completed=1
    │
    ├── start clawos_prepare (oneshot, user=shell)
    │       │
    │       ├── 创建 /data/local/tmp/clawos/ 下的目录
    │       └── 脚本结束 → init.svc.clawos_prepare=stopped
    │
    └── on property:init.svc.clawos_prepare=stopped
            │
            └── start clawos_gateway (user=shell)
                    │
                    ├── Phase 1: 验证/创建目录 (双保险)
                    ├── Phase 2: 复制配置文件
                    ├── Phase 3: 解压 gateway bundle (首次启动)
                    ├── Phase 4: 部署辅助文件 (CDP Shim, Skills, AGENTS.md)
                    ├── Phase 5: 权限修复
                    ├── Phase 6: 设置环境变量
                    └── Phase 7: 启动 Node.js Gateway
                            └── ws://127.0.0.1:18789
```

### 关键设计决策

**目录位置: `/data/local/tmp/clawos/`**

选择 `/data/local/tmp/` 而非 `/data/local/` 或其他路径，原因：
- `/data/local/tmp/` 所有者为 `shell:shell` (770)，SELinux 类型为 `shell_data_file`
- 当 init 服务以 `seclabel u:r:shell:s0` 和 `user shell` 运行时，DAC 和 SELinux 权限均匹配
- `/data/local/` 本身受 `system_data_file` SELinux 类型保护，init 服务无法写入

**服务用户: `user shell` (非 root)**
- shell 用户是 `/data/local/tmp/` 的所有者，DAC 权限天然匹配
- Node.js、`am start` 等操作不需要 root 权限

**两阶段启动: `clawos_prepare` + `clawos_gateway`**
- 确保目录在 Gateway 脚本执行前已存在
- `clawos_prepare` 是 oneshot 服务，init 会自动设置 `init.svc.clawos_prepare=stopped`
- 使用 init 内置属性触发（而非自定义属性），避免 SELinux 属性设置权限问题

**自动重启**: `init.clawos.rc` 中 `on property:init.svc.clawos_gateway=stopped` 会自动 `start clawos_gateway`

**Gateway 重启机制**: ClawOSBridge 写入 `restart-gateway` 文件到 app cache → `start-gateway.sh` 的后台 watcher 检测到后 kill node 进程 → init 自动重启

**DNS 配置**: `setup-network.sh` 三阶段: Phase 1 写入公共 DNS → Phase 2 等待网络 DNS → Phase 3 验证并修正

### Gateway 2026.3.12 Scope/Auth 机制

Gateway 2026.3.12 引入了设备身份验证 (device pairing) 安全机制。对没有设备身份的非 Control-UI 客户端，所有 scopes 在握手时会被清空，导致 `models.list`、`chat.send` 等 RPC 调用失败 (`missing scope: operator.read`)。

**解决方案**:
- 客户端 ID 使用 `openclaw-control-ui` (而非 `webchat-ui`)
- 配合 `gateway.controlUi.dangerouslyDisableDeviceAuth: true` 跳过设备身份验证
- 客户端 mode 保持 `webchat` 以确保 webchat 功能正常
- 请求的 scopes: `['operator.admin']`

| 组件 | 值 |
|------|-----|
| 客户端 ID (`client.ts`) | `openclaw-control-ui` |
| 客户端 mode | `webchat` |
| 请求的 scopes | `['operator.admin']` |
| 配置 (`openclaw-default.json`) | `gateway.controlUi.dangerouslyDisableDeviceAuth: true` |

### Gateway 配置注意事项

ROM 中 bundled 的 Gateway 是预编译版本 (`gateway-bundle.tar.gz`)，其 Zod schema 使用 `.strict()`，不允许额外字段：

| 配置项 | 正确值 | 错误值 | 说明 |
|--------|--------|--------|------|
| `models.providers.ollama.api` | `"openai-completions"` | `"ollama"` | bundled 版本不支持 `"ollama"` API 类型 |
| `models.providers.ollama.baseUrl` | `"http://10.0.2.2:11434/v1"` | `"http://10.0.2.2:11434"` | OpenAI 兼容端点需要 `/v1` 后缀 |
| `sessions.patch` 参数 | `key` + `model` | `sessionKey` + `modelOverride` | 参数名必须精确匹配 schema |

### 配置文件验证

修改 `openclaw-default.json` 后，**必须先在本地验证**再构建 ROM:

```bash
cd /tmp && rm -rf gateway-test && mkdir gateway-test && cd gateway-test
tar xzf /opt/ClawOS/aosp/device/clawos/gateway/gateway-bundle.tar.gz
OPENCLAW_CONFIG_PATH=/opt/ClawOS/aosp/device/clawos/gateway/openclaw-default.json \
OPENCLAW_STATE_DIR=/tmp/gateway-test/state \
HOME=/tmp/gateway-test \
node --import ./intl-polyfill.mjs ./openclaw.mjs gateway --allow-unconfigured --bind loopback
```

- 正常启动监听 18789 端口 → 配置有效
- 立即报错 `Invalid config` → 配置有问题，不要构建 ROM

### 快速热更新 (不重建 ROM)

对于 `openclaw-default.json` 等运行时配置文件，可以直接 adb push 测试:

```bash
adb root
adb push openclaw-fixed.json /data/local/tmp/clawos/openclaw.json
adb reboot
```

### Gateway bundle 结构

从 2026.3.12 起，gateway-bundle.tar.gz 必须包含 `node_modules/`（~347 个 npm 包）。npm 发布的 tarball 不含 node_modules，需要在服务器上 `npm install --production` 后重新打包。

**更新 gateway-bundle.tar.gz 的流程:**
```bash
cd /tmp && rm -rf openclaw-update && mkdir openclaw-update && cd openclaw-update
npm pack openclaw@latest --pack-destination .
tar xzf openclaw-*.tgz && cd package
npm install --production --no-optional
find node_modules -name "*.d.ts" -o -name "*.map" -o -name "*.md" -o -name "LICENSE*" | xargs rm -f 2>/dev/null
find node_modules -type d \( -name test -o -name tests -o -name docs -o -name examples \) -exec rm -rf {} + 2>/dev/null
tar czf /opt/ClawOS/aosp/device/clawos/gateway/gateway-bundle.tar.gz \
  --exclude=package.json --exclude='.git*' --exclude='CHANGELOG*' --exclude='README*' .
echo "版本号" > /opt/ClawOS/aosp/device/clawos/gateway/gateway-version.txt
```

### 文件布局

```
# ROM 中 (只读)
/product/bin/node                                    # Node.js 二进制
/product/etc/clawos/gateway-bundle.tar.gz            # Gateway 打包文件
/product/etc/clawos/gateway/start-gateway.sh         # 启动脚本
/product/etc/clawos/gateway/prepare-dirs.sh          # 目录准备脚本
/product/etc/clawos/gateway/setup-network.sh         # DNS + CA cert 配置
/product/etc/clawos/gateway/cdp-shim.mjs             # CDP 代理
/product/etc/clawos/gateway/ota-update.mjs           # OTA 检查/下载/应用
/product/etc/clawos/gateway/install-gboard.sh        # Gboard 安装脚本
/product/etc/clawos/gateway/resolv.conf              # DNS 回退配置
/product/etc/clawos/openclaw-default.json            # 默认配置
/product/etc/clawos/auth-profiles-default.json       # 默认认证配置
/product/etc/clawos/AGENTS.md                        # AI Agent 系统提示
/product/etc/clawos/skills/                          # AI 技能定义
/product/etc/init/init.clawos.rc                     # init 服务定义

# 运行时数据 (可写)
/data/local/tmp/clawos/
├── gateway/                    # 解压后的 Gateway 代码
│   ├── dist/entry.js           # Gateway 入口
│   ├── cdp-shim.mjs            # CDP 代理
│   ├── node_modules/           # npm 依赖
│   └── package.json            # {"type":"module"}
├── state/                      # Gateway 状态
│   ├── agents/main/agent/      # Agent 配置
│   │   └── auth-profiles.json  # LLM 认证
│   └── canvas/                 # Canvas 数据
├── workspace/                  # AI 工作空间
│   ├── AGENTS.md
│   └── skills/
└── openclaw.json               # Gateway 配置
```

---

## Node.js 交叉编译

ROM 内置预编译的 Node.js ARM64 二进制 (`/product/bin/node`)。

| 项目 | 值 |
|------|-----|
| 版本 | v22.16.0 |
| ICU | small-icu (支持 `Intl` API 和 Unicode 属性正则) |
| NDK | 26.1.10909125 (Clang 17) |
| 目标 | `aarch64-linux-android31` |
| 编译选项 | `--without-inspector --without-node-snapshot --without-npm --without-corepack --openssl-no-asm --partly-static` |
| 源码 | `/opt/ClawOS/build/node-android/node-v22.16.0/` |
| 产物 | `aosp/device/clawos/prebuilt/node` (~68MB, .gitignore) |

### 已知编译补丁
1. `deps/v8/src/handles/handles.h`: `static_assert(false, ...)` → `static_assert(sizeof(T) == 0, ...)` (C++23 兼容)
2. `deps/v8/src/trap-handler/trap-handler.h`: 强制 `#define V8_TRAP_HANDLER_SUPPORTED false` (Android 不支持)
3. 链接时需要 NDK cpufeatures 库: `LDFLAGS="-L/tmp -lcpufeatures"`

> **重要**: 必须使用 `--with-intl=small-icu`。Gateway 代码使用 Unicode 属性正则 (`\p{Extended_Pictographic}`) 和 `Intl.Segmenter` 等 API，`--without-intl` 会导致运行时崩溃。

---

## SSH 远程开发

日常开发通过 Cursor SSH Remote 连接到 Ubuntu 服务器进行。

### 连接方式

1. Cursor → Remote Explorer → SSH Targets → 添加 `legion` 服务器
2. 连接后打开 `/opt/ClawOS` 作为工作目录
3. Cursor 的终端、文件编辑、Git 操作都在远程服务器上执行

### 开发流程

```
Mac/Win (Cursor IDE)  ──SSH──>  Ubuntu (legion)
                                  ├── /opt/ClawOS  (git 仓库, 代码编辑)
                                  └── /opt/aosp → /opt/aosp16  (Android 16 源码, 构建)
```

- **代码编辑**: 在 Cursor SSH Remote 中直接编辑 `/opt/ClawOS` 下的文件
- **AOSP 构建**: 在 Cursor 终端中运行 `aosp/scripts/` 下的构建脚本
- **AOSP 源码修改**: 直接在 `/opt/aosp` 中修改，增量编译
- **Git 操作**: 在 Cursor 中或终端中执行，push 到 GitHub
- **模拟器运行**: 构建完成后，将镜像传到 Mac 用 Android Studio 模拟器运行
- **真机刷写**: 构建完成后，在 Mac 或 Windows 上通过 fastboot 刷写

### 长时间任务

AOSP 编译等长时间任务建议在 `tmux` 中运行：

```bash
# 在 Cursor 终端中
tmux new -s build
cd /opt/aosp && source build/envsetup.sh && lunch clawos_gsi_arm64-trunk_staging-userdebug && m -j$(nproc)

# detach: Ctrl+B, D
# 重新连接: tmux attach -t build
```

即使 SSH 断连，tmux 中的任务也不会中断。

---

## 网络配置（国内用户）

AOSP 源码托管在 `android.googlesource.com`，国内直接访问不通。脚本默认使用清华大学 TUNA 镜像，无需 VPN。

### 方案 1：国内镜像（默认，推荐）

无需任何额外配置，脚本默认使用清华 TUNA 镜像。

如果 TUNA 不可用，可切换到中科大镜像：

编辑 `config/build-env.conf`：

```bash
AOSP_MANIFEST_URL="git://mirrors.ustc.edu.cn/aosp/platform/manifest"
AOSP_MIRROR_URL="git://mirrors.ustc.edu.cn/aosp"
```

### 方案 2：VPN / 代理

如果你的 Linux 机器上运行了 Clash 或 Sing-box：

```bash
# 命令行方式
bash scripts/02-sync-source.sh --google --proxy http://127.0.0.1:7890

# 或配置文件方式 (编辑 config/build-env.conf)
AOSP_MANIFEST_URL="https://android.googlesource.com/platform/manifest"
AOSP_MIRROR_URL=""
HTTP_PROXY_URL="http://127.0.0.1:7890"
HTTPS_PROXY_URL="http://127.0.0.1:7890"
```

### 方案 3：环境变量方式

```bash
export HTTP_PROXY=http://127.0.0.1:7890
export HTTPS_PROXY=http://127.0.0.1:7890
bash scripts/02-sync-source.sh --google
```

### Android 模拟器网络

| 地址 | 说明 |
|------|------|
| `10.0.2.2` | 模拟器 → 宿主机 127.0.0.1 (标准 Android 模拟器映射) |
| `10.0.2.15` | 模拟器自身 IP |
| `192.168.x.x` | 宿主机局域网 IP (需要宿主机服务绑定 0.0.0.0) |

Ollama 从模拟器访问: `http://10.0.2.2:11434` (需要宿主机 Ollama 正在运行)

---

## Ubuntu 24.04 兼容性

AOSP 的预编译工具链是为较旧的 Ubuntu 版本构建的。在 Ubuntu 24.04 上需要以下兼容处理：

### ncurses5 符号链接 (已在脚本中自动处理)

AOSP 预编译的 clang 需要 `libncurses.so.5`，但 Ubuntu 24.04 只有 `.so.6`：

```bash
# 01-setup-build-env.sh 自动执行，手动修复方法：
sudo ln -sf /usr/lib/x86_64-linux-gnu/libncurses.so.6 /usr/lib/x86_64-linux-gnu/libncurses.so.5
sudo ln -sf /usr/lib/x86_64-linux-gnu/libtinfo.so.6 /usr/lib/x86_64-linux-gnu/libtinfo.so.5
sudo ldconfig
```

### 包名变化 (已在脚本中自动处理)

| Ubuntu 20.04/22.04 | Ubuntu 24.04 |
|---|---|
| `lib32ncurses5-dev` | `lib32ncurses-dev` |
| `libncurses5` | `libncurses-dev` + 符号链接 |

`01-setup-build-env.sh` 会自动检测 Ubuntu 版本并安装正确的包。

---

## Android 16 vs Android 12 差异

ClawOS 最初基于 Android 12 开发 (模拟器)，后迁移到 Android 16 (Pixel 8 Pro)。以下是关键差异：

| 差异点 | Android 12 (`/opt/aosp12`) | Android 16 (`/opt/aosp` → `/opt/aosp16`) |
|--------|-------------------------|---------------------------|
| lunch 格式 | `product-variant` (两段式) | `product-release-variant` (三段式) |
| release 参数 | 无 | `trunk_staging` |
| `AndroidProducts.mk` | `COMMON_LUNCH_CHOICES` 两段式 | `COMMON_LUNCH_CHOICES` 三段式 |
| `Android.bp` | 支持 `preprocessed: true` | **不支持** `preprocessed: true` |
| 环境变量 | `TARGET_BUILD_VARIANT` 等 | 不允许预设 `TARGET_PLATFORM_VERSION` |
| 版本标识 | `SP1A`, Android 12 | `Baklava` (BP4A), Android 16 |
| 编译命令 | `make` / `m` | `m` (推荐) |
| partition_size | 可选 | **必须在 BoardConfig.mk 中显式指定** |

> **重要**: Android 16 编译必须用干净环境，不能有 Android 12 的残留环境变量。
> 如果在同一终端中先执行了 Android 12 的 `lunch`，会导致 `Do not set TARGET_PLATFORM_VERSION directly` 错误。
> 解决: 开新终端或用 `env -i` 启动干净环境。

---

## 常见问题

### Q: repo sync 报错 "fatal: cannot obtain manifest"

**原因：** 镜像地址不可达或网络问题。

**解决：**
```bash
# 检查镜像连通性
curl -I https://mirrors.tuna.tsinghua.edu.cn/git/AOSP/

# 切换镜像或使用代理
bash scripts/02-sync-source.sh --proxy http://127.0.0.1:7890 --google
```

### Q: repo sync 中途断了怎么办？

```bash
# 断点续传，不需要重新 init
bash scripts/02-sync-source.sh --retry
```

### Q: 编译报错 "Out of memory" / "Killed"

**原因：** 内存不足。

**解决：**
```bash
# 减少并行度
BUILD_JOBS=4 bash scripts/03-build-aosp.sh

# 或者增加 swap
sudo fallocate -l 16G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Q: 编译报错 "Do not set TARGET_PLATFORM_VERSION directly"

**原因:** shell 中残留了旧的 AOSP (Android 12) 环境变量。

**解决:** 开新终端或用 `env -i` 启动干净环境：
```bash
env -i HOME=$HOME USER=$USER PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  bash -c 'cd /opt/aosp && source build/envsetup.sh && lunch clawos_gsi_arm64-trunk_staging-userdebug && m -j$(nproc)'
```

### Q: Pixel 8 Pro 刷写报错 "Invalid command resize-logical-partition"

**原因:** 在 bootloader 模式下刷动态分区 system。

**解决:** 先切换到 fastbootd 模式：
```bash
fastboot reboot fastboot
fastboot flash system system.img
```

### Q: Pixel 8 Pro 刷写 vbmeta 报错 "No such file or directory"

**原因:** 在 fastbootd 模式下刷 vbmeta。

**解决:** 先回到 bootloader 模式：
```bash
fastboot reboot bootloader
fastboot flash vbmeta_a vbmeta.img
fastboot flash vbmeta_b vbmeta.img
```

### Q: AOSP 16 的 Android.bp 报错 "unrecognized property preprocessed"

**原因:** AOSP 16 的 `android_app_import` 不支持 `preprocessed: true`。

**解决:** 从 `Android.bp` 中移除 `preprocessed: true`。

### Q: Mac 上模拟器启动后黑屏

**可能原因：** GPU 加速问题。

**解决：**
```bash
# 禁用 GPU 加速
~/Library/Android/sdk/emulator/emulator -avd ClawOS_ARM64 -no-snapshot -gpu swiftshader_indirect
```

### Q: 模拟器启动极慢 / 提示 "x86 based AVD"

**原因**: 模拟器未正确识别镜像为 ARM64 架构。

**可能的原因和解决方法**:

1. **`source.properties` 为空**: `make emu_img_zip` 有时生成空的 `source.properties`。
   `run-emulator-mac.sh` 已自动处理。

2. **残留的旧散列镜像文件**: `~/clawos-emulator-images/` 目录中残留的旧 `.img` 文件。
   `run-emulator-mac.sh` 已自动处理。

3. **手动修复**:
   ```bash
   rm -f ~/clawos-emulator-images/*.img ~/clawos-emulator-images/*.ini
   bash aosp/run-emulator-mac.sh --pull --clean
   ```

### Q: Gateway 启动失败 "Invalid config"

**原因:** `openclaw-default.json` 格式不兼容 bundled Gateway。

**解决:** 使用本地验证流程 (见 [配置文件验证](#配置文件验证) 章节)。

### Q: 如何增量编译（修改源码后）

```bash
cd /opt/aosp
source build/envsetup.sh
lunch clawos_gsi_arm64-trunk_staging-userdebug
m -j$(nproc)
```

---

## 构建参数配置

所有可配置参数集中在 `config/build-env.conf` 中：

| 参数 | 默认值 | 说明 |
|------|-------|------|
| `AOSP_BRANCH` | Android 16 (Baklava) | AOSP 分支/标签 |
| `AOSP_SOURCE_DIR` | `/opt/aosp` | 源码目录 (→ `/opt/aosp16` 符号链接) |
| `AOSP_MANIFEST_URL` | TUNA 镜像 | repo manifest URL |
| `AOSP_MIRROR_URL` | TUNA 镜像 | 镜像基础 URL |
| `AOSP_LUNCH_TARGET` | `clawos_gsi_arm64-trunk_staging-userdebug` | lunch 构建目标 (三段式) |
| `BUILD_JOBS` | `$(nproc)` | 编译并行度 |
| `USE_CCACHE` | `1` | 是否启用 ccache |
| `CCACHE_MAX_SIZE` | `50G` | ccache 缓存上限 |
| `MAC_USER` | `your-username` | Mac SSH 用户名 |
| `MAC_HOST` | (空) | Mac IP 地址 |
| `MAC_IMAGE_DIR` | `~/clawos-emulator-images` | Mac 镜像存放目录 |
| `LINUX_HOST` | `<your-build-server>` | Linux 构建机地址 |
| `LINUX_PORT` | `125` | Linux SSH 端口 |
| `LINUX_USER` | `your-username` | Linux SSH 用户名 |
| `HTTP_PROXY_URL` | (空) | HTTP 代理 |
| `HTTPS_PROXY_URL` | (空) | HTTPS 代理 |

所有参数都支持环境变量覆盖，例如：

```bash
BUILD_JOBS=8 bash scripts/03-build-aosp.sh
```

---

## 已排除的大文件 (.gitignore)

以下文件不在 git 中，需要手动下载/生成：

| 文件 | 大小 | 获取方式 |
|------|------|----------|
| `ui/android/app/libs/sherpa-onnx.aar` | ~38MB | GitHub Releases 下载 |
| `aosp/device/clawos/models/` | ~123MB | Hugging Face 下载 |
| `aosp/device/clawos/apps/ClawOS.apk` | ~108MB | 构建生成 (Step 3.5) |
| `aosp/device/clawos/prebuilt/node` | ~68MB | Node.js v22.16.0 ARM64 交叉编译 (with small-icu) |
| `aosp/device/clawos/gateway/gateway-bundle.tar.gz` | ~66MB | OpenClaw npm pack + npm install --production |
