import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// qzPrint tests — QZ Tray is a real desktop app this suite can't install, so
// everything on `qz-tray` itself is a mock. What's worth pinning is the
// CONTRACT: printHtmlSilently/printPanelQcLabelSilently must never throw and
// must return false for every failure mode, checkQzPrinterAvailable must let
// a caller tell "QZ Tray isn't running" (throws) apart from "QZ Tray is
// running, nothing matched" (resolves null), and — added 2026-09-09 —
// configureQzSecurity must stay a complete no-op when signing isn't
// configured, and must register a GENUINELY WORKING signature callback (one
// that actually verifies against the cert) when it is.
// =============================================================================

const isActive = vi.hoisted(() => vi.fn());
const connect = vi.hoisted(() => vi.fn());
const findPrinter = vi.hoisted(() => vi.fn());
const configsCreate = vi.hoisted(() => vi.fn());
const printJob = vi.hoisted(() => vi.fn());
const setCertificatePromise = vi.hoisted(() => vi.fn());
const setSignatureAlgorithm = vi.hoisted(() => vi.fn());
const setSignaturePromise = vi.hoisted(() => vi.fn());

vi.mock("qz-tray", () => ({
  default: {
    websocket: { isActive, connect },
    printers: { find: findPrinter },
    configs: { create: configsCreate },
    print: printJob,
    security: { setCertificatePromise, setSignatureAlgorithm, setSignaturePromise },
  },
}));

const configMock = vi.hoisted(() => ({
  PANEL_QC_LABEL_PRINTER_NAME: undefined as string | undefined,
  QZ_CERTIFICATE: undefined as string | undefined,
  QZ_PRIVATE_KEY: undefined as string | undefined,
}));

vi.mock("./config", () => configMock);

/**
 * A fresh module instance per test. `ensureConnected` in qzPrint.ts keeps a
 * module-level `connecting` promise that deliberately never resets after a
 * successful connect (there's no reason to reconnect once QZ Tray is up) —
 * reusing one module instance across tests would let an earlier test's
 * successful connection silently skip `websocket.connect` in a later test
 * that expects it to be called (and to fail). `securityConfigured` is the
 * same kind of module-level latch, for the same reason.
 */
async function freshQzPrint() {
  vi.resetModules();
  return import("./qzPrint");
}

beforeEach(() => {
  isActive.mockReset().mockReturnValue(false);
  connect.mockReset().mockResolvedValue(undefined);
  findPrinter.mockReset();
  configsCreate.mockReset().mockReturnValue({ mockConfig: true });
  printJob.mockReset().mockResolvedValue(undefined);
  setCertificatePromise.mockReset();
  setSignatureAlgorithm.mockReset();
  setSignaturePromise.mockReset();
  configMock.PANEL_QC_LABEL_PRINTER_NAME = undefined;
  configMock.QZ_CERTIFICATE = undefined;
  configMock.QZ_PRIVATE_KEY = undefined;
});

