LOCAL_PATH := $(call my-dir)

# ── ClawOS Launcher ─────────────────────────────────────────────
# Defined in Android.bp (android_app_import with presigned + preprocessed)
# to preserve APK Signature Scheme v2/v3 on all AOSP versions.

# ── Cromite Browser ────────────────────────────────────────────
# Shipped as a raw file and installed at first boot via pm install,
# same as Gboard. This avoids AOSP 12 PackageParser issues with
# apps targeting newer SDK versions (Cromite targets API 36).
# See PRODUCT_COPY_FILES in clawos_arm64.mk and init.clawos.rc.

# ── Gboard ────────────────────────────────────────────────────
# Gboard APK is shipped as a raw file (not prebuilt app) because its
# APK Signature Scheme v3 fails AOSP 12's priv-app certificate scan.
# Instead, it is installed at first boot via init script using `pm install`.
# See PRODUCT_COPY_FILES in clawos_arm64.mk and init.clawos.rc.
