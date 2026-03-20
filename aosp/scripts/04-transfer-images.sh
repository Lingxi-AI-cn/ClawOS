#!/usr/bin/env bash
#
# 04-transfer-images.sh - 将 AOSP 模拟器镜像传输到 Mac
#
# 在 Linux 构建机上运行 (Linux → Mac 推送方式)。
# 将构建好的模拟器镜像 zip + 必要文件通过 SCP 传到 Mac。
#
# ⚠️  如果 Linux 无法直接 SSH 到 Mac (例如通过路由器端口转发连接),
#    建议改用 Mac 端拉取方式:
#
#      # 在 Mac 上运行:
#      bash aosp/run-emulator-mac.sh --pull
#
#    详见 run-emulator-mac.sh --help
#
# Usage:
#   bash 04-transfer-images.sh                        # 使用配置文件中的 Mac 地址
#   bash 04-transfer-images.sh --host 192.168.1.100   # 指定 Mac IP
#   bash 04-transfer-images.sh --local /tmp/images    # 仅打包到本地目录 (不传输)
#
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# 加载配置
# ──────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/../config/build-env.conf"

if [[ -f "$CONFIG_FILE" ]]; then
    # shellcheck source=../config/build-env.conf
    source "$CONFIG_FILE"
fi

# 默认值
AOSP_SOURCE_DIR="${AOSP_SOURCE_DIR:-/home/${USER}/aosp}"
AOSP_OUT_DIR="${AOSP_OUT_DIR:-$AOSP_SOURCE_DIR/out/target/product/emulator_arm64}"
MAC_USER="${MAC_USER:-}"
MAC_HOST="${MAC_HOST:-}"
MAC_IMAGE_DIR="${MAC_IMAGE_DIR:-~/clawos-emulator-images}"

# 参数覆盖
LOCAL_ONLY=false
LOCAL_OUTPUT_DIR=""

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
            --host)
                MAC_HOST="${2:?--host 需要指定 IP 地址}"
                shift 2
                ;;
            --user)
                MAC_USER="${2:?--user 需要指定用户名}"
                shift 2
                ;;
            --local)
                LOCAL_ONLY=true
                LOCAL_OUTPUT_DIR="${2:?--local 需要指定输出目录}"
                shift 2
                ;;
            --help|-h)
                echo "Usage: bash $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --host IP      Mac 的 IP 地址"
                echo "  --user NAME    Mac 用户名 (默认: your-username)"
                echo "  --local DIR    仅打包到本地目录, 不通过 SCP 传输"
                echo ""
                echo "也可以在 config/build-env.conf 中配置 MAC_HOST 和 MAC_USER"
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
# 查找镜像文件
# ──────────────────────────────────────────────────────────────
find_images() {
    info "查找构建产物..."

    # 查找 emu_img_zip 生成的 zip 文件
    local zip_file
    zip_file="$(ls -t "$AOSP_OUT_DIR"/*-img-*.zip 2>/dev/null | head -1 || true)"

    if [[ -z "$zip_file" || ! -f "$zip_file" ]]; then
        # 尝试更广泛的搜索
        zip_file="$(ls -t "$AOSP_SOURCE_DIR"/out/target/product/*/sdk-repo-*-system-images-*.zip 2>/dev/null | head -1 || true)"
    fi

    if [[ -z "$zip_file" || ! -f "$zip_file" ]]; then
        die "未找到模拟器镜像 zip 文件。
请先运行: bash 03-build-aosp.sh
查找目录: $AOSP_OUT_DIR"
    fi

    local zip_size
    zip_size="$(du -sh "$zip_file" | awk '{print $1}')"
    ok "镜像 zip: $zip_file ($zip_size)"

    echo "$zip_file"
}

# ──────────────────────────────────────────────────────────────
# 准备传输包
# ──────────────────────────────────────────────────────────────
prepare_package() {
    local zip_file="$1"
    local staging_dir="/tmp/clawos-emu-images"

    info "准备传输包..."

    rm -rf "$staging_dir"
    mkdir -p "$staging_dir"

    # 复制 emu_img_zip
    cp "$zip_file" "$staging_dir/"

    # 也复制单独的镜像文件 (有些启动方式需要)
    local product_out
    product_out="$(dirname "$zip_file")"

    for img in system.img system_ext.img vendor.img userdata.img ramdisk.img kernel; do
        if [[ -f "$product_out/$img" ]]; then
            cp "$product_out/$img" "$staging_dir/"
        fi
    done

    # 复制 build.prop (包含版本信息)
    if [[ -f "$product_out/system/build.prop" ]]; then
        cp "$product_out/system/build.prop" "$staging_dir/"
    fi

    # 生成校验和
    info "生成 SHA256 校验和..."
    (cd "$staging_dir" && sha256sum * > SHA256SUMS)

    # 统计
    local total_size
    total_size="$(du -sh "$staging_dir" | awk '{print $1}')"
    ok "传输包准备完成: $staging_dir ($total_size)"
    echo ""
    info "包含文件:"
    ls -lh "$staging_dir" | tail -n +2 | awk '{print "  " $9 " (" $5 ")"}'

    echo "$staging_dir"
}

