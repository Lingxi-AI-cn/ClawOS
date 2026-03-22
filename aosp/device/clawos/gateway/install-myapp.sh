#!/system/bin/sh
#
# Install Tencent MyApp (应用宝) on first boot.
# Called by init service clawos_install_myapp.
#

TAG="clawos_myapp"
PKG="com.tencent.android.qqdownloader"
APK_BIN="/product/etc/clawos/myapp.bin"
APK_TMP="/data/local/tmp/myapp.apk"

logmsg() { /system/bin/log -t "$TAG" -p i "$*" 2>/dev/null; echo "[myapp] $*"; }
errmsg() { /system/bin/log -t "$TAG" -p e "$*" 2>/dev/null; echo "[myapp] ERROR: $*" >&2; }

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

if ! pm path "$PKG" > /dev/null 2>&1; then
    logmsg "Installing MyApp (应用宝)..."
    if [ -f "$APK_BIN" ]; then
        cp "$APK_BIN" "$APK_TMP"
        RESULT=$(pm install -g "$APK_TMP" 2>&1)
        if echo "$RESULT" | grep -q "Success"; then
            logmsg "MyApp installed successfully"
            rm -f "$APK_TMP"
        else
            errmsg "pm install failed: $RESULT"
            rm -f "$APK_TMP"
            exit 1
        fi
    else
        errmsg "MyApp binary not found: $APK_BIN"
        exit 1
    fi
else
    logmsg "MyApp already installed"
fi

logmsg "MyApp setup complete"
