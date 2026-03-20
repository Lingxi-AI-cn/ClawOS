#!/usr/bin/env bash
#
# provision.sh - ClawOS one-click provisioning script
#
# This is the master entry point that orchestrates the complete setup
# of a ClawOS environment on Arch Linux. It runs all provisioning
# scripts in sequence.
#
# Usage:
#   sudo bash provision.sh [--skip-ollama] [--skip-build] [--step N]
#
# Must be run as root inside the Arch Linux VM after base installation.
#
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS_DIR="${SCRIPT_DIR}/scripts"
LOG_DIR="/var/log/clawos"
LOG_FILE="${LOG_DIR}/provision-$(date +%Y%m%d-%H%M%S).log"

# Flags
SKIP_OLLAMA=false
SKIP_BUILD=false
SKIP_GNOME=false
START_STEP=1

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*" | tee -a "$LOG_FILE"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*" | tee -a "$LOG_FILE"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*" | tee -a "$LOG_FILE"; }
error() { echo -e "${RED}[ERROR]${NC} $*" | tee -a "$LOG_FILE" >&2; }
die()   { error "$@"; exit 1; }

# ──────────────────────────────────────────────────────────────
# Argument Parsing
# ──────────────────────────────────────────────────────────────
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --skip-ollama)
                SKIP_OLLAMA=true
                shift
                ;;
            --skip-build)
                SKIP_BUILD=true
                shift
                ;;
            --skip-gnome)
                SKIP_GNOME=true
                shift
                ;;
            --step)
                START_STEP="${2:?--step requires a number}"
                shift 2
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                warn "Unknown option: $1"
                shift
                ;;
        esac
    done
}

show_help() {
    cat <<'HELP'
ClawOS Provisioning Script

Usage: sudo bash provision.sh [OPTIONS]

Options:
  --skip-ollama     Skip Ollama (local LLM) installation
  --skip-build      Skip OpenClaw build (useful if already built)
  --skip-gnome      Skip GNOME desktop installation
  --step N          Start from step N (1-6)
  --help, -h        Show this help message

Steps:
  1. Base system configuration
  2. GNOME desktop installation
  3. Node.js runtime installation
  4. OpenClaw build
  5. Ollama installation
  6. Service configuration

Examples:
  sudo bash provision.sh                  # Full provisioning
  sudo bash provision.sh --skip-ollama    # Skip local LLM
  sudo bash provision.sh --step 3         # Resume from step 3
HELP
}

# ──────────────────────────────────────────────────────────────
# Pre-flight Checks
# ──────────────────────────────────────────────────────────────
preflight() {
    # Must be root
    if [[ $EUID -ne 0 ]]; then
        die "This script must be run as root. Use: sudo bash $0"
    fi

    # Must be on Arch Linux (regular or ARM)
    if [[ ! -f /etc/arch-release ]] && ! grep -qi 'arch' /etc/os-release 2>/dev/null; then
        die "This script is designed for Arch Linux. /etc/arch-release not found."
    fi

    # Create log directory
    mkdir -p "$LOG_DIR"

    # Check scripts directory exists
    if [[ ! -d "$SCRIPTS_DIR" ]]; then
        die "Scripts directory not found: $SCRIPTS_DIR"
    fi

    # Check network connectivity
    info "Checking network connectivity..."
    if ! ping -c 1 -W 3 archlinux.org &>/dev/null; then
        if ! ping -c 1 -W 3 1.1.1.1 &>/dev/null; then
            die "No network connectivity. Please configure networking first."
        else
            warn "DNS may not be working (can ping 1.1.1.1 but not archlinux.org)"
        fi
    fi
    ok "Network connectivity verified"

    # Full system upgrade first
    info "Running full system upgrade..."
    pacman -Syu --noconfirm
    ok "System upgraded"
}

