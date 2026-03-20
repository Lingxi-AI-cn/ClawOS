#!/usr/bin/env node
/**
 * ClawOS CDP Shim — Session-Multiplexing Proxy
 *
 * Makes Android WebView's CDP compatible with Playwright by implementing
 * flat session multiplexing: routes session-scoped commands to individual
 * page WebSocket endpoints.
 *
 * Architecture:
 *   Playwright ←WS→ Shim (9223) ──→ Browser WS (9222/devtools/browser)
 *                                └──→ Page WS (9222/devtools/page/<id>) per session
 *
 * Usage:
 *   node cdp-shim.mjs [--upstream 9222] [--port 9223]
 */

import http from "http";
import { WebSocketServer, WebSocket } from "ws";

const UPSTREAM_PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--upstream") || "9222");
const SHIM_PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--port") || "9223");
const UPSTREAM = `http://localhost:${UPSTREAM_PORT}`;
const DEFAULT_CONTEXT_ID = "CLAWOS_DEFAULT_CONTEXT";

function log(tag, msg) {
  console.log(`[${new Date().toISOString().substring(11, 23)}] [${tag}] ${msg}`);
}

async function fetchJSON(path) {
  const r = await fetch(`${UPSTREAM}${path}`);
  return r.json();
}

function safeClose(ws, code) {
  try {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(code && code >= 1000 && code <= 4999 ? code : 1000);
    }
  } catch {}
}

// ─── HTTP Proxy (rewrite ports in responses) ───

const httpServer = http.createServer(async (req, res) => {
  try {
    const upRes = await fetch(`${UPSTREAM}${req.url}`, { method: req.method });
    let body = await upRes.text();
    body = body.replaceAll(`localhost:${UPSTREAM_PORT}`, `localhost:${SHIM_PORT}`);
    body = body.replaceAll(`127.0.0.1:${UPSTREAM_PORT}`, `localhost:${SHIM_PORT}`);
    res.writeHead(upRes.status, {
      "Content-Type": upRes.headers.get("Content-Type") || "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(body);
  } catch (e) {
    res.writeHead(502).end(JSON.stringify({ error: e.message }));
  }
});

// ─── WebSocket Proxy with Session Multiplexing ───

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (client, req) => {
  const path = req.url || "";
  log("WS", `Client connected: ${path}`);

  // If connecting to a page endpoint directly, simple proxy
  if (path.includes("/devtools/page/")) {
    setupSimpleProxy(client, path);
    return;
  }

  // Browser endpoint: need session multiplexing
  setupBrowserProxy(client);
});

/**
 * Simple 1:1 proxy for page endpoint connections.
 */
function setupSimpleProxy(client, path) {
  const upstream = new WebSocket(`ws://localhost:${UPSTREAM_PORT}${path}`);

  upstream.on("open", () => { log("WS", `Page proxy connected: ${path}`); });
  upstream.on("message", (d) => { if (client.readyState === WebSocket.OPEN) client.send(d); });
  upstream.on("close", (c) => safeClose(client, c));
  upstream.on("error", () => safeClose(client, 1011));

  client.on("message", (d) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(d); });
  client.on("close", (c) => safeClose(upstream, c));
  client.on("error", () => safeClose(upstream, 1011));
}

/**
 * Browser endpoint proxy with session multiplexing.
 * - Commands without sessionId go to browser WS (with interception)
 * - Commands with sessionId are routed to the page's WS
 */
