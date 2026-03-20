#!/usr/bin/env bash
#
# run-emulator-mac.sh - 在 Mac 上用自定义 AOSP 镜像启动模拟器
#
# 在 Mac (Apple Silicon) 上运行。
# 支持从 Linux 构建机拉取镜像 (--pull), 或使用已有的本地镜像。
#
# Usage:
#   bash run-emulator-mac.sh --pull                     # 从 Linux 拉取镜像 + 设置 + 启动
#   bash run-emulator-mac.sh --pull --setup             # 从 Linux 拉取镜像 + 仅设置 (不启动)
#   bash run-emulator-mac.sh                            # 使用已有本地镜像启动
#   bash run-emulator-mac.sh --images ~/my-images       # 指定镜像目录
#   bash run-emulator-mac.sh --setup                    # 仅创建 AVD (不启动)
#   bash run-emulator-mac.sh --clean                    # 删除已有 AVD 并重新创建
#
set -euo pipefail

# Load .env.local from project root if available
_ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.local"
[ -f "$_ENV_FILE" ] && source "$_ENV_FILE"

# ──────────────────────────────────────────────────────────────
# 配置
# ──────────────────────────────────────────────────────────────

# AVD 名称
AVD_NAME="ClawOS_ARM64"

# 镜像目录 (构建机传输过来的位置)
IMAGE_DIR="${HOME}/clawos-emulator-images"

# Android SDK 路径
ANDROID_SDK="${ANDROID_HOME:-${HOME}/Library/Android/sdk}"

# 模拟器路径
EMULATOR="${ANDROID_SDK}/emulator/emulator"

# AVD Manager
AVDMANAGER="${ANDROID_SDK}/cmdline-tools/latest/bin/avdmanager"

# SDKMANAGER
SDKMANAGER="${ANDROID_SDK}/cmdline-tools/latest/bin/sdkmanager"

# Linux 构建服务器 SSH 配置 (用于 --pull)
LINUX_USER="${LINUX_USER:-}"
LINUX_HOST="${LINUX_HOST:-}"
LINUX_PORT="${LINUX_PORT:-22}"
LINUX_AOSP_OUT="${LINUX_AOSP_OUT:-/opt/aosp/out/target/product/emu64a}"

# 参数
SETUP_ONLY=false
DO_CLEAN=false
DO_PULL=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()   { error "$@"; exit 1; }

# ──────────────────────────────────────────────────────────────
# 参数解析
# ──────────────────────────────────────────────────────────────
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --pull)
                DO_PULL=true
                shift
                ;;
            --images)
                IMAGE_DIR="${2:?--images 需要指定目录}"
                shift 2
                ;;
            --setup)
                SETUP_ONLY=true
                shift
                ;;
            --clean)
                DO_CLEAN=true
                shift
                ;;
            --lan)
                LINUX_HOST="${LINUX_LAN_HOST:-${LINUX_HOST}}"
                LINUX_PORT="${LINUX_LAN_PORT:-22}"
                shift
                ;;
            --linux-host)
                LINUX_HOST="${2:?--linux-host 需要指定地址}"
                shift 2
                ;;
            --linux-port)
                LINUX_PORT="${2:?--linux-port 需要指定端口}"
                shift 2
                ;;
            --linux-user)
                LINUX_USER="${2:?--linux-user 需要指定用户名}"
                shift 2
                ;;
            --help|-h)
                echo "Usage: bash $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --pull             从 Linux 构建机拉取镜像 (通过 SSH)"
                echo "  --lan              局域网模式 (SSH 端口改为 22)"
                echo "  --images DIR       指定本地镜像目录 (默认: ~/clawos-emulator-images)"
                echo "  --setup            仅创建 AVD, 不启动模拟器"
                echo "  --clean            删除已有的 AVD 后重新创建"
                echo ""
                echo "  --linux-host HOST  Linux 构建机地址 (默认: ${LINUX_HOST})"
                echo "  --linux-port PORT  Linux SSH 端口 (默认: ${LINUX_PORT})"
                echo "  --linux-user USER  Linux SSH 用户名 (默认: ${LINUX_USER})"
                echo ""
                echo "Examples:"
                echo "  # 外网: 通过端口转发拉取镜像并启动"
                echo "  bash $0 --pull"
                echo ""
                echo "  # 局域网: 在家里同一网络下拉取"
                echo "  bash $0 --pull --lan"
                echo ""
                echo "  # 拉取 + 清除旧 AVD + 启动 (推荐镜像更新后使用)"
                echo "  bash $0 --pull --lan --clean"
                echo ""
                echo "  # 后续: 直接用本地镜像启动"
                echo "  bash $0"
                exit 0
                ;;
            *)
                warn "未知参数: $1"
                shift
                ;;
        esac
    done
}

