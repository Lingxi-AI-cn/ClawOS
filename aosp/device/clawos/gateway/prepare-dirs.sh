#!/system/bin/sh
#
# ClawOS Directory Preparation Script
# Creates writable directories under /data/local/tmp/clawos/ for the gateway.
# Must run as user=shell to match /data/local/tmp/ ownership (shell:shell 770).
#

TAG="ClawOS.Prepare"

log -t "$TAG" "uid=$(id -u 2>/dev/null) gid=$(id -g 2>/dev/null) context=$(cat /proc/self/attr/current 2>/dev/null)"
log -t "$TAG" "parent: $(ls -ldZ /data/local/tmp 2>&1)"

FAILED=0
for DIR in \
    /data/local/tmp/clawos \
    /data/local/tmp/clawos/gateway \
    /data/local/tmp/clawos/state \
    /data/local/tmp/clawos/state/agents \
    /data/local/tmp/clawos/state/agents/main \
    /data/local/tmp/clawos/state/agents/main/agent \
    /data/local/tmp/clawos/state/canvas \
    /data/local/tmp/clawos/workspace \
    /data/local/tmp/clawos/workspace/skills \
    /data/local/tmp/clawos/ota-pending \
    /data/local/tmp/clawos/.openclaw \
    /data/local/tmp/clawos/.openclaw/extensions \
    /data/local/tmp/clawos/net \
    /data/local/tmp/openclaw
do
    if [ ! -d "$DIR" ]; then
        OUT=$(mkdir "$DIR" 2>&1)
        RC=$?
        if [ $RC -ne 0 ]; then
            log -t "$TAG" -p e "mkdir $DIR failed (rc=$RC): $OUT"
            FAILED=1
        fi
    fi
    chmod 0777 "$DIR" 2>/dev/null
done

log -t "$TAG" "result: $(ls -la /data/local/tmp/clawos/ 2>&1)"

if [ $FAILED -eq 0 ]; then
    log -t "$TAG" "All directories created successfully"
else
    log -t "$TAG" -p e "Some directories failed, check logs above"
    log -t "$TAG" -p e "SELinux denials: $(dmesg 2>/dev/null | grep 'avc.*denied' | tail -3)"
fi

# Cromite remote debugging: create command-line flag file so Cromite
# exposes @chrome_devtools_remote when launched (full CDP support).
# Chromium reads /data/local/tmp/<package>-command-line at process start.
CROMITE_FLAGS="/data/local/tmp/org.cromite.cromite-command-line"
echo "_ --remote-debugging-port=0" > "$CROMITE_FLAGS" 2>/dev/null
chmod 666 "$CROMITE_FLAGS" 2>/dev/null
log -t "$TAG" "Cromite debug flags: $CROMITE_FLAGS"

# DNS and CA cert setup is handled by clawos_setup_network service (runs as root)
