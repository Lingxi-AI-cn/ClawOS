#!/usr/bin/env node
/**
 * ClawOS CDP Bridge
 *
 * Bridges TCP localhost:9222 → Cromite's abstract Unix socket
 * @chrome_devtools_remote.
 *
 * SAFETY: Never kills other processes. If port 9222 is in use,
 * retries with exponential backoff.
 */

import net from "net";

const LISTEN_PORT = 9221;
const CROMITE_SOCKET = "\0chrome_devtools_remote";
const POLL_INTERVAL_MS = 3000;
const SOCKET_CHECK_INTERVAL_MS = 10000;
const MAX_RETRY_DELAY_MS = 30000;

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

async function startServer() {
  const server = net.createServer(handleClient);
  let retryDelay = 3000;

  return new Promise((resolve) => {
    function attempt() {
      server.listen(LISTEN_PORT, "127.0.0.1");
    }

    server.on("listening", () => {
      log(`CDP bridge active: 127.0.0.1:${LISTEN_PORT} -> @chrome_devtools_remote`);
      resolve(server);
    });

    server.on("error", (e) => {
      if (e.code === "EADDRINUSE") {
        log(`Port ${LISTEN_PORT} in use, retrying in ${retryDelay / 1000}s...`);
        setTimeout(() => {
          server.close();
          attempt();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
      } else {
        log(`Server error: ${e.message}`);
        setTimeout(attempt, retryDelay);
      }
    });

    attempt();
  });
}

async function main() {
  log("Starting CDP bridge for Cromite...");

  while (!(await tryConnect(CROMITE_SOCKET))) {
    log("Waiting for Cromite @chrome_devtools_remote socket...");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  log("Cromite socket found");
  await startServer();

  setInterval(async () => {
    if (!(await tryConnect(CROMITE_SOCKET))) {
      log("Cromite socket lost, waiting for reconnection...");
    }
  }, SOCKET_CHECK_INTERVAL_MS);
}

main();
