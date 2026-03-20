#
# ClawOS system_ext partition packages
#
# Based on handheld_system_ext.mk.
# Launcher3QuickStep is KEPT: it provides gesture navigation (home/recents)
# even though ClawOS is the default HOME app.
#
$(call inherit-product, $(SRC_TARGET_DIR)/product/media_system_ext.mk)

PRODUCT_PACKAGES += \
    Launcher3QuickStep \
    Provision \
    Settings \
    StorageManager \
    SystemUI \
    WallpaperCropper
