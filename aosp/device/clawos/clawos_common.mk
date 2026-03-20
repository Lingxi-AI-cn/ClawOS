#
# ClawOS Common Product Configuration
#
# Shared ClawOS customizations included by all product variants
# (emulator, GSI, future devices). Each product mk sets its own
# PRODUCT_NAME, PRODUCT_DEVICE, PRODUCT_MODEL, and PRODUCT_BRAND.
#
# This file provides:
#   - ClawOS system_ext and product partitions
#   - ClawOS Launcher APK, Node.js, CLI tools
#   - OpenClaw Gateway (scripts, bundle, config)
#   - Sherpa-ONNX voice models (STT/TTS/VAD)
#   - Boot animation, overlays, permissions, init scripts
#   - IM plugins, agent templates, skills
#   - SELinux policy
#

# ── system_ext partition (ClawOS customized) ─────────────────
$(call inherit-product, device/clawos/clawos_system_ext.mk)

# ── product partition (ClawOS customized) ────────────────────
$(call inherit-product, device/clawos/clawos_product.mk)

# ── Default locale: Simplified Chinese, with English fallback ──
PRODUCT_LOCALES := zh_CN en_US

# ── System properties ────────────────────────────────────────
PRODUCT_BRAND  := ClawOS
PRODUCT_MANUFACTURER := ClawOS

PRODUCT_PRODUCT_PROPERTIES += \
    ro.clawos.version=0.2.0 \
    ro.clawos.build_type=dev \
    ro.setupwizard.mode=DISABLED \
    ro.adb.secure=0 \
    ro.debuggable=1 \
    persist.sys.usb.config=adb \
    persist.sys.locale=zh-CN \
    persist.sys.language=zh \
    persist.sys.country=CN \
    persist.sys.user_setup_complete=1 \
    debug.sf.nobootanimation=0

# ── Boot animation ───────────────────────────────────────────
ifneq ($(wildcard device/clawos/bootanimation/bootanimation.zip),)
PRODUCT_COPY_FILES += \
    device/clawos/bootanimation/bootanimation.zip:$(TARGET_COPY_OUT_PRODUCT)/media/bootanimation.zip
endif

# ── Resource overlays ────────────────────────────────────────
DEVICE_PACKAGE_OVERLAYS += device/clawos/overlay

# ── Default permissions ──────────────────────────────────────
PRODUCT_COPY_FILES += \
    device/clawos/permissions/clawos-default-permissions.xml:$(TARGET_COPY_OUT_PRODUCT)/etc/default-permissions/clawos-default-permissions.xml

# ── Init scripts ─────────────────────────────────────────────
PRODUCT_COPY_FILES += \
    device/clawos/init/init.clawos.rc:$(TARGET_COPY_OUT_PRODUCT)/etc/init/init.clawos.rc

# ── ClawOS Launcher App (pre-installed) ──────────────────────
PRODUCT_PACKAGES += ClawOS

# ── Node.js Gateway ──────────────────────────────────────────
PRODUCT_PACKAGES += node

# ── CLI Tools for OpenClaw ───────────────────────────────────
PRODUCT_PACKAGES += curl_clawos
PRODUCT_PACKAGES += jq
PRODUCT_PACKAGES += trurl

# ── Build mode: dev/prod ─────────────────────────────────────
CLAWOS_BUILD_MODE ?= dev

ifeq ($(CLAWOS_BUILD_MODE),prod)
  CLAWOS_CONFIG_JSON  := device/clawos/gateway/openclaw-prod.json
  CLAWOS_AUTH_JSON    := device/clawos/gateway/auth-profiles-prod.json
else
  CLAWOS_CONFIG_JSON  := device/clawos/gateway/openclaw-default.json
  CLAWOS_AUTH_JSON    := device/clawos/gateway/auth-profiles-default.json
endif

