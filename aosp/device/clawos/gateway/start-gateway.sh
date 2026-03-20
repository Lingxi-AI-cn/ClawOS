#!/system/bin/sh
#
# ClawOS Gateway Start Script
# Extracts the gateway bundle on first boot, then starts OpenClaw Gateway.
# Runs as user=shell, seclabel=u:r:shell:s0.
#

BASE_DIR="/data/local/tmp/clawos"
GATEWAY_DIR="$BASE_DIR/gateway"
GATEWAY_BAK="$BASE_DIR/gateway.bak"
OTA_PENDING_DIR="$BASE_DIR/ota-pending"
BUNDLE_TAR="/product/etc/clawos/gateway-bundle.tar.gz"
ROM_VERSION_FILE="/product/etc/clawos/gateway-version.txt"
INSTALLED_VERSION_FILE="$GATEWAY_DIR/.version"
CONFIG_DIR="$BASE_DIR"
CONFIG_FILE="$CONFIG_DIR/openclaw.json"
DEFAULT_CONFIG="/product/etc/clawos/openclaw-default.json"
DEFAULT_AUTH_PROFILES="/product/etc/clawos/auth-profiles-default.json"
DEFAULT_AGENTS_MD="/product/etc/clawos/AGENTS.md"
DEFAULT_SKILLS_DIR="/product/etc/clawos/skills"
DEFAULT_TEMPLATES_DIR="/product/etc/clawos/templates"
CDP_SHIM_SRC="/product/etc/clawos/gateway/cdp-shim.mjs"
CDP_BRIDGE_SRC="/product/etc/clawos/gateway/cdp-bridge.mjs"
WS_MODULE_TAR="/product/etc/clawos/gateway/ws-module.tar.gz"
OTA_SCRIPT="/product/etc/clawos/gateway/ota-update.mjs"
STATE_DIR="$BASE_DIR/state"
AGENT_DIR="$STATE_DIR/agents/main/agent"
WORKSPACE_DIR="$BASE_DIR/workspace"
APP_FILES_DIR="/data/data/com.clawos.app/files"
NODE="/product/bin/node"
LOG_TAG="clawos_gateway"
GATEWAY_TOKEN="clawos-device-token"

logmsg() {
    /system/bin/log -t "$LOG_TAG" -p i "$*" 2>/dev/null
    echo "[clawos] $*"
}

errmsg() {
    /system/bin/log -t "$LOG_TAG" -p e "$*" 2>/dev/null
    echo "[clawos] ERROR: $*" >&2
}

# ── Phase 0: Debug info ──────────────────────────────────────
logmsg "=== Gateway start script BEGIN ==="
logmsg "uid=$(id -u 2>/dev/null) gid=$(id -g 2>/dev/null) groups=$(id -G 2>/dev/null)"
logmsg "SELinux: $(cat /proc/self/attr/current 2>/dev/null)"
logmsg "Parent /data/local/tmp: $(ls -ldZ /data/local/tmp 2>&1)"

# ── Phase 1: Create directories (with explicit error reporting) ─
ensure_dir() {
    if [ ! -d "$1" ]; then
        MKDIR_OUT=$(mkdir -p "$1" 2>&1)
        MKDIR_RC=$?
        if [ $MKDIR_RC -ne 0 ]; then
            errmsg "mkdir '$1' failed (rc=$MKDIR_RC): $MKDIR_OUT"
            return 1
        fi
    fi
    chmod 0777 "$1" 2>/dev/null
    return 0
}

DIRS_OK=true
for DIR in "$BASE_DIR" "$GATEWAY_DIR" "$CONFIG_DIR" "$STATE_DIR" \
           "$AGENT_DIR" "$WORKSPACE_DIR" \
           "$STATE_DIR/canvas" \
           "/data/local/tmp/openclaw"; do
    ensure_dir "$DIR" || DIRS_OK=false
done

if [ "$DIRS_OK" = "false" ]; then
    errmsg "Some directories could not be created. Listing parent:"
    errmsg "$(ls -laZ /data/local/tmp/ 2>&1)"
    errmsg "Attempting to continue anyway..."
