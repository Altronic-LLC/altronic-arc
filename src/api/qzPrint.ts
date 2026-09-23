import qz from "qz-tray";
import { PANEL_QC_LABEL_PRINTER_NAME, QZ_CERTIFICATE, QZ_PRIVATE_KEY } from "./config";

// =============================================================================
// QZ Tray integration — silent, direct-to-printer printing for a specific
// named printer, bypassing the browser's print dialog entirely.
//
// A browser page CANNOT enumerate real printers, check whether one is
// online, or print to it without the OS print dialog — that's a deliberate
// browser security boundary, not something any amount of JS gets around.
// QZ Tray is a locally-installed helper app (https://qz.io) that runs a
// small WebSocket server on the machine; THIS module is the browser side of
// that connection.
//
// **Signed when VITE_QZ_CERTIFICATE / VITE_QZ_PRIVATE_KEY are set, unsigned
// otherwise.** QZ Tray can cryptographically verify every request came from
// a specific certificate, so it never has to ask the user to trust the
// connection — but signing needs a private key, and ARC has no backend to
// keep one off the client. The decision (Ray, 2026-09-09, after deferring it
// on 2026-09-08): a SELF-SIGNED cert with the key embedded in the public
// bundle, over standing up a signing endpoint. That key is genuinely
// extractable by anyone who fetches the bundle — GitHub Pages serves it to
// anyone on the internet, Entra sign-in only gates using the APP, not
// fetching the JS file — but a self-signed cert is only ever trusted by a
// machine Cooper has specifically configured to trust THIS cert (a clicked
// "Always allow", or an IT-deployed override file), so the exposure's blast
// radius stays bounded to machines Cooper controls. See CLAUDE.md's QZ Tray
// section for the full trade-off against a signing endpoint.
//
// Both env vars unset (the default) means every request goes out unsigned,
// exactly as the feature originally shipped: QZ Tray shows its own native
// "Allow this site to print?" prompt the first time on each machine, with a
// "remember this" option, and nothing else changes.
//
// **Always degrades to false, never throws.** Every caller of
// `printPanelQcLabelSilently` treats a `false` return as "fall back to
// window.print()" — QZ Tray not being installed, the configured printer
// name not matching anything currently available, or the print call itself
// failing are all treated identically: the browser dialog is what the user
// already knows how to use, and NEVER showing them ANYTHING (dialog or
// silent print) is the one outcome this module must not produce.
// =============================================================================

// A silent-print attempt must NEVER be able to hang the caller — the whole
// point is "try it, or fall back to the print dialog", and the ONE thing
// worse than no silent printing is a print tab that never shows anything at
// all because it's still waiting. ARC is served over HTTPS (GitHub Pages),
// and qz-tray's connect attempt can include an insecure `ws://` candidate
// alongside the secure `wss://` one — a browser blocking that as mixed
// content doesn't always surface as a rejection; the connect promise can
// simply never settle. `withTimeout` is the backstop for that (and for a
// printer that's on the network but not actually responding).
const SILENT_PRINT_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// =============================================================================
// Signing — RSA-SHA512, via the browser's native Web Crypto API rather than
// a signing library (jsrsasign, node-forge, …): a PKCS8 private key is
// exactly what `crypto.subtle.importKey("pkcs8", …)` wants, so no extra
// dependency earns its ~100–300KB for something the platform already does.
// =============================================================================

function pemToDer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN [\s\S]+?-----/, "")
    .replace(/-----END [\s\S]+?-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Imported once, lazily, and reused — importKey is real work QZ Tray's
// signature callback shouldn't repeat on every single print.
let signingKey: Promise<CryptoKey> | null = null;

function getSigningKey(): Promise<CryptoKey> {
  if (!signingKey) {
    signingKey = !QZ_PRIVATE_KEY
      ? Promise.reject(new Error("QZ_PRIVATE_KEY is not configured"))
      : crypto.subtle.importKey(
          "pkcs8",
          pemToDer(QZ_PRIVATE_KEY),
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" },
          false,
          ["sign"],
        );
  }
  return signingKey;
}

let securityConfigured = false;

/**
 * Registers this cert + private key with QZ Tray so a machine that already
 * trusts the cert (a clicked "Always allow", or an IT-deployed override
 * file) never sees the unsigned flow's per-machine prompt at all. A no-op
 * whenever either half is unset — everything stays exactly as unsigned as
 * before. Called once, before the first connect, since that's when QZ Tray
 * actually asks for the certificate.
 */
function configureQzSecurity(): void {
  if (securityConfigured || !QZ_CERTIFICATE || !QZ_PRIVATE_KEY) return;
  securityConfigured = true;
  // Re-typed as plain `string` locals: the closures below outlive this
  // function call, and TS doesn't carry the truthiness narrowing above
  // across that boundary for the module-level `string | undefined` bindings.
  const certificate: string = QZ_CERTIFICATE;
  qz.security.setCertificatePromise((resolve: (cert: string) => void) => resolve(certificate));
  // Must match the hash importKey used above — QZ Tray sends the same
  // `toSign` string regardless, but verifies against whichever algorithm
  // this call declares.
  qz.security.setSignatureAlgorithm("SHA512");
  qz.security.setSignaturePromise(
    (toSign: string) => (resolve: (sig: string) => void, reject: (err: unknown) => void) => {
      getSigningKey()
        .then((key) => crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(toSign)))
        .then((sig) => resolve(bufferToBase64(sig)))
        .catch(reject);
    },
  );
}

