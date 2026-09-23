import { useState } from "react";
import { FABRIC_GRAPHQL_ENDPOINT } from "@/api/config";
import {
  describeFabricFailure,
  fabricQuery,
  fabricTokenClaims,
  probeFabricCors,
} from "@/api/fabric";
import { fabricScopes } from "@/auth/msalConfig";
import { stripSapPadding } from "@/lib/sapMaterialNumber";

/**
 * Dev-only page (never rendered in production — see the `import.meta.env.DEV`
 * guard around its route in App.tsx) for testing the Microsoft Fabric API for
 * GraphQL connection end to end: silent token acquisition against ARC's own
 * app registration, then a real query over the wire.
 *
 * Reached at /dev/fabric-test while running `npm run dev`.
 *
 * It exercises the SAME `api/fabric.ts` the real feature will use, rather
 * than being a parallel re-implementation that could quietly drift from it —
 * the call `DevQzPrintTestView` already makes for QZ Tray.
 *
 * Endpoint and scope are BOTH editable here on purpose. Testing an
 * integration whose two unknowns are "is this the right URL" and "is this
 * the right scope" shouldn't need a rebuild per guess.
 */

const COUNT_QUERY = `query {
  zBC_SRV_DX_MATs {
    groupBy(fields: []) {
      aggregations {
        count(field: SIMP_CAP_SEQUENCE)
      }
    }
  }
}`;

const ROWS_QUERY = `query($first: Int) {
  zBC_SRV_DX_MATs(first: $first) {
    items {
      MATNR_OLD
      MATNR_NEW
    }
    hasNextPage
  }
}`;

type Status = { tone: "idle" | "info" | "success" | "error"; text: string };

const TONE_CLASS: Record<Status["tone"], string> = {
  idle: "border-border bg-surface text-fg-muted",
  info: "border-border bg-surface text-fg-muted",
  success: "border-cooper-green/40 bg-cooper-green/10 text-cooper-green",
  error: "border-cooper-red/40 bg-cooper-red/10 text-cooper-red",
};

interface MaterialRow {
  MATNR_OLD: string | null;
  MATNR_NEW: string | null;
}

/** Pull `{ items, hasNextPage }` out of whatever the query returned, if it looks like that. */
export function readRowsResult(
  data: unknown,
): { items: MaterialRow[]; hasNextPage: boolean } | null {
  if (typeof data !== "object" || data === null) return null;
  const first = Object.values(data as Record<string, unknown>)[0];
  if (typeof first !== "object" || first === null) return null;
  const { items, hasNextPage } = first as { items?: unknown; hasNextPage?: unknown };
  if (!Array.isArray(items)) return null;
  return { items: items as MaterialRow[], hasNextPage: hasNextPage === true };
}

