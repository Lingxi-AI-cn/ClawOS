#!/usr/bin/env bash
#
# upload-sourceforge.sh - Upload ClawOS ROM images to SourceForge
#
# Uploads system.img, vbmeta.img, emulator images, and prebuilt binaries
# to SourceForge file hosting via rsync (supports resume/incremental sync).
#
# Usage:
#   bash upload-sourceforge.sh <version>                    # Upload Pixel 8 Pro images
#   bash upload-sourceforge.sh <version> --emulator         # Also upload emulator image
#   bash upload-sourceforge.sh <version> --prebuilt         # Also upload prebuilt binaries
#   bash upload-sourceforge.sh <version> --all              # Upload everything
#   bash upload-sourceforge.sh <version> --dry-run          # Show what would be uploaded
#
# Prerequisites:
#   1. SourceForge account with SSH key configured
#   2. AOSP build completed (system.img exists)
#   3. rsync installed
#
# Environment variables (or set in .env.local):
#   SF_USER     - SourceForge username (default: from .env.local)
#   SF_PROJECT  - SourceForge project name (default: clawos)
#
set -euo pipefail

# Load .env.local
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
for envfile in "${SCRIPT_DIR}/../.env.local" "${PROJECT_ROOT}/.env.local"; do
    [ -f "$envfile" ] && source "$envfile" && break
done

# ──────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────

SF_USER="${SF_USER:-your-sf-username}"
SF_PROJECT="${SF_PROJECT:-clawos}"
SF_HOST="frs.sourceforge.net"
SF_BASE="/home/frs/project/${SF_PROJECT}"

GSI_OUT="${LINUX_AOSP_OUT:-/opt/aosp/out/target/product/clawos_gsi_arm64}"
EMU_OUT="/opt/aosp/out/target/product/emu64a"
DEVICE_TREE="/opt/ClawOS/aosp/device/clawos"

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
# Parse arguments
# ──────────────────────────────────────────────────────────────

VERSION=""
UPLOAD_EMU=false
UPLOAD_PREBUILT=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --emulator)    UPLOAD_EMU=true; shift ;;
        --prebuilt)    UPLOAD_PREBUILT=true; shift ;;
        --all)         UPLOAD_EMU=true; UPLOAD_PREBUILT=true; shift ;;
        --dry-run)     DRY_RUN=true; shift ;;
        --sf-user)     SF_USER="${2:?--sf-user requires a value}"; shift 2 ;;
        --sf-project)  SF_PROJECT="${2:?--sf-project requires a value}"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 <version> [options]"
            echo ""
            echo "Options:"
            echo "  --emulator     Also upload emulator image"
            echo "  --prebuilt     Also upload prebuilt binaries (node, gateway-bundle)"
            echo "  --all          Upload everything"
            echo "  --dry-run      Show what would be uploaded without uploading"
            echo "  --sf-user      SourceForge username (default: ${SF_USER})"
            echo "  --sf-project   SourceForge project (default: ${SF_PROJECT})"
            echo ""
            echo "Examples:"
            echo "  $0 v1.0"
            echo "  $0 v1.0 --all"
            echo "  $0 v1.0 --dry-run"
            exit 0
            ;;
        -*)
            die "Unknown option: $1"
            ;;
        *)
            VERSION="$1"; shift
            ;;
    esac
done

if [[ -z "$VERSION" ]]; then
    die "Usage: $0 <version> [options]\n  Example: $0 v1.0 --all"
fi

# ──────────────────────────────────────────────────────────────
# Preflight checks
# ──────────────────────────────────────────────────────────────

echo ""
echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  ClawOS → SourceForge Upload${NC}"
echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
echo ""

info "Version:  ${VERSION}"
info "SF User:  ${SF_USER}"
info "SF Project: ${SF_PROJECT}"
info "Remote:   ${SF_USER}@${SF_HOST}:${SF_BASE}/"
echo ""

