// Screenshot one element of the RUNNING dev server, signed in as the demo
// user, so a UI change can be checked by eye rather than only by tests.
//
//   npm run dev                       (or: VITE_USE_MOCK=true npx vite --port 5180)
//   node scripts/screenshot-page.mjs <url> <cssSelector> <out.png> [light|dark]
//
// e.g.
//   node scripts/screenshot-page.mjs http://localhost:5180/sales/pricing/request/3 \
//     '[data-testid="pricing-workbench"]' ./workbench.png dark
//
// It drives headless Chrome over the DevTools protocol (Node's built-in
// fetch + WebSocket — no Playwright/Puppeteer dependency): opens the app,
// presses "Continue as Demo User", routes to the page in-app, waits for the
// selector, and captures just that element. Mock mode only — it never signs
// in to Microsoft. CHROME_PATH overrides the browser location.

import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, selector, out, theme] = process.argv.slice(2);
if (!url || !selector || !out) {
  console.error("usage: node scripts/screenshot-page.mjs <url> <cssSelector> <out.png> [light|dark]");
  process.exit(2);
}

const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = mkdtempSync(join(tmpdir(), "arc-shot-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  // Port 0: Chrome picks a free one and writes it to DevToolsActivePort, so
  // two runs back to back never collide on a port the last Chrome still holds.
  "--remote-debugging-port=0",
  // SHOT_WIDTH checks a layout at another width (default 1300).
  `--window-size=${process.env.SHOT_WIDTH ?? "1300"},1600`,
  `--user-data-dir=${profile}`,
  "about:blank",
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => {
  console.error(msg);
  chrome.kill();
  process.exit(1);
};

let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) {
  try {
    const port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0].trim();
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    wsUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {
    /* Chrome still starting */
  }
  await sleep(250);
}
if (!wsUrl) fail("Chrome didn't start — set CHROME_PATH?");

const sock = new WebSocket(wsUrl);
await new Promise((r) => sock.addEventListener("open", r));
let nextId = 0;
const pending = new Map();
// Page errors are collected and printed at the end — a screenshot alone can't
// show why something didn't happen.
const pageErrors = [];
sock.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    pageErrors.push(`exception: ${d.exception?.description ?? d.text}`);
  }
  if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
    pageErrors.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
  }
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++nextId;
    pending.set(id, r);
    sock.send(JSON.stringify({ id, method, params }));
  });
const evalJs = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }))
    .result?.result?.value;

// Emulate the width rather than trust the window: headless Chrome won't open a
// window narrower than ~500px, so a phone width needs the DevTools override.
await send("Runtime.enable");
const width = Number(process.env.SHOT_WIDTH ?? "1300");
await send("Emulation.setDeviceMetricsOverride", { width, height: 1600, deviceScaleFactor: 1, mobile: width < 640 });

const target = new URL(url);
await send("Page.navigate", { url: `${target.origin}/` });
if (theme) {
  // useTheme's storage key — read when the app renders after sign-in.
  await sleep(500);
  await evalJs(`localStorage.setItem("aets-theme", ${JSON.stringify(theme)}); true`);
}
// The sign-in page appears only once MSAL has settled, so a single click on a
// timer is a race (it missed about half the time). Click until it's gone.
let signedIn = false;
for (let i = 0; i < 60 && !signedIn; i++) {
  await sleep(500);
  signedIn = await evalJs(`(() => {
    const demo = [...document.querySelectorAll("button")].find((b) => /Demo User/.test(b.textContent));
    if (demo) { demo.click(); return false; }
    return !!document.querySelector("header");
  })()`);
}
if (!signedIn) fail("Couldn't get past the sign-in page — is the dev server in mock mode?");
// Route in-app rather than reloading: the demo sign-in lives in memory.
await evalJs(
  `history.pushState({}, "", ${JSON.stringify(target.pathname + target.search)}); dispatchEvent(new PopStateEvent("popstate")); true`,
);

// SHOT_CLICK="Price calculator" presses that button first (by aria-label or
// text) — for a dialog or a menu that only exists once opened.
if (process.env.SHOT_CLICK) {
  await sleep(1500);
  const clicked = await evalJs(`(() => {
    const want = ${JSON.stringify(process.env.SHOT_CLICK)};
    const b = [...document.querySelectorAll("button, a")].find(
      (el) => el.offsetParent !== null && (el.getAttribute("aria-label") === want || el.textContent.trim() === want),
    );
    if (b) b.click();
    return !!b;
  })()`);
  if (!clicked) fail(`No visible button "${process.env.SHOT_CLICK}" to click.`);
}

// SHOT_TYPE='{"COGS":"12","GM wanted":"40"}' fills inputs by aria-label, the
// way React sees typing (the native value setter, then an input event).
if (process.env.SHOT_TYPE) {
  await sleep(500);
  await evalJs(`(() => {
    const values = ${process.env.SHOT_TYPE};
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    for (const [label, value] of Object.entries(values)) {
      const el = document.querySelector(\`input[aria-label="\${label}"]\`);
      if (!el) continue;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return true;
  })()`);
}

// SHOT_THEN_CLICK="Look up" presses a second button AFTER the typing — for a
// form that does something once filled in. SHOT_WAIT_MS waits for the result.
if (process.env.SHOT_THEN_CLICK) {
  await sleep(500);
  const clicked = await evalJs(`(() => {
    const want = ${JSON.stringify(process.env.SHOT_THEN_CLICK)};
    const b = [...document.querySelectorAll("button, a")].find(
      (el) => el.offsetParent !== null && (el.getAttribute("aria-label") === want || el.textContent.trim() === want),
    );
    if (b) b.click();
    return b ? (b.disabled ? "disabled" : "clicked") : "";
  })()`);
  if (!clicked) fail(`No visible button "${process.env.SHOT_THEN_CLICK}" to click after typing.`);
  if (clicked === "disabled") console.log(`note: "${process.env.SHOT_THEN_CLICK}" was disabled when pressed`);
}
if (process.env.SHOT_WAIT_MS) await sleep(Number(process.env.SHOT_WAIT_MS));

let rect = null;
for (let i = 0; i < 60 && !rect; i++) {
  await sleep(500);
  rect = await evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView();
    const r = el.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
  })()`);
}
if (!rect) {
  const full = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(full.result.data, "base64"));
  fail(`"${selector}" never appeared at ${await evalJs("location.href")} — saved the whole page to ${out}`);
}
// The app header is sticky; un-stick it so it can't sit over the capture.
await evalJs(`document.querySelectorAll("header").forEach((h) => { h.style.position = "static"; }); true`);
await sleep(800);
rect = await evalJs(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  const r = el.getBoundingClientRect();
  return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
})()`);
const shot = await send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: true,
  clip: { ...rect, scale: 1 },
});
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
// The house rule is no sideways page scroll — say so when there is one.
const overflow = await evalJs(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
console.log(`saved ${out}${overflow > 0 ? ` — WARNING: the page scrolls sideways by ${overflow}px` : ""}`);
for (const e of pageErrors) console.log(`page ${e}`);
chrome.kill();
process.exit(0);
