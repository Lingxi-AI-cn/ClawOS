#!/usr/bin/env bash
#
# 01-setup-build-env.sh - 安装 AOSP 构建依赖和工具
#
# 在 Ubuntu 20.04/22.04 x86_64 上运行。
# 需要 root 权限 (sudo)。
#
# Usage:
#   sudo bash 01-setup-build-env.sh
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
# 前置检查
# ──────────────────────────────────────────────────────────────
preflight() {
    info "执行前置检查..."

    # 检查是否为 root
    if [[ $EUID -ne 0 ]]; then
        die "此脚本需要 root 权限运行。请使用: sudo bash $0"
    fi

    # 检查操作系统
    if [[ ! -f /etc/os-release ]]; then
        die "无法检测操作系统。需要 Ubuntu 20.04/22.04。"
    fi

    local os_id os_version
    os_id="$(grep '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"')"
    os_version="$(grep '^VERSION_ID=' /etc/os-release | cut -d= -f2 | tr -d '"')"

    if [[ "$os_id" != "ubuntu" ]]; then
        warn "检测到 $os_id，AOSP 官方支持 Ubuntu。可能遇到兼容性问题。"
    else
        ok "操作系统: Ubuntu $os_version"
    fi

    # 检查架构
    local arch
    arch="$(uname -m)"
    if [[ "$arch" != "x86_64" ]]; then
        warn "检测到架构: $arch。AOSP 构建推荐 x86_64。"
    else
        ok "架构: x86_64"
    fi

    # 检查磁盘空间 (AOSP 源码 + 构建至少需要 300GB)
    local source_parent
    source_parent="$(dirname "${AOSP_SOURCE_DIR:-/home/$SUDO_USER/aosp}")"
    if [[ -d "$source_parent" ]]; then
        local avail_gb
        avail_gb="$(df -BG "$source_parent" | tail -1 | awk '{print $4}' | tr -d 'G')"
        if [[ "$avail_gb" -lt 300 ]]; then
            warn "磁盘可用空间: ${avail_gb}GB (推荐 400GB+)"
        else
            ok "磁盘可用空间: ${avail_gb}GB"
        fi
    fi

    # 检查内存
    local mem_gb
    mem_gb="$(free -g | awk '/^Mem:/{print $2}')"
    if [[ "$mem_gb" -lt 16 ]]; then
        warn "内存: ${mem_gb}GB (推荐 32GB+，最低 16GB)"
    else
        ok "内存: ${mem_gb}GB"
    fi

    # 检查网络 (优先测试国内镜像)
    info "检查网络连接..."
    if curl -fsSL --connect-timeout 5 https://mirrors.tuna.tsinghua.edu.cn -o /dev/null 2>/dev/null; then
        ok "网络连接正常 (清华 TUNA 镜像可达)"
    elif curl -fsSL --connect-timeout 5 https://mirrors.ustc.edu.cn -o /dev/null 2>/dev/null; then
        ok "网络连接正常 (中科大 USTC 镜像可达)"
    elif ping -c 1 -W 3 8.8.8.8 &>/dev/null; then
        ok "网络连接正常 (可访问外网)"
    else
        die "无网络连接。请先配置网络。"
    fi
}