fi

logmsg "Directories after setup: $(ls -la /data/local/tmp/clawos/ 2>&1)"

# ── Phase 1b: Link skills directory to app private storage ──
APP_SKILLS_DIR="/data/data/com.clawos.app/files/skills"
WORKSPACE_SKILLS_LINK="$WORKSPACE_DIR/skills"
if [ -d "$APP_SKILLS_DIR" ] && [ ! -e "$WORKSPACE_SKILLS_LINK" ]; then
    ln -s "$APP_SKILLS_DIR" "$WORKSPACE_SKILLS_LINK" 2>/dev/null
    logmsg "Created symlink: $WORKSPACE_SKILLS_LINK -> $APP_SKILLS_DIR"
elif [ -L "$WORKSPACE_SKILLS_LINK" ]; then
    logmsg "Skills symlink already exists"
fi

# ── Phase 1c: Copy OTA script early (needed by Phase 3 --fix-deps) ──
if [ -f "$OTA_SCRIPT" ]; then
    cp "$OTA_SCRIPT" "$BASE_DIR/ota-update.mjs"
    chmod 755 "$BASE_DIR/ota-update.mjs"
    logmsg "OTA script copied from ROM (early)"
fi

# ── Phase 2: Copy config files FIRST (before extraction) ─────
if [ ! -f "$CONFIG_FILE" ]; then
    if [ -f "$DEFAULT_CONFIG" ]; then
        cp "$DEFAULT_CONFIG" "$CONFIG_FILE"
        chmod 666 "$CONFIG_FILE"
        logmsg "Default config copied to $CONFIG_FILE"
    else
        errmsg "No config file and no default config found"
    fi
fi

AUTH_PROFILES="$AGENT_DIR/auth-profiles.json"
if [ ! -f "$AUTH_PROFILES" ]; then
    if [ -f "$DEFAULT_AUTH_PROFILES" ]; then
        cp "$DEFAULT_AUTH_PROFILES" "$AUTH_PROFILES"
        chmod 666 "$AUTH_PROFILES"
        logmsg "Default auth profiles copied to $AUTH_PROFILES"
    else
        logmsg "No default auth profiles found (LLM auth may not work)"
    fi
fi

# Sync config to ClawOS app's private files directory (best-effort)
if [ -d "$APP_FILES_DIR" ] && [ -f "$CONFIG_FILE" ]; then
    cp "$CONFIG_FILE" "$APP_FILES_DIR/openclaw.json" 2>/dev/null
    APP_UID=$(stat -c '%u' "$APP_FILES_DIR" 2>/dev/null)
    APP_GID=$(stat -c '%g' "$APP_FILES_DIR" 2>/dev/null)
    if [ -n "$APP_UID" ] && [ -n "$APP_GID" ]; then
        chown "$APP_UID:$APP_GID" "$APP_FILES_DIR/openclaw.json" 2>/dev/null
    fi
    logmsg "Config synced to app files dir"
fi

# ── Phase 3: Version-aware gateway bundle deployment ─────────
# Priority: OTA pending > ROM upgrade > existing install
# Config files (openclaw.json, auth-profiles.json) are NEVER touched.

read_version() {
    if [ -f "$1" ]; then
        head -1 "$1" 2>/dev/null | tr -d '[:space:]'
    fi
}

