#
# DEPRECATED: This file was for the Android 12 emulator product.
# Use sdk_clawos_arm64.mk for the AOSP 16 emulator instead.
# Kept for reference only — not registered in AndroidProducts.mk.
#
# ClawOS ARM64 Emulator Product Definition (Android 12)
#

QEMU_USE_SYSTEM_EXT_PARTITIONS := true
PRODUCT_USE_DYNAMIC_PARTITIONS := true

# ── system partition (same as sdk_phone_arm64) ───────────────────
$(call inherit-product, $(SRC_TARGET_DIR)/product/core_64_bit.mk)
$(call inherit-product, $(SRC_TARGET_DIR)/product/generic_system.mk)

# ── system_ext partition (CUSTOM: no Launcher3QuickStep) ─────────
$(call inherit-product, device/clawos/clawos_system_ext.mk)
$(call inherit-product, $(SRC_TARGET_DIR)/product/telephony_system_ext.mk)

# ── product partition (CUSTOM: only essential apps) ──────────────
$(call inherit-product, device/clawos/clawos_product.mk)

# ── vendor partition (same as sdk_phone_arm64) ───────────────────
$(call inherit-product-if-exists, device/generic/goldfish/arm64-vendor.mk)
$(call inherit-product, $(SRC_TARGET_DIR)/product/emulator_vendor.mk)
$(call inherit-product, $(SRC_TARGET_DIR)/board/emulator_arm64/device.mk)

# ── SDK tools ────────────────────────────────────────────────────
$(call inherit-product, sdk/build/product_sdk.mk)
$(call inherit-product, development/build/product_sdk.mk)

# ── ClawOS branding ──────────────────────────────────────────────
PRODUCT_BRAND  := ClawOS
PRODUCT_NAME   := clawos_arm64
PRODUCT_DEVICE := emulator_arm64
PRODUCT_MODEL  := ClawOS ARM64
PRODUCT_MANUFACTURER := ClawOS

# ── System properties ────────────────────────────────────────────
PRODUCT_SYSTEM_PROPERTIES += \
    ro.clawos.version=0.1.0 \
    ro.clawos.build_type=dev \
    ro.clawos.platform=emulator \
    ro.setupwizard.mode=DISABLED

# Mark user setup as complete so FallbackHome immediately redirects
# to ClawOS Launcher instead of waiting for setup wizard.
PRODUCT_PRODUCT_PROPERTIES += \
    ro.setupwizard.mode=DISABLED

PRODUCT_SYSTEM_DEFAULT_PROPERTIES += \
    persist.sys.user_setup_complete=1 \
    debug.sf.nobootanimation=0

# ── Boot animation ───────────────────────────────────────────────
ifneq ($(wildcard device/clawos/bootanimation/bootanimation.zip),)
PRODUCT_COPY_FILES += \
    device/clawos/bootanimation/bootanimation.zip:$(TARGET_COPY_OUT_PRODUCT)/media/bootanimation.zip
endif

# ── Resource overlays ────────────────────────────────────────────
DEVICE_PACKAGE_OVERLAYS += device/clawos/overlay

# ── Default permissions (pre-grant overlay, microphone to ClawOS) ─
PRODUCT_COPY_FILES += \
    device/clawos/permissions/clawos-default-permissions.xml:$(TARGET_COPY_OUT_PRODUCT)/etc/default-permissions/clawos-default-permissions.xml

# ── Init scripts ─────────────────────────────────────────────────
PRODUCT_COPY_FILES += \
    device/clawos/init/init.clawos.rc:$(TARGET_COPY_OUT_PRODUCT)/etc/init/init.clawos.rc

# ── ClawOS Launcher App (pre-installed) ─────────────────────────
# The ClawOS Capacitor APK, pre-installed as a privileged system app
# so it can act as the default HOME launcher.
# Uses BUILD_PREBUILT via device/clawos/apps/Android.mk
PRODUCT_PACKAGES += ClawOS

# ── Node.js Gateway ─────────────────────────────────────────────
# Prebuilt Node.js 22 ARM64 binary (cross-compiled)
# Uses BUILD_PREBUILT via device/clawos/prebuilt/Android.mk
PRODUCT_PACKAGES += node

# ── CLI Tools for OpenClaw ──────────────────────────────────────
# Prebuilt static ARM64 binaries installed to /product/bin/
# Used by OpenClaw Gateway for web requests, JSON processing, etc.
#   curl:  HTTP client (static, from stunnel/static-curl)
#   jq:    JSON processor (static, from jqlang/jq)
#   trurl: URL parser/manipulator (static, from curl/trurl)
PRODUCT_PACKAGES += curl_clawos
PRODUCT_PACKAGES += jq
PRODUCT_PACKAGES += trurl

