#!/system/bin/sh
#
# Install Trime (同文输入法 / RIME for Android) on first boot.
# Pre-configures pinyin_simp schema for offline Chinese input.
# Called by init service clawos_install_trime.
#

TAG="clawos_trime"
TRIME_PKG="com.osfans.trime"
TRIME_BIN="/product/etc/clawos/trime-installer.bin"
RIME_DATA_ARCHIVE="/product/etc/clawos/rime-data.tar.gz"
WORK_DIR="/data/local/tmp/trime-install"
PM_WAIT_TIMEOUT=120

logmsg() { /system/bin/log -t "$TAG" -p i "$*" 2>/dev/null; echo "[trime] $*"; }
errmsg() { /system/bin/log -t "$TAG" -p e "$*" 2>/dev/null; echo "[trime] ERROR: $*" >&2; }

wait_for_pm() {
    logmsg "Waiting for PackageManager (max ${PM_WAIT_TIMEOUT}s)..."
    local elapsed=0
    while [ "$elapsed" -lt "$PM_WAIT_TIMEOUT" ]; do
        if pm path com.android.settings > /dev/null 2>&1; then
            logmsg "PackageManager ready after ${elapsed}s"
            return 0
        fi
        sleep 5
        elapsed=$((elapsed + 5))
    done
    errmsg "PackageManager not ready after ${PM_WAIT_TIMEOUT}s"
    return 1
}

wait_for_storage() {
    logmsg "Waiting for external storage (max 60s)..."
    local elapsed=0
    while [ "$elapsed" -lt 60 ]; do
        if [ -d "/sdcard/Android" ] || [ -d "/storage/emulated/0/Android" ]; then
            logmsg "External storage available after ${elapsed}s"
            return 0
        fi
        sleep 5
        elapsed=$((elapsed + 5))
    done
    errmsg "External storage not available after 60s"
    return 1
}

# ── Main ─────────────────────────────────────────────────────

if ! wait_for_pm; then
    exit 1
fi

# 1. Install Trime APK
if pm path "$TRIME_PKG" > /dev/null 2>&1; then
    logmsg "Trime already installed, skipping APK install"
else
    if [ ! -f "$TRIME_BIN" ]; then
        errmsg "Trime binary not found: $TRIME_BIN"
        exit 1
    fi

    mkdir -p "$WORK_DIR"
    cp "$TRIME_BIN" "$WORK_DIR/trime.apk"

    INSTALLED=false
    for attempt in 1 2 3; do
        logmsg "Install attempt $attempt/3..."
        result=$(pm install -g "$WORK_DIR/trime.apk" 2>&1)
        if echo "$result" | grep -q "Success"; then
            logmsg "Trime installed successfully"
            INSTALLED=true
            break
        fi
        errmsg "Attempt $attempt failed: $result"
        sleep 10
    done

    rm -rf "$WORK_DIR"

    if [ "$INSTALLED" != "true" ]; then
        errmsg "Failed to install Trime after 3 attempts"
        exit 1
    fi
    sleep 5
fi

# 2. Pre-populate RIME data (pinyin_simp schema + dictionary + trime.yaml theme)
if [ -f "$RIME_DATA_ARCHIVE" ]; then
    if wait_for_storage; then
        RIME_DIR="/sdcard/rime"
        if [ ! -f "$RIME_DIR/trime.yaml" ]; then
            logmsg "Deploying RIME schema data to $RIME_DIR..."
            mkdir -p "$RIME_DIR"
            tar xzf "$RIME_DATA_ARCHIVE" -C "$RIME_DIR" 2>&1
            if [ $? -eq 0 ]; then
                logmsg "RIME data deployed: $(ls "$RIME_DIR" | wc -l) files"
            else
                errmsg "Failed to extract RIME data"
            fi
        else
            logmsg "RIME data already exists, skipping"
        fi

        # Pre-create the build/ directory with trime.yaml so
        # TrimeInputMethodService doesn't crash on first start.
        # Normally Trime's deploy creates this, but the IME service
        # can start before the user opens the Trime app to trigger deploy.
        BUILD_DIR="$RIME_DIR/build"
        if [ ! -f "$BUILD_DIR/trime.yaml" ]; then
            logmsg "Pre-creating build/ directory for Trime..."
            mkdir -p "$BUILD_DIR"
            cp "$RIME_DIR/trime.yaml" "$BUILD_DIR/" 2>/dev/null
            cp "$RIME_DIR/default.yaml" "$BUILD_DIR/" 2>/dev/null
            logmsg "build/ directory pre-created"
        fi
    else
        errmsg "Cannot deploy RIME data: storage not available"
    fi
else
    logmsg "No RIME data archive found, Trime will use built-in schemas"
fi

# 3. Launch Trime main activity to trigger full RIME deployment
logmsg "Launching Trime to trigger initial deployment..."
am start -n com.osfans.trime/.core.Preferences 2>&1 || true
sleep 15
am force-stop com.osfans.trime 2>&1 || true
logmsg "Initial deployment triggered"

# 4. Enable Trime as available IME
TRIME_SERVICE="$TRIME_PKG/com.osfans.trime.ime.core.TrimeInputMethodService"

logmsg "Waiting 15s for system IME initialization..."
sleep 15

logmsg "Enabling Trime IME: $TRIME_SERVICE"
ime enable "$TRIME_SERVICE" 2>&1

CURRENT_ENABLED=$(settings get secure enabled_input_methods 2>&1)
if echo "$CURRENT_ENABLED" | grep -q "$TRIME_SERVICE"; then
    logmsg "Trime already in enabled IME list"
else
    if [ -n "$CURRENT_ENABLED" ] && [ "$CURRENT_ENABLED" != "null" ]; then
        NEW_ENABLED="${CURRENT_ENABLED}:${TRIME_SERVICE}"
    else
        NEW_ENABLED="$TRIME_SERVICE"
    fi
    settings put secure enabled_input_methods "$NEW_ENABLED" 2>&1
    logmsg "Added Trime to enabled IME list"
fi

logmsg "Current enabled IMEs: $(settings get secure enabled_input_methods 2>&1)"
logmsg "Current default IME: $(settings get secure default_input_method 2>&1)"
logmsg "Trime setup complete"
