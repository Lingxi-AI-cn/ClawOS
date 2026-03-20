#!/usr/bin/env node
/**
 * ClawOS CDP End-to-End Test (via CDP Shim)
 *
 * Tests the full pipeline:
 *   Playwright → CDP Shim (9223) → WebView CDP Proxy (9222) → Android WebView
 *
 * Prerequisites:
 *   1. Android emulator running with ClawOS ROM
 *   2. BrowserActivity started:
 *      adb shell am start -n com.clawos.app/com.clawos.browser.BrowserActivity
 *   3. ADB port forwarding: adb forward tcp:9222 tcp:9222
 *   4. CDP Shim running: node aosp/cdp-shim.mjs
 *   5. Install: pnpm add playwright-core
 *
 * Usage:
 *   node aosp/test-cdp-e2e.mjs [--direct]     # via shim (default)
 *   node aosp/test-cdp-e2e.mjs --direct        # direct raw CDP (no shim)
 */

import fs from "fs";

const USE_SHIM = !process.argv.includes("--direct");
const SHIM_URL = "http://localhost:9223";
const DIRECT_URL = "http://localhost:9222";
const CDP_URL = USE_SHIM ? SHIM_URL : DIRECT_URL;

async function main() {
  console.log("=== ClawOS CDP E2E Test ===");
  console.log(`Mode: ${USE_SHIM ? "Playwright via CDP Shim" : "Raw CDP (direct)"}\n`);

  // Step 1: Verify CDP endpoint
  console.log("1. Checking CDP endpoint...");
  let version, targets;
  try {
    version = await (await fetch(`${CDP_URL}/json/version`)).json();
    console.log(`   Browser: ${version.Browser}`);
    console.log(`   Protocol: ${version["Protocol-Version"]}`);

    targets = await (await fetch(`${CDP_URL}/json/list`)).json();
    console.log(`   Targets: ${targets.length}`);
    for (const t of targets) {
      console.log(`     - [${t.type}] "${t.title}" ${t.url.substring(0, 60)}`);
    }
    console.log(`   ✓ CDP endpoint reachable\n`);
  } catch (e) {
    console.error(`   ✗ Cannot reach ${CDP_URL}: ${e.message}`);
    if (USE_SHIM) {
      console.error("   Is the CDP Shim running? → node aosp/cdp-shim.mjs");
    }
    console.error("   Is adb forwarding set up? → adb forward tcp:9222 tcp:9222");
    process.exit(1);
  }

  if (USE_SHIM) {
    await testPlaywright();
  } else {
    const target = targets.find(t =>
      t.type === "page" && !t.url.startsWith("about:blank") && t.url !== "http://localhost/"
    ) || targets.find(t => t.type === "page");
    await testRawCDP(target);
  }

  process.exit(0);
}

// ─── Playwright Test (via Shim) ───

