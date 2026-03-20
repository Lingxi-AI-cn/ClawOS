#!/usr/bin/env bash
#
# 01a-install-gnome.sh - Install GNOME Desktop Environment for ClawOS
#
# This script installs the GNOME desktop environment and configures
# GDM (GNOME Display Manager) for auto-login.
# Must be run as root inside the VM.
#
set -euo pipefail

# Colors
info()  { echo -e "\033[0;36m[INFO]\033[0m  $*"; }
ok()    { echo -e "\033[0;32m[OK]\033[0m    $*"; }
warn()  { echo -e "\033[1;33m[WARN]\033[0m  $*"; }
error() { echo -e "\033[0;31m[ERROR]\033[0m $*" >&2; }
die()   { error "$@"; exit 1; }

CLAWOS_USER="clawos"

require_root() {
    if [[ $EUID -ne 0 ]]; then
        die "This script must be run as root. Use: sudo $0"
    fi
}

# ──────────────────────────────────────────────────────────────
# GNOME Installation
# ──────────────────────────────────────────────────────────────

install_gnome() {
    info "Installing GNOME desktop environment..."
    info "This will download ~1-2GB of packages and may take a while..."

    # Install GNOME and essential extras
    pacman -S --noconfirm --needed \
        gnome \
        gnome-tweaks \
        gnome-terminal \
        nautilus \
        xdg-user-dirs \
        networkmanager \
        pipewire \
        pipewire-pulse \
        wireplumber

    ok "GNOME packages installed"
}

install_fonts() {
    info "Installing fonts for CJK and general use..."

    pacman -S --noconfirm --needed \
        noto-fonts \
        noto-fonts-cjk \
        noto-fonts-emoji \
        ttf-liberation \
        ttf-dejavu

    ok "Fonts installed"
}

install_browser() {
    info "Installing Firefox browser..."

    pacman -S --noconfirm --needed firefox

    ok "Firefox installed"
}

# ──────────────────────────────────────────────────────────────
# GDM Configuration
# ──────────────────────────────────────────────────────────────

configure_gdm() {
    info "Configuring GDM (GNOME Display Manager)..."

    # Enable GDM
    systemctl enable gdm

    # Enable NetworkManager (GNOME needs it for network management)
    systemctl enable NetworkManager

    # Enable pipewire for audio
    # (pipewire user services are enabled per-user automatically)

    ok "GDM enabled"
}

configure_autologin_gdm() {
    info "Configuring GDM auto-login for ${CLAWOS_USER}..."

    local gdm_conf="/etc/gdm/custom.conf"

    if [[ -f "$gdm_conf" ]]; then
        # Check if [daemon] section exists
        if grep -q '^\[daemon\]' "$gdm_conf"; then
            # Add auto-login settings after [daemon] section
            sed -i '/^\[daemon\]/a AutomaticLoginEnable=True\nAutomaticLogin='"${CLAWOS_USER}" "$gdm_conf"
        else
            # Append [daemon] section
            cat >> "$gdm_conf" <<EOF

[daemon]
AutomaticLoginEnable=True
AutomaticLogin=${CLAWOS_USER}
EOF
        fi
    else
        # Create the file
        mkdir -p /etc/gdm
        cat > "$gdm_conf" <<EOF
[daemon]
AutomaticLoginEnable=True
AutomaticLogin=${CLAWOS_USER}

[security]

[xdmcp]

[chooser]

[debug]
EOF
    fi

    ok "GDM auto-login configured for ${CLAWOS_USER}"
}

# ──────────────────────────────────────────────────────────────
# XDG User Dirs
# ──────────────────────────────────────────────────────────────

setup_user_dirs() {
    info "Setting up user directories..."

    su - "$CLAWOS_USER" -c "xdg-user-dirs-update" 2>/dev/null || true

    ok "User directories created"
}

# ──────────────────────────────────────────────────────────────
# Disable unnecessary GNOME services for server-like use
# ──────────────────────────────────────────────────────────────

optimize_gnome() {
    info "Optimizing GNOME for ClawOS..."

    # Disable GNOME Software auto-update notifications (if installed)
    su - "$CLAWOS_USER" -c "
        dbus-launch gsettings set org.gnome.software download-updates false 2>/dev/null || true
        dbus-launch gsettings set org.gnome.software download-updates-notify false 2>/dev/null || true
    " 2>/dev/null || true

    ok "GNOME optimized"
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
main() {
    info "=========================================="
    info "ClawOS GNOME Desktop Installation"
    info "=========================================="

    require_root

    install_gnome
    install_fonts
    install_browser
    configure_gdm
    configure_autologin_gdm
    setup_user_dirs
    optimize_gnome

    ok "=========================================="
    ok "GNOME desktop installation complete!"
    ok "Reboot to start the graphical environment:"
    ok "  reboot"
    ok "=========================================="
}

main "$@"
