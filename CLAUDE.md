# ClawOS — AI 助手项目规则

## 开发约定

- 始终用**中文**交流
- 不自动提交 git，不自动启动应用，不随意创建文档
- 模拟器运行在 **Mac (Apple Silicon)** 或 **ARM64 Windows** 上，不在 Ubuntu 服务器上
- **x86_64 Windows** 不支持模拟器 (ARM64 镜像需要 ARM64 主机)，仅用于真机刷写

## 环境

| 项目 | 值 |
|------|-----|
| 项目路径 | `/opt/ClawOS` |
| AOSP 源码 | `/opt/aosp` → 符号链接到 `/opt/aosp16` (Android 16, Pixel 8 Pro) |
| AOSP 12 源码 (旧模拟器) | `/opt/aosp12` — Android 12，已归档不再主要使用 |
| JDK (Gradle) | `$JAVA_HOME` (OpenJDK 21) |
| 主要构建目标 | `clawos_gsi_arm64-trunk_staging-userdebug` (Android 16, 三段式) |

### AOSP 目录结构 (已简化)

`/opt/aosp` 是一个符号链接，指向 `/opt/aosp16`（Android 16 源码树）。这样即使上下文丢失，`cd /opt/aosp` 始终进入正确的 Android 16 目录。

旧的 Android 12 源码树已重命名为 `/opt/aosp12`，不再是默认构建目标。

## ROM 构建流程

### 判断执行哪些步骤

| 修改了什么 | 步骤 |
|-----------|------|
| 仅 `aosp/device/clawos/` 下的配置文件 | Step 2 → 3 → 4 |
| `ui/src/` 或 `ui/android/` 下的代码 | Step 1 → 2 → 3 → 4 |

### Step 1: 构建 APK

```bash
cd /opt/ClawOS/ui
pnpm run build
npx cap sync android
export JAVA_HOME=$JAVA_HOME    # OpenJDK 21
cd android && ./gradlew assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk ../aosp/device/clawos/apps/ClawOS.apk
```

### Step 2: 同步设备树

```bash
cd /opt/ClawOS && bash aosp/scripts/05-setup-device-tree.sh
```

> 由于 `/opt/aosp` 已是指向 `/opt/aosp16` 的符号链接，此脚本现在直接同步到 Android 16 源码树。

### Step 3 + 4: AOSP 编译

```bash
cd /opt/aosp && source build/envsetup.sh && lunch clawos_gsi_arm64-trunk_staging-userdebug && m -j$(nproc)
```

> ⚠️ `source`/`lunch`/`make` 必须在**同一个 shell** 中，不能用管道接 `source`

**产物：`/opt/aosp/out/target/product/clawos_gsi_arm64/system.img` (~3.5 GB)**

### Step 5: 测试

**模拟器 (Mac):**
```bash
bash aosp/run-emulator-mac.sh --pull --lan --clean
```

**模拟器 (Windows ARM64):**
```powershell
.\aosp\run-emulator-win.ps1 -Pull -Lan -Clean
```

> ⚠️ 仅 ARM64 Windows 支持模拟器。x86_64 Windows 无法运行 ARM64 模拟器镜像。

**Pixel 8 Pro 镜像拉取 + 刷机 (Mac/Windows):**
```bash
# Mac
bash aosp/pull-pixel8pro-images-mac.sh --lan
bash aosp/flash-pixel8pro-mac.sh
```
```powershell
# Windows
.\aosp\pull-pixel8pro-images-win.ps1 -Lan
.\aosp\flash-pixel8pro-win.ps1
# 全自动刷机 (跳过确认):
.\aosp\flash-pixel8pro-win.ps1 -Auto -Wipe
```

**Pixel 8 Pro (手动刷写，动态分区，需要 fastbootd 模式):**
```bash
# 1. 进入 bootloader
adb reboot bootloader

# 2. 刷 vbmeta (禁用验证) — 在 bootloader 模式下
fastboot flash vbmeta_a /tmp/vbmeta_disabled.img
fastboot flash vbmeta_b /tmp/vbmeta_disabled.img

# 3. 切换到 fastbootd 刷 system
fastboot reboot fastboot
fastboot flash system /opt/aosp/out/target/product/clawos_gsi_arm64/system.img

# 4. 重启 (加 -w 可清除用户数据)
fastboot reboot
```

> ⚠️ **Pixel 8 Pro 刷写注意事项:**
> - `system.img` 必须在 **fastbootd** 模式下刷入（`fastboot reboot fastboot`），不能在 bootloader 模式直接刷
> - `vbmeta.img` 必须在 **bootloader** 模式下刷入（fastbootd 中会报 `No such file or directory`）
> - 刷入顺序: fastbootd 刷 system → bootloader 刷 vbmeta → `-w` 清数据 → reboot

**Lenovo Tab M10 (A-only 分区, 非动态):**
```bash
fastboot flash system system.img
fastboot --disable-verity --disable-verification flash vbmeta vbmeta.img
fastboot -w
fastboot reboot
```

