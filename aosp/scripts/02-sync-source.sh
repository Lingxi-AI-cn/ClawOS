#!/usr/bin/env bash
#
# 02-sync-source.sh - 初始化并同步 AOSP 源码
#
# 以普通用户身份运行 (不需要 sudo)。
# 建议在 tmux/screen 中运行 (下载耗时较长)。
#
# Usage:
#   bash 02-sync-source.sh              # 完整同步
#   bash 02-sync-source.sh --retry      # 断点续传 (仅 repo sync)
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
AOSP_BRANCH="${AOSP_BRANCH:-android-12.0.0_r34}"
AOSP_SOURCE_DIR="${AOSP_SOURCE_DIR:-/home/${USER}/aosp}"
AOSP_MANIFEST_URL="${AOSP_MANIFEST_URL:-https://mirrors.tuna.tsinghua.edu.cn/git/AOSP/platform/manifest}"
AOSP_MIRROR_URL="${AOSP_MIRROR_URL:-https://mirrors.tuna.tsinghua.edu.cn/git/AOSP}"
BUILD_JOBS="${BUILD_JOBS:-$(nproc 2>/dev/null || echo 4)}"
HTTP_PROXY_URL="${HTTP_PROXY_URL:-}"
HTTPS_PROXY_URL="${HTTPS_PROXY_URL:-}"

# 参数
RETRY_ONLY=false
USE_GOOGLE=false

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
            --retry)
                RETRY_ONLY=true
                shift
                ;;
            --google)
                USE_GOOGLE=true
                shift
                ;;
            --mirror)
                AOSP_MANIFEST_URL="${2:?--mirror 需要指定 manifest URL}"
                shift 2
                ;;
            --proxy)
                HTTP_PROXY_URL="${2:?--proxy 需要指定代理地址}"
                HTTPS_PROXY_URL="$HTTP_PROXY_URL"
                shift 2
                ;;
            --help|-h)
                echo "Usage: bash $0 [OPTIONS]"
                echo ""
                echo "  --retry           跳过 repo init，仅执行 repo sync (断点续传)"
                echo "  --google          使用 Google 官方源 (需要 VPN)"
                echo "  --mirror URL      指定自定义 manifest 镜像 URL"
                echo "  --proxy URL       设置 HTTP 代理 (例如: http://127.0.0.1:7890)"
                echo ""
                echo "默认使用清华 TUNA 镜像 (无需 VPN)。"
                exit 0
                ;;
            *)
                warn "未知参数: $1"
                shift
                ;;
        esac
    done

    # 如果指定了 --google，切换到官方源
    if [[ "$USE_GOOGLE" == "true" ]]; then
        AOSP_MANIFEST_URL="https://android.googlesource.com/platform/manifest"
        AOSP_MIRROR_URL=""
        info "使用 Google 官方源 (需要 VPN/代理)"
    fi
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

    # 配置代理 (如果设置了)
    if [[ -n "$HTTP_PROXY_URL" ]]; then
        export http_proxy="$HTTP_PROXY_URL"
        export HTTP_PROXY="$HTTP_PROXY_URL"
        info "HTTP 代理: $HTTP_PROXY_URL"
    fi
    if [[ -n "$HTTPS_PROXY_URL" ]]; then
        export https_proxy="$HTTPS_PROXY_URL"
        export HTTPS_PROXY="$HTTPS_PROXY_URL"
        info "HTTPS 代理: $HTTPS_PROXY_URL"
    fi

    # 检查 repo 是否可用
    if ! command -v repo &>/dev/null; then
        # 尝试在 ~/bin 中查找
        if [[ -x "$HOME/bin/repo" ]]; then
            export PATH="$HOME/bin:$PATH"
        else
            die "repo 工具未找到。请先运行 01-setup-build-env.sh"
        fi
    fi
    ok "repo 工具: $(which repo)"

    # 检查 git 配置
    local git_name git_email
    git_name="$(git config --global user.name 2>/dev/null || true)"
    git_email="$(git config --global user.email 2>/dev/null || true)"
    if [[ -z "$git_name" || -z "$git_email" ]]; then
        die "Git 用户信息未配置。请先运行:
  git config --global user.name \"Your Name\"
  git config --global user.email \"your@email.com\""
    fi
    ok "Git 用户: $git_name <$git_email>"

    # 检查目标目录
    if [[ ! -d "$AOSP_SOURCE_DIR" ]]; then
        info "创建源码目录: $AOSP_SOURCE_DIR"
        mkdir -p "$AOSP_SOURCE_DIR"
    fi
    ok "源码目录: $AOSP_SOURCE_DIR"

    # 检查磁盘空间
    local avail_gb
    avail_gb="$(df -BG "$AOSP_SOURCE_DIR" | tail -1 | awk '{print $4}' | tr -d 'G')"
    if [[ "$avail_gb" -lt 200 ]]; then
        warn "磁盘可用空间: ${avail_gb}GB (需要至少 200GB 用于源码下载)"
    else
        ok "磁盘可用空间: ${avail_gb}GB"
    fi

    # 显示镜像/源信息
    info "Manifest URL: $AOSP_MANIFEST_URL"
    if [[ "$AOSP_MANIFEST_URL" == *"tuna"* ]]; then
        ok "使用清华大学 TUNA 镜像 (国内无需 VPN)"
    elif [[ "$AOSP_MANIFEST_URL" == *"ustc"* ]]; then
        ok "使用中科大 USTC 镜像 (国内无需 VPN)"
    elif [[ "$AOSP_MANIFEST_URL" == *"googlesource"* ]]; then
        warn "使用 Google 官方源 (国内需要 VPN/代理)"
        if [[ -z "$HTTP_PROXY_URL" && -z "$HTTPS_PROXY_URL" ]]; then
            warn "未检测到代理配置。如果下载失败，请:"
            warn "  1. 使用 --proxy 参数: bash $0 --proxy http://127.0.0.1:7890"
            warn "  2. 或切换到国内镜像 (默认): 移除 --google 参数"
        fi
    fi

    # 测试网络连通性
    info "测试源站连通性..."
    local test_url
    if [[ "$AOSP_MANIFEST_URL" == *"tuna"* ]]; then
        test_url="https://mirrors.tuna.tsinghua.edu.cn"
    elif [[ "$AOSP_MANIFEST_URL" == *"ustc"* ]]; then
        test_url="https://mirrors.ustc.edu.cn"
    else
        test_url="https://android.googlesource.com"
    fi

    if curl -fsSL --connect-timeout 10 "$test_url" -o /dev/null 2>/dev/null; then
        ok "源站连通: $test_url"
    else
        warn "无法连接源站: $test_url"
        warn "请检查网络或代理配置。"
    fi
}

