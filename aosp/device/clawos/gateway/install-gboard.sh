#!/system/bin/sh
#
# Install Gboard (Google Keyboard) on first boot.
# Supports both single APK and split APKs (.apks bundle) formats.
# Called by init service clawos_install_gboard.
#

TAG="clawos_gboard"
GBOARD_PKG="com.google.android.inputmethod.latin"
GBOARD_BIN="/product/etc/clawos/gboard-installer.bin"
WORK_DIR="/data/local/tmp/gboard-install"
MAX_RETRIES=3
PM_WAIT_TIMEOUT=120

logmsg() { /system/bin/log -t "$TAG" -p i "$*" 2>/dev/null; echo "[gboard] $*"; }
errmsg() { /system/bin/log -t "$TAG" -p e "$*" 2>/dev/null; echo "[gboard] ERROR: $*" >&2; }

wait_for_pm() {
    logmsg "Waiting for PackageManager to be ready (max ${PM_WAIT_TIMEOUT}s)..."
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

install_single_apk() {
    local apk_path="$1"
    logmsg "Installing single APK: $apk_path"
    local result
    result=$(pm install -g "$apk_path" 2>&1)
    if echo "$result" | grep -q "Success"; then
        logmsg "Single APK installed successfully"
        return 0
    else
        errmsg "pm install failed: $result"
        return 1
    fi
}

install_split_apks() {
    local bundle_path="$1"
    local extract_dir="$WORK_DIR/extracted"
    mkdir -p "$extract_dir"

    logmsg "Extracting split APKs from bundle..."
    unzip -o "$bundle_path" -d "$extract_dir" > /dev/null 2>&1
    if [ $? -ne 0 ]; then
        errmsg "Failed to extract bundle"
        return 1
    fi

    local apk_count
    apk_count=$(ls "$extract_dir"/*.apk 2>/dev/null | wc -l)
    if [ "$apk_count" -eq 0 ]; then
        errmsg "No APK files found in bundle"
        return 1
    fi
    logmsg "Found $apk_count split APK(s)"

    local total_size=0
    for apk in "$extract_dir"/*.apk; do
        local size
        size=$(stat -c '%s' "$apk" 2>/dev/null || wc -c < "$apk")
        total_size=$((total_size + size))
    done

    logmsg "Creating install session (total size: ${total_size} bytes)..."
    local session_output
    session_output=$(pm install-create -S "$total_size" 2>&1)
    local session_id
    session_id=$(echo "$session_output" | grep -o '\[.*\]' | tr -d '[]')

    if [ -z "$session_id" ]; then
        errmsg "Failed to create install session: $session_output"
        return 1
    fi
    logmsg "Install session: $session_id"

    local idx=0
    for apk in "$extract_dir"/*.apk; do
        local apk_name
        apk_name=$(basename "$apk")
        local apk_size
        apk_size=$(stat -c '%s' "$apk" 2>/dev/null || wc -c < "$apk")
        logmsg "Writing split $idx: $apk_name ($apk_size bytes)"

        local write_result
        write_result=$(pm install-write -S "$apk_size" "$session_id" "$idx" "$apk" 2>&1)
        if ! echo "$write_result" | grep -q "Success"; then
            errmsg "Failed to write split $idx: $write_result"
            pm install-abandon "$session_id" 2>/dev/null
            return 1
        fi
        idx=$((idx + 1))
    done

    logmsg "Committing install session..."
    local commit_result
    commit_result=$(pm install-commit "$session_id" 2>&1)
    if echo "$commit_result" | grep -q "Success"; then
        logmsg "Split APKs installed successfully"
        return 0
    else
        errmsg "Failed to commit session: $commit_result"
        return 1
    fi
}

# ── Main ─────────────────────────────────────────────────────

if ! wait_for_pm; then
    exit 1
fi

if pm path "$GBOARD_PKG" > /dev/null 2>&1; then
    logmsg "Gboard already installed, skipping"
else
    if [ ! -f "$GBOARD_BIN" ]; then
        errmsg "Gboard binary not found: $GBOARD_BIN"
        exit 1
    fi

    mkdir -p "$WORK_DIR"
    cp "$GBOARD_BIN" "$WORK_DIR/gboard.bin"

    FILE_TYPE=$(file "$WORK_DIR/gboard.bin" 2>/dev/null || echo "unknown")
    IS_ZIP=false
    if echo "$FILE_TYPE" | grep -qi "zip"; then
        IS_ZIP=true
    fi

    INSTALLED=false
    for attempt in $(seq 1 $MAX_RETRIES); do
        logmsg "Install attempt $attempt/$MAX_RETRIES..."

        if [ "$IS_ZIP" = "true" ]; then
            HAS_MULTIPLE_APKS=false
            APK_COUNT=$(unzip -l "$WORK_DIR/gboard.bin" 2>/dev/null | grep -c '\.apk$')
            if [ "$APK_COUNT" -gt 1 ]; then
                HAS_MULTIPLE_APKS=true
            fi

            if [ "$HAS_MULTIPLE_APKS" = "true" ]; then
                if install_split_apks "$WORK_DIR/gboard.bin"; then
                    INSTALLED=true
                    break
                fi
            else
                unzip -o "$WORK_DIR/gboard.bin" -d "$WORK_DIR" > /dev/null 2>&1
                SINGLE_APK=$(ls "$WORK_DIR"/*.apk 2>/dev/null | head -1)
                if [ -n "$SINGLE_APK" ]; then
                    if install_single_apk "$SINGLE_APK"; then
                        INSTALLED=true
                        break
                    fi
                else
                    if install_single_apk "$WORK_DIR/gboard.bin"; then
                        INSTALLED=true
                        break
                    fi
                fi
            fi
        else
            if install_single_apk "$WORK_DIR/gboard.bin"; then
                INSTALLED=true
                break
            fi
        fi

        logmsg "Attempt $attempt failed, waiting 10s before retry..."
        sleep 10
    done

    rm -rf "$WORK_DIR"

    if [ "$INSTALLED" != "true" ]; then
        errmsg "Failed to install Gboard after $MAX_RETRIES attempts"
        exit 1
    fi

    sleep 5
fi

# ── Enable and set as default IME ────────────────────────────

GBOARD_SERVICE="$GBOARD_PKG/com.android.inputmethod.latin.LatinIME"

logmsg "Waiting 30s for system IME initialization to settle..."
sleep 30

logmsg "Enabling Gboard: $GBOARD_SERVICE"
ime enable "$GBOARD_SERVICE" 2>&1

logmsg "Setting Gboard as default IME"
ime set "$GBOARD_SERVICE" 2>&1
settings put secure default_input_method "$GBOARD_SERVICE" 2>&1

CURRENT=$(settings get secure default_input_method 2>&1)
logmsg "Current default IME: $CURRENT"

if [ "$CURRENT" != "$GBOARD_SERVICE" ]; then
    logmsg "Default IME not set correctly, retrying in 30s..."
    sleep 30
    ime enable "$GBOARD_SERVICE" 2>&1
    ime set "$GBOARD_SERVICE" 2>&1
    settings put secure default_input_method "$GBOARD_SERVICE" 2>&1
    CURRENT=$(settings get secure default_input_method 2>&1)
    logmsg "After retry, default IME: $CURRENT"
fi

logmsg "Gboard setup complete"