extract_bundle() {
    local SRC_TAR="$1"
    local DST_DIR="$2"
    local VER="$3"

    rm -rf "$DST_DIR"
    ensure_dir "$DST_DIR"
    if [ ! -d "$DST_DIR" ]; then
        errmsg "FATAL: Cannot create gateway directory $DST_DIR"
        return 1
    fi

    logmsg "Extracting bundle ($VER): $(ls -la "$SRC_TAR" 2>&1)"
    logmsg "Disk space: $(df /data 2>&1 | tail -1)"

    TAR_OUTPUT=$(tar -C "$DST_DIR" -xzf "$SRC_TAR" 2>&1)
    TAR_EXIT=$?
    if [ "$TAR_EXIT" -ne 0 ]; then
        logmsg "tar failed (exit $TAR_EXIT), trying gzip pipe..."
        cd "$DST_DIR" || true
        TAR_OUTPUT=$(gzip -d < "$SRC_TAR" | tar -xf - 2>&1)
        TAR_EXIT=$?
    fi

    if [ "$TAR_EXIT" -eq 0 ]; then
        echo '{"type":"module"}' > "$DST_DIR/package.json"
        echo "$VER" > "$DST_DIR/.version"
        chmod 666 "$DST_DIR/.version" 2>/dev/null
        chmod 666 "$DST_DIR/package.json" 2>/dev/null
        logmsg "Bundle $VER extracted OK ($(ls "$DST_DIR/dist/" 2>/dev/null | wc -l) files in dist/)"
        return 0
    else
        errmsg "Extraction failed (exit $TAR_EXIT): $TAR_OUTPUT"
        return 1
    fi
}

INSTALLED_VER=$(read_version "$INSTALLED_VERSION_FILE")
ROM_VER=$(read_version "$ROM_VERSION_FILE")
NEED_DEPLOY=""
DEPLOY_SOURCE=""

logmsg "Version check: installed=$INSTALLED_VER rom=$ROM_VER"

# (pre-a) Retrieve OTA files staged in app cache (untrusted_app can't write to shell_data_file)
APP_OTA_CACHE="/data/data/com.clawos.app/cache/ota-pending"
if run-as com.clawos.app test -f "$APP_OTA_CACHE/.version" 2>/dev/null; then
    logmsg "OTA files found in app cache, extracting via run-as..."
    ensure_dir "$OTA_PENDING_DIR"
    for F in gateway-bundle.tar.gz .version .shasum; do
        if run-as com.clawos.app test -f "$APP_OTA_CACHE/$F" 2>/dev/null; then
            run-as com.clawos.app cat "$APP_OTA_CACHE/$F" > "$OTA_PENDING_DIR/$F"
            logmsg "  Copied $F from app cache"
        fi
    done
    run-as com.clawos.app rm -rf "$APP_OTA_CACHE" 2>/dev/null
    logmsg "App OTA cache cleaned"
fi

# (a) Check for OTA pending bundle (downloaded by ota-update.mjs)
if [ -f "$OTA_PENDING_DIR/gateway-bundle.tar.gz" ] && [ -f "$OTA_PENDING_DIR/.version" ]; then
    OTA_VER=$(read_version "$OTA_PENDING_DIR/.version")
    logmsg "OTA pending found: version=$OTA_VER"

    if [ -f "$OTA_PENDING_DIR/.shasum" ]; then
        EXPECTED_SHA=$(cat "$OTA_PENDING_DIR/.shasum" 2>/dev/null | tr -d '[:space:]')
        ACTUAL_SHA=$(sha1sum "$OTA_PENDING_DIR/gateway-bundle.tar.gz" 2>/dev/null | cut -d' ' -f1)
        if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
            errmsg "OTA integrity check FAILED (expected=$EXPECTED_SHA actual=$ACTUAL_SHA)"
            rm -rf "$OTA_PENDING_DIR"
        else
            logmsg "OTA integrity check OK"
            NEED_DEPLOY="ota"
            DEPLOY_SOURCE="$OTA_PENDING_DIR/gateway-bundle.tar.gz"
        fi
    else
        NEED_DEPLOY="ota"
        DEPLOY_SOURCE="$OTA_PENDING_DIR/gateway-bundle.tar.gz"
    fi
fi

