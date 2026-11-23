import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useEirs } from "@/hooks/useEirs";
import { GRAY_MARKET_KEY } from "@/hooks/useGrayMarketRequests";
import { FAITS_KEY } from "@/hooks/useFaits";
import { faitLabel } from "@/lib/faitMapper";
import { grayMarketLabel } from "@/lib/grayMarketMapper";
import { SOURCE_NOUN, sourcePath, type BuildRequestSourceKind } from "@/lib/buildRequestFromSource";
import type { BuildRequest, Fait, GrayMarketRequest } from "@/types/task";

interface SourceLink {
  kind: BuildRequestSourceKind;
  id: number;
  label: string;
}

/**
 * The records a build request was raised FROM (BusinessIT#68/#69/#65), as
 * links. The EIR list is held on every page already, so an EIR shows its
 * number. The Gray Market and FAIT lists live elsewhere and aren't fetched
 * just for a label: their number shows when it is already cached, otherwise
 * "Gray Market request #12".
 */
export function buildRequestSourceLinks(
  br: BuildRequest,
  labels: { eir: (id: number) => string | null; grayMarket: (id: number) => string | null; fait: (id: number) => string | null },
): SourceLink[] {
  const out: SourceLink[] = [];
  const add = (kind: BuildRequestSourceKind, id: number | null | undefined) => {
    if (!id) return;
    out.push({ kind, id, label: labels[kind](id) ?? `${SOURCE_NOUN[kind]} #${id}` });
  };
  add("eir", br.eirReferenceLookupId);
  add("grayMarket", br.grayMarketRequestId);
  add("fait", br.faitReferenceLookupId);
  return out;
}

export function BuildRequestSourceLinks({ br }: { br: BuildRequest }) {
  const qc = useQueryClient();
  const { data: eirs = [] } = useEirs();
  const links = buildRequestSourceLinks(br, {
    eir: (id) => eirs.find((e) => e.id === id)?.eirNo || null,
    grayMarket: (id) => {
      const r = qc.getQueryData<GrayMarketRequest[]>(GRAY_MARKET_KEY)?.find((g) => g.id === id);
      return r ? grayMarketLabel(r) : null;
    },
    fait: (id) => {
      const f = qc.getQueryData<Fait[]>(FAITS_KEY)?.find((x) => x.id === id);
      return f ? `FAIT ${faitLabel(f)}` : null;
    },
  });
  if (links.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm" data-testid="br-source-links">
      {links.map((l) => (
        <li key={`${l.kind}-${l.id}`}>
          <Link to={sourcePath(l.kind, l.id)} className="text-accent underline-offset-2 hover:underline">
            {l.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
