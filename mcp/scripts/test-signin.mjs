// =============================================================================
// ARC MCP — desktop sign-in prerequisite check
//
// Signs in the way the MCP server will (msal-node, the system browser, a
// loopback redirect on a RANDOM localhost port), then reads /me and one
// item from the Task list. One run answers three questions:
//
//   1. Is "http://localhost" registered under the app's "Mobile and desktop
//      applications" platform?  (The SPA http://localhost:5173/ entry the dev
//      server uses does NOT count — Entra only lets a browser redeem SPA
//      codes, and SPA ports must match exactly.)
//        not registered → the browser shows AADSTS50011 and this times out
//   2. Does Conditional Access allow a desktop sign-in for this app?
//        blocked        → AADSTS53xxx
//   3. Does the existing Sites.Selected grant work from a desktop client?
//        refused        → the Task list read returns 403
//
// Usage (from the repo root):
//   cd mcp && npm install && npm run test-signin
//
// Reads VITE_AZURE_CLIENT_ID, VITE_AZURE_TENANT_ID, VITE_SP_SITE_ID and
// VITE_SP_LIST_ID from the environment, falling back to the repo's
// .env.local. Nothing is cached or written: the token lives in memory for
// the length of the run.
// =============================================================================

import { PublicClientApplication } from "@azure/msal-node";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ENV_FILE = fileURLToPath(new URL("../../.env.local", import.meta.url));
const TIMEOUT_MS = 120_000;

function loadEnv() {
  const fromFile = existsSync(ENV_FILE)
    ? Object.fromEntries(
        readFileSync(ENV_FILE, "utf8")
          .split(/\r?\n/)
          .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
          .filter(Boolean)
          .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
      )
    : {};
  const pick = (key) => process.env[key] || fromFile[key];
  const env = {
    clientId: pick("VITE_AZURE_CLIENT_ID"),
    tenantId: pick("VITE_AZURE_TENANT_ID"),
    siteId: pick("VITE_SP_SITE_ID"),
    listId: pick("VITE_SP_LIST_ID"),
  };
  const missing = Object.entries(env).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.error(
      `Missing ${missing.join(", ")}. Set the VITE_* variables, or create ${ENV_FILE}.`,
    );
    process.exit(2);
  }
  return env;
}

// Opens the default browser without a shell, so the "&"s in the sign-in URL
// can't be read as command separators.
async function openBrowser(url) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

function explainFailure(message) {
  if (message === "TIMEOUT") {
    return (
      "No redirect reached this script. If the browser showed AADSTS50011, the\n" +
      "'Mobile and desktop applications' http://localhost redirect is NOT registered yet."
    );
  }
  if (/AADSTS50011/.test(message)) {
    return "Redirect URI mismatch: add http://localhost under 'Mobile and desktop applications'.";
  }
  if (/AADSTS9002327/.test(message)) {
    return "Only an SPA redirect matched: add http://localhost under 'Mobile and desktop applications'.";
  }
  if (/AADSTS53\d{3}/.test(message)) {
    return "Conditional Access blocked the desktop sign-in: that's an IT policy question.";
  }
  if (/AADSTS65001/.test(message)) {
    return "Consent is missing for one of the scopes (User.Read, Sites.Selected).";
  }
  return "";
}

const { clientId, tenantId, siteId, listId } = loadEnv();
const pca = new PublicClientApplication({
  auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` },
});

console.log("Opening the browser for sign-in (waiting up to 2 minutes)...");
let result;
try {
  result = await Promise.race([
    pca.acquireTokenInteractive({
      scopes: ["User.Read", "Sites.Selected"],
      openBrowser,
      prompt: "select_account",
      successTemplate: "<h2>ARC MCP sign-in test: signed in. You can close this tab.</h2>",
      errorTemplate: "<h2>ARC MCP sign-in test failed: {error}</h2>",
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), TIMEOUT_MS)),
  ]);
} catch (err) {
  const message = String(err?.errorMessage || err?.message || err);
  console.error(`\nFAIL (1/3): sign-in did not complete.\n${message}`);
  const hint = explainFailure(message);
  if (hint) console.error(`\n${hint}`);
  process.exit(1);
}

console.log(`\nPASS (1/3, 2/3): signed in as ${result.account?.username} from a desktop client.`);

async function graphGet(path) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${result.accessToken}` },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const me = await graphGet("/me?$select=displayName,mail");
console.log(`/me -> ${me.status} ${me.body.displayName ?? ""} <${me.body.mail ?? ""}>`);

const tasks = await graphGet(
  `/sites/${siteId}/lists/${listId}/items?$top=1&$expand=fields($select=Title,NumberedTitle)`,
);
const first = tasks.body.value?.[0]?.fields;
console.log(
  `Task list -> ${tasks.status}${first ? `  first item: ${first.NumberedTitle ?? first.Title}` : ""}`,
);
if (tasks.status === 200) {
  console.log("\nPASS (3/3): Sites.Selected works from a desktop client — the existing site grants carry over.");
  process.exit(0);
}
console.error(
  `\nFAIL (3/3): signed in, but the Task list read was refused (${tasks.body.error?.code ?? tasks.status}).\n` +
    "Check the Sites.Selected consent and the site grant.",
);
process.exit(1);