## 关键规则

1. **`/opt/aosp` 是符号链接到 `/opt/aosp16`**，所有构建命令使用 `/opt/aosp` 即可
2. **lunch 格式是三段式**: `clawos_gsi_arm64-trunk_staging-userdebug`
3. 修改 `openclaw-default.json` 后先本地验证再构建
4. Gateway 运行时数据路径：`/data/local/tmp/clawos/` (shell:shell 所有, SELinux `shell_data_file`)
5. **Pixel 8 Pro 刷写**: vbmeta 用 bootloader 模式，system 用 fastbootd 模式
6. **设备树同步**: 使用 `05-setup-device-tree.sh`（自动同步到 `/opt/aosp` → `/opt/aosp16`）

## 关键文件

| 文件 | 说明 |
|------|------|
| `aosp/device/clawos/gateway/openclaw-default.json` | Gateway 默认配置（ROM 内置） |
| `aosp/device/clawos/gateway/start-gateway.sh` | Gateway 启动脚本 |
| `aosp/device/clawos/gateway/prepare-dirs.sh` | 目录准备脚本 (oneshot, shell 用户) |
| `aosp/device/clawos/gateway/gateway-bundle.tar.gz` | Gateway Node.js bundle |
| `aosp/device/clawos/gateway/setup-network.sh` | DNS resolv.conf + CA cert 配置 (root/oneshot) |
| `aosp/device/clawos/gateway/ota-update.mjs` | OTA 检查/下载/应用脚本 |
| `aosp/device/clawos/gateway/resolv.conf` | ROM 内置 DNS 回退配置 (公共 DNS) |
| `aosp/device/clawos/init/init.clawos.rc` | Android init 服务 (prepare → gateway, 含自动重启) |
| `aosp/device/clawos/clawos_gsi_arm64.mk` | GSI 产品定义 |
| `aosp/device/clawos/clawos_gsi_arm64/BoardConfig.mk` | GSI 板级配置 |
| `aosp/device/clawos/sepolicy/` | SELinux 策略 |
| `aosp/scripts/05-setup-device-tree.sh` | 设备树同步脚本 |
| `aosp/run-emulator-mac.sh` | Mac 模拟器拉取/运行脚本 |
| `aosp/run-emulator-win.ps1` | Windows 模拟器拉取/运行脚本 (仅 ARM64 Windows) |
| `aosp/pull-pixel8pro-images-mac.sh` | Mac Pixel 8 Pro 镜像拉取 |
| `aosp/pull-pixel8pro-images-win.ps1` | Windows Pixel 8 Pro 镜像拉取 |
| `aosp/flash-pixel8pro-mac.sh` | Mac Pixel 8 Pro 刷机脚本 |
| `aosp/flash-pixel8pro-win.ps1` | Windows Pixel 8 Pro 刷机脚本 |
| `ui/src/gateway/client.ts` | WebSocket RPC 客户端 |
| `ui/src/components/AddProviderWizard.tsx` | 模型提供商配置向导 |
| `ui/src/components/AppDrawer.tsx` | 应用列表抽屉 (上滑/HUD 按钮打开) |
| `ui/src/store/apps.ts` | 应用列表状态管理 (Zustand) |

## Gateway 服务架构

### 启动流程
```
sys.boot_completed=1
  → start clawos_prepare (oneshot, user=shell)
    → 创建 /data/local/tmp/clawos/ 下所有目录
  → init.svc.clawos_prepare=stopped
    → start clawos_gateway (user=shell)
      → Phase 1-7: 创建目录(双保险) → 复制配置 → 解压bundle → 启动Node.js
      → ws://127.0.0.1:18789
```

### 关键设计决策

- **目录**: `/data/local/tmp/clawos/` — shell:shell 所有，`shell_data_file` SELinux 类型
- **用户**: `user shell` (非 root) — DAC + SELinux 权限匹配
- **触发**: `init.svc.clawos_prepare=stopped` — init 内置属性，无需自定义属性权限
- **状态属性**: `clawos.gateway.status` (非 `ro.`) — 可多次更新
- **CDP Shim**: 失败为 non-fatal，不影响 Gateway 主进程
- **自动重启**: `init.clawos.rc` 中 `on property:init.svc.clawos_gateway=stopped` 会自动 `start clawos_gateway`
- **Gateway 重启机制**: ClawOSBridge 写入 `restart-gateway` 文件到 app cache → `start-gateway.sh` 的后台 watcher 检测到后 kill node 进程 → init 自动重启
- **DNS 配置**: `setup-network.sh` 三阶段: Phase 1 写入公共 DNS → Phase 2 等待网络 DNS → Phase 3 验证并修正

### ADB 调试
```bash
adb shell getprop clawos.gateway.status     # 检查 Gateway 状态
adb logcat -s ClawOS.Prepare clawos_gateway  # 查看日志
adb shell ps -A | grep node                 # 检查 node 进程
adb shell ls -laZ /data/local/tmp/clawos/   # 检查目录
```

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