# ──────────────────────────────────────────────────────────────
# Step Execution
# ──────────────────────────────────────────────────────────────
run_step() {
    local step_num="$1"
    local step_name="$2"
    local script_path="$3"
    local skip="${4:-false}"

    echo ""
    echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${CYAN}║  Step ${step_num}: ${step_name}${NC}"
    echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${NC}"
    echo ""

    if [[ "$skip" == "true" ]]; then
        warn "Skipping step ${step_num} (${step_name})"
        return 0
    fi

    if [[ $step_num -lt $START_STEP ]]; then
        warn "Skipping step ${step_num} (starting from step ${START_STEP})"
        return 0
    fi

    if [[ ! -f "$script_path" ]]; then
        die "Script not found: $script_path"
    fi

    local start_time
    start_time=$(date +%s)

    # Execute the script
    bash "$script_path" 2>&1 | tee -a "$LOG_FILE"
    local exit_code=${PIPESTATUS[0]}

    local end_time
    end_time=$(date +%s)
    local duration=$((end_time - start_time))

    if [[ $exit_code -ne 0 ]]; then
        error "Step ${step_num} failed with exit code ${exit_code} (took ${duration}s)"
        error "Check the log at: $LOG_FILE"
        error "You can resume from this step with: sudo bash $0 --step ${step_num}"
        exit $exit_code
    fi

    ok "Step ${step_num} completed in ${duration}s"
}

# ──────────────────────────────────────────────────────────────
# Final Summary
# ──────────────────────────────────────────────────────────────
show_summary() {
    local ip_addr
    ip_addr="$(ip -4 addr show | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v '127.0.0.1' | head -1 || echo '<vm-ip>')"

    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}║          ClawOS Provisioning Complete!                        ║${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  OpenClaw Gateway:  ${CYAN}http://${ip_addr}:18789/${NC}                 ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  Ollama API:        ${CYAN}http://${ip_addr}:11434/${NC}                 ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  SSH Access:        ${CYAN}ssh clawos@${ip_addr}${NC}                    ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  Default user: clawos / clawos                               ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  (Change password with: passwd)                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  Service management:                                         ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    systemctl status openclaw-gateway                         ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    systemctl status ollama                                   ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    journalctl -u openclaw-gateway -f                         ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  Log: ${LOG_FILE}${NC}"
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
main() {
    parse_args "$@"

    echo ""
    echo -e "${BOLD}${CYAN}"
    echo "   ██████╗██╗      █████╗ ██╗    ██╗ ██████╗ ███████╗"
    echo "  ██╔════╝██║     ██╔══██╗██║    ██║██╔═══██╗██╔════╝"
    echo "  ██║     ██║     ███████║██║ █╗ ██║██║   ██║███████╗"
    echo "  ██║     ██║     ██╔══██║██║███╗██║██║   ██║╚════██║"
    echo "  ╚██████╗███████╗██║  ██║╚███╔███╔╝╚██████╔╝███████║"
    echo "   ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝  ╚═════╝╚══════╝"
    echo ""
    echo "  AI-Driven OS - Powered by Arch Linux + OpenClaw"
    echo -e "${NC}"
    echo ""

    local total_start
    total_start=$(date +%s)

    # Pre-flight checks
    preflight

    # Step 1: Base system configuration
    run_step 1 "Base System Configuration" \
        "${SCRIPTS_DIR}/01-base-system.sh"

    # Step 2: GNOME Desktop (skip with --skip-gnome)
    run_step 2 "GNOME Desktop Installation" \
        "${SCRIPTS_DIR}/01a-install-gnome.sh" \
        "$SKIP_GNOME"

    # Step 3: Node.js runtime
    run_step 3 "Node.js Runtime Installation" \
        "${SCRIPTS_DIR}/02-install-node.sh"

    # Step 4: Build OpenClaw
    run_step 4 "OpenClaw Build" \
        "${SCRIPTS_DIR}/03-build-openclaw.sh" \
        "$SKIP_BUILD"

    # Step 5: Ollama (skip with --skip-ollama)
    run_step 5 "Ollama Installation" \
        "${SCRIPTS_DIR}/04-install-ollama.sh" \
        "$SKIP_OLLAMA"

    # Step 6: Service configuration
    run_step 6 "Service Configuration" \
        "${SCRIPTS_DIR}/05-configure-services.sh"

    local total_end
    total_end=$(date +%s)
    local total_duration=$((total_end - total_start))

    ok "Total provisioning time: ${total_duration}s"

    # Show final summary
    show_summary
}

main "$@"