# (b) Check ROM version vs installed (only if no OTA pending)
if [ -z "$NEED_DEPLOY" ] && [ -n "$ROM_VER" ]; then
    if [ -z "$INSTALLED_VER" ]; then
        logmsg "No installed version found, deploying ROM bundle"
        NEED_DEPLOY="rom"
        DEPLOY_SOURCE="$BUNDLE_TAR"
    elif [ "$ROM_VER" != "$INSTALLED_VER" ]; then
        # Compare versions: only deploy ROM if it's newer than installed.
        # This prevents downgrading an OTA-updated gateway.
        ROM_DATE=$(echo "$ROM_VER" | tr '.' ' ')
        INST_DATE=$(echo "$INSTALLED_VER" | tr '.' ' ')
        ROM_SORTABLE=$(printf "%04d%02d%02d" $ROM_DATE 2>/dev/null)
        INST_SORTABLE=$(printf "%04d%02d%02d" $INST_DATE 2>/dev/null)
        if [ "$ROM_SORTABLE" -gt "$INST_SORTABLE" ] 2>/dev/null; then
            logmsg "ROM version ($ROM_VER) is newer than installed ($INSTALLED_VER), upgrading"
            NEED_DEPLOY="rom"
            DEPLOY_SOURCE="$BUNDLE_TAR"
        else
            logmsg "Installed version ($INSTALLED_VER) is newer/equal to ROM ($ROM_VER), keeping OTA version"
        fi
    fi
fi

# (c) Fallback: no entry.js at all (corrupted install)
if [ -z "$NEED_DEPLOY" ] && [ ! -f "$GATEWAY_DIR/dist/entry.js" ]; then
    logmsg "No entry.js found (corrupted?), re-deploying ROM bundle"
    NEED_DEPLOY="rom"
    DEPLOY_SOURCE="$BUNDLE_TAR"
fi

wait_for_network() {
    local MAX_WAIT=60
    local INTERVAL=3
    local WAITED=0
    while [ "$WAITED" -lt "$MAX_WAIT" ]; do
        if ip -4 addr show 2>/dev/null | grep -v '127.0.0.1' | grep -q 'inet '; then
            logmsg "Network available after ${WAITED}s"
            return 0
        fi
        sleep "$INTERVAL"
        WAITED=$((WAITED + INTERVAL))
    done
    logmsg "Network not available after ${MAX_WAIT}s (fix-deps may fail)"
    return 1
}

run_fix_deps() {
    if [ ! -f "$BASE_DIR/ota-update.mjs" ]; then
        return
    fi
    logmsg "Checking for missing npm dependencies..."
    FIX_OUTPUT=$($NODE "$BASE_DIR/ota-update.mjs" --fix-deps 2>&1)
    logmsg "fix-deps: $FIX_OUTPUT"

    if echo "$FIX_OUTPUT" | grep -q '"installed":0' && echo "$FIX_OUTPUT" | grep -q 'installing_missing'; then
        logmsg "fix-deps installed 0 packages but had missing deps, waiting for network..."
        if wait_for_network; then
            logmsg "Retrying fix-deps with network..."
            FIX_OUTPUT=$($NODE "$BASE_DIR/ota-update.mjs" --fix-deps 2>&1)
            logmsg "fix-deps retry: $FIX_OUTPUT"
        fi
    fi
}

