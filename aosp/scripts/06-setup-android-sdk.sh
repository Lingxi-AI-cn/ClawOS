#!/usr/bin/env bash
#
# 06-setup-android-sdk.sh - 安装 Android SDK 命令行工具
#
# 在 Ubuntu 上安装 Android SDK (不需要 Android Studio)。
# 用于构建 Capacitor Android 项目。
#
# Usage:
#   bash scripts/06-setup-android-sdk.sh
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
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()   { error "$@"; exit 1; }

# ──────────────────────────────────────────────────────────────
# 配置
# ──────────────────────────────────────────────────────────────
ANDROID_SDK_DIR="${HOME}/Android/Sdk"
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"

# SDK 组件
PLATFORM_VERSION="android-34"
BUILD_TOOLS_VERSION="34.0.0"
NDK_VERSION="26.1.10909125"
CMAKE_VERSION="3.22.1"

# ──────────────────────────────────────────────────────────────
# Step 1: JDK
# ──────────────────────────────────────────────────────────────
setup_jdk() {
    info "检查 JDK 21..."

    local jdk_dir="${HOME}/tools/jdk-21.0.5+11"
    if [[ -x "$jdk_dir/bin/javac" ]]; then
        ok "JDK 21 已安装: $jdk_dir"
        return 0
    fi

    info "下载 JDK 21 (Temurin)..."
    mkdir -p "${HOME}/tools"
    local tmp="/tmp/jdk21.tar.gz"
    wget -q --show-progress -O "$tmp" \
        "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jdk_x64_linux_hotspot_21.0.5_11.tar.gz"
    tar -xzf "$tmp" -C "${HOME}/tools/"
    rm -f "$tmp"

    ok "JDK 21 已安装: $jdk_dir"
}

# ──────────────────────────────────────────────────────────────
# Step 2: Android SDK command-line tools
# ──────────────────────────────────────────────────────────────
setup_sdk() {
    info "检查 Android SDK..."

    if [[ -f "$ANDROID_SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]]; then
        ok "Android SDK command-line tools 已安装"
        return 0
    fi

    info "下载 Android SDK command-line tools..."
    mkdir -p "$ANDROID_SDK_DIR"

    local tmp_zip="/tmp/android-cmdline-tools.zip"
    if [[ ! -f "$tmp_zip" ]]; then
        wget -q --show-progress -O "$tmp_zip" "$CMDLINE_TOOLS_URL"
    fi

    info "解压..."
    unzip -q -o "$tmp_zip" -d "$ANDROID_SDK_DIR"

    # 移动到标准路径
    mkdir -p "$ANDROID_SDK_DIR/cmdline-tools"
    if [[ -d "$ANDROID_SDK_DIR/cmdline-tools/latest" ]]; then
        rm -rf "$ANDROID_SDK_DIR/cmdline-tools/latest"
    fi
    mv "$ANDROID_SDK_DIR/cmdline-tools" "$ANDROID_SDK_DIR/cmdline-tools-tmp" 2>/dev/null || true
    mkdir -p "$ANDROID_SDK_DIR/cmdline-tools"
    if [[ -d "$ANDROID_SDK_DIR/cmdline-tools-tmp" ]]; then
        mv "$ANDROID_SDK_DIR/cmdline-tools-tmp" "$ANDROID_SDK_DIR/cmdline-tools/latest"
    fi

    rm -f "$tmp_zip"
    ok "Android SDK command-line tools 已安装"
}

# ──────────────────────────────────────────────────────────────
# Step 3: 安装 SDK 组件
# ──────────────────────────────────────────────────────────────
install_sdk_packages() {
    local sdkmanager="$ANDROID_SDK_DIR/cmdline-tools/latest/bin/sdkmanager"

    if [[ ! -x "$sdkmanager" ]]; then
        die "sdkmanager 不可用: $sdkmanager"
    fi

    info "安装 SDK 组件..."

    # 接受所有许可
    yes | "$sdkmanager" --licenses > /dev/null 2>&1 || true

    # 安装核心组件
    "$sdkmanager" \
        "platform-tools" \
        "platforms;${PLATFORM_VERSION}" \
        "build-tools;${BUILD_TOOLS_VERSION}"

    ok "核心 SDK 组件已安装"

    # NDK 和 CMake (用于 Phase 1C Node.js 交叉编译)
    info "安装 NDK 和 CMake (用于 Node.js 交叉编译)..."
    "$sdkmanager" \
        "ndk;${NDK_VERSION}" \
        "cmake;${CMAKE_VERSION}"

    ok "NDK ${NDK_VERSION} 和 CMake ${CMAKE_VERSION} 已安装"
}

# ──────────────────────────────────────────────────────────────
# Step 4: 环境变量
# ──────────────────────────────────────────────────────────────
setup_env() {
    info "配置环境变量..."

    local profile="${HOME}/.bashrc"
    local marker="# ClawOS Android SDK"

    if grep -q "$marker" "$profile" 2>/dev/null; then
        ok "环境变量已配置"
        return 0
    fi

    cat >> "$profile" << 'ENVEOF'

# ClawOS Android SDK
export JAVA_HOME=$HOME/tools/jdk-21.0.5+11
export ANDROID_HOME=$HOME/Android/Sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH
ENVEOF

    ok "环境变量已添加到 $profile"
    warn "运行 'source ~/.bashrc' 使环境变量生效"
}

# ──────────────────────────────────────────────────────────────
# Step 5: 验证
# ──────────────────────────────────────────────────────────────
verify() {
    export ANDROID_HOME="$ANDROID_SDK_DIR"
    export ANDROID_SDK_ROOT="$ANDROID_SDK_DIR"
    export PATH="$ANDROID_SDK_DIR/cmdline-tools/latest/bin:$ANDROID_SDK_DIR/platform-tools:$PATH"

    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  Android SDK 环境验证${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "  ANDROID_HOME:  $ANDROID_HOME"
    echo "  sdkmanager:    $(which sdkmanager 2>/dev/null || echo 'NOT FOUND')"
    echo "  adb:           $(which adb 2>/dev/null || echo 'NOT FOUND')"
    echo "  JDK:           $(javac -version 2>&1)"
    echo ""

    "$ANDROID_SDK_DIR/cmdline-tools/latest/bin/sdkmanager" --list_installed 2>/dev/null | head -20
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
main() {
    echo ""
    echo -e "${CYAN}ClawOS - Android SDK 环境搭建${NC}"
    echo ""

    setup_jdk
    setup_sdk
    install_sdk_packages
    setup_env
    verify

    echo ""
    echo -e "${GREEN}Android SDK 环境搭建完成!${NC}"
    echo ""
    echo "下一步:"
    echo "  source ~/.bashrc"
    echo "  cd \$CLAWOS_ROOT/ui"
    echo "  pnpm add @capacitor/core && pnpm add -D @capacitor/cli @capacitor/android"
    echo ""
}

main
