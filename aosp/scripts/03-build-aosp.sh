#!/usr/bin/env bash
#
# 03-build-aosp.sh - 构建 AOSP 并生成模拟器镜像
#
# 以普通用户身份运行 (不需要 sudo)。
# 建议在 tmux/screen 中运行 (构建耗时较长)。
#
# Usage:
#   bash 03-build-aosp.sh                  # 全量构建 + 模拟器镜像
#   bash 03-build-aosp.sh --skip-build     # 仅生成模拟器镜像 zip (已构建过)
#   bash 03-build-aosp.sh --clean          # 清理后重新构建
#
# 注意: 不使用 -u (nounset), 因为 AOSP 的 build/envsetup.sh
# 和构建系统大量使用未初始化的变量
set -eo pipefail

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
AOSP_LUNCH_TARGET="${AOSP_LUNCH_TARGET:-sdk_phone_arm64-userdebug}"
BUILD_JOBS="${BUILD_JOBS:-$(nproc 2>/dev/null || echo 4)}"

# GSI target override (set by --gsi flag)
GSI_LUNCH_TARGET="clawos_gsi_arm64-userdebug"
USE_CCACHE="${USE_CCACHE:-1}"

# 参数
SKIP_BUILD=false
DO_CLEAN=false
BUILD_GSI=false

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
            --skip-build)
                SKIP_BUILD=true
                shift
                ;;
            --clean)
                DO_CLEAN=true
                shift
                ;;
            --gsi)
                BUILD_GSI=true
                AOSP_LUNCH_TARGET="$GSI_LUNCH_TARGET"
                shift
                ;;
            --help|-h)
                echo "Usage: bash $0 [--skip-build] [--clean] [--gsi]"
                echo ""
                echo "  --skip-build  跳过编译, 仅生成 emu_img_zip"
                echo "  --clean       清理 out/ 后重新编译"
                echo "  --gsi         构建 GSI 镜像 (用于真机, 如 Lenovo Tab M10)"
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
# 前置检查
# ──────────────────────────────────────────────────────────────
preflight() {
    info "执行前置检查..."

    # 不应以 root 运行
    if [[ $EUID -eq 0 ]]; then
        die "请以普通用户身份运行此脚本 (不要用 sudo)"
    fi

    # 检查源码目录
    if [[ ! -f "$AOSP_SOURCE_DIR/build/envsetup.sh" ]]; then
        die "AOSP 源码不完整。找不到 build/envsetup.sh
请先运行 02-sync-source.sh"
    fi
    ok "AOSP 源码: $AOSP_SOURCE_DIR"

    # 检查内存
    local mem_gb
    mem_gb="$(free -g | awk '/^Mem:/{print $2}')"
    if [[ "$mem_gb" -lt 16 ]]; then
        warn "内存: ${mem_gb}GB (推荐 32GB+, 低内存可能导致构建失败)"
    else
        ok "内存: ${mem_gb}GB"
    fi

    # 检查磁盘空间 (构建需要额外 ~150GB)
    local avail_gb
    avail_gb="$(df -BG "$AOSP_SOURCE_DIR" | tail -1 | awk '{print $4}' | tr -d 'G')"
    if [[ "$avail_gb" -lt 100 ]]; then
        warn "磁盘可用空间: ${avail_gb}GB (构建需要约 150GB 额外空间)"
    else
        ok "磁盘可用空间: ${avail_gb}GB"
    fi

    info "构建目标: $AOSP_LUNCH_TARGET"
    info "并行度: $BUILD_JOBS"
}

# ──────────────────────────────────────────────────────────────
# 初始化构建环境
# ──────────────────────────────────────────────────────────────
init_build_env() {
    cd "$AOSP_SOURCE_DIR"

    info "初始化构建环境..."

    # AOSP 的 build/envsetup.sh 和 lunch 内部使用了未初始化的变量
    # (TOP, ZSH_VERSION 等), 必须关闭 set -u 才能正常 source
    set +u

    # source envsetup.sh
    # 注意: 必须在同一个 shell 中执行, 所以用 source
    source build/envsetup.sh

    # 配置 ccache
    if [[ "${USE_CCACHE:-0}" == "1" ]] && command -v ccache &>/dev/null; then
        export USE_CCACHE=1
        export CCACHE_EXEC="$(which ccache)"
        info "ccache 已启用"
    fi

    # 选择构建目标
    info "lunch $AOSP_LUNCH_TARGET ..."
    lunch "$AOSP_LUNCH_TARGET"

    ok "构建环境初始化完成"
    echo ""
    info "目标设备: $(get_build_var TARGET_PRODUCT 2>/dev/null || echo 'unknown')"
    info "构建变体: $(get_build_var TARGET_BUILD_VARIANT 2>/dev/null || echo 'unknown')"
    info "输出目录: $(get_build_var PRODUCT_OUT 2>/dev/null || echo 'unknown')"

    # 恢复 set -u (AOSP make 系统自己管理变量, 不能开 -u)
    # 注意: 后续 m / make 命令也依赖 AOSP 环境, 保持 set +u
}

