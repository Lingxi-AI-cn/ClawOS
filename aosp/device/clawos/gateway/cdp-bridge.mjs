#!/usr/bin/env node
/**
 * ClawOS CDP Bridge (runs as root via init service)
 *
 * Bridges TCP localhost:9222 → Cromite's abstract Unix socket
 * @chrome_devtools_remote.
 */

const net = require("net");
const { execSync } = require("child_process");

const LISTEN_PORT = 9222;
const CROMITE_SOCKET = "\0chrome_devtools_remote";
const POLL_INTERVAL_MS = 3000;
const SOCKET_CHECK_INTERVAL_MS = 5000;

function log(msg) {
  const ts = new Date().toISOString().substring(11, 23);
  console.log(`[${ts}] [cdp-bridge] ${msg}`);
}

function tryConnect(socketPath) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ path: socketPath });
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, 3000);
    sock.on("connect", () => { clearTimeout(timer); sock.destroy(); resolve(true); });
    sock.on("error", () => { clearTimeout(timer); resolve(false); });
  });
}

function killPortHolder() {
  try {
    const out = execSync(`ss -tlnp 2>/dev/null | grep ':${LISTEN_PORT} '`, { encoding: "utf8" });
    const pidMatch = out.match(/pid=(\d+)/);
    if (pidMatch) {
      const pid = parseInt(pidMatch[1]);
      if (pid !== process.pid) {
        log(`Killing PID ${pid} on port ${LISTEN_PORT}`);
        try { process.kill(pid, "SIGTERM"); } catch {}
        return true;
      }
    }
  } catch {}
  return false;
}

let connId = 0;

function handleClient(client) {
  const id = ++connId;
  const upstream = net.createConnection({ path: CROMITE_SOCKET });
  upstream.on("connect", () => { client.pipe(upstream); upstream.pipe(client); });
  upstream.on("error", (e) => { log(`[${id}] upstream err: ${e.message}`); client.destroy(); });
  client.on("error", () => upstream.destroy());
  client.on("close", () => upstream.destroy());
  upstream.on("close", () => client.destroy());
}

async function main() {
  log("Starting CDP bridge for Cromite...");

  while (!(await tryConnect(CROMITE_SOCKET))) {
    log("Waiting for Cromite @chrome_devtools_remote socket...");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  log("Cromite socket found");
  killPortHolder();
  await new Promise((r) => setTimeout(r, 1000));

  const server = net.createServer(handleClient);

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      log(`Port ${LISTEN_PORT} in use, retrying...`);
      killPortHolder();
      setTimeout(() => { server.close(); server.listen(LISTEN_PORT, "127.0.0.1"); }, 3000);
    } else {
      log(`Server error: ${e.message}`);
    }
  });

  server.listen(LISTEN_PORT, "127.0.0.1", () => {
    log(`CDP bridge active: 127.0.0.1:${LISTEN_PORT} -> @chrome_devtools_remote`);
  });

  setInterval(async () => {
    if (!(await tryConnect(CROMITE_SOCKET))) {
      log("Cromite socket lost, waiting for reconnection...");
    }
  }, SOCKET_CHECK_INTERVAL_MS);
}

main();
