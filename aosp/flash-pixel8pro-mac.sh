#!/usr/bin/env bash
#
# flash-pixel8pro-mac.sh - 在 Mac 上刷入 ClawOS 到 Pixel 8 Pro
#
# 使用 fastboot 刷入自定义 AOSP GSI 镜像。
# 每一步都会提示确认，确保安全。
#
# 前置条件:
#   1. Pixel 8 Pro 已解锁 bootloader
#   2. 已安装 Android Platform Tools (adb/fastboot)
#   3. 已拉取镜像到 ~/clawos-pixel8pro/
#
# Usage:
#   bash flash-pixel8pro-mac.sh                # 交互式刷入
#   bash flash-pixel8pro-mac.sh --auto         # 自动模式 (跳过确认)
#   bash flash-pixel8pro-mac.sh --wipe         # 刷入并清除用户数据
#
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# 配置
# ──────────────────────────────────────────────────────────────

# 镜像目录
IMAGE_DIR="${HOME}/clawos-pixel8pro"

# 是否清除用户数据
WIPE_DATA=false

# 自动模式 (跳过确认)
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
            --wipe|-w)
                WIPE_DATA=true
                shift
                ;;
            --auto|-y)
                AUTO_MODE=true
                shift
                ;;
            --help|-h)
                echo "Usage: bash $0 [OPTIONS]"
                echo ""
                echo "在 Mac 上刷入 ClawOS 到 Pixel 8 Pro"
                echo ""
                echo "Options:"
                echo "  --wipe, -w    刷入后清除用户数据 (恢复出厂设置)"
                echo "  --auto, -y    自动模式，跳过所有确认提示"
                echo ""
                echo "Examples:"
                echo "  # 交互式刷入 (推荐)"
                echo "  bash $0"
                echo ""
                echo "  # 刷入并清除数据"
                echo "  bash $0 --wipe"
                echo ""
                echo "  # 自动模式 (危险!)"
                echo "  bash $0 --auto"
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
# 确认提示
# ──────────────────────────────────────────────────────────────
confirm() {
    if [[ "$AUTO_MODE" == "true" ]]; then
        return 0
    fi
    
    local prompt="$1"
    local default="${2:-y}"
    
    if [[ "$default" == "y" ]]; then
        echo -ne "${YELLOW}${prompt} [Y/n]${NC} "
    else
        echo -ne "${YELLOW}${prompt} [y/N]${NC} "
    fi
    
    read -r answer
    
    if [[ "$default" == "y" ]]; then
        [[ -z "$answer" || "$answer" == "y" || "$answer" == "Y" ]]
    else
        [[ "$answer" == "y" || "$answer" == "Y" ]]
    fi
}