# ──────────────────────────────────────────────────────────────
# 清理构建
# ──────────────────────────────────────────────────────────────
clean_build() {
    if [[ "$DO_CLEAN" != "true" ]]; then
        return 0
    fi

    cd "$AOSP_SOURCE_DIR"

    warn "清理构建产物 (out/)..."
    warn "这将删除所有已编译的文件, 需要重新全量编译。"

    m clean

    ok "清理完成"
}

# ──────────────────────────────────────────────────────────────
# 执行构建
# ──────────────────────────────────────────────────────────────
do_build() {
    if [[ "$SKIP_BUILD" == "true" ]]; then
        warn "跳过编译 (--skip-build)"
        return 0
    fi

    cd "$AOSP_SOURCE_DIR"

    info "开始构建 AOSP..."
    info "并行度: $BUILD_JOBS"
    info "预计首次构建耗时: 1-4 小时 (取决于硬件配置)"
    echo ""

    local start_time
    start_time=$(date +%s)

    # 全量构建
    m -j"$BUILD_JOBS"

    local end_time
    end_time=$(date +%s)
    local duration=$(( end_time - start_time ))
    local hours=$(( duration / 3600 ))
    local minutes=$(( (duration % 3600) / 60 ))

    ok "AOSP 构建完成 (耗时: ${hours}小时${minutes}分钟)"
}

# ──────────────────────────────────────────────────────────────
# 生成模拟器镜像 zip
# ──────────────────────────────────────────────────────────────
make_emu_img_zip() {
    # GSI 模式不需要模拟器镜像 zip
    if [[ "$BUILD_GSI" == "true" ]]; then
        info "GSI 模式: 跳过模拟器镜像 zip 生成"
        return 0
    fi

    cd "$AOSP_SOURCE_DIR"

    info "生成模拟器镜像 zip 包..."

    make emu_img_zip -j"$BUILD_JOBS"

    # 查找生成的 zip 文件
    local product_out
    product_out="$(get_build_var PRODUCT_OUT 2>/dev/null || echo "$AOSP_SOURCE_DIR/out/target/product/emulator_arm64")"

    local zip_file
    zip_file="$(ls -t "$product_out"/*-img-*.zip 2>/dev/null | head -1)"

    if [[ -n "$zip_file" && -f "$zip_file" ]]; then
        local zip_size
        zip_size="$(du -sh "$zip_file" | awk '{print $1}')"
        ok "模拟器镜像: $zip_file ($zip_size)"
    else
        warn "未找到模拟器镜像 zip 文件。"
        warn "请检查构建输出目录: $product_out"
    fi
}

# ──────────────────────────────────────────────────────────────
# 打印总结
# ──────────────────────────────────────────────────────────────
print_summary() {
    local product_out
    product_out="$(get_build_var PRODUCT_OUT 2>/dev/null || echo "$AOSP_SOURCE_DIR/out/target/product/emulator_arm64")"

    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  AOSP 构建完成${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "  构建目标:    $AOSP_LUNCH_TARGET"
    echo "  输出目录:    $product_out"
    echo ""
    echo -e "${YELLOW}构建产物中的关键文件:${NC}"
    echo ""
    if [[ -d "$product_out" ]]; then
        ls -lh "$product_out"/*.img 2>/dev/null | awk '{print "  " $NF " (" $5 ")"}' || true
    fi
    echo ""

    if [[ "$BUILD_GSI" == "true" ]]; then
        # GSI 模式: 显示 system.img 路径和刷机提示
        local system_img="$product_out/system.img"
        if [[ -f "$system_img" ]]; then
            local img_size
            img_size="$(du -sh "$system_img" | awk '{print $1}')"
            echo -e "${GREEN}  GSI 镜像:    $system_img ($img_size)${NC}"
        fi
        echo ""
        echo -e "${YELLOW}下一步 (GSI 刷机):${NC}"
        echo ""
        echo "  1. 将 system.img 传输到 Mac:"
        echo "     scp $system_img <mac-user>@<mac-ip>:~/clawos-gsi/"
        echo ""
        echo "  2. 在 Mac 上运行刷机脚本:"
        echo "     bash scripts/flash-gsi.sh ~/clawos-gsi/system.img"
    else
        # 模拟器模式: 显示原始提示
        local zip_file
        zip_file="$(ls -t "$product_out"/*-img-*.zip 2>/dev/null | head -1)" || true
        zip_file="${zip_file:-<未生成>}"
        echo "  镜像 zip:    $zip_file"
        echo ""
        echo -e "${YELLOW}下一步:${NC}"
        echo ""
        echo "  运行镜像传输脚本 (将镜像传到 Mac):"
        echo "    bash $(dirname "$0")/04-transfer-images.sh"
    fi
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
main() {
    parse_args "$@"

    echo ""
    echo -e "${CYAN}ClawOS AOSP - 系统构建${NC}"
    echo -e "${CYAN}目标: ${AOSP_LUNCH_TARGET}${NC}"
    echo ""

    preflight

    # 以下命令需要在同一个 shell 中执行 (envsetup.sh 设置的环境变量)
    # 所以不能拆成子进程
    init_build_env
    clean_build
    do_build
    make_emu_img_zip
    print_summary
}

main "$@"
