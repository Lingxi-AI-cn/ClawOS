#
# ClawOS GSI ARM64 BoardConfig
#
# Inherits the official AOSP GSI common board config, then applies
# settings appropriate for modern ARM64 devices with dynamic partitions
# (e.g., Google Pixel 8 Pro / husky).
#

# ── Official GSI / Mainline board config ────────────────────
include build/make/target/board/BoardConfigGsiCommon.mk

# ── Architecture (64-bit only) ──────────────────────────────
TARGET_ARCH := arm64
TARGET_ARCH_VARIANT := armv8-2a
TARGET_CPU_VARIANT := cortex-a55
TARGET_CPU_ABI := arm64-v8a

# ── Kernel ──────────────────────────────────────────────────
TARGET_NO_KERNEL := true

# ── Partition sizes ─────────────────────────────────────────
# AOSP 16 build_image.py requires explicit partition_size for all images.
BOARD_SYSTEMIMAGE_PARTITION_SIZE := 6442450944
BOARD_VENDORIMAGE_PARTITION_SIZE := 67108864
BOARD_SYSTEM_DLKMIMAGE_PARTITION_SIZE := 67108864
BOARD_USERDATAIMAGE_PARTITION_SIZE := 2147483648

# ── GSI-compatible SELinux ──────────────────────────────────
BOARD_SEPOLICY_DIRS += build/make/target/board/generic_arm64/sepolicy
BOARD_SEPOLICY_DIRS += device/clawos/sepolicy
