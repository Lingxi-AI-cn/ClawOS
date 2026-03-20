#
# ClawOS Emulator Product (AOSP 16, ARM64)
#
# Inherits the standard goldfish/emu64a emulator base, then layers
# ClawOS customizations (Launcher, Gateway, voice models, etc.) on top.
#
# Usage:
#   lunch sdk_clawos_arm64-trunk_staging-userdebug
#   m -j$(nproc) && make emu_img_zip -j$(nproc)
#   # Output: out/target/product/emu64a/sdk-repo-linux-system-images-*.zip
#
# The "sdk_" prefix is required by emu_img_zip.mk, which only triggers
# for products matching sdk_% or gcar_%.
#

PRODUCT_USE_DYNAMIC_PARTITIONS := true
PRODUCT_ENFORCE_ARTIFACT_PATH_REQUIREMENTS := relaxed

# ── Emulator base (goldfish ARM64) ───────────────────────────
$(call inherit-product, $(SRC_TARGET_DIR)/product/core_64_bit_only.mk)

PRODUCT_SDK_ADDON_SYS_IMG_SOURCE_PROP := \
    device/generic/goldfish/64bitonly/product/phone_source.prop_template

$(call inherit-product, device/generic/goldfish/board/emu64a/details.mk)
$(call inherit-product, device/generic/goldfish/product/phone.mk)

# ── ClawOS customizations ───────────────────────────────────
$(call inherit-product, device/clawos/clawos_common.mk)

# ── Product identity ─────────────────────────────────────────
PRODUCT_NAME   := sdk_clawos_arm64
PRODUCT_DEVICE := emu64a
PRODUCT_MODEL  := ClawOS Emulator ARM64
PRODUCT_BRAND  := ClawOS

# ── Emulator-specific properties ─────────────────────────────
PRODUCT_PRODUCT_PROPERTIES += \
    ro.clawos.platform=emulator

# ── SELinux policy (system_ext for treble compliance) ────────
SYSTEM_EXT_PRIVATE_SEPOLICY_DIRS += device/clawos/sepolicy
