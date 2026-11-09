import { MARK10_READ_COMMAND, takeLines } from "@/lib/mark10";

// =============================================================================
// The Mark-10 WT-205 pull tester over USB, from the browser (BusinessIT#64).
//
// The tester's USB port is a serial port once Mark-10's USB driver is
// installed (WT-205 User's Guide §3.2), and Chrome and Edge can open a serial
// port from a web page — the Web Serial API. So ARC reads the tester directly,
// with no helper program and no server: the bench PC's browser IS the reader.
//
// What that means in practice:
//  - Chrome or Edge on a COMPUTER, over https (GitHub Pages is). Not Firefox,
//    not Safari, not a phone or iPad — `serialSupported()` says so and the form
//    falls back to typing.
//  - The first time, the person picks the port from the browser's own chooser
//    (a click is required). After that the browser remembers the grant, so
//    `grantedPorts()` can reopen it without asking.
//  - One program at a time: if Mark-10's MESUR software or another ARC tab
//    has the port open, opening it here fails, and the error says why.
//
// The Web Serial types aren't in TypeScript's DOM library, so the little of
// the API used here is declared locally rather than augmenting the global
// Navigator — a later DOM lib that adds them must not collide.
// =============================================================================

interface SerialReaderLike {
  read(): Promise<{ value?: Uint8Array; done: boolean }>;
  cancel(): Promise<void>;
  releaseLock(): void;
}

interface SerialWriterLike {
  write(chunk: Uint8Array): Promise<void>;
  releaseLock(): void;
}

export interface SerialPortLike {
  readable: { getReader(): SerialReaderLike } | null;
  writable: { getWriter(): SerialWriterLike } | null;
  open(options: { baudRate: number; dataBits?: number; stopBits?: number; parity?: string }): Promise<void>;
  close(): Promise<void>;
}

interface SerialLike {
  requestPort(options?: unknown): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

function serial(): SerialLike | null {
  if (typeof navigator === "undefined") return null;
  return ((navigator as unknown as { serial?: SerialLike }).serial ?? null) as SerialLike | null;
}

/** Can this browser read the tester at all? */
export function serialSupported(): boolean {
  const secure = typeof window === "undefined" || window.isSecureContext !== false;
  return secure && serial() !== null;
}

/** Ports this site was given before — reopened without asking. */
export async function grantedPorts(): Promise<SerialPortLike[]> {
  const s = serial();
  return s ? s.getPorts() : [];
}

/** The browser's port chooser. Must be called from a click. */
export async function choosePort(): Promise<SerialPortLike> {
  const s = serial();
  if (!s) throw new Error("This browser can't read serial ports. Use Chrome or Edge on a computer.");
  return s.requestPort();
}

export interface TesterHandlers {
  /** One whole line from the tester, trimmed. */
  onLine: (line: string) => void;
  /** The read loop failed — unplugged, or the port was taken away. Not called after close(). */
  onError: (err: unknown) => void;
}

export interface TesterConnection {
  /** Ask for the displayed reading ("?"); the answer arrives through onLine. */
  requestReading: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Open the port at the tester's settings (8 data bits, 1 stop bit, no parity —
 * fixed on the WT-205; the baud rate is set on the tester) and hand each line
 * to `onLine` until closed.
 */
export async function openTester(port: SerialPortLike, baudRate: number, handlers: TesterHandlers): Promise<TesterConnection> {
  await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: "none" });
  if (!port.readable) {
    await port.close().catch(() => undefined);
    throw new Error("The tester's port opened but can't be read.");
  }

  let closing = false;
  const reader = port.readable.getReader();
  const decoder = new TextDecoder();

  const loop = (async () => {
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const { lines, rest } = takeLines(buffer);
          buffer = rest;
          lines.forEach((line) => handlers.onLine(line));
        }
      }
    } catch (err) {
      if (!closing) handlers.onError(err);
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Already released.
      }
    }
  })();

  return {
    async requestReading() {
      if (!port.writable) throw new Error("The tester's port can't be written to.");
      const writer = port.writable.getWriter();
      try {
        await writer.write(new TextEncoder().encode(MARK10_READ_COMMAND));
      } finally {
        writer.releaseLock();
      }
    },
    async close() {
      closing = true;
      await reader.cancel().catch(() => undefined);
      await loop;
      await port.close().catch(() => undefined);
    },
  };
}
