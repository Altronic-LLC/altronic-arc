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
  "--window-size=1300,1600",
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
sock.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
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
await sleep(800);
const shot = await send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: true,
  clip: { ...rect, scale: 1 },
});
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log(`saved ${out}`);
chrome.kill();
process.exit(0);