# ── Build mode: dev/prod ─────────────────────────────────────────
# dev  = pre-configured models & auth (for development/testing)
# prod = empty config, user must configure models via UI
CLAWOS_BUILD_MODE ?= dev

ifeq ($(CLAWOS_BUILD_MODE),prod)
  CLAWOS_CONFIG_JSON  := device/clawos/gateway/openclaw-prod.json
  CLAWOS_AUTH_JSON    := device/clawos/gateway/auth-profiles-prod.json
else
  CLAWOS_CONFIG_JSON  := device/clawos/gateway/openclaw-default.json
  CLAWOS_AUTH_JSON    := device/clawos/gateway/auth-profiles-default.json
endif

# Gateway files: start script, compressed bundle, config (mode-dependent), auth
PRODUCT_COPY_FILES += \
    device/clawos/gateway/start-gateway.sh:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/start-gateway.sh \
    device/clawos/gateway/prepare-dirs.sh:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/prepare-dirs.sh \
    device/clawos/gateway/gateway-bundle.tar.gz:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway-bundle.tar.gz \
    $(CLAWOS_CONFIG_JSON):$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/openclaw-default.json \
    $(CLAWOS_AUTH_JSON):$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/auth-profiles-default.json \
    device/clawos/gateway/chinese-ime-installer.bin:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/chinese-ime-installer.bin \
    device/clawos/gateway/install-gboard.sh:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/install-gboard.sh \
    device/clawos/gateway/install-cromite.sh:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/install-cromite.sh \
    device/clawos/gateway/cromite-browser.bin:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/cromite-browser.bin \
    device/clawos/gateway/telegram-installer.bin:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/telegram-installer.bin \
    device/clawos/gateway/cdp-shim.mjs:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/cdp-shim.mjs \
    device/clawos/gateway/cdp-bridge.mjs:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/cdp-bridge.mjs \
    device/clawos/gateway/intl-polyfill.js:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/intl-polyfill.js \
    device/clawos/gateway/dns-polyfill.cjs:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/dns-polyfill.cjs \
    device/clawos/gateway/setup-network.sh:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/setup-network.sh \
    device/clawos/gateway/ws-module.tar.gz:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/ws-module.tar.gz \
    device/clawos/gateway/AGENTS.md:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/AGENTS.md \
    device/clawos/gateway/skills/android-system-control/SKILL.md:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/skills/android-system-control/SKILL.md \
    device/clawos/gateway/skills/im-setup-automation/SKILL.md:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/skills/im-setup-automation/SKILL.md \
    device/clawos/gateway/discord-bot-setup.mjs:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/discord-bot-setup.mjs \
    device/clawos/gateway/ota-update.mjs:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/ota-update.mjs \
    device/clawos/gateway/gateway-version.txt:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway-version.txt \
    device/clawos/gateway/resolv.conf:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/resolv.conf \
    device/clawos/gateway/cacert.pem:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/cacert.pem

# Agent templates (required by gateway agent system for session bootstrap)
PRODUCT_COPY_FILES += \
    device/clawos/gateway/templates/AGENTS.md:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/templates/AGENTS.md \
    device/clawos/gateway/templates/AGENTS.dev.md:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/templates/AGENTS.dev.md \
    device/clawos/gateway/templates/BOOT.md:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/templates/BOOT.md \
    device/clawos/gateway/templates/BOOTSTRAP.md:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/templates/BOOTSTRAP.md \
    device/clawos/gateway/templates/HEARTBEAT.md:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/templates/HEARTBEAT.md \
    device/clawos/gateway/templates/IDENTITY.md:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/templates/IDENTITY.md \
    device/clawos/gateway/templates/IDENTITY.dev.md:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/templates/IDENTITY.dev.md \
    device/clawos/gateway/templates/SOUL.md:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/templates/SOUL.md \
    device/clawos/gateway/templates/SOUL.dev.md:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/templates/SOUL.dev.md \
    device/clawos/gateway/templates/TOOLS.md:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/templates/TOOLS.md \
    device/clawos/gateway/templates/TOOLS.dev.md:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/templates/TOOLS.dev.md \
    device/clawos/gateway/templates/USER.md:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/templates/USER.md \
    device/clawos/gateway/templates/USER.dev.md:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/templates/USER.dev.md

# ── IM Plugins (pre-bundled for IM integration) ──────────────────
# Copied to /product/etc/clawos/extensions/<plugin>/ at build time.
# At runtime, IMSetupWizard calls ClawOSBridge.installPlugin("<pluginId>")
# to copy from ROM to Gateway's writable extensions directory.

