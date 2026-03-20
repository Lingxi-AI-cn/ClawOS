#!/usr/bin/env bash
#
# 02-install-node.sh - Install Node.js 22+ and pnpm for ClawOS
#
# This script installs the Node.js runtime and pnpm package manager
# required by OpenClaw. Must be run as root inside the VM.
#
set -euo pipefail

REQUIRED_NODE_MAJOR=22
REQUIRED_PNPM_VERSION="10.23.0"

# Colors
info()  { echo -e "\033[0;36m[INFO]\033[0m  $*"; }
ok()    { echo -e "\033[0;32m[OK]\033[0m    $*"; }
warn()  { echo -e "\033[1;33m[WARN]\033[0m  $*"; }
error() { echo -e "\033[0;31m[ERROR]\033[0m $*" >&2; }
die()   { error "$@"; exit 1; }

require_root() {
    if [[ $EUID -ne 0 ]]; then
        die "This script must be run as root. Use: sudo $0"
    fi
}

# ──────────────────────────────────────────────────────────────
# Node.js Installation
# ──────────────────────────────────────────────────────────────

install_nodejs() {
    info "Installing Node.js from Arch Linux repositories..."

    # Arch Linux rolling release should have Node.js >= 22
    pacman -S --noconfirm --needed nodejs npm

    # Verify version
    local node_version
    node_version="$(node --version 2>/dev/null || echo 'not installed')"
    info "Node.js version: $node_version"

    # Extract major version number
    local major_version
    major_version="$(echo "$node_version" | sed 's/v//' | cut -d. -f1)"

    if [[ "$major_version" -lt "$REQUIRED_NODE_MAJOR" ]]; then
        warn "Node.js $node_version is below the required version $REQUIRED_NODE_MAJOR."
        warn "Attempting to install from NodeSource..."
        install_nodejs_from_nvm
    else
        ok "Node.js $node_version installed (>= v${REQUIRED_NODE_MAJOR} required)"
    fi
}

install_nodejs_from_nvm() {
    # Fallback: install Node.js via nvm if pacman version is too old
    info "Installing Node.js via nvm as fallback..."

    # Install nvm for the clawos user
    local nvm_dir="/home/clawos/.nvm"

    sudo -u clawos bash -c "
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
        export NVM_DIR='$nvm_dir'
        [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\"
        nvm install ${REQUIRED_NODE_MAJOR}
        nvm alias default ${REQUIRED_NODE_MAJOR}
    "

    # Create system-wide symlinks
    local node_path
    node_path="$(find "$nvm_dir" -name "node" -path "*/bin/node" | head -1)"
    if [[ -n "$node_path" ]]; then
        local bin_dir
        bin_dir="$(dirname "$node_path")"
        ln -sf "$bin_dir/node" /usr/local/bin/node
        ln -sf "$bin_dir/npm" /usr/local/bin/npm
        ln -sf "$bin_dir/npx" /usr/local/bin/npx
        ok "Node.js installed via nvm and linked to /usr/local/bin/"
    else
        die "Failed to install Node.js via nvm"
    fi
}

# ──────────────────────────────────────────────────────────────
# pnpm Installation
# ──────────────────────────────────────────────────────────────

install_pnpm() {
    info "Installing pnpm..."

    # Enable corepack (ships with Node.js)
    corepack enable 2>/dev/null || npm install -g corepack

    # Prepare pnpm via corepack
    corepack prepare "pnpm@${REQUIRED_PNPM_VERSION}" --activate 2>/dev/null || {
        warn "corepack prepare failed, installing pnpm via npm..."
        npm install -g "pnpm@${REQUIRED_PNPM_VERSION}"
    }

    # Verify pnpm
    local pnpm_version
    pnpm_version="$(pnpm --version 2>/dev/null || echo 'not installed')"
    ok "pnpm version: $pnpm_version"
}

# ──────────────────────────────────────────────────────────────
# Bun Installation (required for some OpenClaw build scripts)
# ──────────────────────────────────────────────────────────────

install_bun() {
    info "Installing Bun (required for OpenClaw build scripts)..."

    # Install Bun
    curl -fsSL https://bun.sh/install | bash

    # Make Bun available system-wide
    if [[ -f /root/.bun/bin/bun ]]; then
        ln -sf /root/.bun/bin/bun /usr/local/bin/bun
        ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx
    fi

    # Also install for clawos user
    sudo -u clawos bash -c 'curl -fsSL https://bun.sh/install | bash' 2>/dev/null || true

    local bun_version
    bun_version="$(bun --version 2>/dev/null || echo 'not installed')"
    ok "Bun version: $bun_version"
}

# ──────────────────────────────────────────────────────────────
# Verification
# ──────────────────────────────────────────────────────────────

verify_installation() {
    info "Verifying installation..."

    local errors=0

    # Check node
    if command -v node &>/dev/null; then
        ok "node:  $(node --version)"
    else
        error "node not found"
        ((errors++))
    fi

    # Check npm
    if command -v npm &>/dev/null; then
        ok "npm:   $(npm --version)"
    else
        error "npm not found"
        ((errors++))
    fi

    # Check pnpm
    if command -v pnpm &>/dev/null; then
        ok "pnpm:  $(pnpm --version)"
    else
        error "pnpm not found"
        ((errors++))
    fi

    # Check bun
    if command -v bun &>/dev/null; then
        ok "bun:   $(bun --version)"
    else
        warn "bun not found (optional, some build scripts may fail)"
    fi

    if [[ $errors -gt 0 ]]; then
        die "Installation verification failed with $errors error(s)"
    fi

    ok "All required tools are installed"
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
main() {
    info "=========================================="
    info "ClawOS Node.js Runtime Installation"
    info "=========================================="

    require_root

    install_nodejs
    install_pnpm
    install_bun
    verify_installation

    ok "=========================================="
    ok "Node.js runtime installation complete!"
    ok "=========================================="
}

main "$@"
