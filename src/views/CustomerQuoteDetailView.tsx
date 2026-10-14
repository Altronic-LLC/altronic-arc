import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Download, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import type { SapCustomer } from "@/types/pricing";
import type { CustomerQuotePatch } from "@/lib/pricingMapper";
import { SapCustomerPicker } from "@/components/SapCustomerPicker";
import { useOverlayDismiss } from "@/components/useOverlayDismiss";
import { CUSTOMER_QUOTES_CONFIGURED } from "@/api/config";
import type { Comment, Person } from "@/types/task";
import { CUSTOMER_QUOTE_STATUSES, type CustomerQuote, type CustomerQuoteLine, type CustomerQuoteStatus } from "@/types/pricing";
import {
  collectCustomerQuotePeople,
  useAddCustomerQuoteComment,
  useCreateCustomerQuoteRevision,
  useCustomerQuote,
  useCustomerQuotes,
  useEditCustomerQuoteComment,
  useSetCustomerQuoteWatchers,
  useUpdateCustomerQuote,
} from "@/hooks/useCustomerQuotes";
import { useNewProductWorksheets } from "@/hooks/useNewProductPricing";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useCommentFileUpload } from "@/hooks/useAttachments";
import { downloadBlob } from "@/hooks/useQuotePdf";
import {
  isLatestRevision,
  lineSubtotal,
  quoteProblems,
  quoteTotal,
  refreshWorksheetLine,
  revisionsOf,
  unitPriceAt,
  worksheetLineIsStale,
} from "@/lib/customerQuotes";
import { customerQuotePdfModel, generatePricingPdf, pricingPdfFileName } from "@/lib/pricingPdf";
import { formatMoney } from "@/lib/quoteMoney";
import { mergePeople, personKey } from "@/lib/people";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { CommentComposer } from "@/components/CommentComposer";
import { CommentThread } from "@/components/CommentThread";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { PersonMultiField } from "@/components/PersonMultiField";
import { QuoteLineModal } from "@/components/QuoteLineModal";
import { ActionButton, PricingCard, PricingManagerGate, PricingPage, ReadField } from "@/components/pricingAtoms";
import { CustomerQuoteStatusChip } from "./CustomerQuotesView";

// =============================================================================
// One customer quote (/sales/pricing/quote/:id). Managers and admins only.
//
// Lines can be added, re-quantified and removed while the quote is a DRAFT.
// Once it is Sent (or Won / Lost / Expired) its lines are what the customer
// was given: change them with New revision, which leaves this one as sent.
//
// A worksheet line is PINNED to the revision it was priced from; when the
// worksheet has moved on, the line says so and offers "Update to R#".
// The PDF is built from customer prices only (lib/pricingPdf.ts).
// =============================================================================

export function CustomerQuoteDetailView() {
  return (
    <PricingManagerGate configured={CUSTOMER_QUOTES_CONFIGURED} listName="Customer Quotes" envVar="VITE_SP_CUSTOMER_QUOTES_LIST_ID">
      {() => <QuotePage />}
    </PricingManagerGate>
  );
}

function QuotePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const quoteId = id ? parseInt(id, 10) : null;
  const { data: quote, isLoading, error, refetch } = useCustomerQuote(quoteId);

  if (isLoading) {
    return (
      <PricingPage>
        <LoadingTasks noun="the quote" />
      </PricingPage>
    );
  }
  if (error && !quote) {
    return (
      <PricingPage>
        {isPermissionDenied(error) ? (
          <ListAccessNotice list="Customer Quotes" site="ALTRONICSALESTEAM" onRetry={() => void refetch()} />
        ) : (
          <p className="py-10 text-center text-sm text-fg-muted">Couldn't load the quote.</p>
        )}
      </PricingPage>
    );
  }
  if (!quote) {
    return (
      <PricingPage>
        <div className="py-10 text-center">
          <p className="text-sm text-fg-muted">That quote doesn't exist.</p>
          <button onClick={() => navigate("/sales/pricing/quotes")} className="mt-3 text-sm text-accent hover:underline">
            Back to customer quotes
          </button>
        </div>
      </PricingPage>
    );
  }
  return <Quote quote={quote} />;
}

