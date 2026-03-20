#!/usr/bin/env bash
#
# 01-base-system.sh - Base system configuration for ClawOS
#
# This script configures the base Arch Linux system after installation.
# It must be run as root inside the VM.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/common.sh" 2>/dev/null || {
    # Inline fallback if common.sh not available
    info()  { echo -e "\033[0;36m[INFO]\033[0m  $*"; }
    ok()    { echo -e "\033[0;32m[OK]\033[0m    $*"; }
    warn()  { echo -e "\033[1;33m[WARN]\033[0m  $*"; }
    error() { echo -e "\033[0;31m[ERROR]\033[0m $*" >&2; }
    die()   { error "$@"; exit 1; }
}

require_root() {
    if [[ $EUID -ne 0 ]]; then
        die "This script must be run as root. Use: sudo $0"
    fi
}

# ──────────────────────────────────────────────────────────────
# System Configuration
# ──────────────────────────────────────────────────────────────

configure_pacman() {
    info "Configuring pacman..."

    # Enable parallel downloads
    sed -i 's/^#ParallelDownloads/ParallelDownloads/' /etc/pacman.conf

    # Enable Color output
    sed -i 's/^#Color/Color/' /etc/pacman.conf

    # Update package database
    info "Updating package database..."
    pacman -Sy --noconfirm

    ok "pacman configured"
}

install_base_packages() {
    info "Installing base development packages..."

    pacman -S --noconfirm --needed \
        base-devel \
        git \
        curl \
        wget \
        vim \
        htop \
        openssh \
        sudo \
        python \
        gcc \
        make \
        pkg-config \
        openssl \
        unzip \
        tar \
        gzip \
        which \
        inetutils \
        net-tools \
        bind-tools \
        jq

    ok "Base packages installed"
}

configure_network() {
    info "Configuring network..."

    # Enable and start NetworkManager (installed by archinstall with nm config)
    if systemctl list-unit-files | grep -q NetworkManager; then
        systemctl enable --now NetworkManager 2>/dev/null || true
        ok "NetworkManager enabled"
    fi

    # Enable and start systemd-resolved for DNS
    systemctl enable --now systemd-resolved 2>/dev/null || true

    # Ensure /etc/resolv.conf points to systemd-resolved
    if [[ ! -L /etc/resolv.conf ]] || [[ "$(readlink /etc/resolv.conf)" != *"systemd"* ]]; then
        ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf 2>/dev/null || true
    fi

    ok "Network configured"
}

configure_ssh() {
    info "Configuring SSH server..."

    # Enable and start sshd
    systemctl enable --now sshd

    # Allow password authentication (for initial setup; can be disabled later)
    if grep -q "^#PasswordAuthentication" /etc/ssh/sshd_config; then
        sed -i 's/^#PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
    fi

    # Allow root login via SSH (for initial provisioning; disable later)
    if grep -q "^#PermitRootLogin" /etc/ssh/sshd_config; then
        sed -i 's/^#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
    fi

    systemctl restart sshd

    ok "SSH server configured and running"
}

configure_user() {
    local username="clawos"

    info "Configuring user: $username"

    # Create user if not exists (archinstall may have already created it)
    if ! id "$username" &>/dev/null; then
        useradd -m -G wheel -s /bin/bash "$username"
        echo "${username}:clawos" | chpasswd
        ok "User '$username' created with default password 'clawos'"
    else
        ok "User '$username' already exists"
    fi

    # Ensure user is in wheel group
    usermod -aG wheel "$username" 2>/dev/null || true

    # Enable sudo for wheel group (passwordless for convenience during setup)
    if [[ -f /etc/sudoers ]]; then
        # Enable wheel group with password
        sed -i 's/^# %wheel ALL=(ALL:ALL) ALL/%wheel ALL=(ALL:ALL) ALL/' /etc/sudoers
    fi

    # Create workspace directory
    local workspace="/home/${username}/.openclaw/workspace"
    mkdir -p "$workspace"
    chown -R "${username}:${username}" "/home/${username}/.openclaw"

    ok "User configured"
}

configure_locale() {
    info "Configuring locale..."

    # Generate en_US.UTF-8 locale
    sed -i 's/^#en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen
    locale-gen

    # Set default locale
    echo "LANG=en_US.UTF-8" > /etc/locale.conf

    ok "Locale configured"
}

configure_timezone() {
    info "Setting timezone to UTC..."
    ln -sf /usr/share/zoneinfo/UTC /etc/localtime
    hwclock --systohc 2>/dev/null || true
    ok "Timezone set"
}

configure_hostname() {
    info "Setting hostname to clawos..."
    echo "clawos" > /etc/hostname

    # Update /etc/hosts
    cat > /etc/hosts <<'EOF'
127.0.0.1   localhost
::1         localhost
127.0.1.1   clawos.localdomain clawos
EOF

    ok "Hostname configured"
}

enable_ntp() {
    info "Enabling NTP time sync..."
    timedatectl set-ntp true 2>/dev/null || \
        systemctl enable --now systemd-timesyncd 2>/dev/null || true
    ok "NTP enabled"
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
main() {
    info "=========================================="
    info "ClawOS Base System Configuration"
    info "=========================================="

    require_root

    configure_locale
    configure_timezone
    configure_hostname
    configure_pacman
    install_base_packages
    configure_network
    configure_ssh
    configure_user
    enable_ntp

    ok "=========================================="
    ok "Base system configuration complete!"
    ok "=========================================="
}

main "$@"