export function DevFabricTestView() {
  const [endpoint, setEndpoint] = useState(FABRIC_GRAPHQL_ENDPOINT ?? "");
  const [scope, setScope] = useState(fabricScopes[0] ?? "");
  const [query, setQuery] = useState(COUNT_QUERY);
  const [first, setFirst] = useState(500);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({
    tone: "idle",
    text:
      "Start with Test CORS only — it needs no token, no sign-in and no Entra consent, and it " +
      "answers the one question that decides whether this route is viable at all.",
  });
  const [output, setOutput] = useState<string>("");
  const [preview, setPreview] = useState<MaterialRow[]>([]);
  const [pastedToken, setPastedToken] = useState("");

  const usesFirst = query.includes("$first");

  async function handleProbeCors() {
    setBusy(true);
    setOutput("");
    setPreview([]);
    setStatus({ tone: "info", text: "Probing…" });
    const probe = await probeFabricCors(endpoint);
    setStatus({ tone: probe.corsOk ? "success" : "error", text: probe.message });
    setBusy(false);
  }

  async function handleCheckToken() {
    setBusy(true);
    setOutput("");
    setPreview([]);
    setStatus({ tone: "info", text: "Acquiring a token silently…" });
    try {
      const claims = await fabricTokenClaims([scope]);
      const granted = claims?.scp ?? "(no scp claim)";
      setOutput(JSON.stringify(claims, null, 2));
      setStatus({
        tone: "success",
        text: `Got a token. Audience ${claims?.aud ?? "?"} — granted scopes: ${granted}`,
      });
    } catch (err) {
      setStatus({ tone: "error", text: describeFabricFailure(err) });
    } finally {
      setBusy(false);
    }
  }

  async function handleRun() {
    setBusy(true);
    setOutput("");
    setPreview([]);
    setStatus({ tone: "info", text: "Sending the query…" });
    const startedAt = performance.now();
    try {
      const data = await fabricQuery<unknown>(
        query,
        usesFirst ? { first } : {},
        { endpoint, scopes: [scope], accessToken: pastedToken },
      );
      const ms = Math.round(performance.now() - startedAt);
      setOutput(JSON.stringify(data, null, 2));

      const rows = readRowsResult(data);
      if (rows) {
        setPreview(
          rows.items.slice(0, 10).map((r) => ({
            MATNR_OLD: stripSapPadding(r.MATNR_OLD),
            MATNR_NEW: stripSapPadding(r.MATNR_NEW),
          })),
        );
        setStatus({
          tone: rows.hasNextPage ? "info" : "success",
          text: rows.hasNextPage
            ? `${rows.items.length} rows in ${ms}ms — and hasNextPage is TRUE, so this is not the whole set. Raise "first", or page properly.`
            : `${rows.items.length} rows in ${ms}ms, and hasNextPage is false — that's all of them.`,
        });
      } else {
        setStatus({ tone: "success", text: `Query succeeded in ${ms}ms.` });
      }
    } catch (err) {
      setStatus({ tone: "error", text: describeFabricFailure(err) });
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-fg";

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-8">
      <div>
        <h1 className="text-lg font-semibold text-fg">Fabric GraphQL test</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Dev-only — this page doesn't exist in the deployed app. It runs the real{" "}
          <code className="rounded bg-bg-subtle px-1">api/fabric.ts</code> transport: a silent MSAL token on
          ARC's own app registration, then a POST to the Fabric GraphQL endpoint. ARC only ever reads from
          Fabric, so there is nothing here that writes.
        </p>
      </div>

      <label className="block text-sm text-fg">
        Endpoint
        <input className={inputClass} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
      </label>

      <label className="block text-sm text-fg">
        Scope
        <input className={inputClass} value={scope} onChange={(e) => setScope(e.target.value)} />
      </label>

      <div className="rounded-md border border-border bg-bg-subtle p-3">
        <label className="block text-sm text-fg">
          Paste an access token (optional — bypasses MSAL)
          <textarea
            rows={3}
            className={inputClass}
            value={pastedToken}
            onChange={(e) => setPastedToken(e.target.value)}
            placeholder="eyJ0eXAiOiJKV1Qi…"
          />
        </label>
        <p className="mt-2 text-xs text-fg-muted">
          Lets you test everything <em>before</em> ARC's app registration has the Fabric scope. Run{" "}
          <code className="rounded bg-surface px-1">
            az account get-access-token --resource https://analysis.windows.net/powerbi/api --query
            accessToken -o tsv
          </code>{" "}
          and paste the result. The request is still sent by this browser from this origin, so it proves the
          endpoint, the query, your Fabric permissions and CORS — all without an Entra change. Leave it empty
          to use ARC's own silent MSAL token instead.
        </p>
      </div>

      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-sm text-fg">Query</span>
          <button
            type="button"
            onClick={() => setQuery(COUNT_QUERY)}
            className="rounded border border-border px-2 py-0.5 text-xs text-fg-muted hover:border-cooper-red hover:text-cooper-red"
          >
            Row count
          </button>
          <button
            type="button"
            onClick={() => setQuery(ROWS_QUERY)}
            className="rounded border border-border px-2 py-0.5 text-xs text-fg-muted hover:border-cooper-red hover:text-cooper-red"
          >
            Fetch rows
          </button>
        </div>
        <textarea
          rows={12}
          className="w-full rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-fg"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {usesFirst && (
        <label className="block max-w-[200px] text-sm text-fg">
          $first
          <input
            type="number"
            min="1"
            className={inputClass}
            value={first}
            onChange={(e) => setFirst(Number(e.target.value) || 0)}
          />
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !endpoint.trim()}
          onClick={handleProbeCors}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg transition-colors hover:border-cooper-red hover:text-cooper-red disabled:cursor-not-allowed disabled:opacity-40"
          title="Sends a deliberately invalid token. Answers the CORS question on its own — no consent, no sign-in needed."
        >
          Test CORS only
        </button>
        <button
          type="button"
          disabled={busy || !scope.trim()}
          onClick={handleCheckToken}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg transition-colors hover:border-cooper-red hover:text-cooper-red disabled:cursor-not-allowed disabled:opacity-40"
        >
          Check token
        </button>
        <button
          type="button"
          disabled={busy || !endpoint.trim() || !query.trim()}
          onClick={handleRun}
          className="rounded-md bg-cooper-red px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cooper-red/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Run query
        </button>
      </div>

      <div className={`rounded-md border px-3 py-2 text-xs ${TONE_CLASS[status.tone]}`}>{status.text}</div>

      {preview.length > 0 && (
        <div>
          <p className="mb-1 text-sm text-fg">
            First {preview.length} rows, leading zeros stripped
          </p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg-subtle text-fg-muted">
                <tr>
                  <th className="px-3 py-1.5 font-medium">MATNR_OLD</th>
                  <th className="px-3 py-1.5 font-medium">MATNR_NEW</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {preview.map((row, i) => (
                  <tr key={`${row.MATNR_OLD}-${i}`} className="border-t border-border">
                    <td className="px-3 py-1">{row.MATNR_OLD}</td>
                    <td className="px-3 py-1">{row.MATNR_NEW}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {output && (
        <div>
          <p className="mb-1 text-sm text-fg">Raw response</p>
          <pre className="max-h-96 overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-xs text-fg">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}
