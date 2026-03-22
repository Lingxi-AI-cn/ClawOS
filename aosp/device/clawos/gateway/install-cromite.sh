#!/system/bin/sh
#
# Install Cromite browser on first boot and skip first-run wizard.
# Called by init service clawos_install_cromite.
#

TAG="clawos_cromite"
PKG="org.cromite.cromite"
APK_BIN="/product/etc/clawos/cromite-browser.bin"
APK_TMP="/data/local/tmp/cromite-browser.apk"

logmsg() { /system/bin/log -t "$TAG" -p i "$*" 2>/dev/null; echo "[cromite] $*"; }
errmsg() { /system/bin/log -t "$TAG" -p e "$*" 2>/dev/null; echo "[cromite] ERROR: $*" >&2; }

logmsg "Waiting for PackageManager to be ready..."
PM_WAIT=0
while [ "$PM_WAIT" -lt 120 ]; do
    if pm path com.android.settings > /dev/null 2>&1; then
        logmsg "PackageManager ready after ${PM_WAIT}s"
        break
    fi
    sleep 5
    PM_WAIT=$((PM_WAIT + 5))
done

INSTALLED=false
if ! pm path "$PKG" > /dev/null 2>&1; then
    logmsg "Installing Cromite browser..."
    if [ -f "$APK_BIN" ]; then
        cp "$APK_BIN" "$APK_TMP"
        RESULT=$(pm install -g "$APK_TMP" 2>&1)
        if echo "$RESULT" | grep -q "Success"; then
            logmsg "Cromite installed successfully"
            rm -f "$APK_TMP"
            INSTALLED=true
        else
            errmsg "pm install failed: $RESULT"
            rm -f "$APK_TMP"
            exit 1
        fi
    else
        errmsg "Cromite binary not found: $APK_BIN"
        exit 1
    fi
else
    logmsg "Cromite already installed"
fi

# ── Skip first-run wizard ────────────────────────────────────
# Cromite (Chromium-based) checks for a Preferences JSON file
# to determine first-run state. Pre-populate it to skip the
# search engine selection and privacy setup screens.
DATA_DIR="/data/data/$PKG"
PREFS_DIR="$DATA_DIR/app_chrome/Default"
PREFS_FILE="$PREFS_DIR/Preferences"
FIRST_RUN_FILE="$DATA_DIR/app_chrome/Local State"

if [ ! -f "$PREFS_FILE" ]; then
    logmsg "Configuring Cromite to skip first-run wizard..."
    sleep 3

    # Get the app's UID for correct file ownership
    APP_UID=$(stat -c '%u' "$DATA_DIR" 2>/dev/null)
    APP_GID=$(stat -c '%g' "$DATA_DIR" 2>/dev/null)
    if [ -z "$APP_UID" ]; then
        APP_UID=$(dumpsys package "$PKG" 2>/dev/null | grep userId | head -1 | sed 's/.*userId=\([0-9]*\).*/\1/')
        APP_GID="$APP_UID"
    fi
    logmsg "Cromite UID=$APP_UID GID=$APP_GID"

    # Create directory structure
    mkdir -p "$PREFS_DIR" 2>/dev/null

    # Write Preferences to skip first-run
    cat > "$PREFS_FILE" << 'PREFS_EOF'
{
  "first_run_tabs": [],
  "show_welcome_page": false,
  "has_seen_welcome_page": true,
  "welcome_page_version": 0,
  "distribution": {
    "skip_first_run_ui": true
  },
  "browser": {
    "has_seen_welcome_page": true
  },
  "search": {
    "suggest_enabled": true
  },
  "privacy": {
    "network_prediction_options": 2
  }
}
PREFS_EOF

    # Write Local State to mark first run complete and allow insecure downloads
    cat > "$FIRST_RUN_FILE" << 'STATE_EOF'
{
  "browser": {
    "enabled_labs_experiments": ["disallow-unsafe-downloads@2"]
  }
}
STATE_EOF

    # Create the "First Run" sentinel file
    touch "$DATA_DIR/app_chrome/First Run" 2>/dev/null

    # Fix ownership and permissions
    if [ -n "$APP_UID" ] && [ -n "$APP_GID" ]; then
        chown -R "$APP_UID:$APP_GID" "$DATA_DIR/app_chrome" 2>/dev/null
    fi
    chmod -R 700 "$DATA_DIR/app_chrome" 2>/dev/null
    chmod 600 "$PREFS_FILE" 2>/dev/null
    chmod 600 "$FIRST_RUN_FILE" 2>/dev/null

    logmsg "Cromite first-run bypass configured"
else
    logmsg "Cromite preferences already exist, skipping first-run setup"
fi

logmsg "Cromite setup complete"