if [ -n "$NEED_DEPLOY" ]; then
    if [ "$NEED_DEPLOY" = "ota" ]; then
        DEPLOY_VER=$(read_version "$OTA_PENDING_DIR/.version")
    else
        DEPLOY_VER="$ROM_VER"
    fi
    [ -z "$DEPLOY_VER" ] && DEPLOY_VER="unknown"

    # Backup current gateway if it exists
    if [ -f "$GATEWAY_DIR/dist/entry.js" ]; then
        logmsg "Backing up current gateway ($INSTALLED_VER) to gateway.bak"
        rm -rf "$GATEWAY_BAK"
        mv "$GATEWAY_DIR" "$GATEWAY_BAK"
        ensure_dir "$GATEWAY_DIR"
    fi

    if [ -f "$DEPLOY_SOURCE" ]; then
        if extract_bundle "$DEPLOY_SOURCE" "$GATEWAY_DIR" "$DEPLOY_VER"; then
            logmsg "Gateway $DEPLOY_VER deployed from $NEED_DEPLOY"

            # Carry over node_modules from backup if the new bundle lacks them
            # (OTA bundles staged from the app skip node_modules due to SELinux)
            if [ ! -d "$GATEWAY_DIR/node_modules" ] && [ -d "$GATEWAY_BAK/node_modules" ]; then
                logmsg "Copying node_modules from backup..."
                cp -r "$GATEWAY_BAK/node_modules" "$GATEWAY_DIR/node_modules"
                logmsg "node_modules carried over from backup"
            fi

            run_fix_deps

            if [ "$NEED_DEPLOY" = "ota" ]; then
                chmod -R 0777 "$OTA_PENDING_DIR" 2>/dev/null
                rm -rf "$OTA_PENDING_DIR"
                logmsg "OTA pending directory cleaned up"
            fi
        else
            errmsg "Deploy failed, attempting rollback"
            if [ -d "$GATEWAY_BAK" ] && [ -f "$GATEWAY_BAK/dist/entry.js" ]; then
                rm -rf "$GATEWAY_DIR"
                mv "$GATEWAY_BAK" "$GATEWAY_DIR"
                logmsg "Rolled back to previous version"
            elif [ -f "$BUNDLE_TAR" ] && [ "$NEED_DEPLOY" = "ota" ]; then
                logmsg "Falling back to ROM bundle"
                extract_bundle "$BUNDLE_TAR" "$GATEWAY_DIR" "$ROM_VER"
            else
                errmsg "FATAL: No fallback available"
                exit 1
            fi
        fi
    else
        errmsg "Deploy source not found: $DEPLOY_SOURCE"
        if [ -d "$GATEWAY_BAK" ] && [ -f "$GATEWAY_BAK/dist/entry.js" ]; then
            rm -rf "$GATEWAY_DIR"
            mv "$GATEWAY_BAK" "$GATEWAY_DIR"
            logmsg "Restored backup"
        else
            errmsg "FATAL: Gateway bundle not found and no backup"
            exit 1
        fi
    fi
else
    logmsg "Gateway up to date ($INSTALLED_VER), no deployment needed"

    # Even when skipping deployment, verify deps are present
    if [ -f "$GATEWAY_DIR/dist/entry.js" ]; then
        run_fix_deps
    fi
fi

# Stamp version if missing (upgrade from old ROM that didn't track versions)
if [ -f "$GATEWAY_DIR/dist/entry.js" ] && [ ! -f "$INSTALLED_VERSION_FILE" ] && [ -n "$ROM_VER" ]; then
    echo "$ROM_VER" > "$INSTALLED_VERSION_FILE"
    chmod 666 "$INSTALLED_VERSION_FILE" 2>/dev/null
    logmsg "Stamped existing gateway with ROM version $ROM_VER"
fi

# ── Phase 4: Deploy auxiliary files ──────────────────────────
# Always refresh from ROM to pick up updates from ROM upgrades.

# CDP Bridge (Cromite abstract socket → TCP 9222)
if [ -f "$CDP_BRIDGE_SRC" ]; then
    cp "$CDP_BRIDGE_SRC" "$GATEWAY_DIR/cdp-bridge.mjs"
    chmod 644 "$GATEWAY_DIR/cdp-bridge.mjs"
    logmsg "CDP Bridge deployed to $GATEWAY_DIR/cdp-bridge.mjs"
fi

# Legacy CDP Shim (kept for reference, no longer started)
if [ -f "$CDP_SHIM_SRC" ]; then
    cp "$CDP_SHIM_SRC" "$GATEWAY_DIR/cdp-shim.mjs"
    chmod 644 "$GATEWAY_DIR/cdp-shim.mjs"
fi

# ws module (Node.js WebSocket library for CDP Shim)
if [ -f "$WS_MODULE_TAR" ] && [ ! -d "$GATEWAY_DIR/node_modules/ws" ]; then
    tar -C "$GATEWAY_DIR" -xzf "$WS_MODULE_TAR" 2>&1
    logmsg "ws module extracted to $GATEWAY_DIR/node_modules/ws"
fi

# OTA update script: already copied in Phase 1b (refresh for ROM upgrades)
if [ -f "$OTA_SCRIPT" ]; then
    cp "$OTA_SCRIPT" "$BASE_DIR/ota-update.mjs"
    chmod 755 "$BASE_DIR/ota-update.mjs"
