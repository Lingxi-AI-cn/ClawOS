#!/usr/bin/env bash
#
# 05-setup-device-tree.sh - 将 ClawOS 设备树部署到 AOSP 源码树
#
# 将 git 仓库中的 device/clawos/ 目录复制到 AOSP 源码树的 device/clawos/。
# 使用 rsync 进行增量同步，只更新变化的文件。
#
# 统一 AOSP 16 源码树 (/opt/aosp)，支持模拟器和 Pixel GSI 双产品。
#
# Usage:
#   bash scripts/05-setup-device-tree.sh           # 部署到 AOSP 树 (/opt/aosp)
#   bash scripts/05-setup-device-tree.sh --check    # 仅检查状态
#   bash scripts/05-setup-device-tree.sh --remove   # 移除部署的设备树
#   bash scripts/05-setup-device-tree.sh --diff      # 显示差异
#
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# 加载配置
# ──────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/../config/build-env.conf"

if [[ -f "$CONFIG_FILE" ]]; then
    source "$CONFIG_FILE"
fi

AOSP_SOURCE_DIR="${AOSP_SOURCE_DIR:-/opt/aosp}"

# ClawOS device tree in git repo (source of truth)
DEVICE_SRC="${SCRIPT_DIR}/../device/clawos"

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
ACTION="deploy"
TARGET_TREES=()

for arg in "$@"; do
    case "$arg" in
        --check)
            ACTION="check"
            ;;
        --remove)
            ACTION="remove"
            ;;
        --diff)
            ACTION="diff"
            ;;
        --help|-h)
            echo "Usage: bash $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  (no args)    部署到 AOSP 源码树 ($AOSP_SOURCE_DIR)"
            echo "  --check      仅检查状态"
            echo "  --diff       显示源和部署目标之间的差异"
            echo "  --remove     移除部署的设备树"
            echo ""
            exit 0
            ;;
    esac
done

if [[ ${#TARGET_TREES[@]} -eq 0 ]]; then
    TARGET_TREES=("$AOSP_SOURCE_DIR")
fi

# ──────────────────────────────────────────────────────────────
# 前置检查
# ──────────────────────────────────────────────────────────────
preflight() {
    local target_dir="$1"
    if [[ ! -d "$target_dir/build" ]]; then
        die "AOSP 源码目录不存在或不完整: $target_dir
请先同步 AOSP 源码。"
    fi

    if [[ ! -f "$DEVICE_SRC/AndroidProducts.mk" ]]; then
        die "ClawOS 设备树不完整: $DEVICE_SRC
缺少 AndroidProducts.mk"
    fi

    DEVICE_SRC="$(cd "$DEVICE_SRC" && pwd)"
}

# ──────────────────────────────────────────────────────────────
# 检查状态
# ──────────────────────────────────────────────────────────────
check_status() {
    local device_dst="$1"
    if [[ -L "$device_dst" ]]; then
        warn "目标是符号链接 (Soong 不支持目录符号链接): $device_dst"
        return 1
    elif [[ -d "$device_dst" && -f "$device_dst/AndroidProducts.mk" ]]; then
        ok "设备树已部署: $device_dst"
        if command -v diff &>/dev/null; then
            if diff -rq "$DEVICE_SRC" "$device_dst" > /dev/null 2>&1; then
                ok "源和部署目标完全同步"
                return 0
            else
                warn "源和部署目标存在差异, 请重新运行部署"
                return 1
            fi
        fi
        return 0
    else
        info "设备树未部署: $device_dst"
        return 1
    fi
}

# ──────────────────────────────────────────────────────────────
# 显示差异
# ──────────────────────────────────────────────────────────────
show_diff() {
    local device_dst="$1"
    if [[ ! -d "$device_dst" ]]; then
        info "设备树未部署, 无差异可显示"
        return 0
    fi
    diff -rq "$DEVICE_SRC" "$device_dst" 2>/dev/null || true
}

# ──────────────────────────────────────────────────────────────
# 部署设备树 (rsync 增量复制)
# ──────────────────────────────────────────────────────────────
deploy() {
    local aosp_dir="$1"
    local device_dst="$aosp_dir/device/clawos"

    if [[ -L "$device_dst" ]]; then
        warn "移除旧的符号链接: $device_dst"
        rm "$device_dst"
    fi

    info "部署设备树: $DEVICE_SRC -> $device_dst"
    mkdir -p "$(dirname "$device_dst")"

    rsync -av --delete \
        --exclude='.git' \
        --exclude='.gitkeep' \
        "$DEVICE_SRC/" "$device_dst/"

    ok "设备树部署完成"

    # WebView APK 升级: 替换 AOSP 源码树中的默认 WebView
    local webview_src="$DEVICE_SRC/webview/webview.apk"
    local webview_dst="${aosp_dir}/external/chromium-webview/prebuilt/arm64/webview.apk"
    if [[ -f "$webview_src" && -d "$(dirname "$webview_dst")" ]]; then
        if [[ ! -f "${webview_dst}.orig" && -f "$webview_dst" ]]; then
            cp "$webview_dst" "${webview_dst}.orig"
            info "已备份原始 WebView: ${webview_dst}.orig"
        fi
        cp "$webview_src" "$webview_dst"
        ok "已替换 AOSP WebView APK (升级版)"
    fi

    # 验证
    if [[ -f "$device_dst/AndroidProducts.mk" ]]; then
        ok "验证通过: AndroidProducts.mk 可访问"
    else
        die "验证失败: 无法访问 AndroidProducts.mk"
    fi

    # 刷新 Soong 模块路径缓存
    local cache_file="${aosp_dir}/out/.module_paths/AndroidProducts.mk.list"
    if [[ -f "$cache_file" ]]; then
        if ! grep -q "device/clawos/AndroidProducts.mk" "$cache_file"; then
            info "更新 Soong 模块路径缓存..."
            echo "device/clawos/AndroidProducts.mk" >> "$cache_file"
            ok "缓存已更新"
        else
            ok "Soong 缓存已包含 ClawOS 条目"
        fi
    else
        warn "Soong 缓存文件不存在 (首次构建将自动生成)"
    fi
}

# ──────────────────────────────────────────────────────────────
# 移除设备树
# ──────────────────────────────────────────────────────────────
remove() {
    local device_dst="$1"
    if [[ -L "$device_dst" ]]; then
        rm "$device_dst"
        ok "符号链接已移除: $device_dst"
    elif [[ -d "$device_dst" ]]; then
        rm -rf "$device_dst"
        ok "设备树目录已移除: $device_dst"
    else
        info "设备树不存在, 无需移除"
    fi
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
main() {
    echo ""
    echo -e "${CYAN}ClawOS AOSP - 设备树部署${NC}"
    echo ""

    for target_dir in "${TARGET_TREES[@]}"; do
        local device_dst="$target_dir/device/clawos"
        echo "  目标: $device_dst"
        echo ""

        preflight "$target_dir"

        case "$ACTION" in
            deploy)
                deploy "$target_dir"
                echo ""
                echo -e "${GREEN}设备树已部署到: $target_dir${NC}"
                echo ""
                ;;
            check)
                check_status "$device_dst"
                ;;
            diff)
                show_diff "$device_dst"
                ;;
            remove)
                remove "$device_dst"
                ;;
        esac
    done
}

main
