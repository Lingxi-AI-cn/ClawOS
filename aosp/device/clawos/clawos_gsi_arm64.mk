#
# ClawOS ARM64 GSI (Generic System Image) Product Definition
#
# Builds a GSI for modern ARM64 devices with A/B + dynamic partitions.
# Primary target: Google Pixel 8 Pro (husky, Android 16, Tensor G3).
#
# Usage:
#   lunch clawos_gsi_arm64-trunk_staging-userdebug
#   m -j$(nproc)
#   # Output: out/target/product/clawos_gsi_arm64/system.img
#

# ── GSI / Treble fundamentals ───────────────────────────────
BUILDING_GSI := true
PRODUCT_FULL_TREBLE_OVERRIDE := true
BOARD_VNDK_VERSION := current
PRODUCT_SET_DEBUGFS_RESTRICTIONS := false

PRODUCT_PACKAGES += \
    gsi_skip_mount.cfg \
    init.gsi.rc \
    init.vndk-nodef.rc

# ── system partition ─────────────────────────────────────────
$(call inherit-product, $(SRC_TARGET_DIR)/product/core_64_bit_only.mk)
$(call inherit-product, $(SRC_TARGET_DIR)/product/handheld_system.mk)
$(call inherit-product, $(SRC_TARGET_DIR)/product/telephony_system.mk)
$(call inherit-product, $(SRC_TARGET_DIR)/product/languages_default.mk)
$(call inherit-product, $(SRC_TARGET_DIR)/product/updatable_apex.mk)

# ── system_ext partition (telephony) ─────────────────────────
$(call inherit-product, $(SRC_TARGET_DIR)/product/telephony_system_ext.mk)

# ── ClawOS shared customizations ────────────────────────────
$(call inherit-product, device/clawos/clawos_common.mk)

# ── Product identity ─────────────────────────────────────────
PRODUCT_NAME   := clawos_gsi_arm64
PRODUCT_DEVICE := clawos_gsi_arm64
PRODUCT_MODEL  := ClawOS GSI ARM64

# ── GSI-specific properties ──────────────────────────────────
PRODUCT_SYSTEM_EXT_PROPERTIES += \
    ro.cp_system_other_odex=0 \
    ro.adb.secure=0 \
    ro.nnapi.extensions.deny_on_product=true \
    persist.sys.disable_rescue=true \
    ro.control_privapp_permissions=disable

PRODUCT_PRODUCT_PROPERTIES += \
    ro.clawos.platform=gsi \
    ro.clawos.device=pixel8pro

# ── GSI build system flags ──────────────────────────────────
PRODUCT_ENFORCE_VINTF_MANIFEST := false
SKIP_VINTF_CHECK_IN_BUILD := true

# ── Image build controls (GSI: only system + vbmeta) ────────
PRODUCT_BUILD_SYSTEM_IMAGE := true
PRODUCT_BUILD_SYSTEM_OTHER_IMAGE := false
PRODUCT_BUILD_PRODUCT_IMAGE := false
PRODUCT_BUILD_SYSTEM_EXT_IMAGE := false
PRODUCT_BUILD_ODM_IMAGE := false
PRODUCT_BUILD_CACHE_IMAGE := false
PRODUCT_BUILD_VENDOR_DLKM_IMAGE := false
PRODUCT_BUILD_ODM_DLKM_IMAGE := false
PRODUCT_BUILD_RAMDISK_IMAGE := true
PRODUCT_BUILD_USERDATA_IMAGE := false
PRODUCT_BUILD_BOOT_IMAGE := false
PRODUCT_BUILD_VENDOR_BOOT_IMAGE := false
PRODUCT_BUILD_RECOVERY_IMAGE := false
PRODUCT_BUILD_VBMETA_IMAGE := true

$(call inherit-product, $(SRC_TARGET_DIR)/product/generic_ramdisk.mk)
