#!/usr/bin/env bash
#
# 03-build-openclaw.sh - Build and install OpenClaw from source
#
# This script copies/mounts the OpenClaw source code into the VM,
# installs dependencies, and builds the project.
# Must be run as root inside the VM.
#
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────
OPENCLAW_USER="clawos"
OPENCLAW_INSTALL_DIR="/opt/openclaw"
OPENCLAW_HOME="/home/${OPENCLAW_USER}/.openclaw"
OPENCLAW_WORKSPACE="${OPENCLAW_HOME}/workspace"

# Source location: shared folder from Parallels or local copy
SHARED_FOLDER_PATH="/media/psf/clawos/openclaw"
LOCAL_SOURCE_PATH="/tmp/openclaw-src"

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
# Source Code Preparation
# ──────────────────────────────────────────────────────────────

locate_source() {
    info "Locating OpenClaw source code..." >&2

    # Option 1: Parallels shared folder
    if [[ -d "$SHARED_FOLDER_PATH" ]] && [[ -f "${SHARED_FOLDER_PATH}/package.json" ]]; then
        ok "Found OpenClaw source in Parallels shared folder: $SHARED_FOLDER_PATH" >&2
        echo "$SHARED_FOLDER_PATH"
        return 0
    fi

    # Option 2: Already copied to local path
    if [[ -d "$LOCAL_SOURCE_PATH" ]] && [[ -f "${LOCAL_SOURCE_PATH}/package.json" ]]; then
        ok "Found OpenClaw source at: $LOCAL_SOURCE_PATH" >&2
        echo "$LOCAL_SOURCE_PATH"
        return 0
    fi

    # Option 3: Try mounting Parallels shared folder
    info "Attempting to mount Parallels shared folder..." >&2
    mkdir -p /media/psf
    mount -t prl_fs clawos /media/psf/clawos 2>/dev/null || true

    if [[ -d "$SHARED_FOLDER_PATH" ]] && [[ -f "${SHARED_FOLDER_PATH}/package.json" ]]; then
        ok "Mounted and found OpenClaw source: $SHARED_FOLDER_PATH" >&2
        echo "$SHARED_FOLDER_PATH"
        return 0
    fi

    die "OpenClaw source code not found. Please either:
  1. Enable Parallels shared folders and mount the ClawOS project directory
  2. Copy the openclaw source to $LOCAL_SOURCE_PATH
  3. scp -r <host>:/path/to/openclaw $LOCAL_SOURCE_PATH"
}

copy_source_to_install_dir() {
    local source_dir="$1"

    info "Copying OpenClaw source to ${OPENCLAW_INSTALL_DIR}..."

    # Create install directory
    mkdir -p "$OPENCLAW_INSTALL_DIR"

    # Use rsync if available, otherwise cp
    if command -v rsync &>/dev/null; then
        rsync -a --delete \
            --exclude='node_modules' \
            --exclude='.git' \
            --exclude='dist' \
            --exclude='apps/macos' \
            --exclude='apps/ios' \
            --exclude='apps/android' \
            "$source_dir/" "$OPENCLAW_INSTALL_DIR/"
    else
        # Clean destination first
        rm -rf "${OPENCLAW_INSTALL_DIR:?}/"*

        # Copy excluding large/unnecessary directories
        cd "$source_dir"
        tar cf - \
            --exclude='node_modules' \
            --exclude='.git' \
            --exclude='dist' \
            --exclude='apps/macos' \
            --exclude='apps/ios' \
            --exclude='apps/android' \
            . | tar xf - -C "$OPENCLAW_INSTALL_DIR"
    fi

    # Set ownership
    chown -R "${OPENCLAW_USER}:${OPENCLAW_USER}" "$OPENCLAW_INSTALL_DIR"

    ok "Source code copied to $OPENCLAW_INSTALL_DIR"
}

# ──────────────────────────────────────────────────────────────
# Build OpenClaw
# ──────────────────────────────────────────────────────────────

