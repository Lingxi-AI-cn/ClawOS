#
# ClawOS product partition packages
#
# Replaces aosp_product.mk (which includes handheld_product.mk with all
# default user apps). We keep essential packages and common system apps.
# Excluded: Music, QuickSearchBox, OneTimeInitializer
#

# ── Base (webview) ───────────────────────────────────────────────
$(call inherit-product, $(SRC_TARGET_DIR)/product/media_product.mk)

# ── Telephony ────────────────────────────────────────────────────
$(call inherit-product, $(SRC_TARGET_DIR)/product/telephony_product.mk)

# ── Default sounds ───────────────────────────────────────────────
$(call inherit-product-if-exists, frameworks/base/data/sounds/AllAudio.mk)

# ── Packages from handheld_product.mk (SELECTED subset) ─────────
# Kept:  LatinIME, CromiteBrowser, SettingsIntelligence, overlays
#        Camera2, Contacts, Calendar, DeskClock, Gallery2 (AI-controllable)
# Removed: Music, QuickSearchBox, OneTimeInitializer, Browser2
# Note: Gboard is installed at first boot via init (see init.clawos.rc)
PRODUCT_PACKAGES += \
    Calendar \
    Camera2 \
    Contacts \
    DeskClock \
    Gallery2 \
    LatinIME \
    SettingsIntelligence \
    frameworks-base-overlays \
    preinstalled-packages-platform-handheld-product.xml

PRODUCT_PACKAGES_DEBUG += \
    frameworks-base-overlays-debug

# ── Packages from aosp_product.mk ───────────────────────────────
PRODUCT_PACKAGES += \
    messaging \
    PhotoTable \
    WallpaperPicker \
    preinstalled-packages-platform-aosp-product.xml

PRODUCT_PRODUCT_PROPERTIES += \
    ro.config.ringtone?=Ring_Synth_04.ogg \
    ro.config.notification_sound?=pixiedust.ogg \
    ro.com.android.dataroaming?=true

# ── APN configuration ───────────────────────────────────────────
PRODUCT_COPY_FILES += \
    device/sample/etc/apns-full-conf.xml:$(TARGET_COPY_OUT_PRODUCT)/etc/apns-conf.xml