# ── Gateway files ────────────────────────────────────────────
PRODUCT_COPY_FILES += \
    device/clawos/gateway/start-gateway.sh:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/start-gateway.sh \
    device/clawos/gateway/prepare-dirs.sh:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/prepare-dirs.sh \
    device/clawos/gateway/gateway-bundle.tar.gz:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway-bundle.tar.gz \
    $(CLAWOS_CONFIG_JSON):$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/openclaw-default.json \
    $(CLAWOS_AUTH_JSON):$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/auth-profiles-default.json \
    device/clawos/gateway/install-gboard.sh:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/install-gboard.sh \
    device/clawos/gateway/install-cromite.sh:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/install-cromite.sh \
    device/clawos/gateway/cromite-browser.bin:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/cromite-browser.bin \
    device/clawos/gateway/install-trime.sh:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/install-trime.sh \
    device/clawos/gateway/trime-installer.bin:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/trime-installer.bin \
    device/clawos/gateway/rime-data.tar.gz:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/rime-data.tar.gz \
    device/clawos/gateway/cdp-shim.mjs:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/cdp-shim.mjs \
    device/clawos/gateway/cdp-bridge.mjs:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/cdp-bridge.mjs \
    device/clawos/gateway/intl-polyfill.js:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/intl-polyfill.js \
    device/clawos/gateway/dns-polyfill.cjs:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/dns-polyfill.cjs \
    device/clawos/gateway/setup-network.sh:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/setup-network.sh \
    device/clawos/gateway/ws-module.tar.gz:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/ws-module.tar.gz \
    device/clawos/gateway/AGENTS.md:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/AGENTS.md \
    device/clawos/gateway/skills/android-system-control/SKILL.md:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/skills/android-system-control/SKILL.md \
    device/clawos/gateway/ota-update.mjs:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway/ota-update.mjs \
    device/clawos/gateway/gateway-version.txt:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/gateway-version.txt \
    device/clawos/gateway/resolv.conf:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/resolv.conf \
    device/clawos/gateway/cacert.pem:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/cacert.pem

# ── Agent templates ──────────────────────────────────────────
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

# ── IM Plugins (pre-bundled) ─────────────────────────────────
$(foreach f,$(shell cd device/clawos && find extensions/feishu -type f 2>/dev/null),\
  $(eval PRODUCT_COPY_FILES += device/clawos/$(f):$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/$(f)))

$(foreach f,$(shell cd device/clawos && find extensions/dingtalk -type f 2>/dev/null),\
  $(eval PRODUCT_COPY_FILES += device/clawos/$(f):$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/$(f)))

# ── Voice models (sherpa-onnx: STT + TTS + VAD) ─────────────

# STT: streaming zipformer bilingual zh-en
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

# TTS Chinese dict files
PRODUCT_COPY_FILES += \
    device/clawos/models/tts/dict/jieba.dict.utf8:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/dict/jieba.dict.utf8 \
    device/clawos/models/tts/dict/hmm_model.utf8:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/dict/hmm_model.utf8 \
    device/clawos/models/tts/dict/idf.utf8:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/dict/idf.utf8 \
    device/clawos/models/tts/dict/user.dict.utf8:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/dict/user.dict.utf8 \
    device/clawos/models/tts/dict/stop_words.utf8:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/dict/stop_words.utf8

# TTS Chinese pos_dict files
PRODUCT_COPY_FILES += \
    device/clawos/models/tts/dict/pos_dict/char_state_tab.utf8:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/dict/pos_dict/char_state_tab.utf8 \
    device/clawos/models/tts/dict/pos_dict/prob_emit.utf8:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/dict/pos_dict/prob_emit.utf8 \
    device/clawos/models/tts/dict/pos_dict/prob_start.utf8:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/dict/pos_dict/prob_start.utf8 \
    device/clawos/models/tts/dict/pos_dict/prob_trans.utf8:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts/dict/pos_dict/prob_trans.utf8

# TTS English: Matcha English (ljspeech)
PRODUCT_COPY_FILES += \
    device/clawos/models/tts-en/model-steps-3.onnx:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts-en/model-steps-3.onnx \
    device/clawos/models/tts-en/tokens.txt:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/tts-en/tokens.txt

# TTS English: espeak-ng-data (exclude !v variants that break Soong)
$(foreach f,$(shell cd device/clawos && find models/tts-en/espeak-ng-data -type f 2>/dev/null | grep -v '/!'),\
  $(eval PRODUCT_COPY_FILES += device/clawos/$(f):$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/$(f)))

# VAD: Silero VAD
PRODUCT_COPY_FILES += \
    device/clawos/models/vad/silero_vad.onnx:$(TARGET_COPY_OUT_PRODUCT)/etc/clawos/models/vad/silero_vad.onnx

# ── SELinux policy ───────────────────────────────────────────
# Each product handles sepolicy inclusion:
#   - Emulator: SYSTEM_EXT_PRIVATE_SEPOLICY_DIRS (treble-compliant)
#   - GSI: BOARD_SEPOLICY_DIRS (in BoardConfig.mk, no treble checks)

# ── Build system flags ───────────────────────────────────────
PRODUCT_ENFORCE_ARTIFACT_PATH_REQUIREMENTS := relaxed
PRODUCT_BROKEN_VERIFY_USES_LIBRARIES := true
