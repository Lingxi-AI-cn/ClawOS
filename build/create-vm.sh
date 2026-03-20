#!/usr/bin/env bash
#
# create-vm.sh - Create a Parallels Desktop VM for ClawOS
#
# This script automates the creation of an Arch Linux aarch64 VM
# using Parallels Desktop Pro's prlctl command-line tool.
#
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────
VM_NAME="${CLAWOS_VM_NAME:-ClawOS}"
VM_RAM="${CLAWOS_VM_RAM:-8192}"         # MB (8GB for GNOME desktop)
VM_CPUS="${CLAWOS_VM_CPUS:-4}"
VM_DISK="${CLAWOS_VM_DISK:-131072}"     # MB (128GB)

# Paths
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ISO_DIR="${SCRIPT_DIR}/iso"
# Archboot provides the official Arch Linux aarch64 ISO
ARCHBOOT_BASE_URL="https://release.archboot.com/aarch64/latest/iso"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ──────────────────────────────────────────────────────────────
# Helper functions
# ──────────────────────────────────────────────────────────────
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()   { error "$@"; exit 1; }

check_prerequisites() {
    info "Checking prerequisites..."

    # Check prlctl is available
    if ! command -v prlctl &>/dev/null; then
        die "prlctl not found. Please install Parallels Desktop Pro/Business."
    fi
    ok "prlctl found: $(prlctl --version 2>/dev/null || echo 'unknown version')"

    # Check we're on macOS
    if [[ "$(uname)" != "Darwin" ]]; then
        die "This script is designed for macOS with Parallels Desktop."
    fi
    ok "Running on macOS"

    # Check architecture
    local arch
    arch="$(uname -m)"
    if [[ "$arch" != "arm64" ]]; then
        warn "Detected architecture: $arch (expected arm64 for Apple Silicon)"
        warn "The VM will use aarch64 Arch Linux. Performance may vary on non-ARM hosts."
    else
        ok "Apple Silicon detected (arm64)"
    fi
}

check_vm_exists() {
    if prlctl list --all 2>/dev/null | grep -q "\"$VM_NAME\""; then
        return 0
    fi
    return 1
}

download_iso() {
    mkdir -p "$ISO_DIR"

    # Check for any existing valid ISO (> 100MB)
    local existing_iso
    existing_iso="$(find "$ISO_DIR" -name "archboot-*.iso" -size +100M 2>/dev/null | head -1)"
    if [[ -n "$existing_iso" ]]; then
        info "Found existing Arch Linux ISO: $existing_iso" >&2
        echo "$existing_iso"
        return 0
    fi

    # Clean up any failed downloads
    rm -f "${ISO_DIR}/"*.iso 2>/dev/null || true

    info "Detecting latest Archboot aarch64 ISO..." >&2

    # Fetch the index page to find the latest ISO filename
    # We want the "latest" variant (smallest, ~285MB, downloads packages from net)
    local index_page
    index_page="$(curl -fsSL "$ARCHBOOT_BASE_URL/" 2>/dev/null)" || \
        die "Failed to fetch Archboot ISO index from $ARCHBOOT_BASE_URL/"

    # Extract the "latest" ISO filename (smallest download, ~285MB)
    # Use sed instead of grep -P for macOS compatibility
    local iso_filename
    iso_filename="$(echo "$index_page" | sed -n 's/.*\(archboot-[^"]*-latest-aarch64\.iso\).*/\1/p' | head -1)"

    # Fallback: try the normal ISO if latest not found
    if [[ -z "$iso_filename" ]]; then
        iso_filename="$(echo "$index_page" \
            | sed -n 's/.*\(archboot-[^"]*-aarch64\.iso\).*/\1/p' \
            | grep -v 'latest\|local\|sig' \
            | head -1)"
    fi

    if [[ -z "$iso_filename" ]]; then
        die "Could not detect ISO filename from $ARCHBOOT_BASE_URL/
Please download manually from: $ARCHBOOT_BASE_URL/
Place the .iso file in: $ISO_DIR/"
    fi

    local iso_url="${ARCHBOOT_BASE_URL}/${iso_filename}"
    local iso_file="${ISO_DIR}/${iso_filename}"

    info "Downloading: $iso_filename" >&2
    info "URL: $iso_url" >&2
    info "This may take a while depending on your connection..." >&2

    if command -v curl &>/dev/null; then
        curl -L --progress-bar -o "$iso_file" "$iso_url"
    elif command -v wget &>/dev/null; then
        wget --show-progress -O "$iso_file" "$iso_url"
    else
        die "Neither curl nor wget found. Please install one of them."
    fi

    # Verify the download is a reasonable size (at least 100MB)
    local file_size
    file_size="$(stat -f%z "$iso_file" 2>/dev/null || stat -c%s "$iso_file" 2>/dev/null || echo 0)"
    if [[ "$file_size" -lt 104857600 ]]; then
        rm -f "$iso_file"
        die "ISO download appears corrupt (size: ${file_size} bytes). Expected > 100MB."
    fi

    info "ISO downloaded: $iso_file ($(( file_size / 1048576 ))MB)" >&2
    echo "$iso_file"
}

