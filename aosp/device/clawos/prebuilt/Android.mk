LOCAL_PATH := $(call my-dir)

# ── Node.js 22 ARM64 (prebuilt binary) ─────────────────────────
# Cross-compiled Node.js for Android ARM64.
# Installed to /product/bin/node
include $(CLEAR_VARS)

LOCAL_MODULE := node
LOCAL_MODULE_CLASS := EXECUTABLES
LOCAL_MODULE_TAGS := optional
LOCAL_SRC_FILES := node
LOCAL_MODULE_PATH := $(TARGET_OUT_PRODUCT)/bin
LOCAL_PRODUCT_MODULE := true

# Skip shared library dependency checks (Node.js links against
# system libc/libdl/libm which are on the system partition)
LOCAL_CHECK_ELF_FILES := false

include $(BUILD_PREBUILT)

# ── jq 1.7.1 ARM64 (prebuilt static binary) ────────────────────
# JSON processor for shell scripts. Static binary, no dependencies.
# Installed to /product/bin/jq
include $(CLEAR_VARS)

LOCAL_MODULE := jq
LOCAL_MODULE_CLASS := EXECUTABLES
LOCAL_MODULE_TAGS := optional
LOCAL_SRC_FILES := tools/jq
LOCAL_MODULE_PATH := $(TARGET_OUT_PRODUCT)/bin
LOCAL_PRODUCT_MODULE := true
LOCAL_CHECK_ELF_FILES := false

include $(BUILD_PREBUILT)

# ── curl 8.12.1 ARM64 (prebuilt static binary) ─────────────────
# HTTP client. Static binary with TLS support, no dependencies.
# Named curl_clawos to avoid collision with AOSP's external/curl module.
# Installed to /product/bin/curl
include $(CLEAR_VARS)

LOCAL_MODULE := curl_clawos
LOCAL_MODULE_STEM := curl
LOCAL_MODULE_CLASS := EXECUTABLES
LOCAL_MODULE_TAGS := optional
LOCAL_SRC_FILES := tools/curl
LOCAL_MODULE_PATH := $(TARGET_OUT_PRODUCT)/bin
LOCAL_PRODUCT_MODULE := true
LOCAL_CHECK_ELF_FILES := false

include $(BUILD_PREBUILT)

# ── trurl ARM64 (prebuilt static binary) ────────────────────────
# URL parser and manipulator (companion to curl).
# Installed to /product/bin/trurl
include $(CLEAR_VARS)

LOCAL_MODULE := trurl
LOCAL_MODULE_CLASS := EXECUTABLES
LOCAL_MODULE_TAGS := optional
LOCAL_SRC_FILES := tools/trurl
LOCAL_MODULE_PATH := $(TARGET_OUT_PRODUCT)/bin
LOCAL_PRODUCT_MODULE := true
LOCAL_CHECK_ELF_FILES := false

include $(BUILD_PREBUILT)
