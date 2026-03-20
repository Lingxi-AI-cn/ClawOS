#!/usr/bin/env bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
[ -f "$SCRIPT_DIR/.env.local" ] && source "$SCRIPT_DIR/.env.local"

CLAWOS_ROOT="${CLAWOS_ROOT:-$SCRIPT_DIR}"
AOSP_DIR="${AOSP_DIR:-/opt/aosp}"
JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk}"

UI_DIR="$CLAWOS_ROOT/ui"
DEVICE_TREE="$CLAWOS_ROOT/aosp/device/clawos"

echo "=== Step 1: cap sync android ==="
cd "$UI_DIR"
npx cap sync android

echo "=== Step 1c: gradle assembleDebug ==="
export JAVA_HOME="$JAVA_HOME"
cd "$UI_DIR/android"
./gradlew assembleDebug

echo "=== Step 1d: copy APK ==="
cp "$UI_DIR/android/app/build/outputs/apk/debug/app-debug.apk" \
   "$DEVICE_TREE/apps/ClawOS.apk"
echo "APK copied: $(du -sh $DEVICE_TREE/apps/ClawOS.apk | cut -f1)"

echo "=== Step 2: sync device tree ==="
cd "$CLAWOS_ROOT"
bash aosp/scripts/05-setup-device-tree.sh

echo "=== Step 3+4: AOSP build + emu_img_zip ==="
cd "$AOSP_DIR"
source build/envsetup.sh
lunch clawos_arm64-userdebug
CLAWOS_BUILD_MODE=prod make -j$(nproc)
CLAWOS_BUILD_MODE=prod make emu_img_zip -j$(nproc)

ZIP=$(ls -t "$AOSP_DIR/out/target/product/emulator_arm64"/*-img-*.zip 2>/dev/null | head -1)
echo ""
echo "=== BUILD COMPLETE ==="
echo "ZIP: $ZIP ($(du -sh $ZIP | cut -f1))"
echo ""
echo "On Mac, run:"
echo "  bash aosp/run-emulator-mac.sh --pull --lan --clean"