install_dependencies() {
    info "Installing OpenClaw dependencies with pnpm..."

    cd "$OPENCLAW_INSTALL_DIR"

    # Install as clawos user
    sudo -u "$OPENCLAW_USER" bash -c "
        cd '$OPENCLAW_INSTALL_DIR'
        export HOME='/home/$OPENCLAW_USER'
        export PATH=\"/home/$OPENCLAW_USER/.bun/bin:\$PATH\"

        # Install dependencies
        pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    "

    ok "Dependencies installed"
}

build_openclaw() {
    info "Building OpenClaw..."

    sudo -u "$OPENCLAW_USER" bash -c "
        cd '$OPENCLAW_INSTALL_DIR'
        export HOME='/home/$OPENCLAW_USER'
        export PATH=\"/home/$OPENCLAW_USER/.bun/bin:\$PATH\"
        export NODE_ENV=production

        # Build the project (skip A2UI if missing)
        export OPENCLAW_A2UI_SKIP_MISSING=1
        pnpm build
    "

    ok "OpenClaw built successfully"
}

build_ui() {
    info "Building OpenClaw Control UI..."

    sudo -u "$OPENCLAW_USER" bash -c "
        cd '$OPENCLAW_INSTALL_DIR'
        export HOME='/home/$OPENCLAW_USER'
        export PATH=\"/home/$OPENCLAW_USER/.bun/bin:\$PATH\"

        # Force pnpm for UI build (Bun may have issues on ARM)
        export OPENCLAW_PREFER_PNPM=1
        pnpm ui:build
    "

    ok "Control UI built"
}

# ──────────────────────────────────────────────────────────────
# Post-build Configuration
# ──────────────────────────────────────────────────────────────

setup_openclaw_home() {
    info "Setting up OpenClaw home directory..."

    # Create directories
    mkdir -p "$OPENCLAW_HOME"
    mkdir -p "$OPENCLAW_WORKSPACE"

    # Set ownership
    chown -R "${OPENCLAW_USER}:${OPENCLAW_USER}" "$OPENCLAW_HOME"

    ok "OpenClaw home directory created at $OPENCLAW_HOME"
}

create_symlink() {
    info "Creating convenience symlinks..."

    # Create a symlink to the openclaw CLI in /usr/local/bin
    if [[ -f "${OPENCLAW_INSTALL_DIR}/openclaw.mjs" ]]; then
        cat > /usr/local/bin/openclaw <<SCRIPT
#!/usr/bin/env bash
exec node "${OPENCLAW_INSTALL_DIR}/openclaw.mjs" "\$@"
SCRIPT
        chmod +x /usr/local/bin/openclaw
        ok "Created /usr/local/bin/openclaw"
    fi
}

# ──────────────────────────────────────────────────────────────
# Verification
# ──────────────────────────────────────────────────────────────

verify_build() {
    info "Verifying OpenClaw build..."

    # Check dist directory exists
    if [[ ! -d "${OPENCLAW_INSTALL_DIR}/dist" ]]; then
        die "Build verification failed: dist/ directory not found"
    fi

    # Check main entry point
    if [[ ! -f "${OPENCLAW_INSTALL_DIR}/dist/index.js" ]]; then
        die "Build verification failed: dist/index.js not found"
    fi

    # Check CLI entry point
    if [[ ! -f "${OPENCLAW_INSTALL_DIR}/openclaw.mjs" ]]; then
        die "Build verification failed: openclaw.mjs not found"
    fi

    # Try running openclaw --version
    local version
    version="$(sudo -u "$OPENCLAW_USER" node "${OPENCLAW_INSTALL_DIR}/openclaw.mjs" --version 2>/dev/null || echo 'unknown')"
    ok "OpenClaw version: $version"

    ok "Build verification passed"
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
main() {
    info "=========================================="
    info "ClawOS OpenClaw Build"
    info "=========================================="

    require_root

    # Locate source code
    local source_dir
    source_dir="$(locate_source)"

    # Copy to install directory
    copy_source_to_install_dir "$source_dir"

    # Setup home directory
    setup_openclaw_home

    # Build
    install_dependencies
    build_openclaw
    build_ui

    # Post-build
    create_symlink
    verify_build

    ok "=========================================="
    ok "OpenClaw build complete!"
    ok "Install dir: $OPENCLAW_INSTALL_DIR"
    ok "Home dir:    $OPENCLAW_HOME"
    ok "=========================================="
}

main "$@"