# ──────────────────────────────────────────────────────────────
# 前置检查
# ──────────────────────────────────────────────────────────────
preflight() {
    echo ""
    echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  ClawOS Pixel 8 Pro - 刷机工具${NC}"
    echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    info "执行前置检查..."
    echo ""

    # 检查是否在 macOS 上
    if [[ "$(uname)" != "Darwin" ]]; then
        die "此脚本仅在 macOS 上运行"
    fi
    ok "macOS $(sw_vers -productVersion)"

    # 检查 adb
    if ! command -v adb &>/dev/null; then
        die "adb 未找到。请安装 Android Platform Tools:
  brew install --cask android-platform-tools
或从官网下载: https://developer.android.com/tools/releases/platform-tools"
    fi
    ok "adb: $(adb version | head -1)"

    # 检查 fastboot
    if ! command -v fastboot &>/dev/null; then
        die "fastboot 未找到。请安装 Android Platform Tools"
    fi
    ok "fastboot: $(fastboot --version | head -1)"

    # 检查镜像目录
    if [[ ! -d "$IMAGE_DIR" ]]; then
        die "镜像目录不存在: $IMAGE_DIR
请先拉取镜像: bash aosp/pull-pixel8pro-images-mac.sh"
    fi
    ok "镜像目录: $IMAGE_DIR"

    # 检查镜像文件
    local required_files=("system.img" "vbmeta.img")
    local missing_files=()
    
    for file in "${required_files[@]}"; do
        if [[ ! -f "${IMAGE_DIR}/${file}" ]]; then
            missing_files+=("$file")
        fi
    done
    
    if [[ ${#missing_files[@]} -gt 0 ]]; then
        die "缺少镜像文件: ${missing_files[*]}
请先拉取镜像: bash aosp/pull-pixel8pro-images-mac.sh"
    fi
    ok "镜像文件完整"

    # 显示镜像信息
    echo ""
    info "镜像信息:"
    for file in "${required_files[@]}"; do
        local size
        size="$(du -sh "${IMAGE_DIR}/${file}" | awk '{print $1}')"
        echo "  ${file}: ${size}"
    done
    
    # 验证校验和 (如果有)
    if [[ -f "${IMAGE_DIR}/SHA256SUMS" ]]; then
        echo ""
        info "验证文件校验和..."
        if (cd "$IMAGE_DIR" && shasum -a 256 -c SHA256SUMS --quiet 2>/dev/null); then
            ok "校验和验证通过"
        else
            warn "校验和验证失败，某些文件可能损坏"
            if ! confirm "是否继续?"; then
                die "用户取消"
            fi
        fi
    fi

    echo ""
    ok "前置检查完成"
}

# ──────────────────────────────────────────────────────────────
# 检查设备连接
# ──────────────────────────────────────────────────────────────
check_device() {
    echo ""
    echo -e "${BOLD}步骤 1: 检查设备连接${NC}"
    echo ""
    
    info "检查 ADB 设备..."
    
    # 检查是否有设备连接
    local devices
    devices="$(adb devices | grep -v "List of devices" | grep "device$" || true)"
    
    if [[ -z "$devices" ]]; then
        warn "未检测到 ADB 设备"
        echo ""
        echo "请确保:"
        echo "  1. Pixel 8 Pro 已通过 USB 连接到 Mac"
        echo "  2. 手机已开启 USB 调试"
        echo "  3. 已授权此电脑的 USB 调试"
        echo ""
        
        if ! confirm "设备已连接并准备好?"; then
            die "用户取消"
        fi
        
        # 重新检查
        devices="$(adb devices | grep -v "List of devices" | grep "device$" || true)"
        if [[ -z "$devices" ]]; then
            die "仍未检测到设备。请检查连接。"
        fi
    fi
    
    ok "检测到设备:"
    echo "$devices" | sed 's/^/  /'
    
    # 获取设备信息
    local device_model
    device_model="$(adb shell getprop ro.product.model 2>/dev/null || echo "Unknown")"
    local device_android
    device_android="$(adb shell getprop ro.build.version.release 2>/dev/null || echo "Unknown")"
    
    echo ""
    info "设备信息:"
    echo "  型号: ${device_model}"
    echo "  Android 版本: ${device_android}"
    
    # 确认是否是 Pixel 8 Pro
    if [[ "$device_model" != *"Pixel 8 Pro"* ]]; then
        warn "检测到的设备不是 Pixel 8 Pro: ${device_model}"
        if ! confirm "是否继续? (可能导致设备变砖)"; then
            die "用户取消"
        fi
    fi
    
    echo ""
    ok "设备检查完成"
}

# ──────────────────────────────────────────────────────────────
# 重启到 bootloader
# ──────────────────────────────────────────────────────────────
reboot_to_bootloader() {
    echo ""
    echo -e "${BOLD}步骤 2: 重启到 Bootloader${NC}"
    echo ""
    
    if ! confirm "是否重启设备到 bootloader 模式?"; then
        die "用户取消"
    fi
    
    info "重启到 bootloader..."
    adb reboot bootloader
    
    info "等待设备进入 bootloader 模式..."
    sleep 5
    
    # 等待 fastboot 设备
    local timeout=30
    local elapsed=0
    while [[ $elapsed -lt $timeout ]]; do
        if fastboot devices | grep -q "fastboot"; then
            ok "设备已进入 bootloader 模式"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done
    
    die "设备未进入 bootloader 模式 (超时 ${timeout}s)
请手动进入:
  1. 关机
  2. 同时按住 音量下 + 电源键
  3. 看到 fastboot 界面后松开"
}

# ──────────────────────────────────────────────────────────────
# 刷入 vbmeta (禁用验证)
# ──────────────────────────────────────────────────────────────
flash_vbmeta() {
    echo ""
    echo -e "${BOLD}步骤 3: 刷入 vbmeta (禁用验证)${NC}"
    echo ""
    
    warn "此步骤将禁用 Verified Boot (验证启动)"
    warn "这是刷入自定义系统镜像的必要步骤"
    echo ""
    
    if ! confirm "是否刷入 vbmeta?"; then
        die "用户取消"
    fi
    
    local vbmeta_img="${IMAGE_DIR}/vbmeta.img"
    
    info "刷入 vbmeta 到 slot A..."
    fastboot flash vbmeta_a "$vbmeta_img"
    ok "vbmeta_a 刷入完成"
    
    echo ""
    info "刷入 vbmeta 到 slot B..."
    fastboot flash vbmeta_b "$vbmeta_img"
    ok "vbmeta_b 刷入完成"
    
    echo ""
    ok "vbmeta 刷入完成"
}

# ──────────────────────────────────────────────────────────────
# 重启到 fastbootd
# ──────────────────────────────────────────────────────────────
reboot_to_fastbootd() {
    echo ""
    echo -e "${BOLD}步骤 4: 切换到 Fastbootd 模式${NC}"
    echo ""
    
    info "Pixel 8 Pro 使用动态分区，必须在 fastbootd 模式下刷入 system"
    echo ""
    
    if ! confirm "是否切换到 fastbootd 模式?"; then
        die "用户取消"
    fi
    
    info "重启到 fastbootd..."
    fastboot reboot fastboot
    
    info "等待设备进入 fastbootd 模式..."
    sleep 5
    
    # 等待 fastboot 设备 (fastbootd 模式)
    local timeout=30
    local elapsed=0
    while [[ $elapsed -lt $timeout ]]; do
        if fastboot devices | grep -q "fastboot"; then
            ok "设备已进入 fastbootd 模式"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done
    
    die "设备未进入 fastbootd 模式 (超时 ${timeout}s)"
}

# ──────────────────────────────────────────────────────────────
# 刷入 system
# ──────────────────────────────────────────────────────────────
flash_system() {
    echo ""
    echo -e "${BOLD}步骤 5: 刷入 System 镜像${NC}"
    echo ""
    
    local system_img="${IMAGE_DIR}/system.img"
    local size
    size="$(du -sh "$system_img" | awk '{print $1}')"
    
    warn "即将刷入 ClawOS 系统镜像 (${size})"
    warn "此操作将覆盖原有系统，无法撤销"
    echo ""
    
    if ! confirm "是否刷入 system 镜像?"; then
        die "用户取消"
    fi
    
    info "刷入 system 镜像 (这可能需要几分钟)..."
    echo ""
    
    # 刷入 system (fastboot 会自动选择当前活跃的 slot)
    if fastboot flash system "$system_img"; then
        echo ""
        ok "system 镜像刷入完成"
    else
        echo ""
        error "system 镜像刷入失败"
        die "刷入失败。设备可能处于不可用状态。"
    fi
}

# ──────────────────────────────────────────────────────────────
# 切回 bootloader (从 fastbootd)
# ──────────────────────────────────────────────────────────────
return_to_bootloader() {
    echo ""
    echo -e "${BOLD}步骤 6: 切回 Bootloader${NC}"
    echo ""

    info "从 fastbootd 切回 bootloader (wipe/reboot 需要在 bootloader 模式)..."
    fastboot reboot bootloader

    local timeout=30
    local elapsed=0
    while [[ $elapsed -lt $timeout ]]; do
        if fastboot devices | grep -q "fastboot"; then
            ok "已切回 bootloader 模式"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done

    die "切回 bootloader 超时 (${timeout}s)"
}

# ──────────────────────────────────────────────────────────────
# 清除用户数据 (可选)
# ──────────────────────────────────────────────────────────────
wipe_userdata() {
    if [[ "$WIPE_DATA" != "true" ]]; then
        echo ""
        if confirm "是否清除用户数据? (恢复出厂设置，首次刷入建议选 y)"; then
            WIPE_DATA=true
        fi
    fi
    
    if [[ "$WIPE_DATA" == "true" ]]; then
        echo ""
        echo -e "${BOLD}步骤 7: 清除用户数据${NC}"
        echo ""
        
        warn "此操作将删除所有用户数据、应用和设置"
        warn "无法撤销!"
        echo ""
        
        if ! confirm "确认清除用户数据?"; then
            info "跳过清除用户数据"
            return 0
        fi
        
        info "清除用户数据..."
        fastboot -w
        ok "用户数据已清除"
    else
        info "保留用户数据"
    fi
}

# ──────────────────────────────────────────────────────────────
# 重启设备
# ──────────────────────────────────────────────────────────────
reboot_device() {
    echo ""
    echo -e "${BOLD}步骤 8: 重启设备${NC}"
    echo ""
    
    if ! confirm "是否重启设备?"; then
        warn "设备仍在 bootloader 模式"
        warn "请手动重启: fastboot reboot"
        return 0
    fi
    
    info "重启设备..."
    fastboot reboot
    
    echo ""
    ok "设备正在重启..."
    info "首次启动可能需要几分钟，请耐心等待"
}

# ──────────────────────────────────────────────────────────────
# 打印总结
# ──────────────────────────────────────────────────────────────
print_summary() {
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ClawOS 刷入完成${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "  设备: Pixel 8 Pro"
    echo "  系统: ClawOS (AOSP 16 GSI)"
    echo "  数据: $(if [[ "$WIPE_DATA" == "true" ]]; then echo "已清除"; else echo "已保留"; fi)"
    echo ""
    echo -e "${YELLOW}首次启动注意事项:${NC}"
    echo ""
    echo "  1. 首次启动需要 3-5 分钟，请耐心等待"
    echo "  2. 启动后会自动进入 ClawOS Launcher"
    echo "  3. Gateway 服务会自动启动 (约 10-20 秒)"
    echo "  4. 检查 Gateway 状态:"
    echo "     adb shell getprop clawos.gateway.status"
    echo ""
    echo -e "${YELLOW}调试命令:${NC}"
    echo ""
    echo "  # 查看 Gateway 日志"
    echo "  adb logcat -s clawos_gateway"
    echo ""
    echo "  # 查看系统日志"
    echo "  adb logcat"
    echo ""
    echo "  # 进入 shell"
    echo "  adb shell"
    echo ""
    echo "  # 检查 Gateway 进程"
    echo "  adb shell ps -A | grep node"
    echo ""
    echo -e "${YELLOW}如果遇到问题:${NC}"
    echo ""
    echo "  1. 检查 Gateway 日志: adb logcat -s clawos_gateway"
    echo "  2. 检查 SELinux: adb shell getenforce (应该是 Permissive)"
    echo "  3. 重启 Gateway: adb shell setprop ctl.restart clawos_gateway"
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
main() {
    parse_args "$@"
    
    # 显示警告
    echo ""
    echo -e "${RED}${BOLD}⚠️  警告 ���️${NC}"
    echo ""
    echo -e "${RED}此操作将刷入自定义 AOSP 系统到 Pixel 8 Pro${NC}"
    echo -e "${RED}可能导致:${NC}"
    echo -e "${RED}  - 原有系统被覆盖${NC}"
    echo -e "${RED}  - 数据丢失 (如果选择清除数据)${NC}"
    echo -e "${RED}  - 保修失效${NC}"
    echo ""
    echo -e "${YELLOW}请确保:${NC}"
    echo "  1. 已备份重要数据"
    echo "  2. Bootloader 已解锁"
    echo "  3. 电池电量充足 (>50%)"
    echo "  4. 使用原装或高质量 USB 线缆"
    echo ""
    
    if ! confirm "我已了解风险，继续刷机?"; then
        die "用户取消"
    fi
    
    # 执行刷机流程
    #   1. 前置检查           — macOS / adb / fastboot / 镜像文件
    #   2. 检查设备           — ADB 连接、型号确认
    #   3. → bootloader       — adb reboot bootloader
    #   4. 刷 vbmeta          — 禁用 Verified Boot (bootloader 模式)
    #   5. → fastbootd        — fastboot reboot fastboot
    #   6. 刷 system          — fastboot flash system (fastbootd 模式)
    #   7. → bootloader       — fastboot reboot bootloader
    #   8. wipe (可选)        — fastboot -w (bootloader 模式)
    #   9. reboot             — fastboot reboot
    preflight
    check_device
    reboot_to_bootloader
    flash_vbmeta
    reboot_to_fastbootd
    flash_system
    return_to_bootloader
    wipe_userdata
    reboot_device
    print_summary
}

main "$@"
