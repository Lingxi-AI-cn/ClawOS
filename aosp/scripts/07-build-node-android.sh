#!/usr/bin/env bash
#
# 07-build-node-android.sh - Cross-compile Node.js 22 for Android ARM64
#
# Compiles Node.js 22 LTS targeting Android ARM64 using the Android NDK.
# Uses Node.js's built-in android-configure script.
# The resulting binary is placed in the ClawOS device tree for AOSP ROM integration.
#
# Prerequisites:
#   - Android NDK r26 installed at $ANDROID_HOME/ndk/26.1.10909125
#   - Python 3, git, make, g++ (host build tools)
#
# Usage:
#   bash scripts/07-build-node-android.sh           # Full build
#   bash scripts/07-build-node-android.sh --clean    # Clean and rebuild
#   bash scripts/07-build-node-android.sh --check    # Check prerequisites only
#
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ──────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────
NODE_VERSION="22.13.1"
NODE_TARBALL_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}.tar.gz"

ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
NDK_VERSION="26.1.10909125"
NDK_PATH="$ANDROID_HOME/ndk/$NDK_VERSION"
ANDROID_API=24  # Minimum API level (Android 7.0+)

CLAWOS_ROOT="${CLAWOS_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
BUILD_DIR="${CLAWOS_ROOT}/build/node-android"
SOURCE_DIR="$BUILD_DIR/node-v${NODE_VERSION}"
OUTPUT_DIR="${CLAWOS_ROOT}/aosp/device/clawos/prebuilt"

JOBS=$(nproc)

# ──────────────────────────────────────────────────────────────
# Prerequisites Check
# ──────────────────────────────────────────────────────────────
check_prereqs() {
    info "检查编译环境..."

    local missing=()

    [[ -d "$NDK_PATH" ]] || missing+=("NDK at $NDK_PATH")

    for cmd in python3 git make g++ cc wget; do
        command -v "$cmd" &>/dev/null || missing+=("$cmd")
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        die "缺少依赖:\n$(printf '  - %s\n' "${missing[@]}")"
    fi

    # Check NDK toolchain
    local toolchain="$NDK_PATH/toolchains/llvm/prebuilt/linux-x86_64"
    [[ -f "$toolchain/bin/aarch64-linux-android${ANDROID_API}-clang" ]] || \
        die "NDK 工具链不完整: 缺少 aarch64-linux-android${ANDROID_API}-clang"

    ok "所有依赖已满足"
    echo "  NDK: $NDK_PATH"
    echo "  目标: aarch64-linux-android (API $ANDROID_API)"
    echo "  Node.js: v${NODE_VERSION}"
    echo "  并行度: $JOBS"
}

# ──────────────────────────────────────────────────────────────
# Download & Extract Source
# ──────────────────────────────────────────────────────────────
prepare_source() {
    info "准备 Node.js v${NODE_VERSION} 源码..."

    mkdir -p "$BUILD_DIR"

    local tarball="$BUILD_DIR/node-v${NODE_VERSION}.tar.gz"

    if [[ -d "$SOURCE_DIR" && -f "$SOURCE_DIR/configure" ]]; then
        ok "源码已存在: $SOURCE_DIR"
        return 0
    fi

    if [[ ! -f "$tarball" ]]; then
        info "下载 Node.js v${NODE_VERSION} 源码..."
        wget -q --show-progress -O "$tarball" "$NODE_TARBALL_URL"
    fi

    info "解压..."
    tar -xzf "$tarball" -C "$BUILD_DIR"

    [[ -f "$SOURCE_DIR/configure" ]] || die "解压失败: $SOURCE_DIR/configure 不存在"

    ok "Node.js 源码准备完成"
}

# ──────────────────────────────────────────────────────────────
# Apply Android Patches
# ──────────────────────────────────────────────────────────────
apply_patches() {
    cd "$SOURCE_DIR"

    info "应用 Android 兼容性补丁..."

    # Patch 1: Fix missing execinfo.h (backtrace not available on Android < 33)
    if grep -q '#include <execinfo.h>' src/node_internals.h 2>/dev/null; then
        info "  补丁: 跳过 execinfo.h..."
        sed -i 's/#include <execinfo.h>/\/\/ #include <execinfo.h> \/\/ Android: not available/' \
            src/node_internals.h
    fi

    # Patch 2: Fix FICLONE ioctl not available on Android
    if grep -q 'FICLONE' src/node_file.cc 2>/dev/null; then
        info "  补丁: 跳过 FICLONE..."
        sed -i 's/defined(__linux__) || defined(__FreeBSD__)/defined(__linux__) \&\& !defined(__ANDROID__) || defined(__FreeBSD__)/' \
            src/node_file.cc 2>/dev/null || true
    fi

    # Patch 3: Ensure android-configure exists and is executable
    if [[ -f "android-configure" ]]; then
        chmod +x android-configure
        ok "android-configure 脚本可用"
    else
        warn "android-configure 不存在，将使用手动配置"
    fi

    ok "补丁应用完成"
}