fi

# AGENTS.md (always refresh from ROM)
if [ -f "$DEFAULT_AGENTS_MD" ]; then
    cp "$DEFAULT_AGENTS_MD" "$WORKSPACE_DIR/AGENTS.md"
    chmod 644 "$WORKSPACE_DIR/AGENTS.md"
    logmsg "AGENTS.md deployed to $WORKSPACE_DIR/AGENTS.md"
fi

# Skills (always refresh from ROM)
if [ -d "$DEFAULT_SKILLS_DIR" ]; then
    mkdir -p "$WORKSPACE_DIR/skills" 2>/dev/null
    cp -r "$DEFAULT_SKILLS_DIR"/* "$WORKSPACE_DIR/skills/" 2>/dev/null
    chmod -R 644 "$WORKSPACE_DIR/skills/" 2>/dev/null
    find "$WORKSPACE_DIR/skills/" -type d -exec chmod 755 {} + 2>/dev/null
    logmsg "Skills deployed to $WORKSPACE_DIR/skills/"
fi

# Agent templates (required by gateway agent system for session bootstrap)
if [ -d "$DEFAULT_TEMPLATES_DIR" ]; then
    mkdir -p "$GATEWAY_DIR/docs/reference/templates" 2>/dev/null
    cp "$DEFAULT_TEMPLATES_DIR"/*.md "$GATEWAY_DIR/docs/reference/templates/" 2>/dev/null
    chmod -R 644 "$GATEWAY_DIR/docs/reference/templates/" 2>/dev/null
    find "$GATEWAY_DIR/docs/reference/templates/" -type d -exec chmod 755 {} + 2>/dev/null
    logmsg "Agent templates deployed to $GATEWAY_DIR/docs/reference/templates/"
fi

# ── Phase 5: Permission fixup ────────────────────────────────
chmod 0777 "$CONFIG_DIR" "$STATE_DIR" "$AGENT_DIR" 2>/dev/null
chmod 0755 "$GATEWAY_DIR" 2>/dev/null
[ -f "$CONFIG_FILE" ] && chmod 666 "$CONFIG_FILE"
[ -f "$AUTH_PROFILES" ] && chmod 666 "$AUTH_PROFILES"
[ -f "$INSTALLED_VERSION_FILE" ] && chmod 666 "$INSTALLED_VERSION_FILE"
find "$GATEWAY_DIR/dist" -type f -exec chmod 644 {} + 2>/dev/null
find "$GATEWAY_DIR/dist" -type d -exec chmod 755 {} + 2>/dev/null
logmsg "Permissions fixup completed"

# ── Phase 6: Set environment ─────────────────────────────────
export OPENCLAW_CONFIG_PATH="$CONFIG_FILE"
export OPENCLAW_STATE_DIR="$STATE_DIR"
export HOME="$CONFIG_DIR"
export TMPDIR="/data/local/tmp"

# CA certs for static curl binary (OpenSSL looks for ca-certificates.crt)
CLAWOS_CACERT="/product/etc/clawos/cacert.pem"
CLAWOS_NET_CACERT="/data/local/tmp/clawos/net/ca-certificates.crt"
if [ -f "$CLAWOS_NET_CACERT" ]; then
    export CURL_CA_BUNDLE="$CLAWOS_NET_CACERT"
    export SSL_CERT_FILE="$CLAWOS_NET_CACERT"
    logmsg "CA bundle: $CLAWOS_NET_CACERT (copied)"
elif [ -f "$CLAWOS_CACERT" ]; then
    export CURL_CA_BUNDLE="$CLAWOS_CACERT"
    export SSL_CERT_FILE="$CLAWOS_CACERT"
    logmsg "CA bundle: $CLAWOS_CACERT (rom)"
fi

# DNS polyfill: c-ares reads /etc/resolv.conf; if absent on Android,
# we inject a --require polyfill that calls dns.setServers() at startup.
DNS_POLYFILL="/product/etc/clawos/gateway/dns-polyfill.cjs"
DNS_FLAG=""
if [ -f /etc/resolv.conf ]; then
    logmsg "DNS: using /etc/resolv.conf (c-ares native)"
elif [ -f "$DNS_POLYFILL" ]; then
    DNS_FLAG="--require $DNS_POLYFILL"
    logmsg "DNS: /etc/resolv.conf absent, using dns-polyfill.cjs"
elif [ -f "$BASE_DIR/gateway/dns-polyfill.cjs" ]; then
    DNS_FLAG="--require $BASE_DIR/gateway/dns-polyfill.cjs"
    logmsg "DNS: /etc/resolv.conf absent, using gateway/dns-polyfill.cjs (fallback)"
else
    logmsg "DNS: /etc/resolv.conf absent, no polyfill available"
fi

# Clear stale models.json (ensures gateway re-derives from current config)
rm -f "$AGENT_DIR/models.json"

# Remove stale PID lock files from previous crashed runs.
rm -f /data/local/tmp/openclaw/gateway.*.lock 2>/dev/null

# ── Phase 6b: Network check (non-blocking) ───────────────────
# Log current network state but don't block — Gateway starts immediately
# and handles network absence gracefully. LLM calls will fail until
# the user connects WiFi, but the WebSocket for the App works on loopback.
IP_ADDR=$(ip -4 addr show 2>/dev/null | grep -v '127.0.0.1' | grep 'inet ' | head -1)
if [ -n "$IP_ADDR" ]; then
    logmsg "Network available: $IP_ADDR"
else
    logmsg "No network yet. Gateway will start anyway (LLM calls require network)."
fi

# ── Phase 7: Start OpenClaw Gateway ──────────────────────────
cd "$GATEWAY_DIR" || { errmsg "Cannot cd to $GATEWAY_DIR"; exit 1; }
logmsg "Starting OpenClaw Gateway (cwd=$GATEWAY_DIR)..."
logmsg "Node: $($NODE --version 2>&1)"
logmsg "Config: $CONFIG_FILE"
logmsg "State: $STATE_DIR"
logmsg "entry.js exists: $(ls -la "$GATEWAY_DIR/dist/entry.js" 2>&1)"

# Determine entry point: prefer openclaw.mjs (official CLI wrapper that
# sets up compile cache and warning filters before loading dist/entry.js).
# Fall back to dist/entry.js for legacy bundles that lack the wrapper.
if [ -f "$GATEWAY_DIR/openclaw.mjs" ]; then
    ENTRY_POINT="openclaw.mjs"
else
    ENTRY_POINT="dist/entry.js"
fi
logmsg "Entry point: $ENTRY_POINT"

# Deploy Intl polyfill (Node.js on this device has no ICU support)
INTL_POLYFILL="/product/etc/clawos/gateway/intl-polyfill.js"
INTL_FLAG=""
if [ -f "$INTL_POLYFILL" ]; then
    INTL_FLAG="--require $INTL_POLYFILL"
    logmsg "Intl polyfill: $INTL_POLYFILL"
fi

GATEWAY_LOG="$BASE_DIR/gateway.log"
> "$GATEWAY_LOG"
chmod 666 "$GATEWAY_LOG" 2>/dev/null

OPENCLAW_NODE_OPTIONS_READY=1 "$NODE" --disable-warning=ExperimentalWarning \
    $INTL_FLAG \
    $DNS_FLAG \
    "$ENTRY_POINT" gateway \
    --allow-unconfigured \
    --bind loopback \
    --token "$GATEWAY_TOKEN" \
    > "$GATEWAY_LOG" 2>&1 &
NODE_PID=$!
logmsg "Node.js started with PID $NODE_PID (log: $GATEWAY_LOG)"

# Feed Node.js output to logcat in background
(tail -f "$GATEWAY_LOG" 2>/dev/null | while IFS= read -r line; do
    /system/bin/log -t openclaw_node -p i "$line" 2>/dev/null
done) &
LOGCAT_PID=$!

# ── Restart trigger watcher (background) ─────────────────────
# The app (untrusted_app) can't setprop ctl.restart on Android 16.
# Instead, ClawOSBridge writes a trigger file to the app cache.
# This watcher detects it and kills the gateway to trigger a restart via init.
(
    RESTART_CHECK_INTERVAL=2
    while kill -0 "$NODE_PID" 2>/dev/null; do
        if run-as com.clawos.app test -f /data/data/com.clawos.app/cache/restart-gateway 2>/dev/null; then
            run-as com.clawos.app rm /data/data/com.clawos.app/cache/restart-gateway 2>/dev/null
            logmsg "Restart trigger detected from app, killing gateway (PID $NODE_PID)..."
            kill "$NODE_PID" 2>/dev/null
            break
        fi
        sleep "$RESTART_CHECK_INTERVAL"
    done
) &
TRIGGER_PID=$!

# ── Rollback watchdog (background) ───────────────────────────
# If the gateway crashes within 15 seconds of starting AND we have a
# backup, roll back and flag the failure so we don't retry next boot.
(
    sleep 15
    if ! kill -0 "$NODE_PID" 2>/dev/null; then
        CURR_VER=$(head -1 "$INSTALLED_VERSION_FILE" 2>/dev/null | tr -d '[:space:]')
        if [ -d "$GATEWAY_BAK" ] && [ -f "$GATEWAY_BAK/dist/entry.js" ]; then
            /system/bin/log -t "$LOG_TAG" -p e "Gateway crashed within 15s, rolling back from $CURR_VER"
            rm -rf "$GATEWAY_DIR"
            mv "$GATEWAY_BAK" "$GATEWAY_DIR"
            echo "rollback-$(date +%s)" > "$BASE_DIR/.last-rollback"
            /system/bin/log -t "$LOG_TAG" -p i "Rollback complete, will restart via init"
        fi
    fi
) &

# ── Browser CDP Setup (background, delayed, non-fatal) ───────
# Cromite provides full Chromium CDP on @chrome_devtools_remote.
# CDP bridge runs as a separate init service (clawos_cdp_bridge) as root
# because shell user gets EACCES on abstract Unix sockets.
# This function only handles Cromite lifecycle (force-stop + relaunch)
# so it picks up the --remote-debugging-port=0 command-line flag.
cdp_setup() {
    sleep 15
    logmsg "[CDP] Force-stopping Cromite to apply debug flags..."
    am force-stop org.cromite.cromite 2>/dev/null
    sleep 2
    logmsg "[CDP] Launching Cromite for CDP support..."
    am start --user 0 -n org.cromite.cromite/org.chromium.chrome.browser.ChromeTabbedActivity \
        2>&1 | while read -r line; do logmsg "[CDP] am: $line"; done
    sleep 5
    input keyevent KEYCODE_HOME 2>/dev/null
    logmsg "[CDP] HOME key sent, Launcher should be in foreground"

    if cat /proc/net/unix 2>/dev/null | grep -q "chrome_devtools_remote"; then
        logmsg "[CDP] @chrome_devtools_remote socket found — CDP bridge should connect"
    else
        errmsg "[CDP] No @chrome_devtools_remote socket yet (CDP bridge will poll)"
    fi
}
# cdp_setup &  # Disabled: OpenClaw will launch Cromite when needed (attachOnly: false)

# Wait for Node.js gateway process; if it exits, log and clean up.
# CDP Shim failure should NOT cause this wait to end — only node exiting does.
wait $NODE_PID
EXIT_CODE=$?

if [ "$EXIT_CODE" -eq 0 ]; then
    logmsg "Node.js exited normally"
else
    errmsg "Node.js exited with code $EXIT_CODE"
fi

pkill -f "cdp-bridge.mjs" 2>/dev/null
[ -n "$LOGCAT_PID" ] && kill "$LOGCAT_PID" 2>/dev/null
[ -n "$TRIGGER_PID" ] && kill "$TRIGGER_PID" 2>/dev/null

if [ "$EXIT_CODE" -ne 0 ]; then
    sleep 5
fi
exit $EXIT_CODE