describe("printHtmlSilently — the generic silent-print path", () => {
  it("connects, finds the printer by query, configures the given size, and prints", async () => {
    const { printHtmlSilently } = await freshQzPrint();
    findPrinter.mockResolvedValue("Zebra ZD410 (real name)");

    const ok = await printHtmlSilently("Zebra", "<div>label</div>", { widthIn: 1, heightIn: 0.5 });

    expect(ok).toBe(true);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(findPrinter).toHaveBeenCalledWith("Zebra");
    expect(configsCreate).toHaveBeenCalledWith(
      "Zebra ZD410 (real name)",
      expect.objectContaining({ size: { width: 1, height: 0.5 }, units: "in", margins: 0 }),
    );
    expect(printJob).toHaveBeenCalledWith(
      { mockConfig: true },
      [expect.objectContaining({ type: "pixel", format: "html", data: "<div>label</div>" })],
    );
  });

  it("skips reconnecting when the websocket is already active", async () => {
    const { printHtmlSilently } = await freshQzPrint();
    isActive.mockReturnValue(true);
    findPrinter.mockResolvedValue("Zebra ZD410");

    await printHtmlSilently("Zebra", "<div/>", { widthIn: 1, heightIn: 0.5 });

    expect(connect).not.toHaveBeenCalled();
  });

  it("never throws — resolves false when QZ Tray itself isn't reachable", async () => {
    const { printHtmlSilently } = await freshQzPrint();
    connect.mockRejectedValue(new Error("connection refused"));

    const ok = await printHtmlSilently("Zebra", "<div/>", { widthIn: 1, heightIn: 0.5 });

    expect(ok).toBe(false);
  });

  it("never throws — resolves false when the named printer can't be found", async () => {
    const { printHtmlSilently } = await freshQzPrint();
    findPrinter.mockRejectedValue(new Error("no printer matched"));

    const ok = await printHtmlSilently("Nonexistent", "<div/>", { widthIn: 1, heightIn: 0.5 });

    expect(ok).toBe(false);
  });

  it("never throws — resolves false when the print call itself fails", async () => {
    const { printHtmlSilently } = await freshQzPrint();
    findPrinter.mockResolvedValue("Zebra ZD410 (real name)");
    printJob.mockRejectedValue(new Error("printer offline"));

    const ok = await printHtmlSilently("Zebra", "<div/>", { widthIn: 1, heightIn: 0.5 });

    expect(ok).toBe(false);
  });

  it("never hangs — resolves false if QZ Tray's connect attempt never settles at all", async () => {
    // A blocked mixed-content `ws://` candidate from this HTTPS app can leave
    // the connect promise neither resolving nor rejecting — the exact
    // scenario `withTimeout` exists for. Without it, this test hangs the
    // whole run rather than failing cleanly.
    vi.useFakeTimers();
    try {
      const { printHtmlSilently } = await freshQzPrint();
      connect.mockReturnValue(new Promise<void>(() => {}));

      const result = printHtmlSilently("Zebra", "<div/>", { widthIn: 1, heightIn: 0.5 });
      await vi.advanceTimersByTimeAsync(10_000);

      expect(await result).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("checkQzPrinterAvailable", () => {
  it("resolves the real printer name when QZ Tray finds a match", async () => {
    const { checkQzPrinterAvailable } = await freshQzPrint();
    findPrinter.mockResolvedValue("Zebra ZD410 (real name)");

    expect(await checkQzPrinterAvailable("Zebra")).toBe("Zebra ZD410 (real name)");
  });

  it("resolves null — not a throw — when QZ Tray is running but nothing matches", async () => {
    const { checkQzPrinterAvailable } = await freshQzPrint();
    findPrinter.mockRejectedValue(new Error("no printer matched"));

    expect(await checkQzPrinterAvailable("Nonexistent")).toBeNull();
  });

  it("throws when QZ Tray itself isn't reachable — callers need to tell these apart", async () => {
    const { checkQzPrinterAvailable } = await freshQzPrint();
    connect.mockRejectedValue(new Error("connection refused"));

    await expect(checkQzPrinterAvailable("Zebra")).rejects.toThrow("connection refused");
  });

  it("never hangs — throws rather than waiting forever if connect never settles", async () => {
    vi.useFakeTimers();
    try {
      const { checkQzPrinterAvailable } = await freshQzPrint();
      connect.mockReturnValue(new Promise<void>(() => {}));

      const result = checkQzPrinterAvailable("Zebra");
      const assertion = expect(result).rejects.toThrow(/didn't respond/);
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("printPanelQcLabelSilently — the Panel QC wrapper", () => {
  it("returns false without attempting a connection when no printer is configured", async () => {
    configMock.PANEL_QC_LABEL_PRINTER_NAME = undefined;
    const { printPanelQcLabelSilently } = await freshQzPrint();

    const ok = await printPanelQcLabelSilently("<div/>");

    expect(ok).toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });

  it("prints at the label's real 3\"×2\" size using the configured printer name", async () => {
    configMock.PANEL_QC_LABEL_PRINTER_NAME = "Zebra ZD410";
    const { printPanelQcLabelSilently } = await freshQzPrint();
    findPrinter.mockResolvedValue("Zebra ZD410 (real name)");

    const ok = await printPanelQcLabelSilently("<div>label</div>");

    expect(ok).toBe(true);
    expect(findPrinter).toHaveBeenCalledWith("Zebra ZD410");
    expect(configsCreate).toHaveBeenCalledWith(
      "Zebra ZD410 (real name)",
      expect.objectContaining({ size: { width: 3, height: 2 } }),
    );
  });
});

function derToPem(der: ArrayBuffer, label: string): string {
  const bytes = new Uint8Array(der);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

describe("configureQzSecurity — signing", () => {
  // A real RSA keypair, generated fresh per test run via the SAME Web Crypto
  // API qzPrint.ts itself uses (this project's tsconfig has no Node types,
  // so node:crypto isn't an option here anyway) — not a fixture file, so
  // there's no temptation to reuse it as an actual cert anywhere. Only the
  // PRIVATE key needs to be genuinely valid PKCS8 (importKey rejects
  // anything else); QZ_CERTIFICATE is opaque to this module — it's handed
  // straight to QZ Tray unexamined — so a plain string stands in for it.
  let privateKeyPem: string;
  let publicKey: CryptoKey;

  beforeAll(async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-512" },
      true,
      ["sign", "verify"],
    );
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    privateKeyPem = derToPem(pkcs8, "PRIVATE KEY");
    publicKey = keyPair.publicKey;
  });

  it("never touches qz.security when signing isn't configured — the default", async () => {
    const { printHtmlSilently } = await freshQzPrint();
    findPrinter.mockResolvedValue("Zebra ZD410");

    await printHtmlSilently("Zebra", "<div/>", { widthIn: 1, heightIn: 0.5 });

    expect(setCertificatePromise).not.toHaveBeenCalled();
    expect(setSignatureAlgorithm).not.toHaveBeenCalled();
    expect(setSignaturePromise).not.toHaveBeenCalled();
  });

  it("registers the cert, SHA512, and a signature callback that produces a REAL verifiable signature", async () => {
    configMock.QZ_CERTIFICATE = "-----BEGIN CERTIFICATE-----\nfake for this test\n-----END CERTIFICATE-----";
    configMock.QZ_PRIVATE_KEY = privateKeyPem;
    const { printHtmlSilently } = await freshQzPrint();
    findPrinter.mockResolvedValue("Zebra ZD410");

    await printHtmlSilently("Zebra", "<div/>", { widthIn: 1, heightIn: 0.5 });

    // The certificate promise resolves with exactly the configured cert.
    expect(setCertificatePromise).toHaveBeenCalledTimes(1);
    const certResolve = vi.fn();
    setCertificatePromise.mock.calls[0][0](certResolve);
    expect(certResolve).toHaveBeenCalledWith(configMock.QZ_CERTIFICATE);

    expect(setSignatureAlgorithm).toHaveBeenCalledWith("SHA512");

    // The signature callback: QZ Tray calls it with the string to sign, gets
    // back a (resolve, reject) executor (the qz-tray Promise-constructor
    // shape), and the base64 it resolves with must ACTUALLY verify against
    // the public half of the key — proof this signs for real, not just that
    // it returns some base64-looking string.
    expect(setSignaturePromise).toHaveBeenCalledTimes(1);
    const toSign = "some-qz-tray-request-payload";
    const executor = setSignaturePromise.mock.calls[0][0](toSign);
    const sigResolve = vi.fn();
    const sigReject = vi.fn();
    executor(sigResolve, sigReject);
    await vi.waitFor(() => expect(sigResolve).toHaveBeenCalled());
    expect(sigReject).not.toHaveBeenCalled();

    const signatureBase64: string = sigResolve.mock.calls[0][0];
    const signatureBytes = Uint8Array.from(atob(signatureBase64), (c) => c.charCodeAt(0));
    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      signatureBytes,
      new TextEncoder().encode(toSign),
    );
    expect(verified).toBe(true);
  });

  it("configures security only once, even across multiple print attempts", async () => {
    configMock.QZ_CERTIFICATE = "cert";
    configMock.QZ_PRIVATE_KEY = privateKeyPem;
    const { printHtmlSilently } = await freshQzPrint();
    findPrinter.mockResolvedValue("Zebra ZD410");

    await printHtmlSilently("Zebra", "<div/>", { widthIn: 1, heightIn: 0.5 });
    await printHtmlSilently("Zebra", "<div/>", { widthIn: 1, heightIn: 0.5 });

    expect(setCertificatePromise).toHaveBeenCalledTimes(1);
  });
});
