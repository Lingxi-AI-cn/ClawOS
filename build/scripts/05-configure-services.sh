#!/usr/bin/env bash
#
# 05-configure-services.sh - Configure systemd services for ClawOS
#
# This script installs and enables the OpenClaw Gateway systemd service,
# and configures the system for automatic startup.
# Must be run as root inside the VM.
#
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────
OPENCLAW_USER="clawos"
OPENCLAW_INSTALL_DIR="/opt/openclaw"
OPENCLAW_HOME="/home/${OPENCLAW_USER}/.openclaw"
CONFIG_DIR="$(cd "$(dirname "$0")/../config" && pwd)"

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
# OpenClaw Configuration
# ──────────────────────────────────────────────────────────────

install_openclaw_config() {
    info "Installing OpenClaw configuration..."

    local config_dest="${OPENCLAW_HOME}/openclaw.json"

    # Only install if config doesn't already exist
    if [[ -f "$config_dest" ]]; then
        warn "OpenClaw config already exists at $config_dest, skipping."
        warn "To overwrite, delete it first and re-run this script."
    else
        cp "${CONFIG_DIR}/openclaw.json" "$config_dest"
        chown "${OPENCLAW_USER}:${OPENCLAW_USER}" "$config_dest"
        ok "OpenClaw config installed at $config_dest"
    fi

    # Create workspace directory
    mkdir -p "${OPENCLAW_HOME}/workspace"
    chown -R "${OPENCLAW_USER}:${OPENCLAW_USER}" "$OPENCLAW_HOME"
}

# ──────────────────────────────────────────────────────────────
# Systemd Service Installation
# ──────────────────────────────────────────────────────────────

install_gateway_service() {
    info "Installing OpenClaw Gateway systemd service..."

    local service_src="${CONFIG_DIR}/openclaw-gateway.service"
    local service_dest="/etc/systemd/system/openclaw-gateway.service"

    if [[ ! -f "$service_src" ]]; then
        die "Service file not found: $service_src"
    fi

    cp "$service_src" "$service_dest"
    chmod 644 "$service_dest"

    ok "Gateway service installed at $service_dest"
}

enable_services() {
    info "Enabling systemd services..."

    # Reload systemd daemon
    systemctl daemon-reload

    # Enable OpenClaw Gateway
    systemctl enable openclaw-gateway
    ok "openclaw-gateway service enabled"

    # Enable Ollama (should already be enabled from 04-install-ollama.sh)
    if systemctl list-unit-files | grep -q "ollama.service"; then
        systemctl enable ollama
        ok "ollama service enabled"
    fi

    # Enable SSH
    systemctl enable sshd
    ok "sshd service enabled"
}

start_gateway() {
    info "Starting OpenClaw Gateway..."

    # Make sure Ollama is running first
    if systemctl list-unit-files | grep -q "ollama.service"; then
        systemctl start ollama 2>/dev/null || true
        # Wait briefly for Ollama
        sleep 2
    fi

    # Start the gateway
    systemctl start openclaw-gateway

    # Wait for it to be ready
    info "Waiting for Gateway to start..."
    local retries=30
    while [[ $retries -gt 0 ]]; do
        if curl -s http://localhost:18789/health &>/dev/null; then
            break
        fi
        sleep 1
        ((retries--))
    done

    if [[ $retries -eq 0 ]]; then
        warn "Gateway may not have started yet. Checking status..."
        systemctl status openclaw-gateway --no-pager || true
    else
        ok "OpenClaw Gateway is running on port 18789"
    fi
}

# ──────────────────────────────────────────────────────────────
# Firewall Configuration
# ──────────────────────────────────────────────────────────────

configure_firewall() {
    info "Configuring firewall rules (if applicable)..."

    # Check if iptables or nftables is available
    if command -v iptables &>/dev/null; then
        # Allow OpenClaw Gateway port
        iptables -A INPUT -p tcp --dport 18789 -j ACCEPT 2>/dev/null || true
        # Allow Ollama port (local only by default)
        iptables -A INPUT -p tcp --dport 11434 -j ACCEPT 2>/dev/null || true
        # Allow SSH
        iptables -A INPUT -p tcp --dport 22 -j ACCEPT 2>/dev/null || true
        ok "Firewall rules added for ports 18789, 11434, 22"
    else
        info "No firewall detected. Ports should be accessible by default."
    fi
}