# Check rsync
command -v rsync &>/dev/null || die "rsync not found. Install: sudo apt install rsync"

# Check SSH connectivity (SourceForge FRS is a restricted shell, so we test with sftp)
info "Testing SSH connection to SourceForge..."
if sftp -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new \
       -o BatchMode=yes "${SF_USER}@${SF_HOST}" <<< "ls" &>/dev/null 2>&1; then
    ok "SSH connection OK"
else
    # sftp might fail but SSH key could still be valid; try ssh and check exit code
    ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new \
        "${SF_USER}@${SF_HOST}" "" &>/dev/null 2>&1
    if [[ $? -le 1 ]]; then
        ok "SSH connection OK (restricted shell)"
    else
        die "Cannot connect to SourceForge via SSH.
Check:
  1. SSH key added to SourceForge (Account Settings → SSH Keys)
  2. Username correct: ${SF_USER}
  3. Try: ssh ${SF_USER}@${SF_HOST}"
    fi
fi

echo ""

# ──────────────────────────────────────────────────────────────
# Prepare staging directory
# ──────────────────────────────────────────────────────────────

STAGING="/tmp/clawos-sf-upload-${VERSION}"
rm -rf "$STAGING"
mkdir -p "${STAGING}/pixel8pro/${VERSION}"

# Pixel 8 Pro images (always uploaded)
SYSTEM_IMG="${GSI_OUT}/system.img"
if [[ ! -f "$SYSTEM_IMG" ]]; then
    die "system.img not found: ${SYSTEM_IMG}
Build first: cd /opt/aosp && source build/envsetup.sh && lunch clawos_gsi_arm64-trunk_staging-userdebug && m -j\$(nproc)"
fi

info "Preparing Pixel 8 Pro images..."
ln -sf "$SYSTEM_IMG" "${STAGING}/pixel8pro/${VERSION}/system.img"

# Generate disabled-verity vbmeta
AVBTOOL=$(find /opt/aosp/out/host -name avbtool -type f 2>/dev/null | head -1)
if [[ -n "$AVBTOOL" ]]; then
    info "Generating disabled-verity vbmeta..."
    "$AVBTOOL" make_vbmeta_image --flags 2 --padding_size 4096 \
        --output "${STAGING}/pixel8pro/${VERSION}/vbmeta.img"
    ok "vbmeta.img generated"
else
    warn "avbtool not found, skipping vbmeta generation"
    if [[ -f "${GSI_OUT}/vbmeta.img" ]]; then
        ln -sf "${GSI_OUT}/vbmeta.img" "${STAGING}/pixel8pro/${VERSION}/vbmeta.img"
    fi
fi

# Generate SHA256SUMS
info "Generating checksums..."
(
    cd "${STAGING}/pixel8pro/${VERSION}"
    sha256sum system.img > SHA256SUMS.txt
    [[ -f vbmeta.img ]] && sha256sum vbmeta.img >> SHA256SUMS.txt
)
ok "SHA256SUMS.txt generated"

