#!/usr/bin/env bash
#
# download-cli-tools.sh — 下载 ARM64 静态二进制工具, 供预装到 ClawOS ROM
#
# 这些工具将被安装到 /product/bin/, 供 OpenClaw Gateway (Node.js) 调用。
#
# 包含的工具:
#   - curl    HTTP 客户端 (网页下载、API 调用)
#   - jq      JSON 处理
#   - wget    文件下载
#   - zip     压缩打包
#
# Usage:
#   bash scripts/download-cli-tools.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLS_DIR="${SCRIPT_DIR}/../device/clawos/prebuilt/tools"

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

# Tool versions
CURL_VERSION="8.12.1"
JQ_VERSION="1.7.1"
BUSYBOX_VERSION="1.36.1"

mkdir -p "$TOOLS_DIR"
cd "$TOOLS_DIR"

# ── curl (static, from official builds) ─────────────────────────
download_curl() {
    if [[ -f "curl" ]]; then
        ok "curl already downloaded"
        return
    fi
    info "Downloading curl ${CURL_VERSION} (static ARM64)..."
    local url="https://github.com/moparisthebest/static-curl/releases/download/v${CURL_VERSION}/curl-aarch64"
    curl -L -o curl "$url" || die "Failed to download curl"
    chmod +x curl
    ok "curl downloaded ($(du -sh curl | awk '{print $1}'))"
}

# ── jq (static, from official releases) ─────────────────────────
download_jq() {
    if [[ -f "jq" ]]; then
        ok "jq already downloaded"
        return
    fi
    info "Downloading jq ${JQ_VERSION} (static ARM64)..."
    local url="https://github.com/jqlang/jq/releases/download/jq-${JQ_VERSION}/jq-linux-arm64"
    curl -L -o jq "$url" || die "Failed to download jq"
    chmod +x jq
    ok "jq downloaded ($(du -sh jq | awk '{print $1}'))"
}

# ── busybox (provides wget, zip, vi, etc.) ──────────────────────
download_busybox() {
    if [[ -f "busybox" ]]; then
        ok "busybox already downloaded"
        return
    fi
    info "Downloading busybox ${BUSYBOX_VERSION} (static ARM64)..."
    local url="https://busybox.net/downloads/binaries/${BUSYBOX_VERSION}-defconfig-multiarch-musl/busybox-armv8l"
    curl -L -o busybox "$url" || die "Failed to download busybox"
    chmod +x busybox
    ok "busybox downloaded ($(du -sh busybox | awk '{print $1}'))"
}

# ── Main ────────────────────────────────────────────────────────
main() {
    echo ""
    echo -e "${CYAN}ClawOS - 下载 CLI 工具 (ARM64 静态二进制)${NC}"
    echo -e "目录: ${TOOLS_DIR}"
    echo ""

    download_curl
    download_jq
    download_busybox

    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  所有工具下载完成${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
    echo ""
    echo "  文件列表:"
    ls -lhS "$TOOLS_DIR"/ 2>/dev/null | grep -v '^total' | awk '{print "    " $NF " (" $5 ")"}'
    echo ""
    echo "  busybox 提供的额外命令 (通过 symlink):"
    echo "    wget, vi, zip, diff, patch, nc, telnet, base64, md5sum, sha256sum, ..."
    echo ""
    echo -e "${YELLOW}下一步: 运行 05-setup-device-tree.sh 同步到 AOSP, 然后重新构建${NC}"
}

main "$@"