# ──────────────────────────────────────────────────────────────
# Auto-login Configuration (optional, for kiosk-like setup)
# ──────────────────────────────────────────────────────────────

configure_autologin() {
    info "Configuring auto-login for clawos user..."

    # Create systemd override for getty on tty1
    local override_dir="/etc/systemd/system/getty@tty1.service.d"
    mkdir -p "$override_dir"

    cat > "${override_dir}/autologin.conf" <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin ${OPENCLAW_USER} --noclear %I \$TERM
EOF

    systemctl daemon-reload

    ok "Auto-login configured for ${OPENCLAW_USER} on tty1"
}

# ──────────────────────────────────────────────────────────────
# MOTD / Welcome Message
# ──────────────────────────────────────────────────────────────

configure_motd() {
    info "Setting up welcome message..."

    cat > /etc/motd <<'EOF'

  ╔═══════════════════════════════════════════════════════╗
  ║                                                       ║
  ║               ClawOS - AI-Driven OS                   ║
  ║           Powered by Arch Linux + OpenClaw            ║
  ║                                                       ║
  ╠═══════════════════════════════════════════════════════╣
  ║                                                       ║
  ║  OpenClaw Gateway:  http://localhost:18789            ║
  ║  Ollama API:        http://localhost:11434            ║
  ║                                                       ║
  ║  Service status:                                      ║
  ║    systemctl status openclaw-gateway                  ║
  ║    systemctl status ollama                            ║
  ║                                                       ║
  ║  Logs:                                                ║
  ║    journalctl -u openclaw-gateway -f                  ║
  ║                                                       ║
  ╚═══════════════════════════════════════════════════════╝

EOF

    ok "Welcome message configured"
}

# ──────────────────────────────────────────────────────────────
# Verification
# ──────────────────────────────────────────────────────────────

verify_services() {
    info "Verifying service configuration..."

    echo ""
    info "Service status:"

    # OpenClaw Gateway
    if systemctl is-enabled --quiet openclaw-gateway 2>/dev/null; then
        ok "  openclaw-gateway: enabled"
    else
        warn "  openclaw-gateway: NOT enabled"
    fi

    if systemctl is-active --quiet openclaw-gateway 2>/dev/null; then
        ok "  openclaw-gateway: active (running)"
    else
        warn "  openclaw-gateway: not running"
    fi

    # Ollama
    if systemctl is-enabled --quiet ollama 2>/dev/null; then
        ok "  ollama: enabled"
    else
        warn "  ollama: NOT enabled"
    fi

    if systemctl is-active --quiet ollama 2>/dev/null; then
        ok "  ollama: active (running)"
    else
        warn "  ollama: not running"
    fi

    # SSH
    if systemctl is-enabled --quiet sshd 2>/dev/null; then
        ok "  sshd: enabled"
    else
        warn "  sshd: NOT enabled"
    fi

    echo ""

    # Show network info
    info "Network information:"
    local ip_addr
    ip_addr="$(ip -4 addr show | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v '127.0.0.1' | head -1 || echo 'unknown')"
    info "  VM IP address: $ip_addr"
    info "  OpenClaw UI:   http://${ip_addr}:18789/"
    info "  Ollama API:    http://${ip_addr}:11434/"
    info "  SSH:           ssh clawos@${ip_addr}"
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
main() {
    info "=========================================="
    info "ClawOS Service Configuration"
    info "=========================================="

    require_root

    install_openclaw_config
    install_gateway_service
    enable_services
    configure_firewall
    configure_autologin
    configure_motd
    start_gateway
    verify_services

    ok "=========================================="
    ok "Service configuration complete!"
    ok "=========================================="
}

main "$@"
