import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useBuildRequestItems, useBuildRequests } from "@/hooks/useBuildRequests";
import { checklistForPartType } from "@/lib/buildRequestChecklist";
import { sanitiseHtml } from "@/lib/sanitiseHtml";
import { Brandmark } from "@/components/brand/Brandmark";
import { Wordmark } from "@/components/brand/Wordmark";
import { LoadingTasks } from "@/components/LoadingTasks";
import type { Comment } from "@/types/task";

/**
 * Printable single-part layout for the production floor — one part per
 * page, saved as PDF (or sent to a real printer) via the browser's native
 * print dialog, which fires automatically once the data settles. Follows
 * PrintTaskView's conventions: explicit light colours (theme-independent),
 * chrome-less route (App.tsx hides header/footer on /…/print paths).
 *
 * The Lead Free (RoHS) flag from the parent request is rendered as a large
 * banner because it changes solder/process requirements — production must
 * not miss it on a physical copy.
 */
export function PrintBuildRequestItemView() {
  const { itemId } = useParams<{ itemId: string }>();
  const id = itemId ? parseInt(itemId, 10) : null;
  const { data: items = [], isLoading: itemsLoading } = useBuildRequestItems();
  const { data: brs = [], isLoading: brsLoading } = useBuildRequests();

  const item = useMemo(() => items.find((i) => i.id === id) ?? null, [items, id]);
  const header = useMemo(
    () => (item ? brs.find((b) => b.id === item.buildRequestLookupId) ?? null : null),
    [brs, item],
  );

  // Fire the print dialog only once EVERYTHING the page renders is loaded —
  // both queries settled AND the part found. Gating on just `item` fired the
  // dialog while the header query was still loading, so the print preview
  // snapshotted the loading screen. Fonts are awaited too so the condensed
  // display face doesn't reflow after the snapshot.
  const ready = !itemsLoading && !brsLoading && !!item;
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let timer = 0;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      timer = window.setTimeout(() => window.print(), 400);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ready]);

  if (itemsLoading || brsLoading) {
    return <LoadingTasks noun="this part" />;
  }

  if (!item) {
    return (
      <div className="mx-auto max-w-[800px] p-8 text-center text-sm text-gray-600">
        Part not found.
      </div>
    );
  }

  const checklistDefs = checklistForPartType(item.partType);

  return (
    <div className="mx-auto max-w-[800px] bg-white p-8 text-black print:p-0">
      <header className="mb-5 border-b border-gray-300 pb-3">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-black">
            <Brandmark className="h-9 w-auto shrink-0" />
            <div className="flex flex-col leading-tight">
              <Wordmark className="h-3.5 w-auto" />
              <p className="mt-1 font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                ARC · Resource Center
              </p>
            </div>
          </div>
          <div className="rounded-sm border border-gray-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-700">
            Confidential
          </div>
        </div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Build Request Part{header ? ` — ${header.brNo}` : ""}
        </div>
        <h1 className="font-display text-2xl font-bold leading-tight text-black">
          {item.partNumber}
        </h1>
        {item.partDesc && <div className="mt-0.5 text-sm text-gray-700">{item.partDesc}</div>}
        {header && (
          <div className="mt-1.5 text-xs text-gray-600">
            <span className="font-semibold">Request:</span> {header.title}
            {header.requiredLeadTime ? ` · ${header.requiredLeadTime}` : ""}
            {header.status ? ` · ${header.status}` : ""}
          </div>
        )}
      </header>

      {header?.leadFree && (
        <div className="mb-5 break-inside-avoid rounded border-2 border-green-700 bg-green-50 px-4 py-2 text-center font-display text-base font-bold uppercase tracking-[0.2em] text-green-800">
          ⚠ Lead Free (RoHS) build — use lead-free process
        </div>
      )}

      <section className="mb-5">
        <SectionHeading>Part Details</SectionHeading>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <DetailRow label="Qty">{item.qty ?? "—"}</DetailRow>
          <DetailRow label="WO No.">{item.woNo || "—"}</DetailRow>
          <DetailRow label="Drawing No">{item.drawingNo || "—"}</DetailRow>
          <DetailRow label="Drawing Rev">{item.drawingRev || "—"}</DetailRow>
          <DetailRow label="Revision Date">{item.revisionDate || "—"}</DetailRow>
          <DetailRow label="Part Type">{item.partType ?? "—"}</DetailRow>
          <DetailRow label="Part Status">{item.partStatus ?? "—"}</DetailRow>
          <DetailRow label="Disposition">{item.disposition ?? "—"}</DetailRow>
          <DetailRow label="Project">{item.projectRef?.title || "—"}</DetailRow>
          <DetailRow label="Serial Nos">{item.serialNos || "—"}</DetailRow>
          {header && (
            <>
              <DetailRow label="Requestor">{header.requestor?.displayName || "—"}</DetailRow>
              <DetailRow label="Engineer">{header.engineerAssigned?.displayName || "—"}</DetailRow>
            </>
          )}
        </div>
      </section>

      {(item.assembly.length > 0 || item.operations.length > 0 || item.testing.length > 0) && (
        <section className="mb-5 break-inside-avoid">
          <SectionHeading>Process</SectionHeading>
          <div className="grid grid-cols-3 gap-x-6 gap-y-2 text-sm">
            <DetailRow label="Assembly">
              {item.assembly.length ? item.assembly.join(", ") : "—"}
            </DetailRow>
            <DetailRow label="Operations">
              {item.operations.length ? item.operations.join(", ") : "—"}
            </DetailRow>
            <DetailRow label="Testing">
              {item.testing.length ? item.testing.join(", ") : "—"}
            </DetailRow>
          </div>
        </section>
      )}

      {checklistDefs.length > 0 && (
        <section className="mb-5 break-inside-avoid">
          <SectionHeading>
            {item.partType === "PCB" ? "PCB Data Package Checklist" : "Harness Checklist"}
          </SectionHeading>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {checklistDefs.map((def) => (
              <div key={def.field} className="flex items-center gap-2">
                <span className="font-mono text-base leading-none">
                  {item.checklist[def.field] ? "☑" : "☐"}
                </span>
                <span className={item.checklist[def.field] ? "text-gray-500" : "text-black"}>
                  {def.label}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {item.specialInstructions && (
        <TextSection heading="Special Instructions" text={item.specialInstructions} />
      )}
      {item.testPlan && <TextSection heading="Test Plan" text={item.testPlan} />}
      {item.opSummary && <TextSection heading="OP Summary" text={item.opSummary} />}

      <section>
        <SectionHeading>Comments ({item.comments.length})</SectionHeading>
        {item.comments.length === 0 ? (
          <div className="text-sm italic text-gray-500">No comments.</div>
        ) : (
          <div className="space-y-3">
            {item.comments.map((c, i) => (
              <CommentBlock key={`${c.timestamp.getTime()}-${i}`} comment={c} />
            ))}
          </div>
        )}
      </section>

      <footer className="mt-8 border-t border-gray-300 pt-2 text-[10px] text-gray-600">
        <div className="font-semibold uppercase tracking-wider text-gray-700">
          Confidential — Altronic internal use only. Not to be shared externally.
        </div>
        <div className="mt-0.5 text-gray-500">Printed {formatDate(new Date())}</div>
      </footer>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 font-display text-xs font-semibold uppercase tracking-wider text-gray-600">
      {children}
    </h2>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className="text-sm text-black">{children}</div>
    </div>
  );
}

function TextSection({ heading, text }: { heading: string; text: string }) {
  return (
    <section className="mb-5 break-inside-avoid">
      <SectionHeading>{heading}</SectionHeading>
      <div className="whitespace-pre-wrap text-sm text-black">{text}</div>
    </section>
  );
}

function CommentBlock({ comment }: { comment: Comment }) {
  return (
    <article className="break-inside-avoid border-l-2 border-gray-300 py-1 pl-3">
      <div className="mb-1 text-xs text-gray-600">
        <span className="font-semibold text-black">{comment.authorName}</span>
        <span className="text-gray-400"> · </span>
        {formatDate(comment.timestamp)}
      </div>
      {comment.bodyHtml ? (
        <div
          className="comment-html text-sm text-black"
          dangerouslySetInnerHTML={{ __html: sanitiseHtml(comment.bodyHtml) }}
        />
      ) : (
        <div className="text-xs italic text-gray-500">(no text)</div>
      )}
    </article>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