function Quote({ quote: q }: { quote: CustomerQuote }) {
  const navigate = useNavigate();
  const me = useCurrentUser();
  const directory = useDirectoryPeople();
  const { data: quotes = [] } = useCustomerQuotes();
  const { data: worksheets = [] } = useNewProductWorksheets();
  const update = useUpdateCustomerQuote();
  const newRev = useCreateCustomerQuoteRevision();
  const setWatchers = useSetCustomerQuoteWatchers();
  const addComment = useAddCustomerQuoteComment();
  const editComment = useEditCustomerQuoteComment();
  const uploadCommentFile = useCommentFileUpload("customerQuote", q.id);
  const [adding, setAdding] = useState(false);
  const [editingHeader, setEditingHeader] = useState(false);
  const [notes, setNotes] = useState(q.notes);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => setNotes(q.notes), [q.id, q.notes]);

  const draft = q.status === "Draft";
  const latest = isLatestRevision(q, quotes);
  const revs = [...revisionsOf(q.quoteBase, quotes)].reverse();
  const mentionCandidates = useMemo(
    () => mergePeople(collectCustomerQuotePeople(quotes), directory, [me]),
    [quotes, directory, me],
  );

  function saveLines(lines: CustomerQuoteLine[]) {
    update.mutate({ id: q.id, patch: { lines } });
  }

  function setStatus(to: CustomerQuoteStatus) {
    if (to === q.status) return;
    update.mutate({ id: q.id, patch: { status: to } });
  }

  async function pdf() {
    const problems = quoteProblems(q);
    if (problems.length) {
      pushToast({ message: `Can't generate the PDF yet: ${problems.join(" ")}`, variant: "error" });
      return;
    }
    setPdfBusy(true);
    try {
      const model = customerQuotePdfModel(q, { name: me.displayName, email: me.email ?? "" });
      downloadBlob(await generatePricingPdf(model), pricingPdfFileName(model));
    } catch (err) {
      pushToast({ message: `Couldn't build the PDF: ${err instanceof Error ? err.message : "unknown error"}`, variant: "error" });
    } finally {
      setPdfBusy(false);
    }
  }

  async function makeRevision() {
    try {
      const created = await newRev.mutateAsync(q);
      navigate(`/sales/pricing/quote/${created.id}`);
    } catch {
      // The hook toasts the reason.
    }
  }

  function toggledWatchers(person: Person): Person[] {
    const key = personKey(person);
    return q.watchers.some((p) => personKey(p) === key) ? q.watchers.filter((p) => personKey(p) !== key) : [...q.watchers, person];
  }

  function handleAddComment(bodyHtml: string) {
    return addComment
      .mutateAsync({ id: q.id, comment: { authorName: me.displayName, authorEmail: me.email ?? "", bodyHtml } })
      .then(() => undefined);
  }

  async function handleEditComment(comment: Comment, bodyHtml: string) {
    await editComment.mutateAsync({
      id: q.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      bodyHtml,
      previousBodyHtml: comment.bodyHtml,
    });
  }

  return (
    <PricingPage wide>
      <DetailTopBar category="Customer Quotes" listTo="/sales/pricing/quotes" />

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">{q.quoteNumber}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <CustomerQuoteStatusChip status={q.status} />
            <span className="text-fg">{q.customer.name || "No customer"}</span>
            {revs.length > 1 && (
              <span className="inline-flex gap-1" aria-label="Revisions">
                {revs.map((r) =>
                  r.id === q.id ? (
                    <span key={r.id} className="rounded bg-surface-2 px-1.5 text-xs font-semibold">R{r.rev}</span>
                  ) : (
                    <Link key={r.id} to={`/sales/pricing/quote/${r.id}`} className="rounded px-1.5 text-xs font-semibold text-accent hover:underline">
                      R{r.rev}
                    </Link>
                  ),
                )}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-fg-muted">
            Status
            <select value={q.status} onChange={(e) => setStatus(e.target.value as CustomerQuoteStatus)} className="input !h-8 !w-auto !py-0" aria-label="Quote status">
              {CUSTOMER_QUOTE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <ActionButton
            onClick={() => void makeRevision()}
            disabled={newRev.isPending}
            icon={newRev.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          >
            New revision
          </ActionButton>
          <ActionButton onClick={() => void pdf()} disabled={pdfBusy} icon={pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} primary>
            Customer PDF
          </ActionButton>
        </div>
      </div>

      {!latest && (
        <div role="status" className="rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 px-4 py-3 text-sm text-fg">
          You're viewing an earlier revision. The current one is {revisionsOf(q.quoteBase, quotes)[0]?.quoteNumber}.
        </div>
      )}
      {q.linesCorrupt && (
        <div role="alert" className="rounded-lg border border-cooper-red/40 bg-cooper-red/5 px-4 py-3 text-sm text-cooper-red">
          This quote's saved lines couldn't be read, so ARC won't change them. Check the Lines column in SharePoint.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <PricingCard
            title="Customer"
            action={
              draft ? (
                <button
                  type="button"
                  onClick={() => setEditingHeader(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium normal-case tracking-normal text-fg hover:bg-surface-2"
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
              ) : (
                <span className="text-[11px] font-normal normal-case tracking-normal text-fg-muted">
                  {q.status} — use New revision to change it
                </span>
              )
            }
          >
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ReadField label="Customer">{q.customer.name}</ReadField>
              <ReadField label="Sold-to">{q.customer.soldTo}</ReadField>
              <ReadField label="Contact">{q.customer.contactName}</ReadField>
              <ReadField label="Contact email">{q.customer.contactEmail}</ReadField>
              <ReadField label="Customer group">{q.customer.customerGroup}</ReadField>
              <ReadField label="Valid for">{`${q.validityDays} days`}</ReadField>
            </dl>
          </PricingCard>

          <PricingCard
            title="Lines"
            action={
              draft && !q.linesCorrupt ? (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium normal-case tracking-normal text-fg hover:bg-surface-2"
                >
                  <Plus className="h-3 w-3" /> Add line
                </button>
              ) : null
            }
          >
            {!draft && (
              <p className="mb-2 text-xs text-fg-muted">
                This quote is {q.status} — its lines are what the customer was given. Use New revision to change them.
              </p>
            )}
            {q.lines.length === 0 ? (
              <p className="text-sm text-fg-muted">No lines yet.</p>
            ) : (
              <div className="scroll-elegant overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-fg-muted">
                    <tr>
                      <th className="px-2 py-1.5 font-semibold">Item</th>
                      <th className="px-2 py-1.5 font-semibold">Source</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Qty</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Price each</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Subtotal</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {q.lines.map((l) => {
                      const stale = worksheetLineIsStale(l, worksheets);
                      return (
                        <tr key={l.id} className="border-t border-border align-top">
                          <td className="px-2 py-1.5">
                            <span className="font-mono text-xs">{l.partNumber}</span>
                            {l.sapPartNumber && <span className="ml-2 font-mono text-[11px] text-fg-muted">SAP {l.sapPartNumber}</span>}
                            <span className="block">{l.description}</span>
                            {draft && !q.linesCorrupt ? (
                              <input
                                aria-label={`Customer part number for ${l.partNumber || l.description}`}
                                placeholder="Customer part # (optional)"
                                defaultValue={l.customerPartNumber ?? ""}
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  if (v !== (l.customerPartNumber ?? "")) {
                                    saveLines(q.lines.map((x) => (x.id === l.id ? { ...x, customerPartNumber: v || undefined } : x)));
                                  }
                                }}
                                className="input mt-1 !h-7 !w-48 !px-2 text-xs"
                              />
                            ) : (
                              l.customerPartNumber && (
                                <span className="block text-[11px] text-fg-muted">Customer part # {l.customerPartNumber}</span>
                              )
                            )}
                            {l.breaks.length > 0 && (
                              <span className="block text-[11px] text-fg-muted">
                                {l.breaks.map((b) => `${b.minQty}+ ${formatMoney(b.price)}`).join(" · ")}
                              </span>
                            )}
                            {stale && draft && (
                              <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-fg">
                                <AlertTriangle className="h-3 w-3 text-ajax-yellow" />
                                {stale.worksheetNumber} is now R{stale.rev}.
                                <button
                                  type="button"
                                  onClick={() => saveLines(q.lines.map((x) => (x.id === l.id ? refreshWorksheetLine(x, stale) : x)))}
                                  className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"
                                >
                                  <RefreshCw className="h-3 w-3" /> Update to R{stale.rev}
                                </button>
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-xs text-fg-muted">
                            {l.kind === "worksheet" ? (
                              <Link to={`/sales/pricing/new-product/${l.worksheetId}`} className="text-accent hover:underline">
                                {l.worksheetNumber} R{l.worksheetRev}
                              </Link>
                            ) : l.kind === "request" ? (
                              <Link to={`/sales/pricing/request/${l.requestId}`} className="text-accent hover:underline">
                                {l.requestNumber}
                              </Link>
                            ) : l.kind === "sapPart" ? (
                              `SAP ${l.sapPartNumber ?? ""}`
                            ) : (
                              "Other"
                            )}
                            {l.customerDiscountPct !== null && <span className="block">{l.customerDiscountPct}% off list</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            {draft && !q.linesCorrupt ? (
                              <input
                                type="number"
                                min={1}
                                step={1}
                                aria-label={`Quantity for ${l.partNumber || l.description}`}
                                defaultValue={l.quantity}
                                onBlur={(e) => {
                                  const n = Number(e.target.value);
                                  if (Number.isInteger(n) && n >= 1 && n !== l.quantity) {
                                    saveLines(q.lines.map((x) => (x.id === l.id ? { ...x, quantity: n } : x)));
                                  } else e.target.value = String(l.quantity);
                                }}
                                className="input !h-8 !w-20 !px-2 text-right tabular-nums"
                              />
                            ) : (
                              <span className="tabular-nums">{l.quantity}</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(unitPriceAt(l, l.quantity))}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(lineSubtotal(l))}</td>
                          <td className="px-2 py-1.5 text-right">
                            {draft && !q.linesCorrupt && (
                              <button
                                type="button"
                                aria-label={`Remove ${l.partNumber || l.description}`}
                                onClick={() => saveLines(q.lines.filter((x) => x.id !== l.id))}
                                className="rounded p-1 text-fg-muted hover:text-cooper-red"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border font-semibold">
                      <td className="px-2 py-2" colSpan={4}>
                        Total
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatMoney(quoteTotal(q.lines))}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </PricingCard>

          <PricingCard title="Notes (printed on the PDF)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== q.notes && update.mutate({ id: q.id, patch: { notes } })}
              disabled={!draft}
              rows={3}
              className="input w-full"
              aria-label="Quote notes"
            />
          </PricingCard>

          <div className="min-w-0">
            <AttachmentsSection parent="customerQuote" itemId={q.id} />
          </div>

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Discussion</h2>
            <CommentComposer draftKey={`customerQuote:${q.id}`} uploadFile={uploadCommentFile} onSubmit={handleAddComment} mentionablePeople={mentionCandidates} />
            <div className="mt-5">
              <CommentThread
                uploadFile={uploadCommentFile}
                comments={q.comments}
                currentUserEmail={me.email}
                currentUserName={me.displayName}
                mentionablePeople={mentionCandidates}
                onEdit={handleEditComment}
                onReply={handleAddComment}
                draftKey={`customerQuote:${q.id}`}
              />
            </div>
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-col gap-1">
              <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Watchers</span>
              <PersonMultiField
                value={q.watchers}
                allPeople={mentionCandidates}
                onToggle={(p) => setWatchers.mutate({ id: q.id, people: toggledWatchers(p) })}
                emptyLabel="No watchers"
                searchPlaceholder="Add a watcher…"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Created</span>
              <p className="px-1 text-sm text-fg">
                {q.createdBy?.displayName ?? "—"}
                {q.createdAt && <span className="text-fg-muted"> · {new Date(q.createdAt).toLocaleDateString()}</span>}
              </p>
            </div>
          </div>
        </aside>
      </div>

      {editingHeader && (
        <QuoteHeaderModal
          quote={q}
          pending={update.isPending}
          onClose={() => setEditingHeader(false)}
          onSave={(patch) => update.mutate({ id: q.id, patch }, { onSuccess: () => setEditingHeader(false) })}
        />
      )}
      {adding && <QuoteLineModal customer={q.customer} onClose={() => setAdding(false)} onAdd={(line) => saveLines([...q.lines, line])} />}
    </PricingPage>
  );
}

/**
 * Edit the quote header — customer, contact and validity (Ray, 2026-10-13).
 * A Draft only: a Sent quote is what the customer was given, so it changes
 * through New revision. The customer is saved as JSON on the quote.
 */
function QuoteHeaderModal({
  quote,
  pending,
  onClose,
  onSave,
}: {
  quote: CustomerQuote;
  pending: boolean;
  onClose: () => void;
  onSave: (patch: CustomerQuotePatch) => void;
}) {
  const [customer, setCustomer] = useState<SapCustomer | null>(
    quote.customer.name || quote.customer.soldTo
      ? { soldTo: quote.customer.soldTo, name: quote.customer.name, customerGroup: quote.customer.customerGroup }
      : null,
  );
  const [contactName, setContactName] = useState(quote.customer.contactName);
  const [contactEmail, setContactEmail] = useState(quote.customer.contactEmail);
  const [validity, setValidity] = useState(String(quote.validityDays));
  const [error, setError] = useState<string | null>(null);
  const overlay = useOverlayDismiss(onClose, pending);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  function save() {
    const days = Number(validity);
    if (!customer?.name.trim()) return setError("Pick the customer.");
    if (!Number.isInteger(days) || days < 1) return setError("Validity must be a whole number of days.");
    setError(null);
    onSave({
      validityDays: days,
      customer: { ...customer, contactName: contactName.trim(), contactEmail: contactEmail.trim() },
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" {...overlay}>
      <div role="dialog" aria-modal="true" aria-label="Edit quote details" onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-fg">Edit {quote.quoteNumber}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">Customer</span>
            <SapCustomerPicker value={customer} onChange={setCustomer} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-semibold uppercase tracking-wider text-fg-muted">Contact name</span>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="input" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-semibold uppercase tracking-wider text-fg-muted">Contact email</span>
              <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="input" />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">Valid for (days)</span>
            <input type="number" min={1} value={validity} onChange={(e) => setValidity(e.target.value)} className="input !w-32" />
          </label>
          <p className="text-[11px] text-fg-muted">
            Line prices aren't changed — a line keeps the price it was added at.
          </p>
          {error && (
            <p role="alert" className="text-xs text-cooper-red">
              {error}
            </p>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}