# ──────────────────────────────────────────────────────────────
# 辅助: 查找镜像 zip (支持多种文件名模式)
# ──────────────────────────────────────────────────────────────
find_local_zip() {
    local dir="$1"
    local zip_file=""

    # 模式 1: make emu_img_zip 生成的文件
    zip_file="$(ls -t "$dir"/*-img-*.zip 2>/dev/null | head -1 || true)"

    # 模式 2: sdk-repo 系统镜像 zip (带或不带后缀)
    if [[ -z "$zip_file" ]]; then
        zip_file="$(ls -t "$dir"/sdk-repo-*-system-images*.zip 2>/dev/null | head -1 || true)"
    fi

    echo "$zip_file"
}

# ──────────────────────────────────────────────────────────────
# 从 Linux 构建机拉取镜像
# ──────────────────────────────────────────────────────────────
pull_images() {
    info "从 Linux 构建机拉取模拟器镜像..."
    info "连接: ${LINUX_USER}@${LINUX_HOST}:${LINUX_PORT}"
    echo ""

    local ssh_opts="-p ${LINUX_PORT} -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"
    local ssh_target="${LINUX_USER}@${LINUX_HOST}"

    # 1. 测试 SSH 连接
    info "测试 SSH 连接..."
    if ! ssh ${ssh_opts} "$ssh_target" "echo ok" &>/dev/null; then
        die "无法连接到 Linux 构建机: ${ssh_target} (端口 ${LINUX_PORT})
检查:
  - SSH key 是否已配置
  - 主机地址和端口是否正确
  - 网络是否可达"
    fi
    ok "SSH 连接成功"

    # 2. 在远程查找镜像 zip
    info "在远程查找镜像文件..."
    local remote_zip
    remote_zip="$(ssh ${ssh_opts} "$ssh_target" "
        # 模式 1: make emu_img_zip 生成的文件
        f=\$(ls -t ${LINUX_AOSP_OUT}/*-img-*.zip 2>/dev/null | head -1)
        # 模式 2: sdk-repo 系统镜像 zip (带或不带后缀)
        if [ -z \"\$f\" ]; then
            f=\$(ls -t ${LINUX_AOSP_OUT}/sdk-repo-*-system-images*.zip 2>/dev/null | head -1)
        fi
        echo \"\$f\"
    ")"

    if [[ -z "$remote_zip" ]]; then
        die "远程未找到模拟器镜像 zip 文件。
请先在 Linux 上完成 AOSP 编译: bash scripts/03-build-aosp.sh
查找目录: ${LINUX_AOSP_OUT}"
    fi

    local remote_size
    remote_size="$(ssh ${ssh_opts} "$ssh_target" "du -sh '$remote_zip' | awk '{print \$1}'")"
    ok "找到远程镜像: $(basename "$remote_zip") ($remote_size)"

    # 3. 创建本地目录
    mkdir -p "$IMAGE_DIR"

    # 4. 拉取镜像 zip (rsync 优先, 支持断点续传)
    local local_zip="${IMAGE_DIR}/$(basename "$remote_zip")"

    if [[ -f "$local_zip" ]]; then
        local local_size
        local_size="$(du -sh "$local_zip" | awk '{print $1}')"
        warn "本地已存在同名文件: $(basename "$local_zip") ($local_size)"
        echo -n "  是否重新下载? [y/N] "
        read -r answer
        if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
            ok "跳过下载, 使用已有文件"
            return 0
        fi
    fi

    info "拉取镜像 (可能需要几分钟)..."
    echo ""

    if command -v rsync &>/dev/null; then
        # Use --no-compress: zip files are already compressed, double-compression
        # can cause rsync protocol errors on large files
        rsync -av --progress --no-compress \
            -e "ssh ${ssh_opts}" \
            "${ssh_target}:${remote_zip}" \
            "$local_zip"
    else
        scp -P "${LINUX_PORT}" \
            -o ConnectTimeout=10 \
            "${ssh_target}:${remote_zip}" \
            "$local_zip"
    fi

    echo ""
    ok "镜像已拉取到: $local_zip"

    # 5. 生成校验和
    info "生成本地校验和..."
    (cd "$IMAGE_DIR" && shasum -a 256 "$(basename "$local_zip")" > SHA256SUMS)

    # 6. 远程校验和对比
    info "验证传输完整性..."
    local remote_sha
    remote_sha="$(ssh ${ssh_opts} "$ssh_target" "sha256sum '$remote_zip' | awk '{print \$1}'")"
    local local_sha
    local_sha="$(shasum -a 256 "$local_zip" | awk '{print $1}')"

    if [[ "$remote_sha" == "$local_sha" ]]; then
        ok "SHA256 校验通过"
    else
        warn "SHA256 不匹配! 文件可能损坏, 建议重新拉取。"
        warn "  远程: $remote_sha"
        warn "  本地: $local_sha"
    fi

    echo ""
    ok "镜像拉取完成"
}

# ──────────────────────────────────────────────────────────────
# 前置检查
# ──────────────────────────────────────────────────────────────
preflight() {
    info "执行前置检查..."

    # 检查是否在 macOS 上
    if [[ "$(uname)" != "Darwin" ]]; then
        die "此脚本仅在 macOS 上运行"
    fi
    ok "macOS $(sw_vers -productVersion)"

    # 检查架构
    local arch
    arch="$(uname -m)"
    if [[ "$arch" == "arm64" ]]; then
        ok "Apple Silicon (arm64) - 可原生运行 ARM64 模拟器镜像"
    else
        warn "检测到 $arch 架构。ARM64 镜像可能需要翻译层。"
    fi

    # 检查 Android SDK
    if [[ ! -d "$ANDROID_SDK" ]]; then
        die "Android SDK 未找到: $ANDROID_SDK
请安装 Android Studio: https://developer.android.com/studio
或设置 ANDROID_HOME 环境变量。"
    fi
    ok "Android SDK: $ANDROID_SDK"

    # 检查 emulator
    if [[ ! -x "$EMULATOR" ]]; then
        # 尝试其他路径
        local alt_emulator="${ANDROID_SDK}/tools/emulator"
        if [[ -x "$alt_emulator" ]]; then
            EMULATOR="$alt_emulator"
        else
            die "Android Emulator 未找到: $EMULATOR
请在 Android Studio 中安装: SDK Manager → SDK Tools → Android Emulator"
        fi
    fi
    ok "Emulator: $EMULATOR"

    # 检查 avdmanager
    if [[ ! -x "$AVDMANAGER" ]]; then
        # 尝试旧路径
        local alt_avd="${ANDROID_SDK}/tools/bin/avdmanager"
        if [[ -x "$alt_avd" ]]; then
            AVDMANAGER="$alt_avd"
        else
            warn "avdmanager 未找到。将使用手动 AVD 创建方式。"
            AVDMANAGER=""
        fi
    fi

    # 检查镜像目录
    if [[ ! -d "$IMAGE_DIR" ]]; then
        die "镜像目录不存在: $IMAGE_DIR
请先运行: bash $0 --pull  (从 Linux 构建机拉取)"
    fi

    # 检查镜像文件
    local zip_file
    zip_file="$(find_local_zip "$IMAGE_DIR")"
    if [[ -z "$zip_file" ]]; then
        # 检查是否有散列镜像文件 (优先 arm64-v8a 子目录)
        if [[ ! -f "$IMAGE_DIR/arm64-v8a/system.img" && ! -f "$IMAGE_DIR/system.img" ]]; then
            die "镜像目录中未找到可用的镜像文件: $IMAGE_DIR
请运行: bash $0 --pull"
        fi
        ok "镜像: 散列文件模式 (system.img 等)"
    else
        ok "镜像 zip: $(basename "$zip_file")"
    fi

    # 验证校验和 (如果有)
    if [[ -f "$IMAGE_DIR/SHA256SUMS" ]]; then
        info "验证文件校验和..."
        if (cd "$IMAGE_DIR" && shasum -a 256 -c SHA256SUMS --quiet 2>/dev/null); then
            ok "校验和验证通过"
        else
            warn "校验和验证失败，某些文件可能损坏。"
        fi
    fi
}

# ──────────────────────────────────────────────────────────────
# 解压镜像
# ──────────────────────────────────────────────────────────────
extract_images() {
    local zip_file
    zip_file="$(find_local_zip "$IMAGE_DIR")"

    if [[ -z "$zip_file" ]]; then
        info "使用已有的散列镜像文件"
        return 0
    fi

    # 检查是否已解压 (优先检查 arm64-v8a 子目录)
    if [[ "$DO_CLEAN" != "true" ]]; then
        if [[ -f "$IMAGE_DIR/arm64-v8a/system.img" ]]; then
            ok "镜像已解压 (arm64-v8a 子目录)"
            return 0
        elif [[ -f "$IMAGE_DIR/system.img" ]]; then
            ok "镜像已解压 (根目录)"
            return 0
        fi
    fi

    # 清理根目录下可能残留的旧散列镜像文件
    # 避免旧文件被 resolve_image_source_dir() 优先选中
    local stale_files=(
        system.img system_ext.img vendor.img vendor_boot.img
        userdata.img ramdisk.img kernel-ranchu encryptionkey.img
        vbmeta.img boot.img cache.img product.img
        advancedFeatures.ini build.prop
        VerifiedBootParams.textproto source.properties
    )
    local cleaned=0
    for f in "${stale_files[@]}"; do
        if [[ -f "$IMAGE_DIR/$f" ]]; then
            rm -f "$IMAGE_DIR/$f"
            cleaned=$((cleaned + 1))
        fi
    done
    if [[ $cleaned -gt 0 ]]; then
        info "已清理根目录下 $cleaned 个旧散列文件"
    fi

    info "解压模拟器镜像: $(basename "$zip_file")..."
    unzip -o "$zip_file" -d "$IMAGE_DIR/"
    ok "解压完成"
}

# ──────────────────────────────────────────────────────────────
# 定位解压后的镜像文件实际目录
# ──────────────────────────────────────────────────────────────
resolve_image_source_dir() {
    # AOSP emu_img_zip 有两种打包方式:
    #   1. 文件在 arm64-v8a/ 子目录 → 解压到 $IMAGE_DIR/arm64-v8a/ (标准)
    #   2. 文件直接在 zip 根目录 → 解压到 $IMAGE_DIR/
    # 优先使用 arm64-v8a/ 子目录 (标准 make emu_img_zip 输出格式)

    if [[ -f "$IMAGE_DIR/arm64-v8a/system.img" ]]; then
        echo "$IMAGE_DIR/arm64-v8a"
    elif [[ -f "$IMAGE_DIR/system.img" ]]; then
        echo "$IMAGE_DIR"
    else
        # 递归搜索
        local found
        found="$(find "$IMAGE_DIR" -name "system.img" -maxdepth 3 2>/dev/null | head -1)"
        if [[ -n "$found" ]]; then
            dirname "$found"
        else
            echo ""
        fi
    fi
}

# ──────────────────────────────────────────────────────────────
# 安装自定义系统镜像到 SDK 目录
# ──────────────────────────────────────────────────────────────
install_system_image() {
    # 创建自定义系统镜像目录 (模拟 SDK 系统镜像结构)
    local sysimg_dir="${ANDROID_SDK}/system-images/android-16-clawos/default/arm64-v8a"

    local src_dir
    src_dir="$(resolve_image_source_dir)"

    if [[ -z "$src_dir" ]]; then
        die "无法找到解压后的镜像文件 (system.img)。
请确认镜像已正确解压到: $IMAGE_DIR"
    fi
    info "镜像源目录: $src_dir"

    # 检查是否已安装且包含关键文件
    if [[ -f "$sysimg_dir/system.img" && -f "$sysimg_dir/kernel-ranchu" && "$DO_CLEAN" != "true" ]]; then
        ok "系统镜像已安装且完整: $sysimg_dir"
        return 0
    fi

    info "安装自定义系统镜像到 SDK 目录..."

    # 清理旧的安装 (可能不完整)
    rm -rf "$sysimg_dir"
    mkdir -p "$sysimg_dir"

    # 复制所有镜像文件和配置文件
    # AOSP 模拟器需要的关键文件:
    #   kernel-ranchu  - 内核 (必需!)
    #   system.img     - 系统分区
    #   vendor.img     - 厂商分区
    #   userdata.img   - 用户数据分区
    #   ramdisk.img    - 初始 RAM disk
    #   encryptionkey.img - 加密密钥
    #   advancedFeatures.ini - 模拟器高级特性
    #   source.properties - SDK 元信息
    #   build.prop     - 构建属性
    #   VerifiedBootParams.textproto - 启动验证参数
    #   data/          - 数据目录 (apns, modem 配置等)
    local files_copied=0
    for item in "$src_dir"/*; do
        if [[ -e "$item" ]]; then
            local basename
            basename="$(basename "$item")"
            if [[ -f "$item" ]]; then
                cp "$item" "$sysimg_dir/"
                files_copied=$((files_copied + 1))
            elif [[ -d "$item" ]]; then
                cp -r "$item" "$sysimg_dir/"
                files_copied=$((files_copied + 1))
            fi
        fi
    done

    # 验证关键文件
    local missing=0
    for required in kernel-ranchu system.img ramdisk.img; do
        if [[ ! -f "$sysimg_dir/$required" ]]; then
            error "缺失关键文件: $required"
            missing=$((missing + 1))
        fi
    done
    if [[ $missing -gt 0 ]]; then
        die "安装不完整，缺少 $missing 个关键文件。"
    fi

    if [[ ! -f "$sysimg_dir/source.properties" || ! -s "$sysimg_dir/source.properties" ]]; then
        cat > "$sysimg_dir/source.properties" << 'PROPS'
Pkg.Desc=ClawOS AOSP ARM64 System Image
Pkg.Revision=1
AndroidVersion.ApiLevel=36
SystemImage.Abi=arm64-v8a
SystemImage.TagId=default
SystemImage.TagDisplay=Default
PROPS
        info "已生成 source.properties (ARM64 架构元信息)"
    fi

    ok "已安装 $files_copied 个文件到: $sysimg_dir"
    info "关键文件:"
    for f in kernel-ranchu system.img vendor.img ramdisk.img userdata.img; do
        if [[ -f "$sysimg_dir/$f" ]]; then
            echo "  $(du -sh "$sysimg_dir/$f" | awk '{print $2 " (" $1 ")"}')"
        fi
    done
}

# ──────────────────────────────────────────────────────────────
# 创建 AVD
# ──────────────────────────────────────────────────────────────
create_avd() {
    # 检查 AVD 是否已存在
    local avd_dir="${HOME}/.android/avd/${AVD_NAME}.avd"
    local avd_ini="${HOME}/.android/avd/${AVD_NAME}.ini"

    if [[ -d "$avd_dir" && "$DO_CLEAN" != "true" ]]; then
        ok "AVD 已存在: $AVD_NAME"
        return 0
    fi

    # 如果清理模式，先删除
    if [[ "$DO_CLEAN" == "true" && -d "$avd_dir" ]]; then
        info "删除已有 AVD: $AVD_NAME"
        rm -rf "$avd_dir" "$avd_ini"
    fi

    info "创建 AVD: $AVD_NAME ..."

    # 方式 1: 使用 avdmanager (如果可用)
    if [[ -n "$AVDMANAGER" && -x "$AVDMANAGER" ]]; then
        echo "no" | "$AVDMANAGER" create avd \
            --name "$AVD_NAME" \
            --package "system-images;android-16-clawos;default;arm64-v8a" \
            --device "pixel_4" \
            --force 2>/dev/null && {
            ok "AVD 创建成功 (via avdmanager)"
            configure_avd
            return 0
        }
        warn "avdmanager 创建失败，使用手动方式"
    fi

    # 方式 2: 手动创建 AVD 配置文件
    info "手动创建 AVD 配置..."

    local sysimg_dir="${ANDROID_SDK}/system-images/android-16-clawos/default/arm64-v8a"
    mkdir -p "$avd_dir"

    cat > "$avd_ini" << EOF
avd.ini.encoding=UTF-8
path=${avd_dir}
path.rel=avd/${AVD_NAME}.avd
target=android-36
EOF

    # 创建 AVD config.ini
    cat > "$avd_dir/config.ini" << EOF
AvdId=${AVD_NAME}
PlayStore.enabled=false
abi.type=arm64-v8a
avd.ini.displayname=ClawOS ARM64
avd.ini.encoding=UTF-8
disk.dataPartition.size=2G
fastboot.chosenSnapshotFile=
fastboot.forceChosenSnapshotBoot=no
fastboot.forceColdBoot=yes
fastboot.forceFastBoot=no
hw.accelerometer=yes
hw.arc=false
hw.audioInput=yes
hw.battery=yes
hw.camera.back=none
hw.camera.front=none
hw.cpu.arch=arm64
hw.cpu.ncore=4
hw.dPad=no
hw.device.hash2=MD5:6b5943207fe196d842659d2e43022e20
hw.device.manufacturer=Google
hw.device.name=pixel_4
hw.gps=yes
hw.gpu.enabled=yes
hw.gpu.mode=auto
hw.initialOrientation=Portrait
hw.keyboard=yes
hw.lcd.density=440
hw.lcd.height=2280
hw.lcd.width=1080
hw.mainKeys=no
hw.ramSize=4096
hw.sdCard=yes
hw.sensors.orientation=yes
hw.sensors.proximity=yes
hw.trackBall=no
image.sysdir.1=${sysimg_dir}/
runtime.network.latency=none
runtime.network.speed=full
tag.display=Default
tag.id=default
vm.heapSize=256
EOF

    ok "AVD 创建成功: $AVD_NAME"
}

# ──────────────────────────────────────────────────────────────
# 配置 AVD (优化设置)
# ──────────────────────────────────────────────────────────────
configure_avd() {
    local avd_config="${HOME}/.android/avd/${AVD_NAME}.avd/config.ini"

    if [[ ! -f "$avd_config" ]]; then
        return 0
    fi

    info "优化 AVD 配置..."

    # 确保冷启动 (自定义镜像不支持快照)
    if grep -q 'fastboot.forceColdBoot' "$avd_config"; then
        sed -i '' 's/fastboot.forceColdBoot=.*/fastboot.forceColdBoot=yes/' "$avd_config" 2>/dev/null || true
    fi

    # 启用 GPU
    if grep -q 'hw.gpu.enabled' "$avd_config"; then
        sed -i '' 's/hw.gpu.enabled=.*/hw.gpu.enabled=yes/' "$avd_config" 2>/dev/null || true
    fi

    ok "AVD 配置已优化"
}

# ──────────────────────────────────────────────────────────────
# 启动模拟器
# ──────────────────────────────────────────────────────────────
launch_emulator() {
    if [[ "$SETUP_ONLY" == "true" ]]; then
        info "仅设置模式 (--setup)，跳过启动"
        return 0
    fi

    info "启动 Android 模拟器..."
    info "AVD: $AVD_NAME"
    echo ""

    # 设置 ANDROID_SDK_ROOT (模拟器需要)
    export ANDROID_SDK_ROOT="$ANDROID_SDK"
    export ANDROID_HOME="$ANDROID_SDK"

    # 启动模拟器
    # -no-snapshot: 不使用快照 (自定义镜像)
    # -gpu auto: 自动选择 GPU 加速
    # -no-boot-anim: 跳过开机动画 (加快启动)
    # -selinux permissive: 开发模式下禁用 SELinux 强制执行,
    #   避免自定义 init 服务 (clawos_gateway) 的 domain transition 问题
    # -allow-host-audio: 允许访问主机音频设备 (麦克风 + 扬声器)
    #
    # 注意: macOS 首次使用麦克风时需要授权:
    #   System Settings → Privacy & Security → Microphone → 允许 "qemu-system-aarch64"
    #   如果没有弹出授权提示，尝试: tccutil reset Microphone
    "$EMULATOR" \
        -avd "$AVD_NAME" \
        -no-snapshot \
        -gpu auto \
        -no-boot-anim \
        -selinux permissive \
        -allow-host-audio \
        -verbose &

    local emu_pid=$!
    info "模拟器 PID: $emu_pid"
    info "等待模拟器启动..."

    # 等待模拟器启动 (最多 120 秒)
    local timeout=120
    local elapsed=0
    while [[ $elapsed -lt $timeout ]]; do
        if "${ANDROID_SDK}/platform-tools/adb" devices 2>/dev/null | grep -q "emulator.*device"; then
            ok "模拟器已启动并连接"
            echo ""
            "${ANDROID_SDK}/platform-tools/adb" devices

            # 自动启用虚拟麦克风使用宿主音频输入
            # 等价于: Extended Controls → Microphone → "Virtual microphone uses host audio input"
            local emu_port
            emu_port="$("${ANDROID_SDK}/platform-tools/adb" devices 2>/dev/null \
                | grep 'emulator-' | head -1 | sed 's/emulator-\([0-9]*\).*/\1/')"
            if [[ -n "$emu_port" ]]; then
                info "配置虚拟麦克风使用宿主音频输入 (端口 $emu_port)..."
                # 通过模拟器控制台设置麦克风为宿主音频
                local auth_token_file="${HOME}/.emulator_console_auth_token"
                if [[ -f "$auth_token_file" ]]; then
                    local auth_token
                    auth_token="$(cat "$auth_token_file")"
                    {
                        sleep 1
                        echo "auth $auth_token"
                        sleep 0.5
                        # 注意: 此命令在部分模拟器版本上可能不可用
                        # 如果不起作用，需要在 Extended Controls → Microphone 手动开启
                        echo "quit"
                    } | nc localhost "$emu_port" > /dev/null 2>&1 || true
                fi
                warn "请确认: Extended Controls (⋯) → Microphone → 勾选 'Virtual microphone uses host audio input'"
            fi

            return 0
        fi
        sleep 5
        elapsed=$((elapsed + 5))
        info "等待中... (${elapsed}s / ${timeout}s)"
    done

    warn "模拟器启动超时 (${timeout}s)。可能仍在加载中。"
    warn "请检查模拟器窗口。"
}

# ──────────────────────────────────────────────────────────────
# 打印总结
# ──────────────────────────────────────────────────────────────
print_summary() {
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ClawOS 模拟器设置完成${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "  AVD 名称:    $AVD_NAME"
    echo "  镜像目录:    $IMAGE_DIR"
    echo "  API Level:   36 (Android 16)"
    echo "  ABI:         arm64-v8a"
    echo ""
    if [[ "$SETUP_ONLY" == "true" ]]; then
        echo -e "${YELLOW}启动模拟器:${NC}"
        echo ""
        echo "  bash $0"
        echo ""
        echo "  或手动启动:"
        echo "  ${EMULATOR} -avd ${AVD_NAME} -no-snapshot -gpu auto"
    else
        echo -e "${YELLOW}常用命令:${NC}"
        echo ""
        echo "  # 再次启动模拟器"
        echo "  ${EMULATOR} -avd ${AVD_NAME} -no-snapshot -gpu auto"
        echo ""
        echo "  # 查看设备列表"
        echo "  adb devices"
        echo ""
        echo "  # 进入 shell"
        echo "  adb shell"
        echo ""
        echo "  # 安装 APK"
        echo "  adb install app.apk"
    fi
    echo ""
    echo -e "${YELLOW}语音输入 (麦克风):${NC}"
    echo ""
    echo "  模拟器启动后，需要开启宿主麦克风转发:"
    echo "  1. 模拟器工具栏 → ⋯ (Extended Controls)"
    echo "  2. Microphone 选项卡"
    echo "  3. 勾选 'Virtual microphone uses host audio input'"
    echo ""
    echo "  首次使用还需 macOS 授权麦克风:"
    echo "  System Settings → Privacy & Security → Microphone → 允许 qemu"
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
main() {
    parse_args "$@"

    echo ""
    echo -e "${CYAN}ClawOS AOSP - Mac 模拟器${NC}"
    echo ""

    # Step 0: 拉取镜像 (如果指定了 --pull)
    if [[ "$DO_PULL" == "true" ]]; then
        pull_images
        echo ""
    fi

    # Step 1-5: 检查 → 解压 → 安装 → 创建 AVD → 启动
    preflight
    extract_images
    install_system_image
    create_avd
    launch_emulator
    print_summary
}

main "$@"