let connecting: Promise<void> | null = null;

async function ensureConnected(): Promise<void> {
  configureQzSecurity();
  if (qz.websocket.isActive()) return;
  if (!connecting) {
    // No retries: this is a same-machine localhost connection, so a failure
    // means QZ Tray genuinely isn't running right now, not a network blip
    // worth waiting out.
    connecting = qz.websocket.connect({ retries: 0 }).catch((err: unknown) => {
      connecting = null;
      throw err;
    });
  }
  // Awaited rather than returned directly: `connecting` is a mutable
  // module-level variable reassigned inside the `.catch` closure above, so
  // TS can't narrow it back to non-null at this point even though it
  // can't actually be null here (the assignment above is synchronous).
  await connecting;
}

export interface QzLabelSize {
  widthIn: number;
  heightIn: number;
}

/** The actual QZ sequence, with no timeout or error handling of its own — see `printHtmlSilently`. */
async function runSilentPrint(printerQuery: string, html: string, size: QzLabelSize): Promise<void> {
  await ensureConnected();
  // `find` resolves with the matching printer's real name if one is
  // currently available on the system QZ Tray is running on, and rejects
  // otherwise — exactly the "is it available" check this feature needs.
  const printerName: string = await qz.printers.find(printerQuery);
  const config = qz.configs.create(printerName, {
    size: { width: size.widthIn, height: size.heightIn },
    units: "in",
    margins: 0,
    scaleContent: true,
  });
  await qz.print(config, [
    {
      type: "pixel",
      format: "html",
      flavor: "plain",
      data: html,
      options: { pageWidth: size.widthIn, pageHeight: size.heightIn },
    },
  ]);
}

/**
 * Try to print the given self-contained HTML directly to whichever printer
 * `printerQuery` resolves to, silently, at `size`. Resolves `true` once QZ
 * Tray has accepted the job; resolves `false` (never rejects, and never
 * takes longer than `SILENT_PRINT_TIMEOUT_MS`) for every reason it
 * couldn't — QZ Tray not running, the named printer not currently found, or
 * the print call itself failing — so the caller can unconditionally fall
 * back to `window.print()`.
 *
 * Generic over printer name and label size so the same path serves both the
 * real Panel QC label (`printPanelQcLabelSilently`, fixed at 3"×2") and the
 * local dev test page (`DevQzPrintTestView`, whatever size the tester's own
 * printer actually takes) — the two must not drift into two copies of the
 * same QZ plumbing.
 */
export async function printHtmlSilently(
  printerQuery: string,
  html: string,
  size: QzLabelSize,
): Promise<boolean> {
  try {
    await withTimeout(
      runSilentPrint(printerQuery, html, size),
      SILENT_PRINT_TIMEOUT_MS,
      `QZ Tray didn't respond within ${SILENT_PRINT_TIMEOUT_MS}ms`,
    );
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[qzPrint] Couldn't print silently — falling back to the browser print dialog:", err);
    return false;
  }
}

/**
 * Try to print the given self-contained label HTML directly to
 * `PANEL_QC_LABEL_PRINTER_NAME`, silently, at the label's real 3"×2" size.
 * See `printHtmlSilently` for the full contract — this is a thin wrapper
 * that only supplies the Panel QC printer name and size.
 *
 * Was 2"×2" until 2026-09-09 — changed to 3"×2" after Ray confirmed that
 * size actually prints correctly on the real label printer (2"×2" was the
 * originally-assumed size; 3"×2" is what the hardware is actually loaded
 * with).
 */
export async function printPanelQcLabelSilently(html: string): Promise<boolean> {
  if (!PANEL_QC_LABEL_PRINTER_NAME) return false;
  return printHtmlSilently(PANEL_QC_LABEL_PRINTER_NAME, html, { widthIn: 3, heightIn: 2 });
}

/**
 * Resolves the real printer name QZ Tray matched `printerQuery` against, or
 * `null` if QZ Tray is running but nothing matched. Throws if QZ Tray
 * itself isn't reachable — deliberately NOT folded into the same "always
 * false" contract as `printHtmlSilently`, because the dev test page this
 * exists for (`DevQzPrintTestView`) needs to tell a tester "QZ Tray isn't
 * running" apart from "QZ Tray is running, but that name matched nothing" —
 * two different things to go fix. Still bounded by the same
 * `SILENT_PRINT_TIMEOUT_MS`, so a blocked/hanging connection attempt
 * surfaces as "isn't reachable" rather than a permanently spinning button.
 */
export async function checkQzPrinterAvailable(printerQuery: string): Promise<string | null> {
  await withTimeout(
    ensureConnected(),
    SILENT_PRINT_TIMEOUT_MS,
    `QZ Tray didn't respond within ${SILENT_PRINT_TIMEOUT_MS}ms`,
  );
  try {
    return await qz.printers.find(printerQuery);
  } catch {
    return null;
  }
}
