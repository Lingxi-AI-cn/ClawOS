#!/usr/bin/env bash
#
# flash-pixel8pro-linux.sh - 在 Linux (Ubuntu) 服务器上直接刷入 ClawOS 到 Pixel 8 Pro
#
# 该脚本会自动寻找构建产物中的 system.img 并生成 disabled-verity vbmeta。
#
# Usage:
#   bash flash-pixel8pro-linux.sh                # 交互式刷入
#   bash flash-pixel8pro-linux.sh --wipe         # 刷入并清除用户数据
#   bash flash-pixel8pro-linux.sh --auto         # 自动模式 (跳过确认)
#
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# 配置
# ──────────────────────────────────────────────────────────────

# AOSP 构建输出目录
AOSP_OUT="/opt/aosp/out/target/product/clawos_gsi_arm64"
SYSTEM_IMG="${AOSP_OUT}/system.img"

# 临时生成的 vbmeta 位置
VBMETA_IMG="/tmp/clawos-vbmeta-disabled.img"

# 刷机参数
WIPE_DATA=false
AUTO_MODE=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
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
            --wipe|-w) WIPE_DATA=true; shift ;;
            --auto|-y) AUTO_MODE=true; shift ;;
            --help|-h)
                echo "Usage: bash $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --wipe, -w    刷入后清除用户数据"
                echo "  --auto, -y    自动模式，跳过确认提示"
                exit 0
                ;;
            *) warn "未知参数: $1"; shift ;;
        esac
    done
}

confirm() {
    if [[ "$AUTO_MODE" == "true" ]]; then return 0; fi
    local prompt="$1"
    local default="${2:-y}"
    if [[ "$default" == "y" ]]; then echo -ne "${YELLOW}${prompt} [Y/n]${NC} "; else echo -ne "${YELLOW}${prompt} [y/N]${NC} "; fi
    read -r answer
    if [[ "$default" == "y" ]]; then [[ -z "$answer" || "$answer" == "y" || "$answer" == "Y" ]]; else [[ "$answer" == "y" || "$answer" == "Y" ]]; fi
}

# ──────────────────────────────────────────────────────────────
# 镜像准备
# ──────────────────────────────────────────────────────────────
prepare_images() {
    echo ""
    info "执行镜像就绪检查..."
    
    if [[ ! -f "$SYSTEM_IMG" ]]; then
        die "找不到 system.img: $SYSTEM_IMG\n请先确保已完成 AOSP 编译。"
    fi
    ok "System 镜像: $(du -sh "$SYSTEM_IMG" | awk '{print $1}')"

    info "正在生成禁用验证的 vbmeta..."
    local host_out_dir
    host_out_dir=$(readlink -f "${AOSP_OUT}/../../..")/host
    local avbtool
    avbtool=$(find "$host_out_dir" -name avbtool -type f 2>/dev/null | head -1)

    if [[ -z "$avbtool" ]]; then
        die "未找到 avbtool。请先执行一次编译。"
    fi

    "$avbtool" make_vbmeta_image --flags 2 --padding_size 4096 --output "$VBMETA_IMG"
    ok "vbmeta 已准备就绪 (disabled-verity)"
}

# ──────────────────────────────────────────────────────────────
# 刷机流程
# ──────────────────────────────────────────────────────────────
preflight() {
    echo ""
    echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  ClawOS Pixel 8 Pro - Linux 本地刷机工具${NC}"
    echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
    
    for cmd in adb fastboot; do
        if ! command -v $cmd &>/dev/null; then
            die "$cmd 未安装。请运行: sudo apt install android-sdk-platform-tools"
        fi
    done
}

check_device() {
    echo ""
    echo -e "${BOLD}步骤 1: 检查设备连接${NC}"
    info "检查 ADB 设备..."
    local devices
    devices="$(adb devices | grep -v "List of devices" | grep "device$" || true)"
    
    if [[ -z "$devices" ]]; then
        warn "未检测到 ADB 设备。请确保手机已连接并开启 USB 调试。"
        if ! confirm "重试检查?"; then die "用户取消"; fi
        check_device
        return
    fi
    
    local model
    model=$(adb shell getprop ro.product.model 2>/dev/null | tr -d '\r' || echo "Unknown")
    ok "检测到设备: $model"
}

reboot_to_bootloader() {
    echo ""
    echo -e "${BOLD}步骤 2: 重启到 Bootloader${NC}"
    if ! confirm "是否重启设备到 bootloader?"; then die "用户取消"; fi
    adb reboot bootloader
    info "等待设备进入 bootloader..."
    local timeout=30
    while [[ $timeout -gt 0 ]]; do
        if fastboot devices | grep -q "fastboot"; then break; fi
        sleep 1
        timeout=$((timeout-1))
    done
    if [[ $timeout -eq 0 ]]; then die "进入 bootloader 超时"; fi
    ok "已进入 Bootloader"
}

flash_vbmeta() {
    echo ""
    echo -e "${BOLD}步骤 3: 刷入 vbmeta (禁用验证)${NC}"
    if ! confirm "是否刷入 vbmeta?"; then die "用户取消"; fi
    fastboot flash vbmeta_a "$VBMETA_IMG"
    fastboot flash vbmeta_b "$VBMETA_IMG"
    ok "vbmeta 刷入完成"
}

reboot_to_fastbootd() {
    echo ""
    echo -e "${BOLD}步骤 4: 切换到 Fastbootd 模式${NC}"
    if ! confirm "是否切换到 fastbootd 模式?"; then die "用户取消"; fi
    fastboot reboot fastboot
    info "等待进入 fastbootd..."
    sleep 5
    until fastboot devices | grep -q "fastboot"; do sleep 1; done
    ok "已进入 Fastbootd"
}

flash_system() {
    echo ""
    echo -e "${BOLD}步骤 5: 刷入 System 镜像${NC}"
    if ! confirm "是否刷入 system 镜像?"; then die "用户取消"; fi
    info "正在刷入 (可能需要几分钟)..."
    fastboot flash system "$SYSTEM_IMG"
    ok "System 镜像刷入完成"
}

return_to_bootloader() {
    echo ""
    echo -e "${BOLD}步骤 6: 返回 Bootloader${NC}"
    fastboot reboot bootloader
    info "等待返回 bootloader..."
    sleep 3
    until fastboot devices | grep -q "fastboot"; do sleep 1; done
    ok "已返回 Bootloader"
}

wipe_userdata() {
    if [[ "$WIPE_DATA" == "true" ]] || confirm "步骤 7: 是否清除用户数据 (Wipe/Factory Reset)?"; then
        echo ""
        info "正在清除数据..."
        fastboot -w
        ok "数据清除完成"
        WIPE_DATA=true
    fi
}

reboot_device() {
    echo ""
    echo -e "${BOLD}步骤 8: 重启设备${NC}"
    if ! confirm "现在重启设备?"; then 
        warn "设备停留在 bootloader，请手动重启。"
        return
    fi
    fastboot reboot
    ok "设备正在重启，刷机完成！"
}

main() {
    parse_args "$@"
    preflight
    prepare_images
    check_device
    
    echo ""
    warn "⚠️  即将开始刷机！"
    if ! confirm "我已了解风险并继续?"; then die "用户取消"; fi
    
    reboot_to_bootloader
    flash_vbmeta
    reboot_to_fastbootd
    flash_system
    return_to_bootloader
    wipe_userdata
    reboot_device
}

main "$@"