# ──────────────────────────────────────────────────────────────
# 安装 AOSP 构建依赖
# ──────────────────────────────────────────────────────────────
install_build_deps() {
    info "更新软件包索引..."
    apt-get update -qq

    # 检测 Ubuntu 版本，处理包名差异
    local os_version
    os_version="$(grep '^VERSION_ID=' /etc/os-release | cut -d= -f2 | tr -d '"')"
    local os_major="${os_version%%.*}"

    info "安装 AOSP 构建依赖包 (Ubuntu $os_version)..."

    # 基础包 (所有 Ubuntu 版本通用)
    local packages=(
        git
        gnupg
        flex
        bison
        build-essential
        zip
        unzip
        curl
        wget
        zlib1g-dev
        gcc-multilib
        g++-multilib
        libc6-dev-i386
        x11proto-core-dev
        libx11-dev
        lib32z1-dev
        libgl1-mesa-dev
        libxml2-utils
        xsltproc
        fontconfig
        python3
        python3-pip
        rsync
        bc
        lz4
        imagemagick
        dpkg-dev
        libssl-dev
        ccache
        tmux
        screen
    )

    # Ubuntu 版本相关的包
    if [[ "$os_major" -ge 24 ]]; then
        # Ubuntu 24.04+: ncurses5 已移除，使用 ncurses6 替代
        packages+=(
            lib32ncurses-dev
            libncurses-dev
        )
        # python-is-python3 在 24.04 仍可用
        if apt-cache show python-is-python3 &>/dev/null 2>&1; then
            packages+=( python-is-python3 )
        fi
    elif [[ "$os_major" -ge 22 ]]; then
        # Ubuntu 22.04
        packages+=(
            lib32ncurses-dev
            libncurses5
            python-is-python3
        )
    else
        # Ubuntu 20.04 及更早
        packages+=(
            lib32ncurses5-dev
            libncurses5
            python-is-python3
        )
    fi

    apt-get install -y --no-install-recommends "${packages[@]}"

    # Ubuntu 24.04+: AOSP 预编译工具链需要 libncurses.so.5 和 libtinfo.so.5
    # 但 24.04 只有 .so.6 版本，需要创建兼容性符号链接
    if [[ "$os_major" -ge 24 ]]; then
        info "创建 ncurses5 兼容性符号链接 (Ubuntu 24.04 workaround)..."

        local lib_dir="/usr/lib/x86_64-linux-gnu"

        if [[ -f "$lib_dir/libncurses.so.6" && ! -f "$lib_dir/libncurses.so.5" ]]; then
            ln -sf "$lib_dir/libncurses.so.6" "$lib_dir/libncurses.so.5"
            ok "创建: libncurses.so.5 -> libncurses.so.6"
        fi

        if [[ -f "$lib_dir/libtinfo.so.6" && ! -f "$lib_dir/libtinfo.so.5" ]]; then
            ln -sf "$lib_dir/libtinfo.so.6" "$lib_dir/libtinfo.so.5"
            ok "创建: libtinfo.so.5 -> libtinfo.so.6"
        fi

        # 32 位版本 (部分 AOSP 工具需要)
        local lib32_dir="/usr/lib32"
        if [[ -f "$lib32_dir/libncurses.so.6" && ! -f "$lib32_dir/libncurses.so.5" ]]; then
            ln -sf "$lib32_dir/libncurses.so.6" "$lib32_dir/libncurses.so.5"
            ok "创建: lib32/libncurses.so.5 -> libncurses.so.6"
        fi

        if [[ -f "$lib32_dir/libtinfo.so.6" && ! -f "$lib32_dir/libtinfo.so.5" ]]; then
            ln -sf "$lib32_dir/libtinfo.so.6" "$lib32_dir/libtinfo.so.5"
            ok "创建: lib32/libtinfo.so.5 -> libtinfo.so.6"
        fi

        # 刷新动态链接器缓存
        ldconfig
    fi

    ok "构建依赖安装完成"
}

# ──────────────────────────────────────────────────────────────
# 安装 repo 工具
# ──────────────────────────────────────────────────────────────
install_repo() {
    local real_user="${SUDO_USER:-$USER}"
    local real_home
    real_home="$(eval echo "~$real_user")"
    local repo_bin="${real_home}/bin/repo"

    if [[ -x "$repo_bin" ]]; then
        ok "repo 已安装: $repo_bin"
        return 0
    fi

    info "安装 Google repo 工具..."

    # 创建 ~/bin 目录
    mkdir -p "${real_home}/bin"

    # 下载 repo
    curl -fsSL https://storage.googleapis.com/git-repo-downloads/repo -o "$repo_bin"
    chmod a+x "$repo_bin"

    # 确保 ~/bin 在 PATH 中 (添加到 .bashrc)
    local bashrc="${real_home}/.bashrc"
    if ! grep -q 'export PATH=.*\$HOME/bin' "$bashrc" 2>/dev/null; then
        echo '' >> "$bashrc"
        echo '# Google repo tool' >> "$bashrc"
        echo 'export PATH="$HOME/bin:$PATH"' >> "$bashrc"
        info "已将 ~/bin 添加到 PATH (.bashrc)"
    fi

    # 修正所有权
    chown -R "$real_user:$real_user" "${real_home}/bin"

    ok "repo 安装完成: $repo_bin"
}