# Feishu / Lark
$(foreach f,$(shell cd device/clawos && find extensions/feishu -type f 2>/dev/null),\
  $(eval PRODUCT_COPY_FILES += device/clawos/$(f):$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/$(f)))

# DingTalk
$(foreach f,$(shell cd device/clawos && find extensions/dingtalk -type f 2>/dev/null),\
  $(eval PRODUCT_COPY_FILES += device/clawos/$(f):$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/$(f)))

# ── Voice models (sherpa-onnx: STT + TTS + VAD) ─────────────────
# Pre-installed to /product/etc/clawos/models/ so ClawOSVoice plugin
# can load them without bundling into the APK.

# STT: streaming zipformer bilingual zh-en (int8 encoder+joiner, float decoder)
# Supports both Chinese and English speech recognition
PRODUCT_COPY_FILES += \
    device/clawos/models/stt/encoder-epoch-99-avg-1.int8.onnx:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/stt/encoder-epoch-99-avg-1.int8.onnx \
    device/clawos/models/stt/decoder-epoch-99-avg-1.int8.onnx:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/stt/decoder-epoch-99-avg-1.int8.onnx \
    device/clawos/models/stt/decoder-epoch-99-avg-1.onnx:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/stt/decoder-epoch-99-avg-1.onnx \
    device/clawos/models/stt/joiner-epoch-99-avg-1.int8.onnx:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/stt/joiner-epoch-99-avg-1.int8.onnx \
    device/clawos/models/stt/tokens.txt:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/stt/tokens.txt \
    device/clawos/models/stt/bpe.model:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/stt/bpe.model

# TTS Chinese: Matcha Chinese (baker) + HiFiGAN vocoder
PRODUCT_COPY_FILES += \
    device/clawos/models/tts/model-steps-3.onnx:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/model-steps-3.onnx \
    device/clawos/models/tts/hifigan_v2.onnx:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/hifigan_v2.onnx \
    device/clawos/models/tts/lexicon.txt:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/lexicon.txt \
    device/clawos/models/tts/tokens.txt:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/tokens.txt \
    device/clawos/models/tts/date.fst:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/date.fst \
    device/clawos/models/tts/number.fst:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/number.fst \
    device/clawos/models/tts/phone.fst:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/phone.fst

# TTS Chinese dict files (jieba segmentation)
PRODUCT_COPY_FILES += \
    device/clawos/models/tts/dict/jieba.dict.utf8:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/dict/jieba.dict.utf8 \
    device/clawos/models/tts/dict/hmm_model.utf8:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/dict/hmm_model.utf8 \
    device/clawos/models/tts/dict/idf.utf8:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/dict/idf.utf8 \
    device/clawos/models/tts/dict/user.dict.utf8:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/dict/user.dict.utf8 \
    device/clawos/models/tts/dict/stop_words.utf8:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/dict/stop_words.utf8

# TTS Chinese dict pos_dict files
PRODUCT_COPY_FILES += \
    device/clawos/models/tts/dict/pos_dict/char_state_tab.utf8:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/dict/pos_dict/char_state_tab.utf8 \
    device/clawos/models/tts/dict/pos_dict/prob_emit.utf8:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/dict/pos_dict/prob_emit.utf8 \
    device/clawos/models/tts/dict/pos_dict/prob_start.utf8:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/dict/pos_dict/prob_start.utf8 \
    device/clawos/models/tts/dict/pos_dict/prob_trans.utf8:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/dict/pos_dict/prob_trans.utf8

# TTS English: Matcha English (ljspeech) — shares HiFiGAN vocoder with Chinese
PRODUCT_COPY_FILES += \
    device/clawos/models/tts-en/model-steps-3.onnx:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts-en/model-steps-3.onnx \
    device/clawos/models/tts-en/tokens.txt:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts-en/tokens.txt

# TTS English: espeak-ng-data (phoneme database, ~355 files)
$(foreach f,$(shell cd device/clawos && find models/tts-en/espeak-ng-data -type f 2>/dev/null),\
  $(eval PRODUCT_COPY_FILES += device/clawos/$(f):$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/$(f)))

# VAD: Silero VAD (language-agnostic)
PRODUCT_COPY_FILES += \
    device/clawos/models/vad/silero_vad.onnx:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/vad/silero_vad.onnx

# ── SELinux policy ──────────────────────────────────────────────
BOARD_SEPOLICY_DIRS += device/clawos/sepolicy

# ── Build system flags ───────────────────────────────────────────
PRODUCT_ENFORCE_ARTIFACT_PATH_REQUIREMENTS := relaxed
PRODUCT_BROKEN_VERIFY_USES_LIBRARIES := true