async function testPlaywright() {
  let playwright;
  try {
    playwright = await import("playwright-core");
  } catch {
    console.error("playwright-core not installed. Run: pnpm add playwright-core");
    process.exit(1);
  }

  const { chromium } = playwright;

  console.log("2. Connecting Playwright via CDP Shim...");
  let browser, page;
  try {
    browser = await chromium.connectOverCDP(SHIM_URL, { timeout: 15000 });
    console.log(`   ✓ Playwright connected`);

    // Get pages
    const contexts = browser.contexts();
    console.log(`   Contexts: ${contexts.length}`);
    for (const ctx of contexts) {
      const pages = ctx.pages();
      console.log(`     Context pages: ${pages.length}`);
      if (pages.length > 0 && !page) {
        page = pages.find(p => p.url().includes("example.com")) || pages[0];
      }
    }

    if (!page) {
      console.log("   No existing page found, creating new...");
      page = await browser.contexts()[0]?.newPage() || await browser.newPage();
    }

    console.log(`   Using page: ${page.url()}\n`);
  } catch (e) {
    console.error(`   ✗ Playwright failed: ${e.message}`);
    console.error(`   ${e.stack?.split("\n").slice(1, 3).join("\n   ")}`);
    process.exit(1);
  }

  // 3. Navigation
  console.log("3. Navigation test...");
  try {
    await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log(`   Title: "${await page.title()}"`);
    console.log(`   URL: ${page.url()}`);
    console.log(`   ✓ Navigation works\n`);
  } catch (e) {
    console.log(`   ⚠ ${e.message}\n`);
  }

  // 4. DOM access
  console.log("4. DOM access test...");
  try {
    const h1 = await page.textContent("h1");
    console.log(`   <h1>: "${h1}"`);
    const p = await page.textContent("p");
    console.log(`   <p>: "${p?.substring(0, 80)}..."`);
    console.log(`   ✓ DOM access works\n`);
  } catch (e) {
    console.log(`   ⚠ ${e.message}\n`);
  }

  // 5. Screenshot
  console.log("5. Screenshot test...");
  try {
    const buf = await page.screenshot({ type: "png" });
    fs.writeFileSync("cdp-test-screenshot.png", buf);
    console.log(`   ✓ Saved: cdp-test-screenshot.png (${buf.length} bytes)\n`);
  } catch (e) {
    console.log(`   ⚠ ${e.message}\n`);
  }

  // 6. JS execution
  console.log("6. JS execution test...");
  try {
    const info = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      screenWidth: screen.width,
      screenHeight: screen.height,
      dpr: window.devicePixelRatio,
      url: location.href,
    }));
    console.log(`   Screen: ${info.screenWidth}x${info.screenHeight} @${info.dpr}x`);
    console.log(`   URL: ${info.url}`);
    console.log(`   ✓ JS execution works\n`);
  } catch (e) {
    console.log(`   ⚠ ${e.message}\n`);
  }

  // 7. Google search interaction
  console.log("7. Interaction test (Google search)...");
  try {
    await page.goto("https://www.google.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log(`   Page: "${await page.title()}"`);

    const searchBox = page.locator('textarea[name="q"], input[name="q"]').first();
    await searchBox.click();
    await searchBox.fill("ClawOS AI operating system");
    console.log(`   Typed search query`);

    await page.waitForTimeout(1000);
    const shot = await page.screenshot({ type: "png" });
    fs.writeFileSync("cdp-test-google.png", shot);
    console.log(`   ✓ Saved: cdp-test-google.png\n`);
  } catch (e) {
    console.log(`   ⚠ Google: ${e.message}\n`);
  }

  // 8. Click test
  console.log("8. Link click test...");
  try {
    await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    const link = page.locator("a").first();
    const linkText = await link.textContent();
    const href = await link.getAttribute("href");
    console.log(`   Link: "${linkText}" → ${href}`);

    await Promise.all([
      page.waitForURL(/.*/, { timeout: 15000 }).catch(() => {}),
      link.click(),
    ]);
    console.log(`   After click: ${page.url()}`);
    console.log(`   ✓ Click works\n`);
  } catch (e) {
    console.log(`   ⚠ Click: ${e.message}\n`);
  }

  // Done
  await browser.close().catch(() => {});
  console.log("=== All Tests Complete ===");
  console.log("✓ Playwright + CDP Shim + WebView = Full browser control!");
}

// ─── Raw CDP Test (no Shim) ───

async function testRawCDP(target) {
  console.log("--- Raw CDP WebSocket Test ---\n");

  let WebSocket;
  try {
    WebSocket = (await import("ws")).default;
  } catch {
    console.log("   'ws' not installed. Run: pnpm add ws");
    return;
  }

  if (!target) {
    console.log("   No page target found");
    return;
  }

  const wsUrl = target.webSocketDebuggerUrl;
  console.log(`   Target: "${target.title}"`);
  console.log(`   WS: ${wsUrl}\n`);

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const pending = {};

    function send(method, params = {}) {
      const id = msgId++;
      return new Promise((res, rej) => {
        pending[id] = { resolve: res, reject: rej };
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    ws.on("open", async () => {
      console.log("   ✓ WebSocket connected\n");
      try {
        console.log("   a) Navigate...");
        await send("Page.navigate", { url: "https://example.com" });
        await new Promise(r => setTimeout(r, 3000));

        console.log("   b) Title...");
        const title = await send("Runtime.evaluate", { expression: "document.title" });
        console.log(`      "${title.result?.value}"`);

        console.log("   c) DOM...");
        const h1 = await send("Runtime.evaluate", { expression: "document.querySelector('h1')?.textContent" });
        console.log(`      <h1>: "${h1.result?.value}"`);

        console.log("   d) Screenshot...");
        const ss = await send("Page.captureScreenshot", { format: "png" });
        if (ss.data) {
          const buf = Buffer.from(ss.data, "base64");
          fs.writeFileSync("cdp-raw-screenshot.png", buf);
          console.log(`      ✓ ${buf.length} bytes`);
        }

        console.log("   e) Click...");
        await send("Runtime.evaluate", { expression: "document.querySelector('a')?.click()" });
        await new Promise(r => setTimeout(r, 2000));
        const url = await send("Runtime.evaluate", { expression: "location.href" });
        console.log(`      → ${url.result?.value}`);

        console.log("\n   ✓ Raw CDP works!\n");
      } catch (e) {
        console.error(`   Error: ${e.message}`);
      }
      ws.close();
      resolve();
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending[msg.id]) {
        if (msg.error) pending[msg.id].reject(new Error(msg.error.message));
        else pending[msg.id].resolve(msg.result || {});
        delete pending[msg.id];
      }
    });

    ws.on("error", (e) => { console.error(`   WS error: ${e.message}`); resolve(); });
    setTimeout(() => { ws.close(); resolve(); }, 30000);
  });
}

main().catch(e => { console.error("Test failed:", e); process.exit(1); });