# Show file sizes
echo ""
info "Pixel 8 Pro files:"
for f in "${STAGING}/pixel8pro/${VERSION}"/*; do
    size=$(du -sh "$f" 2>/dev/null | cut -f1)
    echo "  $(basename "$f"): ${size}"
done

# Emulator images
if $UPLOAD_EMU; then
    echo ""
    info "Preparing emulator images..."
    mkdir -p "${STAGING}/emulator/${VERSION}"

    EMU_ZIP=$(ls -t "${EMU_OUT}"/*.zip 2>/dev/null | head -1)
    if [[ -n "$EMU_ZIP" ]]; then
        ln -sf "$EMU_ZIP" "${STAGING}/emulator/${VERSION}/$(basename "$EMU_ZIP")"
        ok "Emulator zip: $(basename "$EMU_ZIP") ($(du -sh "$EMU_ZIP" | cut -f1))"
    else
        warn "No emulator zip found in ${EMU_OUT}"
    fi
fi

# Prebuilt binaries
if $UPLOAD_PREBUILT; then
    echo ""
    info "Preparing prebuilt binaries..."
    mkdir -p "${STAGING}/prebuilt"

    if [[ -f "${DEVICE_TREE}/prebuilt/node" ]]; then
        ln -sf "${DEVICE_TREE}/prebuilt/node" "${STAGING}/prebuilt/node-v22.16.0-android-arm64"
        ok "Node.js binary: $(du -sh "${DEVICE_TREE}/prebuilt/node" | cut -f1)"
    else
        warn "Node.js binary not found: ${DEVICE_TREE}/prebuilt/node"
    fi

    if [[ -f "${DEVICE_TREE}/gateway/gateway-bundle.tar.gz" ]]; then
        ln -sf "${DEVICE_TREE}/gateway/gateway-bundle.tar.gz" "${STAGING}/prebuilt/gateway-bundle.tar.gz"
        ok "Gateway bundle: $(du -sh "${DEVICE_TREE}/gateway/gateway-bundle.tar.gz" | cut -f1)"
    else
        warn "Gateway bundle not found"
    fi
fi

# ──────────────────────────────────────────────────────────────
# Upload
# ──────────────────────────────────────────────────────────────

echo ""
echo -e "${CYAN}────────────────────────────────────────────────────────────${NC}"

RSYNC_OPTS="-avz --progress -e ssh"

if $DRY_RUN; then
    RSYNC_OPTS="${RSYNC_OPTS} --dry-run"
    warn "DRY RUN mode — no files will be uploaded"
fi

echo ""
info "Uploading to SourceForge..."
echo ""

# SourceForge FRS is a restricted shell — cannot run mkdir via ssh.
# rsync --rsync-path with mkdir handles remote directory creation.

# Upload Pixel 8 Pro
info "Uploading Pixel 8 Pro images..."
rsync ${RSYNC_OPTS} -L --relative \
    "${STAGING}/./pixel8pro/${VERSION}/" \
    "${SF_USER}@${SF_HOST}:${SF_BASE}/"
ok "Pixel 8 Pro images uploaded"

# Upload emulator
if $UPLOAD_EMU && [[ -d "${STAGING}/emulator/${VERSION}" ]]; then
    echo ""
    info "Uploading emulator images..."
    rsync ${RSYNC_OPTS} -L --relative \
        "${STAGING}/./emulator/${VERSION}/" \
        "${SF_USER}@${SF_HOST}:${SF_BASE}/"
    ok "Emulator images uploaded"
fi

# Upload prebuilt
if $UPLOAD_PREBUILT && [[ -d "${STAGING}/prebuilt" ]]; then
    echo ""
    info "Uploading prebuilt binaries..."
    rsync ${RSYNC_OPTS} -L --relative \
        "${STAGING}/./prebuilt/" \
        "${SF_USER}@${SF_HOST}:${SF_BASE}/"
    ok "Prebuilt binaries uploaded"
fi

# ──────────────────────────────────────────────────────────────
# Cleanup & Summary
# ──────────────────────────────────────────────────────────────

rm -rf "$STAGING"

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Upload complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Downloads:"
echo "  https://sourceforge.net/projects/${SF_PROJECT}/files/pixel8pro/${VERSION}/"

if $UPLOAD_EMU; then
    echo "  https://sourceforge.net/projects/${SF_PROJECT}/files/emulator/${VERSION}/"
fi

if $UPLOAD_PREBUILT; then
    echo "  https://sourceforge.net/projects/${SF_PROJECT}/files/prebuilt/"
fi

echo ""
echo "  Direct download links (for README):"
echo "  https://sourceforge.net/projects/${SF_PROJECT}/files/pixel8pro/${VERSION}/system.img/download"
echo "  https://sourceforge.net/projects/${SF_PROJECT}/files/pixel8pro/${VERSION}/vbmeta.img/download"
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
