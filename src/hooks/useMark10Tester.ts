import { useCallback, useEffect, useRef, useState } from "react";
import {
  choosePort,
  grantedPorts,
  openTester,
  serialSupported,
  type SerialPortLike,
  type TesterConnection,
} from "@/api/mark10Serial";
import { DEFAULT_MARK10_BAUD, describeSerialError, MARK10_BAUD_RATES, parseMark10Line } from "@/lib/mark10";
import type { ForceUnit } from "@/types/pullTest";

// =============================================================================
// The Mark-10 pull tester, for a form that's open (BusinessIT#64).
//
// - Unsupported browser → status "unsupported"; the form says so and the
//   readings are typed.
// - The port is opened when the person presses Connect (the browser's chooser
//   needs a click), and REOPENED BY ITSELF the next time a form opens, when the
//   browser remembers exactly one granted port — so on the bench PC it's
//   connect once, then just pull.
// - It's closed when the form closes. Only one program can hold the port, and
//   leaving it open would lock out MESUR and the next form alike.
// - Every line goes through parseMark10Line; a line that isn't a reading is
//   reported (`problem`), never guessed into a number.
// - The baud rate must match the tester's (Serial/USB Settings → Baud Rate),
//   so it's a choice, remembered in THIS browser.
// =============================================================================

export type TesterStatus = "unsupported" | "disconnected" | "connecting" | "connected";

export interface TesterReading {
  value: number;
  /** Null when the tester is set to "Numeric Only". */
  unit: ForceUnit | null;
}

const BAUD_KEY = "arc-mark10-baud";

function readBaud(): number {
  try {
    const n = Number(localStorage.getItem(BAUD_KEY));
    return (MARK10_BAUD_RATES as readonly number[]).includes(n) ? n : DEFAULT_MARK10_BAUD;
  } catch {
    return DEFAULT_MARK10_BAUD;
  }
}

function saveBaud(rate: number) {
  try {
    localStorage.setItem(BAUD_KEY, String(rate));
  } catch {
    // A lost preference is the status quo; nothing to report.
  }
}

export function useMark10Tester(onReading: (reading: TesterReading) => void) {
  const supported = serialSupported();
  const [status, setStatus] = useState<TesterStatus>(supported ? "disconnected" : "unsupported");
  const [problem, setProblem] = useState<string | null>(null);
  const [baud, setBaudState] = useState(readBaud);

  const conn = useRef<TesterConnection | null>(null);
  const port = useRef<SerialPortLike | null>(null);
  const mounted = useRef(true);
  const onReadingRef = useRef(onReading);
  onReadingRef.current = onReading;

  /** One line, from the tester or the demo's simulate button. */
  const feedLine = useCallback((line: string) => {
    const parsed = parseMark10Line(line);
    if (parsed.ok) {
      setProblem(null);
      onReadingRef.current({ value: parsed.value, unit: parsed.unit });
    } else {
      setProblem(parsed.reason);
    }
  }, []);

  const open = useCallback(
    async (p: SerialPortLike, rate: number) => {
      setStatus("connecting");
      setProblem(null);
      try {
        const c = await openTester(p, rate, {
          onLine: feedLine,
          onError: (err) => {
            conn.current = null;
            if (!mounted.current) return;
            setStatus("disconnected");
            setProblem(describeSerialError(err));
          },
        });
        if (!mounted.current) {
          await c.close();
          return;
        }
        conn.current = c;
        port.current = p;
        setStatus("connected");
      } catch (err) {
        if (!mounted.current) return;
        setStatus("disconnected");
        setProblem(describeSerialError(err));
      }
    },
    [feedLine],
  );

  // Reopen a port this browser was given before — once, when the form opens.
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    if (supported) {
      grantedPorts()
        .then((ports) => {
          if (!cancelled && ports.length === 1 && !conn.current) void open(ports[0], readBaud());
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
      mounted.current = false;
      const c = conn.current;
      conn.current = null;
      void c?.close();
    };
  }, [supported, open]);

  const connect = useCallback(async () => {
    if (conn.current) return;
    let chosen: SerialPortLike;
    try {
      chosen = await choosePort();
    } catch (err) {
      const message = describeSerialError(err);
      if (message) setProblem(message);
      return;
    }
    await open(chosen, baud);
  }, [baud, open]);

  const disconnect = useCallback(async () => {
    const c = conn.current;
    conn.current = null;
    setStatus("disconnected");
    await c?.close();
  }, []);

  const requestReading = useCallback(async () => {
    try {
      await conn.current?.requestReading();
    } catch (err) {
      setProblem(describeSerialError(err));
    }
  }, []);

  /** Change the baud rate; an open port is reopened at the new rate. */
  const setBaud = useCallback(
    async (rate: number) => {
      saveBaud(rate);
      setBaudState(rate);
      const c = conn.current;
      const p = port.current;
      if (c && p) {
        conn.current = null;
        await c.close();
        await open(p, rate);
      }
    },
    [open],
  );

  return { supported, status, problem, baud, setBaud, connect, disconnect, requestReading, feedLine };
}