# ──────────────────────────────────────────────────────────────
# 配置 git
# ──────────────────────────────────────────────────────────────
configure_git() {
    local real_user="${SUDO_USER:-$USER}"
    local real_home
    real_home="$(eval echo "~$real_user")"

    # 检查 git 是否已配置
    local git_name git_email
    git_name="$(su - "$real_user" -c 'git config --global user.name 2>/dev/null' || true)"
    git_email="$(su - "$real_user" -c 'git config --global user.email 2>/dev/null' || true)"

    if [[ -n "$git_name" && -n "$git_email" ]]; then
        ok "Git 已配置: $git_name <$git_email>"
        return 0
    fi

    warn "Git 用户信息未配置 (repo sync 需要)"
    info "请在脚本完成后手动配置:"
    echo "  git config --global user.name \"Your Name\""
    echo "  git config --global user.email \"your@email.com\""
}

# ──────────────────────────────────────────────────────────────
# 配置 ccache
# ──────────────────────────────────────────────────────────────
setup_ccache() {
    local real_user="${SUDO_USER:-$USER}"
    local ccache_dir="${CCACHE_DIR:-/home/$real_user/.ccache}"
    local ccache_size="${CCACHE_MAX_SIZE:-50G}"

    if ! command -v ccache &>/dev/null; then
        warn "ccache 未安装，跳过配置"
        return 0
    fi

    info "配置 ccache (缓存目录: $ccache_dir, 最大: $ccache_size)..."

    mkdir -p "$ccache_dir"
    chown "$real_user:$real_user" "$ccache_dir"

    # 以实际用户身份配置 ccache
    su - "$real_user" -c "ccache -M $ccache_size" 2>/dev/null || true

    # 添加环境变量到 .bashrc
    local bashrc="/home/$real_user/.bashrc"
    if ! grep -q 'USE_CCACHE' "$bashrc" 2>/dev/null; then
        cat >> "$bashrc" << 'CCACHE_EOF'

# AOSP ccache 配置
export USE_CCACHE=1
export CCACHE_EXEC=$(which ccache)
CCACHE_EOF
        info "已将 ccache 环境变量添加到 .bashrc"
    fi

    ok "ccache 配置完成"
}

# ──────────────────────────────────────────────────────────────
# 创建 AOSP 源码目录
# ──────────────────────────────────────────────────────────────
prepare_source_dir() {
    local real_user="${SUDO_USER:-$USER}"
    local source_dir="${AOSP_SOURCE_DIR:-/opt/aosp}"

    if [[ -d "$source_dir" ]]; then
        ok "AOSP 源码目录已存在: $source_dir"
    else
        info "创建 AOSP 源码目录: $source_dir"
        mkdir -p "$source_dir"
    fi

    # 确保普通用户对源码目录有完整权限
    chown -R "$real_user:$real_user" "$source_dir"
    ok "源码目录准备完成: $source_dir (owner: $real_user)"
}

# ──────────────────────────────────────────────────────────────
# 打印总结
# ──────────────────────────────────────────────────────────────
print_summary() {
    local real_user="${SUDO_USER:-$USER}"
    local source_dir="${AOSP_SOURCE_DIR:-/home/$real_user/aosp}"

    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  AOSP 构建环境初始化完成${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "  构建依赖:  已安装"
    echo "  repo 工具: ~/bin/repo"
    echo "  ccache:    已配置 (${CCACHE_MAX_SIZE:-50G})"
    echo "  源码目录:  $source_dir"
    echo ""
    echo -e "${YELLOW}下一步:${NC}"
    echo ""
    echo "  1. 确保 git 已配置用户信息:"
    echo "     git config --global user.name \"Your Name\""
    echo "     git config --global user.email \"your@email.com\""
    echo ""
    echo "  2. 重新加载 shell (或重新登录) 以生效 PATH 和环境变量:"
    echo "     source ~/.bashrc"
    echo ""
    echo "  3. 运行源码同步脚本:"
    echo "     bash $(dirname "$0")/02-sync-source.sh"
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
main() {
    echo ""
    echo -e "${CYAN}ClawOS AOSP - 构建环境初始化${NC}"
    echo -e "${CYAN}目标: Android 12 (${AOSP_BRANCH:-android-12.0.0_r34})${NC}"
    echo ""

    preflight
    install_build_deps
    install_repo
    configure_git
    setup_ccache
    prepare_source_dir
    print_summary
}

main "$@"
