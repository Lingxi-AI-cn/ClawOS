#!/usr/bin/env bash
#
# pull-pixel8pro-images-mac.sh - 从 Linux 构建机拉取 Pixel 8 Pro 镜像到 Mac
#
# 使用 rsync 增量同步，支持断点续传。
# 镜像存放在: ~/clawos-pixel8pro/
#
# Usage:
#   bash pull-pixel8pro-images-mac.sh                # 外网模式 (端口转发)
#   bash pull-pixel8pro-images-mac.sh --lan          # 局域网模式
#
set -euo pipefail

# Load .env.local from project root if available
_ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.local"
[ -f "$_ENV_FILE" ] && source "$_ENV_FILE"

# ──────────────────────────────────────────────────────────────
# 配置
# ──────────────────────────────────────────────────────────────

# 本地镜像目录
IMAGE_DIR="${HOME}/clawos-pixel8pro"

# Linux 构建服务器 SSH 配置
LINUX_USER="${LINUX_USER:-}"
LINUX_HOST="${LINUX_HOST:-}"
LINUX_PORT="${LINUX_PORT:-22}"
LINUX_AOSP_OUT="${LINUX_AOSP_OUT:-/opt/aosp/out/target/product/clawos_gsi_arm64}"

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
            --lan)
                LINUX_PORT="22"
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
                echo "从 Linux 构建机拉取 Pixel 8 Pro 镜像到 Mac"
                echo ""
                echo "Options:"
                echo "  --lan              局域网模式 (SSH 端口改为 22)"
                echo "  --linux-host HOST  Linux 构建机地址 (默认: ${LINUX_HOST})"
                echo "  --linux-port PORT  Linux SSH 端口 (默认: ${LINUX_PORT})"
                echo "  --linux-user USER  Linux SSH 用户名 (默认: ${LINUX_USER})"
                echo ""
                echo "Examples:"
                echo "  # 外网模式 (通过端口转发)"
                echo "  bash $0"
                echo ""
                echo "  # 局域网模式 (在家里同一网络下)"
                echo "  bash $0 --lan"
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
# 拉取镜像
# ──────────────────────────────────────────────────────────────
pull_images() {
    echo ""
    echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  ClawOS Pixel 8 Pro - 镜像拉取${NC}"
    echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    info "从 Linux 构建机拉取 Pixel 8 Pro 镜像..."
    info "连接: ${LINUX_USER}@${LINUX_HOST}:${LINUX_PORT}"
    info "目标: ${IMAGE_DIR}"
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
    echo ""

    # 2. 检查远程 system.img
    info "检查远程镜像文件..."

    if ! ssh ${ssh_opts} "$ssh_target" "test -f ${LINUX_AOSP_OUT}/system.img" 2>/dev/null; then
        die "远程缺少 system.img

请先在 Linux 上完成 AOSP 编译:
  cd \$AOSP_DIR
  source build/envsetup.sh
  lunch clawos_gsi_arm64-trunk_staging-userdebug
  m -j\$(nproc)"
    fi
    ok "远程 system.img 存在"
    echo ""

    # 3. 在服务器上生成 disabled-verity vbmeta
    #    AOSP 构建的 vbmeta.img 有 verity 启用 (Flags:0)，直接刷入会导致
    #    Verified Boot 校验失败，设备无法启动。必须用 avbtool 生成 Flags:2 版本。
    info "在服务器上生成 disabled-verity vbmeta..."
    local remote_vbmeta="/tmp/clawos-vbmeta-disabled.img"

    # avbtool 位于 AOSP 构建产物的 host 工具目录
    local avbtool_cmd="
        AVBTOOL=\$(find \$(readlink -f ${LINUX_AOSP_OUT}/../../..)/host -name avbtool -type f 2>/dev/null | head -1)
        if [ -z \"\$AVBTOOL\" ]; then
            echo 'ERROR: avbtool not found' >&2
            exit 1
        fi
        \$AVBTOOL make_vbmeta_image --flags 2 --padding_size 4096 --output ${remote_vbmeta}
    "

    if ! ssh ${ssh_opts} "$ssh_target" "$avbtool_cmd" 2>&1; then
        die "生成 disabled vbmeta 失败。
请确保已在 Linux 上完成过 AOSP 编译 (avbtool 是编译产物)"
    fi
    ok "disabled-verity vbmeta 已生成"
    echo ""

    # 4. 显示远程文件大小
    info "远程镜像信息:"
    local system_size
    system_size="$(ssh ${ssh_opts} "$ssh_target" "du -sh ${LINUX_AOSP_OUT}/system.img 2>/dev/null | awk '{print \$1}'" || echo "?")"
    echo "  system.img: ${system_size}"
    echo "  vbmeta.img: ~4K (disabled-verity)"
    echo ""

    # 5. 创建本地目录
    mkdir -p "$IMAGE_DIR"

    # 6. 拉取镜像文件 (rsync 增量同步，不压缩 — 二进制 img 压缩率低且浪费 CPU)
    info "开始拉取镜像 (rsync 增量同步)..."
    echo ""

    if ! command -v rsync &>/dev/null; then
        die "rsync 未安装。请安装: brew install rsync"
    fi

    info "拉取: system.img (${system_size})..."
    rsync -av --partial --progress \
        -e "ssh ${ssh_opts}" \
        "${ssh_target}:${LINUX_AOSP_OUT}/system.img" \
        "${IMAGE_DIR}/system.img"
    ok "system.img 拉取完成"
    echo ""

    info "拉取: vbmeta.img (disabled-verity)..."
    rsync -av --partial --progress \
        -e "ssh ${ssh_opts}" \
        "${ssh_target}:${remote_vbmeta}" \
        "${IMAGE_DIR}/vbmeta.img"
    ok "vbmeta.img 拉取完成"
    echo ""

    # 7. 生成校验和
    info "生成本地校验和..."
    (cd "$IMAGE_DIR" && shasum -a 256 *.img > SHA256SUMS)
    ok "校验和已生成: ${IMAGE_DIR}/SHA256SUMS"
    echo ""

    # 8. 验证 system.img 传输完整性
    info "验证 system.img 传输完整性..."
    local remote_sha
    remote_sha="$(ssh ${ssh_opts} "$ssh_target" "sha256sum ${LINUX_AOSP_OUT}/system.img 2>/dev/null | awk '{print \$1}'")"
    local local_sha
    local_sha="$(shasum -a 256 "${IMAGE_DIR}/system.img" | awk '{print $1}')"

    if [[ "$remote_sha" == "$local_sha" ]]; then
        ok "system.img: SHA256 校验通过"
    else
        warn "system.img: SHA256 不匹配!"
        warn "  远程: $remote_sha"
        warn "  本地: $local_sha"
        warn "建议重新拉取"
    fi
    echo ""

    # 9. 验证 vbmeta flags
    info "验证 vbmeta.img..."
    local vbmeta_size
    vbmeta_size="$(wc -c < "${IMAGE_DIR}/vbmeta.img")"
    if [[ "$vbmeta_size" -lt 8192 ]]; then
        ok "vbmeta.img: 大小 ${vbmeta_size} 字节 (disabled-verity 格式正确)"
    else
        warn "vbmeta.img 大小 ${vbmeta_size} 字节 — 可能不是 disabled-verity 版本!"
    fi
    echo ""

    # 10. 显示本地镜像信息
    info "本地镜像信息:"
    echo "  目录: ${IMAGE_DIR}"
    local s_size v_size
    s_size="$(du -sh "${IMAGE_DIR}/system.img" | awk '{print $1}')"
    v_size="$(du -sh "${IMAGE_DIR}/vbmeta.img" | awk '{print $1}')"
    echo "    system.img: ${s_size}"
    echo "    vbmeta.img: ${v_size} (disabled-verity, Flags:2)"
    echo ""

    # 9. 总结
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  镜像拉取完成${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "  镜像目录: ${IMAGE_DIR}"
    echo ""
    echo -e "${YELLOW}下一步:${NC}"
    echo ""
    echo "  刷入 Pixel 8 Pro:"
    echo "  bash aosp/flash-pixel8pro-mac.sh"
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
main() {
    parse_args "$@"
    pull_images
}

main "$@"