# ──────────────────────────────────────────────────────────────
# repo init
# ──────────────────────────────────────────────────────────────
do_repo_init() {
    cd "$AOSP_SOURCE_DIR"

    # 检查是否已经初始化
    if [[ -d ".repo" ]]; then
        if [[ "$RETRY_ONLY" == "true" ]]; then
            ok "repo 已初始化，跳过 init (--retry 模式)"
            return 0
        fi
        warn ".repo 目录已存在，将重新初始化"
    fi

    info "初始化 repo (分支: $AOSP_BRANCH)..."
    info "Manifest URL: $AOSP_MANIFEST_URL"

    # 注意: 不使用 --partial-clone / --clone-filter
    # 这些选项与部分镜像不兼容，且与 tag 分支冲突
    repo init \
        -u "$AOSP_MANIFEST_URL" \
        -b "$AOSP_BRANCH" \
        --depth=1

    # 如果使用国内镜像，替换 manifest 中的 googlesource URL
    # 确保 repo sync 时也走镜像而非回源到 Google
    if [[ -n "${AOSP_MIRROR_URL:-}" && "$AOSP_MIRROR_URL" != *"googlesource"* ]]; then
        local manifest_file="$AOSP_SOURCE_DIR/.repo/manifests/default.xml"
        if [[ -f "$manifest_file" ]]; then
            info "替换 manifest 中的 fetch URL 为镜像地址..."
            # 将 https://android.googlesource.com 替换为镜像 URL
            sed -i "s|https://android.googlesource.com|${AOSP_MIRROR_URL}|g" "$manifest_file"
            ok "已将 fetch URL 替换为: $AOSP_MIRROR_URL"
        fi
    fi

    ok "repo init 完成"
}

