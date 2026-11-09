import { describe, expect, it, vi } from "vitest";
import { openTester, type SerialPortLike } from "./mark10Serial";

// =============================================================================
// The Web Serial read loop, against a fake port (jsdom has no serial port):
//  - lines split across chunks come out whole;
//  - "Read now" writes "?" + CR, the WT-205's "request the displayed reading";
//  - the port opens at the tester's fixed 8N1 and the chosen baud;
//  - a read that fails (cable pulled) is reported, a close() is not.
// =============================================================================

function fakePort(chunks: string[], failAfter = false) {
  const enc = new TextEncoder();
  const queue = chunks.map((c) => enc.encode(c));
  let release: () => void = () => undefined;
  const written: string[] = [];
  const port: SerialPortLike & { opened?: unknown; closed: boolean } = {
    closed: false,
    readable: {
      getReader: () => ({
        read: () =>
          queue.length
            ? Promise.resolve({ value: queue.shift(), done: false })
            : failAfter
              ? Promise.reject(Object.assign(new Error("The device has been lost."), { name: "NetworkError" }))
              : new Promise((resolve) => {
                  release = () => resolve({ done: true });
                }),
        cancel: async () => release(),
        releaseLock: () => undefined,
      }),
    },
    writable: {
      getWriter: () => ({
        write: async (chunk: Uint8Array) => {
          written.push(new TextDecoder().decode(chunk));
        },
        releaseLock: () => undefined,
      }),
    },
    open: async (options) => {
      port.opened = options;
    },
    close: async () => {
      port.closed = true;
    },
  };
  return { port, written };
}

describe("openTester", () => {
  it("opens at 8N1 and hands over whole lines however they arrive", async () => {
    const { port } = fakePort(["24.", "8 lbF\r", "\n30.2 lbF\r\n31", ".0 lbF\r\n"]);
    const lines: string[] = [];
    const conn = await openTester(port, 19200, { onLine: (l) => lines.push(l), onError: vi.fn() });
    await vi.waitFor(() => expect(lines).toEqual(["24.8 lbF", "30.2 lbF", "31.0 lbF"]));
    expect(port.opened).toEqual({ baudRate: 19200, dataBits: 8, stopBits: 1, parity: "none" });
    await conn.close();
    expect(port.closed).toBe(true);
  });

  it("sends ? and CR to ask for a reading", async () => {
    const { port, written } = fakePort([]);
    const conn = await openTester(port, 9600, { onLine: vi.fn(), onError: vi.fn() });
    await conn.requestReading();
    expect(written).toEqual(["?\r"]);
    await conn.close();
  });

  it("reports a lost tester, but not its own close", async () => {
    const lost = fakePort(["24.8 lbF\r\n"], true);
    const onError = vi.fn();
    await openTester(lost.port, 9600, { onLine: vi.fn(), onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));

    const quiet = fakePort([]);
    const onError2 = vi.fn();
    const conn = await openTester(quiet.port, 9600, { onLine: vi.fn(), onError: onError2 });
    await conn.close();
    expect(onError2).not.toHaveBeenCalled();
  });
});
