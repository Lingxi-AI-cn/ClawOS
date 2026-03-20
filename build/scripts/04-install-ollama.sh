#!/usr/bin/env bash
#
# 04-install-ollama.sh - Install Ollama for local LLM inference
#
# This script installs Ollama and optionally pulls a base model.
# Must be run as root inside the VM.
#
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────
# Default model to pull (small model suitable for aarch64 VMs)
DEFAULT_MODEL="${CLAWOS_LLM_MODEL:-qwen2.5:3b}"
SKIP_MODEL_PULL="${CLAWOS_SKIP_MODEL_PULL:-false}"

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
# Installation
# ──────────────────────────────────────────────────────────────

install_ollama() {
    info "Installing Ollama..."

    if command -v ollama &>/dev/null; then
        ok "Ollama already installed: $(ollama --version 2>/dev/null || echo 'unknown version')"
        return 0
    fi

    # Install via official script
    curl -fsSL https://ollama.com/install.sh | sh

    if command -v ollama &>/dev/null; then
        ok "Ollama installed: $(ollama --version 2>/dev/null || echo 'unknown version')"
    else
        die "Ollama installation failed"
    fi
}

# ──────────────────────────────────────────────────────────────
# Service Configuration
# ──────────────────────────────────────────────────────────────

configure_ollama_service() {
    info "Configuring Ollama systemd service..."

    # The Ollama install script usually creates a systemd service.
    # If not, we create one.
    if [[ ! -f /etc/systemd/system/ollama.service ]]; then
        info "Creating Ollama systemd service..."
        cat > /etc/systemd/system/ollama.service <<'EOF'
[Unit]
Description=Ollama Local LLM Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ollama
Group=ollama
ExecStart=/usr/local/bin/ollama serve
Restart=always
RestartSec=3
Environment="OLLAMA_HOST=0.0.0.0:11434"

[Install]
WantedBy=multi-user.target
EOF

        # Create ollama user if it doesn't exist
        if ! id ollama &>/dev/null; then
            useradd -r -s /bin/false -m -d /usr/share/ollama ollama
        fi
    fi

    # Ensure OLLAMA_HOST is set to listen on all interfaces
    # so OpenClaw can connect to it
    local service_file="/etc/systemd/system/ollama.service"
    if [[ -f "$service_file" ]]; then
        if ! grep -q "OLLAMA_HOST=0.0.0.0" "$service_file"; then
            # Add environment variable to service
            mkdir -p /etc/systemd/system/ollama.service.d
            cat > /etc/systemd/system/ollama.service.d/override.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
EOF
        fi
    fi

    # Reload and enable
    systemctl daemon-reload
    systemctl enable ollama
    systemctl start ollama

    # Wait for Ollama to be ready
    info "Waiting for Ollama to start..."
    local retries=30
    while [[ $retries -gt 0 ]]; do
        if curl -s http://localhost:11434/api/tags &>/dev/null; then
            break
        fi
        sleep 1
        ((retries--))
    done

    if [[ $retries -eq 0 ]]; then
        warn "Ollama may not have started properly. Check: systemctl status ollama"
    else
        ok "Ollama service running on port 11434"
    fi
}

# ──────────────────────────────────────────────────────────────
# Model Pull
# ──────────────────────────────────────────────────────────────

pull_default_model() {
    if [[ "$SKIP_MODEL_PULL" == "true" ]]; then
        info "Skipping model pull (CLAWOS_SKIP_MODEL_PULL=true)"
        return 0
    fi

    info "Pulling default LLM model: $DEFAULT_MODEL"
    info "This may take a while depending on your connection and model size..."

    if ollama pull "$DEFAULT_MODEL"; then
        ok "Model '$DEFAULT_MODEL' pulled successfully"
    else
        warn "Failed to pull model '$DEFAULT_MODEL'. You can pull it later with:"
        warn "  ollama pull $DEFAULT_MODEL"
    fi
}

# ──────────────────────────────────────────────────────────────
# Verification
# ──────────────────────────────────────────────────────────────

verify_ollama() {
    info "Verifying Ollama installation..."

    # Check service status
    if systemctl is-active --quiet ollama; then
        ok "Ollama service: active"
    else
        warn "Ollama service: not running"
    fi

    # Check API endpoint
    if curl -s http://localhost:11434/api/tags &>/dev/null; then
        ok "Ollama API: accessible at http://localhost:11434"
    else
        warn "Ollama API: not accessible"
    fi

    # List installed models
    info "Installed models:"
    ollama list 2>/dev/null || warn "Could not list models"
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
main() {
    info "=========================================="
    info "ClawOS Ollama Installation"
    info "=========================================="

    require_root

    install_ollama
    configure_ollama_service
    pull_default_model
    verify_ollama

    ok "=========================================="
    ok "Ollama installation complete!"
    ok "API endpoint: http://localhost:11434"
    ok "Default model: $DEFAULT_MODEL"
    ok "=========================================="
}

main "$@"