# ──────────────────────────────────────────────────────────────
# repo sync
# ──────────────────────────────────────────────────────────────
do_repo_sync() {
    cd "$AOSP_SOURCE_DIR"

    # 计算合理的并行数 (网络 I/O 不需要太多, 通常 4-8 即可)
    local sync_jobs
    sync_jobs=$(( BUILD_JOBS > 8 ? 8 : BUILD_JOBS ))

    info "开始同步 AOSP 源码..."
    info "并行下载数: $sync_jobs"
    info "这将下载约 80-100GB 数据，耗时取决于网络速度。"
    info "如果中断，可以用 'bash $0 --retry' 断点续传。"
    echo ""

    local start_time
    start_time=$(date +%s)

    # repo sync 参数说明:
    #   -c              只下载当前分支 (节省空间和时间)
    #   -j N            并行下载数
    #   --optimized-fetch  优化下载
    #   --force-sync    覆盖本地修改 (retry 时有用)
    #   --force-broken  遇到错误不中止, 继续同步其余仓库
    #   --no-clone-bundle  不使用 clone.bundle (部分镜像不支持)
    #
    # 注意: 不使用 --no-tags，因为我们基于 tag 分支构建
    repo sync \
        -c \
        -j "$sync_jobs" \
        --optimized-fetch \
        --no-clone-bundle \
        --force-sync \
        --force-broken

    local sync_exit=$?

    # 如果有部分仓库 checkout 失败, 尝试强制 checkout 修复
    if [[ $sync_exit -ne 0 ]]; then
        warn "部分仓库同步有错误 (exit: $sync_exit)，尝试修复..."
        info "强制重置有冲突的仓库..."

        # 对所有仓库执行强制 checkout
        repo forall -c 'git checkout -f HEAD 2>/dev/null; git clean -fd 2>/dev/null' || true

        # 再次 sync 修复遗留问题
        info "重新同步修复遗留问题..."
        repo sync \
            -c \
            -j "$sync_jobs" \
            --optimized-fetch \
            --no-clone-bundle \
            --force-sync \
            --force-broken || true

        warn "同步完成 (部分非关键仓库可能有 checkout 错误，通常不影响构建)"
    fi

    local end_time
    end_time=$(date +%s)
    local duration=$(( end_time - start_time ))
    local minutes=$(( duration / 60 ))
    local seconds=$(( duration % 60 ))

    ok "AOSP 源码同步完成 (耗时: ${minutes}分${seconds}秒)"
}

# ──────────────────────────────────────────────────────────────
# 验证源码
# ──────────────────────────────────────────────────────────────
verify_source() {
    cd "$AOSP_SOURCE_DIR"

    info "验证源码完整性..."

    # 检查关键目录是否存在
    local required_dirs=(
        "build/envsetup.sh"
        "frameworks/base"
        "packages/apps"
        "device"
        "kernel"
    )

    local missing=0
    for dir in "${required_dirs[@]}"; do
        if [[ ! -e "$dir" ]]; then
            error "缺失: $dir"
            missing=$((missing + 1))
        fi
    done

    if [[ $missing -gt 0 ]]; then
        warn "有 $missing 个关键目录/文件缺失。源码可能不完整。"
        warn "尝试运行: bash $0 --retry"
        return 1
    fi

    # 统计源码大小
    local size
    size="$(du -sh "$AOSP_SOURCE_DIR" 2>/dev/null | awk '{print $1}')"
    ok "源码验证通过 (总大小: $size)"
}

# ──────────────────────────────────────────────────────────────
# 打印总结
# ──────────────────────────────────────────────────────────────
print_summary() {
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  AOSP 源码同步完成${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "  分支:    $AOSP_BRANCH"
    echo "  目录:    $AOSP_SOURCE_DIR"
    echo ""
    echo -e "${YELLOW}下一步:${NC}"
    echo ""
    echo "  运行构建脚本:"
    echo "    bash $(dirname "$0")/03-build-aosp.sh"
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
main() {
    parse_args "$@"

    echo ""
    echo -e "${CYAN}ClawOS AOSP - 源码同步${NC}"
    echo -e "${CYAN}分支: ${AOSP_BRANCH}${NC}"
    echo ""

    preflight
    do_repo_init
    do_repo_sync
    verify_source
    print_summary
}

main "$@"