### 重要: 必须使用 `--with-intl=small-icu`
Gateway 代码使用 Unicode 属性正则 (`\p{Extended_Pictographic}`) 和 `Intl.Segmenter` 等 API，`--without-intl` 会导致运行时崩溃。

## Gateway bundle 结构

从 2026.3.12 起，gateway-bundle.tar.gz 必须包含 `node_modules/`（~347 个 npm 包）。npm 发布的 tarball **不含** node_modules，需要在服务器上 `npm install --production` 后重新打包。

### 更新 gateway-bundle.tar.gz 的流程
```bash
cd /tmp && rm -rf openclaw-update && mkdir openclaw-update && cd openclaw-update
npm pack openclaw@latest --pack-destination .
tar xzf openclaw-*.tgz && cd package
npm install --production --no-optional
# 精简 node_modules
find node_modules -name "*.d.ts" -o -name "*.map" -o -name "*.md" -o -name "LICENSE*" | xargs rm -f 2>/dev/null
find node_modules -type d \( -name test -o -name tests -o -name docs -o -name examples \) -exec rm -rf {} + 2>/dev/null
# 打包 (不含 package.json)
tar czf /opt/ClawOS/aosp/device/clawos/gateway/gateway-bundle.tar.gz \
  --exclude=package.json --exclude='.git*' --exclude='CHANGELOG*' --exclude='README*' .
# 更新版本号
echo "版本号" > /opt/ClawOS/aosp/device/clawos/gateway/gateway-version.txt
```

## Gateway 配置注意事项

| 配置项 | 正确值 |
|--------|--------|
| `models.providers.ollama.api` | `"openai-completions"` |
| `models.providers.ollama.baseUrl` | `"http://10.0.2.2:11434/v1"` |
| `sessions.patch` 参数 | `key` + `model` |
| `gateway.controlUi.dangerouslyDisableDeviceAuth` | `true` |

## Gateway 2026.3.12 Scope/Auth 机制

Gateway 2026.3.12 引入了设备身份验证 (device pairing) 安全机制。对没有设备身份的非 Control-UI 客户端，所有 scopes 在握手时会被清空，导致 RPC 调用失败。

**解决方案**: 客户端 ID 使用 `openclaw-control-ui` (而非 `webchat-ui`)，配合 `gateway.controlUi.dangerouslyDisableDeviceAuth: true` 跳过设备身份验证。

| 组件 | 值 |
|------|-----|
| 客户端 ID (`client.ts`) | `openclaw-control-ui` |
| 客户端 mode | `webchat` (保持不变，确保 webchat 功能正常) |
| 请求的 scopes | `['operator.admin']` |
| 配置 (`openclaw-default.json`) | `gateway.controlUi.dangerouslyDisableDeviceAuth: true` |

## Gateway bundle 修改流程

修改 `/tmp/gateway-bundle/dist/` 下的 JS 文件后：

```bash
cd /tmp/gateway-bundle && tar -czf /opt/ClawOS/aosp/device/clawos/gateway/gateway-bundle.tar.gz .
```

然后执行 Step 2 → 3 → 4。

## 已验证真机设备

| 设备 | SoC | 分区方案 | 原厂 Android | AOSP 源码 | lunch 目标 | 刷写方式 | 状态 |
|------|-----|---------|-------------|----------|-----------|---------|------|
| Google Pixel 8 Pro | Tensor G3 | A/B, 动态分区 | Android 16 | `/opt/aosp` (→ aosp16) | `clawos_gsi_arm64-trunk_staging-userdebug` | vbmeta(bootloader) → system(fastbootd) | ✅ 可用 |
| Lenovo Tab M10 FHD Plus (TB-X606F) | MT8768 | A-only, 非动态 | Android 10 | `/opt/aosp12` | `clawos_gsi_arm64-userdebug` | bootloader 直接刷 | ✅ 可用 |

### Pixel 8 Pro 特殊说明

- **动态分区**: system 分区大小可动态调整，必须在 fastbootd 模式下刷写
- **A/B 分区**: 有 `system_a` 和 `system_b` 两个 slot，fastboot 自动选择当前活跃 slot
- **Android 16 源码**: AOSP 16 (`Baklava`) 分支，BUILD_ID 为 `BP4A.251205.006`
- **编译时间**: 全量编译约 2 小时 (20 核 CPU)，增量编译约 30-60 分钟
- **`Android.bp` 兼容**: AOSP 16 的 `android_app_import` 不支持 `preprocessed: true`
- **`nsjail` 警告**: `Build sandboxing disabled due to nsjail error` 是正常的，不影响编译
- **ninja 编译 exit code 1**: 即使核心产物 (system.img, vbmeta.img) 已正确生成，ninja 可能在非关键后处理步骤返回 exit code 1，检查 `soong.log` 最后几行确认关键产物是否生成

### Android 16 vs Android 12 的关键差异

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