# ──────────────────────────────────────────────────────────────
# 传输到 Mac (SCP)
# ──────────────────────────────────────────────────────────────
transfer_to_mac() {
    local staging_dir="$1"

    if [[ "$LOCAL_ONLY" == "true" ]]; then
        info "本地模式: 复制到 $LOCAL_OUTPUT_DIR"
        mkdir -p "$LOCAL_OUTPUT_DIR"
        cp -r "$staging_dir"/* "$LOCAL_OUTPUT_DIR/"
        ok "已复制到: $LOCAL_OUTPUT_DIR"
        return 0
    fi

    # 检查 Mac 地址
    if [[ -z "$MAC_HOST" ]]; then
        echo ""
        warn "未配置 Mac IP 地址。"
        echo ""
        echo "  选项 1: 在 config/build-env.conf 中设置 MAC_HOST"
        echo "  选项 2: 使用 --host 参数: bash $0 --host <Mac-IP>"
        echo "  选项 3: 手动 SCP 传输:"
        echo "          scp -r $staging_dir/* ${MAC_USER}@<Mac-IP>:${MAC_IMAGE_DIR}/"
        echo ""
        echo "  传输包位置: $staging_dir"
        return 0
    fi

    info "传输到 Mac ($MAC_USER@$MAC_HOST:$MAC_IMAGE_DIR)..."

    # 在 Mac 上创建目标目录
    ssh "$MAC_USER@$MAC_HOST" "mkdir -p $MAC_IMAGE_DIR" || \
        die "无法连接 Mac。请检查:
  - SSH 是否启用 (Mac: 系统设置 → 通用 → 共享 → 远程登录)
  - IP 地址是否正确: $MAC_HOST
  - 用户名是否正确: $MAC_USER"

    # 使用 rsync 传输 (支持续传)
    if command -v rsync &>/dev/null; then
        rsync -avz --progress "$staging_dir/" "$MAC_USER@$MAC_HOST:$MAC_IMAGE_DIR/"
    else
        scp -r "$staging_dir/"* "$MAC_USER@$MAC_HOST:$MAC_IMAGE_DIR/"
    fi

    ok "传输完成"

    # 远程验证校验和
    info "验证传输完整性..."
    ssh "$MAC_USER@$MAC_HOST" "cd $MAC_IMAGE_DIR && shasum -a 256 -c SHA256SUMS" || \
        warn "校验和验证失败，文件可能不完整。请重新传输。"

    ok "镜像已传输到 Mac: $MAC_IMAGE_DIR"
}

# ──────────────────────────────────────────────────────────────
# 清理
# ──────────────────────────────────────────────────────────────
cleanup() {
    local staging_dir="$1"
    if [[ -d "$staging_dir" && "$LOCAL_ONLY" != "true" ]]; then
        info "清理临时文件: $staging_dir"
        rm -rf "$staging_dir"
    fi
}

# ──────────────────────────────────────────────────────────────
# 打印总结
# ──────────────────────────────────────────────────────────────
print_summary() {
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  模拟器镜像传输完成${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo ""
    if [[ "$LOCAL_ONLY" == "true" ]]; then
        echo "  镜像位置: $LOCAL_OUTPUT_DIR"
    elif [[ -n "$MAC_HOST" ]]; then
        echo "  Mac 镜像位置: $MAC_USER@$MAC_HOST:$MAC_IMAGE_DIR"
    fi
    echo ""
    echo -e "${YELLOW}下一步 (在 Mac 上运行):${NC}"
    echo ""
    echo "  bash run-emulator-mac.sh"
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
main() {
    parse_args "$@"

    echo ""
    echo -e "${CYAN}ClawOS AOSP - 镜像传输${NC}"
    echo ""

    local zip_file
    zip_file="$(find_images)"

    local staging_dir
    staging_dir="$(prepare_package "$zip_file")"

    transfer_to_mac "$staging_dir"
    cleanup "$staging_dir"
    print_summary
}

main "$@"