function setupBrowserProxy(client) {
  const browserWs = new WebSocket(`ws://localhost:${UPSTREAM_PORT}/devtools/browser`);

  // sessionId → { ws: WebSocket, targetId: string }
  const sessions = new Map();
  // targetId → sessionId
  const targetToSession = new Map();

  let browserReady = false;
  const pendingBrowser = [];

  browserWs.on("open", () => {
    browserReady = true;
    log("WS", "Browser upstream connected");
    for (const m of pendingBrowser) browserWs.send(m);
    pendingBrowser.length = 0;
  });

  // Browser upstream → Client
  browserWs.on("message", (data) => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });

  browserWs.on("close", (c) => {
    log("WS", `Browser upstream closed (${c})`);
    for (const s of sessions.values()) safeClose(s.ws, 1000);
    sessions.clear();
    safeClose(client, c);
  });

  browserWs.on("error", (e) => {
    log("WS", `Browser upstream error: ${e.message}`);
  });

  // Client → Route to correct upstream
  client.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch {
      sendToBrowser(raw);
      return;
    }

    const { id, method, params, sessionId } = msg;

    // Commands with sessionId → route to page WS
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      const stripped = { id, method, params };
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify(stripped));
      }
      return;
    }

    // Browser-level commands (no sessionId) → intercept or forward
    const result = await handleBrowserCommand(msg, client, sessions, targetToSession);
    if (result !== undefined) {
      // Already handled (intercepted)
      return;
    }

    // Pass through to browser upstream
    sendToBrowser(raw.toString());
  });

  function sendToBrowser(data) {
    if (browserReady) {
      browserWs.send(typeof data === "string" ? data : data.toString());
    } else {
      pendingBrowser.push(typeof data === "string" ? data : data.toString());
    }
  }

  client.on("close", (c) => {
    log("WS", `Client closed (${c})`);
    for (const s of sessions.values()) safeClose(s.ws, 1000);
    sessions.clear();
    safeClose(browserWs, c && c >= 1000 && c <= 4999 ? c : 1000);
  });

  client.on("error", () => {});

  /**
   * Connect a page session: create a WS to the page endpoint and
   * forward messages with sessionId wrapping.
   */
  function connectPageSession(sessionId, targetId) {
    if (sessions.has(sessionId)) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const pageWs = new WebSocket(`ws://localhost:${UPSTREAM_PORT}/devtools/page/${targetId}`);
      sessions.set(sessionId, { ws: pageWs, targetId });
      targetToSession.set(targetId, sessionId);

      pageWs.on("open", () => {
        log("SESSION", `Page session connected: ${sessionId} → ${targetId}`);
        resolve();
      });

      // Page → Client (wrap with sessionId)
      pageWs.on("message", (data) => {
        if (client.readyState !== WebSocket.OPEN) return;
        try {
          const resp = JSON.parse(data.toString());
          resp.sessionId = sessionId;
          client.send(JSON.stringify(resp));
        } catch {
          client.send(data);
        }
      });

      pageWs.on("close", () => {
        log("SESSION", `Page session closed: ${sessionId}`);
        sessions.delete(sessionId);
        targetToSession.delete(targetId);
      });

      pageWs.on("error", (e) => {
        log("SESSION", `Page session error: ${sessionId}: ${e.message}`);
        resolve(); // resolve anyway to not hang
      });

      // Safety timeout
      setTimeout(resolve, 5000);
    });
  }

  /**
   * Handle browser-level CDP commands.
   * Returns undefined to pass through, or any value to indicate handled.
   */
  async function handleBrowserCommand(msg, clientWs, sessions, targetToSession) {
    const { id, method, params } = msg;

    function respond(result) {
      clientWs.send(JSON.stringify({ id, result }));
    }

    function respondError(code, message) {
      clientWs.send(JSON.stringify({ id, error: { code, message } }));
    }

    switch (method) {
      case "Browser.setDownloadBehavior":
        log("INTERCEPT", method);
        respond({});
        return true;

      case "Browser.getWindowForTarget":
        log("INTERCEPT", method);
        respond({ windowId: 1, bounds: { left: 0, top: 0, width: 1080, height: 2400, windowState: "normal" } });
        return true;

      case "Browser.setWindowBounds":
        log("INTERCEPT", method);
        respond({});
        return true;

      case "Browser.getBrowserContexts":
        log("INTERCEPT", method);
        respond({ browserContexts: [] });
        return true;

      case "Browser.createBrowserContext":
        log("INTERCEPT", method);
        respond({ browserContextId: "DEFAULT_CONTEXT" });
        return true;

      case "Target.setAutoAttach": {
        log("INTERCEPT", `${method} (flatten=${params?.flatten})`);

        // IMPORTANT: Chrome emits attachedToTarget events BEFORE the setAutoAttach response.
        // Playwright relies on this ordering to discover existing pages during connectOverCDP.
        try {
          const targets = await fetchJSON("/json/list");
          const pageTargets = targets.filter(t => t.type === "page");

          // Connect all page sessions in parallel first
          await Promise.all(pageTargets.map(t =>
            connectPageSession(`cdp-session-${t.id}`, t.id)
          ));

          // Emit attachedToTarget events for all pages
          for (const t of pageTargets) {
            const sessId = `cdp-session-${t.id}`;
            const evt = {
              method: "Target.attachedToTarget",
              params: {
                sessionId: sessId,
                targetInfo: {
                  targetId: t.id,
                  type: "page",
                  title: t.title || "",
                  url: t.url || "",
                  attached: true,
                  canAccessOpener: false,
                  browserContextId: DEFAULT_CONTEXT_ID,
                },
                waitingForDebugger: false,
              },
            };
            clientWs.send(JSON.stringify(evt));
          }
          log("INTERCEPT", `  Emitted ${pageTargets.length} attachedToTarget events`);
        } catch (e) {
          log("INTERCEPT", `  Error: ${e.message}`);
        }

        // Send response AFTER events (matching Chrome's behavior)
        respond({});
        return true;
      }

      case "Target.setDiscoverTargets":
        log("INTERCEPT", method);
        respond({});
        return true;

      case "Target.getTargets": {
        log("INTERCEPT", method);
        try {
          const targets = await fetchJSON("/json/list");
          respond({
            targetInfos: targets.map(t => ({
              targetId: t.id,
              type: t.type || "page",
              title: t.title || "",
              url: t.url || "",
              attached: targetToSession.has(t.id),
              canAccessOpener: false,
              browserContextId: DEFAULT_CONTEXT_ID,
            }))
          });
        } catch {
          respond({ targetInfos: [] });
        }
        return true;
      }

      case "Target.getTargetInfo": {
        const tid = params?.targetId;
        log("INTERCEPT", `${method} (${tid || "no-id"})`);
        if (!tid) {
          // Called without targetId (Playwright workaround for Chromium bug)
          respond({
            targetInfo: {
              targetId: "browser",
              type: "browser",
              title: "",
              url: "",
              attached: true,
              canAccessOpener: false,
              browserContextId: "",
            }
          });
          return true;
        }
        try {
          const targets = await fetchJSON("/json/list");
          const t = targets.find(x => x.id === tid);
          if (t) {
            respond({
              targetInfo: {
                targetId: t.id,
                type: t.type || "page",
                title: t.title || "",
                url: t.url || "",
                attached: targetToSession.has(t.id),
                canAccessOpener: false,
                browserContextId: DEFAULT_CONTEXT_ID,
              }
            });
          } else {
            respondError(-32000, "No target with given id found");
          }
        } catch {
          respondError(-32000, "Failed to get target info");
        }
        return true;
      }

      case "Target.createTarget": {
        log("INTERCEPT", `${method} (url: ${params?.url})`);
        // Return first existing page and emit attachedToTarget for it
        try {
          const targets = await fetchJSON("/json/list");
          const page = targets.find(t => t.type === "page" && t.url !== "about:blank")
            || targets.find(t => t.type === "page")
            || targets[0];
          if (page) {
            const sessId = `cdp-session-${page.id}`;
            await connectPageSession(sessId, page.id);

            respond({ targetId: page.id });

            // Emit attachedToTarget so Playwright creates the CRPage
            clientWs.send(JSON.stringify({
              method: "Target.attachedToTarget",
              params: {
                sessionId: sessId,
                targetInfo: {
                  targetId: page.id,
                  type: "page",
                  title: page.title || "",
                  url: page.url || "",
                  attached: true,
                  canAccessOpener: false,
                  browserContextId: DEFAULT_CONTEXT_ID,
                },
                waitingForDebugger: false,
              },
            }));
          } else {
            respondError(-32000, "No existing targets");
          }
        } catch {
          respondError(-32000, "Cannot list targets");
        }
        return true;
      }

      case "Target.activateTarget":
        log("INTERCEPT", method);
        respond({});
        return true;

      case "Target.closeTarget":
        log("INTERCEPT", method);
        respond({ success: true });
        return true;

      case "Target.attachToTarget": {
        const tid = params?.targetId;
        log("INTERCEPT", `${method} (${tid})`);
        const sessId = `cdp-session-${tid}`;
        await connectPageSession(sessId, tid);
        respond({ sessionId: sessId });
        return true;
      }

      case "Target.detachFromTarget": {
        const sid = params?.sessionId;
        log("INTERCEPT", `${method} (${sid})`);
        if (sid && sessions.has(sid)) {
          const s = sessions.get(sid);
          safeClose(s.ws, 1000);
          sessions.delete(sid);
          targetToSession.delete(s.targetId);
        }
        respond({});
        return true;
      }

      default:
        return undefined; // pass through
    }
  }
}

// ─── Start ───

httpServer.listen(SHIM_PORT, "127.0.0.1", () => {
  log("SHIM", `CDP Shim listening on http://localhost:${SHIM_PORT}`);
  log("SHIM", `Upstream: ${UPSTREAM}`);
  log("SHIM", `Connect Playwright: chromium.connectOverCDP("http://localhost:${SHIM_PORT}")`);
});
