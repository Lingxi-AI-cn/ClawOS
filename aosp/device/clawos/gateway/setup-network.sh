#!/system/bin/sh
#
# ClawOS Network Setup Script
# Configures DNS resolv.conf and CA certificates for Node.js (c-ares).
# Runs as root (oneshot). Waits for network on real devices.
#

TAG="ClawOS.Network"

RESOLV_SRC=/product/etc/clawos/resolv.conf
CACERT_SRC=/product/etc/clawos/cacert.pem
NET_DIR=/data/local/tmp/clawos/net
RESOLV_DST=$NET_DIR/resolv.conf

logmsg() { log -t "$TAG" "$1"; }

get_dns_servers() {
    local DNS_LINE=$(dumpsys connectivity 2>/dev/null | grep -o 'DnsAddresses: \[[^]]*\]' | head -1)
    if [ -n "$DNS_LINE" ]; then
        local ADDRS=$(echo "$DNS_LINE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+')
        if [ -n "$ADDRS" ]; then
            echo "$ADDRS"
            return 0
        fi
    fi
    local D1=$(getprop net.dns1 2>/dev/null)
    case "$D1" in 10.0.2.*) D1="" ;; esac
    local D2=$(getprop net.dns2 2>/dev/null)
    case "$D2" in 10.0.2.*) D2="" ;; esac
    if [ -n "$D1" ]; then
        echo "$D1"
        [ -n "$D2" ] && echo "$D2"
        return 0
    fi
    local GW=$(ip route show default 2>/dev/null | head -1 | awk '{print $3}')
    if [ -n "$GW" ]; then
        echo "$GW"
        return 0
    fi
    return 1
}

ensure_dirs() {
    local D
    for D in /data/local/tmp /data/local/tmp/clawos "$NET_DIR"; do
        if [ ! -d "$D" ]; then
            local OUT=$(mkdir -p "$D" 2>&1)
            local RC=$?
            if [ $RC -ne 0 ]; then
                logmsg "mkdir $D failed ($RC): $OUT"
                return 1
            fi
        fi
        chmod 0777 "$D" 2>/dev/null
    done
    return 0
}

write_public_dns() {
    printf 'nameserver 8.8.8.8\nnameserver 1.1.1.1\nnameserver 8.8.4.4\n' > "$RESOLV_DST"
    chmod 644 "$RESOLV_DST" 2>/dev/null
}

# ── Phase 1: Wait for directories (max 10s) then write public DNS ──
logmsg "Starting (uid=$(id -u) ctx=$(cat /proc/self/attr/current 2>/dev/null))"

DIR_READY=false
for i in 1 2 3 4 5 6 7 8 9 10; do
    if ensure_dirs; then
        DIR_READY=true
        break
    fi
    sleep 1
done

if [ "$DIR_READY" = "true" ]; then
    if [ -f "$RESOLV_SRC" ]; then
        cp "$RESOLV_SRC" "$RESOLV_DST" 2>&1 | while read -r L; do logmsg "cp: $L"; done
    fi
    if [ ! -s "$RESOLV_DST" ]; then
        logmsg "Phase 1: cp produced no file, using printf"
        write_public_dns
    fi
    logmsg "Phase 1: resolv.conf $(wc -c < "$RESOLV_DST" 2>/dev/null) bytes"
else
    logmsg "Phase 1: directories not ready after 10s"
fi

# ── Phase 2: Wait for real DNS from WiFi/cellular (up to 60s) ──
MAX_WAIT=60
WAITED=0
DNS_FOUND=false
while [ "$WAITED" -lt "$MAX_WAIT" ]; do
    SERVERS=$(get_dns_servers)
    if [ -n "$SERVERS" ]; then
        DNS_FOUND=true
        break
    fi
    sleep 3
    WAITED=$((WAITED + 3))
    [ $((WAITED % 15)) -eq 0 ] && logmsg "Waiting for DNS... ${WAITED}s"
done

# ── Phase 3: Write final resolv.conf ──
ensure_dirs
if [ "$DNS_FOUND" = "true" ]; then
    printf '' > "$RESOLV_DST"
    echo "$SERVERS" | while read -r S; do
        [ -n "$S" ] && printf 'nameserver %s\n' "$S" >> "$RESOLV_DST"
    done
    printf 'nameserver 8.8.8.8\nnameserver 1.1.1.1\n' >> "$RESOLV_DST"
    chmod 644 "$RESOLV_DST" 2>/dev/null
    logmsg "Phase 3: DNS after ${WAITED}s: $(echo $SERVERS | tr '\n' ' ')"
else
    logmsg "Phase 3: no network DNS after ${MAX_WAIT}s"
fi

if [ ! -s "$RESOLV_DST" ]; then
    logmsg "Phase 3: resolv.conf missing, writing public DNS"
    write_public_dns
fi

# Ensure resolv.conf is world-readable (shell user must read it for gateway)
chmod 644 "$RESOLV_DST" 2>/dev/null
chown shell:shell "$RESOLV_DST" 2>/dev/null

if [ -s "$RESOLV_DST" ]; then
    logmsg "resolv.conf OK: $(wc -l < "$RESOLV_DST") lines, perms=$(ls -la "$RESOLV_DST" 2>/dev/null | awk '{print $1}')"
else
    logmsg "CRITICAL: resolv.conf still missing"
fi

# ── CA certificates ──
if [ -f "$CACERT_SRC" ]; then
    cp "$CACERT_SRC" "$NET_DIR/ca-certificates.crt" 2>/dev/null
    chmod 644 "$NET_DIR/ca-certificates.crt" 2>/dev/null
fi

# ── Try /system or bind mount ──
mount -o remount,rw / 2>/dev/null && mount -o remount,rw /system 2>/dev/null
if [ -s "$RESOLV_DST" ] && cp "$RESOLV_DST" /system/etc/resolv.conf 2>/dev/null; then
    mkdir -p /system/etc/ssl/certs 2>/dev/null
    [ -f "$CACERT_SRC" ] && ln -sf "$CACERT_SRC" /system/etc/ssl/certs/ca-certificates.crt 2>/dev/null
    mount -o remount,ro /system 2>/dev/null
    mount -o remount,ro / 2>/dev/null
    logmsg "DNS + CA configured via /system"
else
    if [ -s "$RESOLV_DST" ]; then
        touch /etc/resolv.conf 2>/dev/null
        mount --bind "$RESOLV_DST" /etc/resolv.conf 2>/dev/null && \
            logmsg "DNS via bind mount" || logmsg "Bind mount failed"
    fi
fi

logmsg "Final: $(cat "$RESOLV_DST" 2>/dev/null | tr '\n' ' ')"