# ──────────────────────────────────────────────────────────────
# Configure & Build
# ──────────────────────────────────────────────────────────────
build_node() {
    cd "$SOURCE_DIR"

    info "配置 Node.js for Android ARM64..."

    local toolchain="$NDK_PATH/toolchains/llvm/prebuilt/linux-x86_64"

    if [[ -f "android-configure" ]]; then
        # Use the official android-configure helper
        info "使用 android-configure 脚本..."
        # android-configure takes: <ndk_path> <android_api> <target_arch>
        # It applies patches, sets CC/CXX, and calls ./configure
        ./android-configure "$NDK_PATH" "$ANDROID_API" arm64
    else
        # Manual configure for cross-compilation
        local CC="$toolchain/bin/aarch64-linux-android${ANDROID_API}-clang"
        local CXX="$toolchain/bin/aarch64-linux-android${ANDROID_API}-clang++"
        local AR="$toolchain/bin/llvm-ar"
        local LINK="$CXX"

        info "手动配置交叉编译..."
        CC="$CC" CXX="$CXX" CC_host="cc" CXX_host="c++" AR="$AR" LINK="$LINK" \
        ./configure \
            --dest-cpu=arm64 \
            --dest-os=android \
            --cross-compiling \
            --without-intl \
            --without-inspector \
            --without-node-snapshot \
            --without-dtrace \
            --without-etw \
            --without-npm \
            --without-corepack \
            --partly-static
    fi

    info "开始编译 Node.js (使用 $JOBS 个线程)..."
    info "预计耗时 15-30 分钟..."

    make -j"$JOBS" 2>&1 | tee "$BUILD_DIR/build.log" | \
        grep -E '(LINK|Compiling|error:|warning:.*error)' | tail -30

    # Check output
    local node_bin="out/Release/node"
    if [[ -f "$node_bin" ]]; then
        ok "Node.js 编译成功!"
        echo "  路径: $SOURCE_DIR/$node_bin"
        echo "  大小: $(du -h "$node_bin" | cut -f1)"
        file "$node_bin"
    else
        echo ""
        echo "最后 30 行编译日志:"
        tail -30 "$BUILD_DIR/build.log"
        die "Node.js 编译失败: $node_bin 不存在"
    fi
}

# ──────────────────────────────────────────────────────────────
# Strip & Install
# ──────────────────────────────────────────────────────────────
install_binary() {
    cd "$SOURCE_DIR"

    local node_bin="out/Release/node"
    local strip="$NDK_PATH/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip"

    mkdir -p "$OUTPUT_DIR"

    info "Strip 并安装 Node.js 二进制..."

    cp "$node_bin" "$OUTPUT_DIR/node"

    local orig_size
    orig_size=$(du -h "$node_bin" | cut -f1)

    if "$strip" "$OUTPUT_DIR/node" 2>/dev/null; then
        ok "Strip 成功"
    else
        warn "Strip 失败，使用未 strip 的二进制"
    fi

    local stripped_size
    stripped_size=$(du -h "$OUTPUT_DIR/node" | cut -f1)

    ok "Node.js 已安装到设备树"
    echo "  原始大小: $orig_size"
    echo "  Strip 后: $stripped_size"
    echo "  路径: $OUTPUT_DIR/node"

    # Verify architecture
    if file "$OUTPUT_DIR/node" | grep -q "aarch64\|ARM aarch64"; then
        ok "架构验证: ARM64 ✓"
    else
        warn "架构验证: 可能不是 ARM64，请手动检查"
        file "$OUTPUT_DIR/node"
    fi
}

# ──────────────────────────────────────────────────────────────
# Clean
# ──────────────────────────────────────────────────────────────
clean() {
    info "清理编译目录..."
    rm -rf "$SOURCE_DIR"
    rm -f "$BUILD_DIR/node-v${NODE_VERSION}.tar.gz"
    ok "编译目录已清理"
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
main() {
    echo ""
    echo -e "${CYAN}ClawOS - Node.js ${NODE_VERSION} Android ARM64 交叉编译${NC}"
    echo ""

    case "${1:-}" in
        --check)
            check_prereqs
            ;;
        --clean)
            clean
            check_prereqs
            prepare_source
            apply_patches
            build_node
            install_binary
            ;;
        *)
            check_prereqs
            prepare_source
            apply_patches
            build_node
            install_binary
            ;;
    esac

    echo ""
    echo -e "${GREEN}完成!${NC}"
    echo ""
    echo "下一步:"
    echo "  1. 确认 $OUTPUT_DIR/node 存在"
    echo "  2. 更新 clawos_arm64.mk 添加 PRODUCT_COPY_FILES"
    echo "  3. 运行 05-setup-device-tree.sh 部署到 AOSP 源码树"
    echo "  4. 运行 03-build-aosp.sh 重新构建 ROM"
    echo ""
}

main "$@"