create_vm() {
    local iso_file="$1"

    info "Creating Parallels VM: $VM_NAME"

    # Create the VM (use generic 'linux' distribution since Parallels
    # doesn't have a specific 'archlinux' option)
    prlctl create "$VM_NAME" \
        --ostype linux \
        --distribution linux
    ok "VM created"

    # Configure hardware
    info "Configuring VM hardware..."
    prlctl set "$VM_NAME" --memsize "$VM_RAM"
    prlctl set "$VM_NAME" --cpus "$VM_CPUS"
    ok "RAM: ${VM_RAM}MB, CPUs: $VM_CPUS"

    # Resize disk
    info "Resizing disk to ${VM_DISK}MB..."
    prlctl set "$VM_NAME" --device-set hdd0 --size "$VM_DISK" 2>/dev/null || \
        warn "Could not resize disk. You may need to do this manually."

    # Attach ISO to CD-ROM drive
    info "Attaching Arch Linux ISO..."
    # First try setting existing cdrom, then try adding a new one
    if prlctl set "$VM_NAME" --device-set cdrom0 --image "$iso_file" --connect 2>/dev/null; then
        ok "ISO attached to cdrom0"
    elif prlctl set "$VM_NAME" --device-add cdrom --image "$iso_file" --connect 2>/dev/null; then
        ok "ISO attached via new cdrom device"
    else
        warn "Could not attach ISO automatically."
        warn "Please attach manually in Parallels VM settings: $iso_file"
    fi

    # Configure boot order: CD-ROM first, then HDD
    prlctl set "$VM_NAME" --device-bootorder "cdrom0 hdd0" 2>/dev/null || \
        warn "Could not set boot order. Please set boot from CD in VM settings."

    # Enable EFI boot (required for aarch64)
    prlctl set "$VM_NAME" --efi-boot on 2>/dev/null || \
        warn "Could not enable EFI boot. It may already be enabled by default on ARM."

    # Network: use shared networking (NAT) for easy host access
    info "Configuring network..."
    prlctl set "$VM_NAME" --device-set net0 --type shared 2>/dev/null || true
    ok "Network configured (shared/NAT)"

    # Note about shared folders: Parallels Tools are not fully supported
    # on Arch Linux, so shared folders may not work. Use SCP instead.
    info "Note: Parallels shared folders require Parallels Tools which"
    info "has limited support on Arch Linux. Use SCP to transfer files."

    ok "VM configuration complete"
}

print_summary() {
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ClawOS VM Created Successfully${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  VM Name:        ${CYAN}$VM_NAME${NC}"
    echo -e "  RAM:            ${VM_RAM}MB"
    echo -e "  CPUs:           $VM_CPUS"
    echo -e "  Disk:           ${VM_DISK}MB"
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo ""
    echo "  1. Start the VM (if not already started):"
    echo "     prlctl start \"$VM_NAME\""
    echo ""
    echo "  2. Open the VM console in Parallels Desktop and boot from the ISO"
    echo "     (The Archboot installer will start automatically)"
    echo ""
    echo "  3. In the Archboot environment, install Arch Linux:"
    echo "     - Follow the archboot setup wizard, OR"
    echo "     - Use archinstall for a more guided experience"
    echo ""
    echo "  4. After installation and reboot, transfer the build scripts via SCP:"
    echo "     # Find VM IP: (shown in Parallels or use 'ip addr' in VM)"
    echo "     scp -r ${PROJECT_DIR}/build clawos@<VM_IP>:/tmp/clawos-build"
    echo ""
    echo "  5. SSH into the VM and run provisioning:"
    echo "     ssh clawos@<VM_IP>"
    echo "     sudo bash /tmp/clawos-build/provision.sh"
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
main() {
    echo ""
    echo -e "${CYAN}ClawOS VM Builder${NC}"
    echo -e "${CYAN}Creating Arch Linux aarch64 VM with Parallels Desktop${NC}"
    echo ""

    check_prerequisites

    # Check if VM already exists
    if check_vm_exists; then
        warn "VM '$VM_NAME' already exists."
        echo ""
        read -rp "Do you want to delete and recreate it? [y/N]: " confirm
        if [[ "$confirm" =~ ^[Yy]$ ]]; then
            info "Stopping and deleting existing VM..."
            prlctl stop "$VM_NAME" --kill 2>/dev/null || true
            prlctl delete "$VM_NAME" 2>/dev/null || true
            ok "Old VM deleted"
        else
            info "Keeping existing VM. Exiting."
            exit 0
        fi
    fi

    # Download ISO
    local iso_file
    iso_file="$(download_iso)"

    # Create and configure VM
    create_vm "$iso_file"

    # Print summary
    print_summary
}

main "$@"
