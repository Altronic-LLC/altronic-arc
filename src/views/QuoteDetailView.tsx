import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ClipboardList,
  Download,
  ExternalLink,
  FileText,
  FolderUp,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  collectQuotePeople,
  useAddQuoteComment,
  useCreateQuoteRevision,
  useEditQuoteComment,
  useQuote,
  useQuoteRevisions,
  useQuotes,
  useSetQuoteWatchers,
  useUpdateQuoteFields,
} from "@/hooks/useQuotes";
import { useDeleteQuoteAssembly, useQuoteAssemblies } from "@/hooks/useQuoteAssemblies";
import { useQuoteCustomers } from "@/hooks/useQuoteCustomers";
import type { MyQuoteAccess } from "@/hooks/useQuoteRoles";
import { downloadBlob, useGenerateQuotePdf, useQuotePdfs, useSaveQuotePdf } from "@/hooks/useQuotePdf";
import { useCommentFileUpload } from "@/hooks/useAttachments";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import type { Comment, Person } from "@/types/task";
import { QUOTE_STATUSES, type Quote, type QuoteAssembly, type QuoteAlternate, type QuoteStatus } from "@/types/quote";
import { isLatestRevision, nextRevFor } from "@/lib/quoteNumber";
import { priceQuote, type QuoteAssemblyPricing } from "@/lib/quotePricing";
import type { QuotePatch } from "@/lib/quoteMapper";
import { createQuoteGate, editQuoteGate, generatePdfGate, seeCostGate, setQuoteStatusGate } from "@/lib/quoteRoles";
import { formatDisplayDate } from "@/lib/dateInput";
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
import { QuotesNav } from "@/components/QuotesNav";
import { CustomerNotes, PRINTED_NOTE, QuoteFormModal } from "@/components/QuoteFormModal";
import { QuoteAssemblyFormModal } from "@/components/QuoteAssemblyFormModal";
import { AlternatesEditor, QuoteAlternatesCard } from "@/components/QuoteAlternatesCard";
import { QuoteLinksPanel } from "@/components/QuoteLinksPanel";
import { QuoteTargetSummaryCard } from "@/components/QuoteTargetSummaryCard";
import { QuoteToTaskModal } from "@/components/QuoteToTaskModal";
import { quoteTaskRefusal } from "@/lib/quoteToTask";
import { useOverlayDismiss } from "@/components/useOverlayDismiss";
import { cn } from "@/lib/cn";
import { QuoteAccessGate, QuoteStatusChip, quoteExpiry } from "./QuotesView";
import { formatMoney, formatPct, formatUnitCost } from "@/lib/quoteMoney";

// =============================================================================
// One quote revision — the WORKSHEET (/sales/quotes/:id).
//
// Quote → LINES. A line carries the part's FINAL cost — material, labor, and
// overhead as a percent of material (Ray, 2026-10-29) — and the tool turns it
// into a selling price at the line's ONE target GM. Each line shows its price
// and quantity-break table to everyone and — for quoters and managers only —
// its cost breakdown, target GM and achieved GM. The page is where Sales,
// Engineering, Supply Chain and Operations discuss a quote and get buy-in.
//
// COST IS HIDDEN, NOT MASKED, for a viewer: no value, no column header, no
// input reaches the DOM. Every cost-bearing element asks `seeCostGate`. That
// is UI-only — Graph still returns the columns and the bundle is public — and
// SharePoint list permissions are the real boundary (design §3).
//
// SENT-EDIT CONFIRMATION (design §11). Any in-place edit of a quote whose
// status is Sent — the header, a line, the alternates — first asks "Update
// anyway, or create R{n+1}?". `useSentEditGuard` is the ONE implementation;
// every edit entry point goes through `guard(fn)`. A STATUS change is not
// guarded — moving a Sent quote to Won is the workflow, not an edit of what
// was sent. Comments, watchers, attachments and the task / project links are
// collaboration, not edits.
//
// The quote's thread is headed "Discussion". The customer's NOTES (from the
// customer list) show on the Quote card — internal, never printed.
// =============================================================================

export function QuoteDetailView() {
  return <QuoteAccessGate>{(access) => <QuoteWorksheet access={access} />}</QuoteAccessGate>;
}

// -----------------------------------------------------------------------------
// The Sent-edit guard
// -----------------------------------------------------------------------------

/**
 * Wrap every in-place edit of a quote in `guard(fn)`. On a Sent quote it
 * shows the "Update anyway / Create R{n+1}" dialog first; otherwise it runs
 * `fn` at once. Render `dialog` somewhere on the page.
 */
export function useSentEditGuard(quote: Quote | undefined) {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const { data: quotes = [] } = useQuotes();
  const createRev = useCreateQuoteRevision();
  const navigate = useNavigate();

  const guard = useCallback(
    (fn: () => void) => {
      if (quote?.status === "Sent") setPending(() => fn);
      else fn();
    },
    [quote?.status],
  );

  const nextRev = quote ? nextRevFor(quote.quoteBase, quotes) : 0;

  const dialog =
    pending && quote ? (
      <ConfirmDialog
        title="This rev was sent"
        busy={createRev.isPending}
        onCancel={() => setPending(null)}
        actions={[
          {
            label: "Update anyway",
            onClick: () => {
              const fn = pending;
              setPending(null);
              fn();
            },
          },
          {
            label: `Create R${nextRev}`,
            primary: true,
            onClick: async () => {
              try {
                const { quote: created } = await createRev.mutateAsync(quote.id);
                setPending(null);
                navigate(`/sales/quotes/${created.id}`);
              } catch {
                // The hook toasts the reason.
              }
            },
          },
        ]}
      >
        This rev was sent to the customer. Update {quote.quoteNumber} anyway, or create R{nextRev}?
      </ConfirmDialog>
    ) : null;

  return { guard, dialog };
}

// -----------------------------------------------------------------------------
// The page
// -----------------------------------------------------------------------------

type ModalState =
  | { kind: "header" }
  | { kind: "assembly"; assembly?: QuoteAssembly }
  | { kind: "alternates" }
  | { kind: "task" }
  | null;

type ConfirmState =
  | { kind: "deleteAssembly"; assembly: QuoteAssembly }
  | { kind: "newRev" }
  | { kind: "savePdfPrompt" }
  | null;

function QuoteWorksheet({ access }: { access: MyQuoteAccess }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const quoteId = id ? parseInt(id, 10) : null;
  // A screenshot pasted into the Discussion goes to the quote's attachments.
  const uploadCommentFile = useCommentFileUpload("quote", quoteId);

  const { data: quote, isLoading, error, refetch } = useQuote(quoteId);
  const { data: quotes = [] } = useQuotes();
  const { data: revisions = [] } = useQuoteRevisions(quote?.quoteBase);
  const { data: assemblies = [] } = useQuoteAssemblies(quoteId);
  const { data: customers = [] } = useQuoteCustomers();
  const currentUser = useCurrentUser();
  const directory = useDirectoryPeople();

  const update = useUpdateQuoteFields();
  const setWatchers = useSetQuoteWatchers();
  const addComment = useAddQuoteComment();
  const editComment = useEditQuoteComment();
  const createRev = useCreateQuoteRevision();
  const deleteAssembly = useDeleteQuoteAssembly();
  const generatePdf = useGenerateQuotePdf();
  const savePdf = useSaveQuotePdf();

  const canSeeCost = seeCostGate(access).allowed;
  const editGate = editQuoteGate(access);
  const canEdit = editGate.allowed;
  const createGate = createQuoteGate(access);
  const pdfGate = generatePdfGate(access);

  const { guard, dialog: sentEditDialog } = useSentEditGuard(quote);
  const [modal, setModal] = useState<ModalState>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [pdfProblems, setPdfProblems] = useState<string[] | null>(null);

  // A new rev is the same route with another id — nothing open survives it.
  useEffect(() => {
    setModal(null);
    setConfirm(null);
    setPdfProblems(null);
  }, [quoteId]);

  const mentionCandidates = useMemo(
    () => mergePeople(collectQuotePeople(quotes), directory, [currentUser]),
    [quotes, directory, currentUser],
  );
  const pricing = useMemo(() => priceQuote(assemblies), [assemblies]);
  const sortedAssemblies = useMemo(
    () => [...assemblies].sort((a, b) => a.lineNo - b.lineNo || a.id - b.id),
    [assemblies],
  );

  if (isLoading) {
    return (
      <Page>
        <LoadingTasks noun="the quote" />
      </Page>
    );
  }
  if (error && !quote) {
    return (
      <Page>
        {isPermissionDenied(error) ? (
          <ListAccessNotice list="Quotes" site="Altronic_PMO" onRetry={() => void refetch()} />
        ) : (
          <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">Couldn't load the quote.</p>
            <p className="mt-1">{error instanceof Error ? error.message : "Unknown error"}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
            >
              Try again
            </button>
          </div>
        )}
      </Page>
    );
  }
  if (!quote) {
    return (
      <Page>
        <div className="py-10 text-center">
          <p className="text-sm text-fg-muted">That quote doesn't exist.</p>
          <button
            onClick={() => navigate("/sales/quotes")}
            className="mt-3 text-sm text-accent underline-offset-2 hover:underline"
          >
            Back to quotes
          </button>
        </div>
      </Page>
    );
  }

  const q = quote;
  const customer = q.customerId === null ? null : (customers.find((c) => c.id === q.customerId) ?? null);
  const latest = isLatestRevision(q, quotes);
  const latestRev = revisions[0];
  const ascendingRevs = [...revisions].reverse();
  const nextRev = nextRevFor(q.quoteBase, quotes);
  const expires = quoteExpiry(q);

  function handleAddComment(bodyHtml: string) {
    // Returned, so a comment that fails to post goes back in the composer.
    return addComment
      .mutateAsync({
        id: q.id,
        comment: {
          authorName: currentUser.displayName,
          authorEmail: currentUser.email ?? "",
          bodyHtml,
        },
      })
      .then(() => undefined);
  }

  async function handleEditComment(comment: Comment, newBodyHtml: string) {
    await editComment.mutateAsync({
      id: q.id,
      target: {
        timestamp: comment.timestamp,
        authorEmail: comment.authorEmail,
      },
      bodyHtml: newBodyHtml,
      previousBodyHtml: comment.bodyHtml,
    });
  }

  function setStatus(to: QuoteStatus) {
    if (to === q.status) return;
    update.mutate(
      { id: q.id, patch: { status: to } },
      {
        onSuccess: () => {
          if (to === "Sent" && pdfGate.allowed) setConfirm({ kind: "savePdfPrompt" });
        },
      },
    );
  }

  async function generate(): Promise<{ blob: Blob; fileName: string } | null> {
    setPdfProblems(null);
    try {
      return await generatePdf.mutateAsync({
        quote: q,
        customer,
        assemblies,
      });
    } catch (err) {
      setPdfProblems(problemsFrom(err));
      return null;
    }
  }

  async function handleDownloadPdf() {
    const result = await generate();
    if (result) downloadBlob(result.blob, result.fileName);
  }

  async function handleSavePdf() {
    const result = await generate();
    if (!result) return;
    try {
      const saved = await savePdf.mutateAsync(result);
      pushToast({ message: `Saved ${saved.name} to the IC Quotes folder.` });
    } catch (err) {
      pushToast({
        message: `Couldn't save the PDF: ${err instanceof Error ? err.message : "unknown error"}`,
        variant: "error",
      });
    }
  }

  async function handleNewRev() {
    try {
      const { quote: created } = await createRev.mutateAsync(q.id);
      setConfirm(null);
      navigate(`/sales/quotes/${created.id}`);
    } catch {
      // The hook toasts the reason.
    }
  }

  function toggledWatchers(person: Person): Person[] {
    const key = personKey(person);
    return q.watchers.some((p) => personKey(p) === key)
      ? q.watchers.filter((p) => personKey(p) !== key)
      : [...q.watchers, person];
  }

  function patchQuote(patch: QuotePatch) {
    update.mutate({ id: q.id, patch });
  }

  async function saveAlternates(rows: QuoteAlternate[]) {
    await update.mutateAsync({ id: q.id, patch: { alternates: rows } });
  }

  const pdfBusy = generatePdf.isPending || savePdf.isPending;
  const nextAssemblyLine = Math.max(0, ...assemblies.map((a) => a.lineNo)) + 1;

  return (
    <Page>
      <DetailTopBar category="Insourcing Quotes" listTo="/sales/quotes" />

      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue">
          <FileText className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">{q.quoteNumber}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <QuoteStatusChip status={q.status} />
            <span className="text-fg">{customer ? `${customer.name} (${customer.code})` : "No customer"}</span>
            {revisions.length > 0 && (
              <span className="inline-flex flex-wrap items-center gap-1 text-fg-muted">
                <span>
                  Rev {q.rev} of {latestRev?.rev ?? q.rev}
                </span>
                {ascendingRevs.length > 1 && (
                  <span className="inline-flex gap-1" aria-label="Revisions">
                    {ascendingRevs.map((r) =>
                      r.id === q.id ? (
                        <span key={r.id} className="rounded-sm bg-surface-2 px-1.5 text-xs font-semibold text-fg">
                          R{r.rev}
                        </span>
                      ) : (
                        <Link
                          key={r.id}
                          to={`/sales/quotes/${r.id}`}
                          className="rounded-sm px-1.5 text-xs font-semibold text-accent hover:underline"
                        >
                          R{r.rev}
                        </Link>
                      ),
                    )}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* A WON quote becomes Engineering / Operations work (lib/quoteToTask.ts).
              Hidden once both departments have a task. */}
          {canEdit &&
            q.status === "Won" &&
            (quoteTaskRefusal(q, "engineering") === null || quoteTaskRefusal(q, "operations") === null) && (
              <ActionButton onClick={() => setModal({ kind: "task" })} icon={<ClipboardList className="h-4 w-4" />}>
                Create task
              </ActionButton>
            )}
          {createGate.allowed && (
            <ActionButton onClick={() => setConfirm({ kind: "newRev" })} icon={<Plus className="h-4 w-4" />}>
              New revision
            </ActionButton>
          )}
          {pdfGate.allowed && (
            <>
              <ActionButton
                onClick={() => void handleDownloadPdf()}
                disabled={pdfBusy}
                icon={
                  generatePdf.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )
                }
              >
                Generate PDF
              </ActionButton>
              <ActionButton
                onClick={() => void handleSavePdf()}
                disabled={pdfBusy}
                icon={
                  savePdf.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderUp className="h-4 w-4" />
                }
              >
                Save PDF to folder
              </ActionButton>
            </>
          )}
        </div>
      </div>

      {!latest && latestRev && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 px-4 py-3 text-sm text-fg"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            You're viewing R{q.rev}, an earlier revision. The current one is{" "}
            <Link to={`/sales/quotes/${latestRev.id}`} className="font-semibold text-accent hover:underline">
              {latestRev.quoteNumber}
            </Link>
            .
          </p>
        </div>
      )}

      {pdfProblems && (
        <div role="alert" className="rounded-lg border border-cooper-red/40 bg-cooper-red/5 px-4 py-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-fg">The customer PDF can't be generated yet:</p>
            <button
              type="button"
              onClick={() => setPdfProblems(null)}
              aria-label="Dismiss"
              className="rounded-sm p-0.5 text-fg-muted hover:text-fg"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ul className="mt-1 list-disc pl-5 text-fg">
            {pdfProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <StatusControl quote={q} access={access} onPick={setStatus} />

          {/* Header card */}
          <Card
            title="Quote"
            action={
              canEdit ? (
                <EditButton label="quote details" onClick={() => guard(() => setModal({ kind: "header" }))} />
              ) : null
            }
          >
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ReadField label="Customer">{customer ? `${customer.name} (${customer.code})` : null}</ReadField>
              <ReadField label="Customer number">{customer?.customerNumber || null}</ReadField>
              <ReadField label="Customer reference / description" wide note={PRINTED_NOTE}>
                {q.customerReference || null}
              </ReadField>
              <ReadField label="Customer type" note="Internal — not printed.">{q.customerType}</ReadField>
              <ReadField label="Contact">{q.contactName || null}</ReadField>
              <ReadField label="Contact email">{q.contactEmail || null}</ReadField>
              <ReadField label="Validity">{`${q.validityDays} days`}</ReadField>
              <ReadField label="Expires">{formatDisplayDate(expires)}</ReadField>
              <ReadField label="Budgetary">{q.budgetary ? "Yes" : "No"}</ReadField>
              {q.budgetary && (
                <ReadField label="Budgetary text" wide note={PRINTED_NOTE}>
                  {q.budgetaryText || null}
                </ReadField>
              )}
              <ReadField label="Quote notes" wide note={PRINTED_NOTE}>
                {q.quoteNotes || null}
              </ReadField>
            </dl>
            {customer?.note.trim() && <CustomerNotes note={customer.note} />}
          </Card>

          {/* Second, right under the header (Ray, 2026-10-30). */}
          <QuoteTargetSummaryCard
            quote={q}
            assemblies={assemblies}
            canSeeCost={canSeeCost}
            canEdit={canEdit}
            busy={update.isPending}
            onSaveContext={async (projectContext) => {
              await update.mutateAsync({ id: q.id, patch: { projectContext } });
            }}
          />

          {/* Lines */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Line items</h2>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => guard(() => setModal({ kind: "assembly" }))}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg hover:bg-surface-2"
                >
                  <Plus className="h-3 w-3" />
                  Add line
                </button>
              )}
            </div>
            {sortedAssemblies.length === 0 && (
              <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-center text-sm text-fg-muted">
                No lines yet — add the parts being quoted.
              </p>
            )}
            {sortedAssemblies.map((assembly) => {
              const assemblyPricing = pricing.assemblies.find((p) => p.assemblyId === assembly.id);
              return (
                <AssemblyCard
                  key={assembly.id}
                  assembly={assembly}
                  pricing={assemblyPricing}
                  canSeeCost={canSeeCost}
                  canEdit={canEdit}
                  onEdit={() => guard(() => setModal({ kind: "assembly", assembly }))}
                  onDelete={() => guard(() => setConfirm({ kind: "deleteAssembly", assembly }))}
                />
              );
            })}
          </section>

          {/* Quote roll-up */}
          <Card title="Quote total">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Quote total">
              <ReadField label="Total">{formatMoney(pricing.quoteTotal)}</ReadField>
              {canSeeCost && <ReadField label="Total cost">{formatMoney(pricing.quoteCost)}</ReadField>}
              {canSeeCost && <ReadField label="GM % (weighted)">{formatPct(pricing.quoteGmPct)}</ReadField>}
            </dl>
            <p className="mt-2 text-[11px] text-fg-muted">
              The sum of every line's Subtotal at its quoted quantity.
            </p>
            {canEdit && pricing.problems.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-fg-muted">
                {pricing.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </Card>

          <QuoteAlternatesCard
            rows={q.alternates}
            corrupt={q.alternatesCorrupt}
            canEdit={canEdit}
            onEdit={() => guard(() => setModal({ kind: "alternates" }))}
          />

          {/* The customer's data package and supplier quotes — full main-column
              width, directly above the Discussion. */}
          <div className="min-w-0" data-testid="quote-attachments">
            <p className="mb-1 px-1 text-[11px] text-fg-muted">
              The customer's data package and supplier quotes — drawings, specs, RFQs.
            </p>
            <AttachmentsSection parent="quote" itemId={q.id} />
          </div>

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Discussion
            </h2>
            <CommentComposer
              draftKey={`quote:${quoteId}`}
              uploadFile={uploadCommentFile}
              onSubmit={handleAddComment}
              mentionablePeople={mentionCandidates}
            />
            <div className="mt-5">
              <CommentThread
                uploadFile={uploadCommentFile}
                comments={q.comments}
                currentUserEmail={currentUser.email}
                currentUserName={currentUser.displayName}
                mentionablePeople={mentionCandidates}
                onEdit={handleEditComment}
                onReply={handleAddComment}
                draftKey={`quote:${quoteId}`}
              />
            </div>
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
            <SidebarField label="Watchers">
              <PersonMultiField
                value={q.watchers}
                allPeople={mentionCandidates}
                onToggle={(p) => setWatchers.mutate({ id: q.id, people: toggledWatchers(p) })}
                emptyLabel="No watchers"
                searchPlaceholder="Add a watcher…"
              />
            </SidebarField>
            <SidebarField label="Raised by">
              <p className="px-1 text-sm text-fg">
                {q.createdBy?.displayName ?? <span className="text-fg-muted">Unknown</span>}
                {q.createdAt && <span className="text-fg-muted"> · {new Date(q.createdAt).toLocaleDateString()}</span>}
              </p>
            </SidebarField>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="mb-2 font-display text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Linked work
            </h3>
            <QuoteLinksPanel quote={q} canEdit={canEdit} onPatch={patchQuote} />
          </div>

          <SavedPdfs quoteBase={q.quoteBase} />
        </aside>
      </div>

      {modal?.kind === "header" && <QuoteFormModal quote={q} onClose={() => setModal(null)} />}
      {modal?.kind === "task" && <QuoteToTaskModal quote={q} onClose={() => setModal(null)} />}
      {modal?.kind === "assembly" && (
        <QuoteAssemblyFormModal
          quoteId={q.id}
          assembly={modal.assembly}
          nextLineNo={nextAssemblyLine}
          canSeeCost={canSeeCost}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "alternates" && (
        <AlternatesEditor
          rows={q.alternates}
          busy={update.isPending}
          onSave={saveAlternates}
          onClose={() => setModal(null)}
        />
      )}

      {confirm?.kind === "deleteAssembly" && (
        <ConfirmDialog
          title="Delete line"
          busy={deleteAssembly.isPending}
          onCancel={() => setConfirm(null)}
          actions={[
            {
              label: "Delete",
              danger: true,
              onClick: async () => {
                try {
                  await deleteAssembly.mutateAsync(confirm.assembly.id);
                  setConfirm(null);
                } catch {
                  setConfirm(null);
                }
              },
            },
          ]}
        >
          Delete line {confirm.assembly.altronicPartNumber || confirm.assembly.lineNo}?
        </ConfirmDialog>
      )}
      {confirm?.kind === "newRev" && (
        <ConfirmDialog
          title="New revision"
          busy={createRev.isPending}
          onCancel={() => setConfirm(null)}
          actions={[
            {
              label: `Create R${nextRev}`,
              primary: true,
              onClick: () => void handleNewRev(),
            },
          ]}
        >
          Create R{nextRev} of {q.quoteBase}? Its lines, alternates, links, discussion and attachments are copied
          forward;{" "}
          {q.quoteNumber} stays exactly as it is.
        </ConfirmDialog>
      )}
      {confirm?.kind === "savePdfPrompt" && (
        <ConfirmDialog
          title="Quote marked Sent"
          busy={pdfBusy}
          onCancel={() => setConfirm(null)}
          cancelLabel="Not now"
          actions={[
            {
              label: "Save PDF",
              primary: true,
              onClick: async () => {
                setConfirm(null);
                await handleSavePdf();
              },
            },
          ]}
        >
          Save the PDF to the IC Quotes folder now?
        </ConfirmDialog>
      )}
      {sentEditDialog}
    </Page>
  );
}

/** The "• " lines of a generate refusal, or the whole message. */
function problemsFrom(err: unknown): string[] {
  const message = err instanceof Error ? err.message : String(err);
  const bullets = message
    .split("\n")
    .filter((line) => line.trim().startsWith("•"))
    .map((line) => line.trim().replace(/^•\s*/, ""));
  return bullets.length > 0 ? bullets : [message];
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <QuotesNav />
      {children}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Status
// -----------------------------------------------------------------------------

/**
 * Every status as a button. A move the gate refuses is `aria-disabled` (not
 * `disabled` — that would drop its tooltip and its place in the tab order)
 * and the reason is printed beneath, not only in a tooltip.
 */
function StatusControl({
  quote,
  access,
  onPick,
}: {
  quote: Quote;
  access: MyQuoteAccess;
  onPick: (to: QuoteStatus) => void;
}) {
  const gates = QUOTE_STATUSES.map((s) => ({
    status: s,
    gate: s === quote.status ? null : setQuoteStatusGate(access, quote.status, s),
  }));
  const refusals = new Map<string, QuoteStatus[]>();
  for (const { status, gate } of gates) {
    if (gate && !gate.allowed) refusals.set(gate.hint, [...(refusals.get(gate.hint) ?? []), status]);
  }
  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-label="Status">
      <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Status</h2>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Quote status">
        {gates.map(({ status, gate }) => {
          const current = status === quote.status;
          const refused = !!gate && !gate.allowed;
          return (
            <button
              key={status}
              type="button"
              aria-pressed={current}
              aria-disabled={refused || undefined}
              title={refused ? gate!.hint : undefined}
              onClick={() => {
                if (current || refused) return;
                onPick(status);
              }}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                current
                  ? "border-accent bg-accent text-white"
                  : refused
                    ? "cursor-not-allowed border-border bg-surface text-fg-muted opacity-60"
                    : "border-border bg-surface text-fg hover:bg-surface-2",
              )}
            >
              {status}
            </button>
          );
        })}
      </div>
      {refusals.size > 0 && (
        <ul className="mt-2 text-xs text-fg-muted">
          {[...refusals].map(([hint, statuses]) => (
            <li key={hint}>
              {statuses.join(", ")}: {hint}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// Lines
// -----------------------------------------------------------------------------

function AssemblyCard({
  assembly,
  pricing,
  canSeeCost,
  canEdit,
  onEdit,
  onDelete,
}: {
  assembly: QuoteAssembly;
  pricing: QuoteAssemblyPricing | undefined;
  canSeeCost: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const name = assembly.altronicPartNumber || `line ${assembly.lineNo}`;
  return (
    <article
      className="rounded-xl border border-border bg-surface p-4 sm:p-5"
      aria-label={`Line ${assembly.altronicPartNumber}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Line {assembly.lineNo}</p>
          <h3 className="font-display text-base font-semibold text-fg">{assembly.altronicPartNumber || "No part #"}</h3>
          <p className="text-sm text-fg">{assembly.description}</p>
          <p className="mt-1 text-xs text-fg-muted">
            SAP # {assembly.sapPartNumber || "—"} · Customer part # {assembly.customerPartNumber || "—"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Price</p>
          <p className="font-display text-lg font-semibold tabular-nums text-fg">
            {pricing?.price === null || pricing?.price === undefined ? "Not priced" : formatMoney(pricing.price)}
          </p>
          {canSeeCost && pricing?.isManual && (
            <span className="rounded-full bg-ajax-yellow/20 px-1.5 py-0.5 text-[10px] font-semibold text-fg">
              Manual price
            </span>
          )}
          {canSeeCost && (
            <p className="mt-0.5 text-xs text-fg-muted">
              Target GM {assembly.targetGM === null ? "not set" : formatPct(assembly.targetGM)}
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-1">
            <EditButton label={`line ${name}`} onClick={onEdit} />
            <IconButton label={`Delete line ${name}`} onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        )}
      </div>

      {/* The quoted quantity — a SELL figure, so everyone sees it; cost and GM at
          that quantity for cost viewers only. */}
      {pricing && (
        <dl
          aria-label="Quoted quantity"
          className="mt-3 grid grid-cols-3 gap-3 rounded-lg border border-border p-3 text-sm sm:grid-cols-6"
        >
          <ReadField label="Qty">{String(pricing.quotedQty)}</ReadField>
          <ReadField label="Unit price">{formatMoney(pricing.quotedUnitPrice)}</ReadField>
          <ReadField label="Subtotal">{formatMoney(pricing.lineTotal)}</ReadField>
          {canSeeCost && <ReadField label="Cost at qty">{formatMoney(pricing.lineCost)}</ReadField>}
          {canSeeCost && <ReadField label="Profit at qty">{formatMoney(pricing.lineProfit)}</ReadField>}
          {canSeeCost && <ReadField label="GM at qty">{formatPct(pricing.lineGmPct)}</ReadField>}
        </dl>
      )}

      {/* Quantity breaks — range and unit price for everyone; discount, GM and profit for cost viewers. */}
      {pricing && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                <th className="px-2 py-1 font-semibold">Quantity</th>
                <th className="px-2 py-1 font-semibold">Unit price</th>
                {canSeeCost && <th className="px-2 py-1 font-semibold">Discount</th>}
                {canSeeCost && <th className="px-2 py-1 font-semibold">GM %</th>}
                {canSeeCost && <th className="px-2 py-1 font-semibold">Profit</th>}
                {canSeeCost && <th className="px-2 py-1 font-semibold">Note</th>}
              </tr>
            </thead>
            <tbody>
              {pricing.tiers.map((t) => (
                <tr key={t.rangeLabel} className="border-t border-border">
                  <td className="px-2 py-1 text-fg">{t.rangeLabel}</td>
                  <td className="px-2 py-1 tabular-nums text-fg">{formatMoney(t.unitPrice)}</td>
                  {canSeeCost && <td className="px-2 py-1 tabular-nums text-fg-muted">{t.discountPct}%</td>}
                  {canSeeCost && <td className="px-2 py-1 tabular-nums text-fg-muted">{formatPct(t.gmPct)}</td>}
                  {canSeeCost && <td className="px-2 py-1 tabular-nums text-fg-muted">{formatMoney(t.profit)}</td>}
                  {canSeeCost && <td className="px-2 py-1 text-fg-muted">{t.note}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && pricing && pricing.problems.length > 0 && (
        <ul className="mt-3 list-disc rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 py-2 pl-8 pr-3 text-xs text-fg">
          {pricing.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {/* The cost of one, and what it prices at: material + overhead (% of
          material) + labor = total cost, at the line's ONE target GM. */}
      {canSeeCost && pricing && (
        <dl
          aria-label="Line cost"
          className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-surface-2 p-3 text-sm sm:grid-cols-4"
        >
          <ReadField label="Material">{formatUnitCost(assembly.materialCost)}</ReadField>
          <ReadField label={`Overhead (${assembly.materialOverheadPct ?? 0}%)`}>
            {formatMoney(pricing.cost?.overhead ?? null)}
          </ReadField>
          <ReadField label="Labor">{formatUnitCost(assembly.laborCost)}</ReadField>
          <ReadField label="Total cost">{formatMoney(pricing.unitCost)}</ReadField>
          <ReadField label="Target GM">{formatPct(pricing.targetGM)}</ReadField>
          <ReadField label="Price">
            {formatMoney(pricing.price)}
            {pricing.isManual && (
              <span className="ml-1.5 rounded-full bg-ajax-yellow/20 px-1.5 py-0.5 text-[10px] font-semibold text-fg">
                Manual
              </span>
            )}
          </ReadField>
          <ReadField label="Achieved GM">{formatPct(pricing.gmPct)}</ReadField>
          <ReadField label="Markup %">{formatPct(pricing.markupPct)}</ReadField>
        </dl>
      )}
    </article>
  );
}

// -----------------------------------------------------------------------------
// Sidebar pieces
// -----------------------------------------------------------------------------

function SavedPdfs({ quoteBase }: { quoteBase: string }) {
  const { data: files = [], isLoading, error, refetch } = useQuotePdfs(quoteBase);
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="mb-2 font-display text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Saved PDFs</h3>
      {isLoading ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : error ? (
        <div className="text-sm text-fg-muted">
          <p>Couldn't list the IC Quotes folder.</p>
          <button type="button" onClick={() => void refetch()} className="mt-1 text-accent hover:underline">
            Try again
          </button>
        </div>
      ) : files.length === 0 ? (
        <p className="text-sm text-fg-muted">
          None saved yet. Generating a PDF saves nothing — use Save PDF to folder.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {files.map((f) => (
            <li key={f.webUrl}>
              <a
                href={f.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
              >
                {f.name}
                <ExternalLink className="h-3 w-3" />
              </a>
              {f.modifiedAt && (
                <span className="ml-1 text-[11px] text-fg-muted">{new Date(f.modifiedAt).toLocaleDateString()}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Small shared bits
// -----------------------------------------------------------------------------

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function ReadField({
  label,
  wide,
  note,
  children,
}: {
  label: string;
  wide?: boolean;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</dt>
      <dd className="whitespace-pre-wrap text-sm text-fg">
        {children === null || children === undefined || children === "" ? (
          <span className="text-fg-muted">Not set</span>
        ) : (
          children
        )}
      </dd>
      {note && <p className="mt-0.5 text-[11px] font-semibold text-fg-muted">{note}</p>}
    </div>
  );
}

function SidebarField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</div>
      {children}
    </div>
  );
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Edit ${label}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
    >
      <Pencil className="h-3 w-3" />
      Edit
    </button>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-md border border-border bg-surface p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      {children}
    </button>
  );
}

function ActionButton({
  onClick,
  icon,
  disabled,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-60"
    >
      {icon}
      {children}
    </button>
  );
}

interface DialogAction {
  label: string;
  onClick: () => void | Promise<void>;
  primary?: boolean;
  danger?: boolean;
}

/** One small confirmation dialog. Escape and the backdrop cancel — only this dialog. */
function ConfirmDialog({
  title,
  children,
  actions,
  onCancel,
  busy = false,
  cancelLabel = "Cancel",
}: {
  title: string;
  children: React.ReactNode;
  actions: DialogAction[];
  onCancel: () => void;
  busy?: boolean;
  cancelLabel?: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);
  const overlayDismiss = useOverlayDismiss(onCancel, busy);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="mt-24 w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <h2 className="font-display text-base font-semibold text-fg">{title}</h2>
        <p className="mt-2 text-sm text-fg">{children}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => void a.onClick()}
              disabled={busy}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60",
                a.danger
                  ? "bg-cooper-red text-white hover:bg-cooper-red/90"
                  : a.primary
                    ? "bg-accent text-white hover:bg-accent/90"
                    : "border border-border bg-surface text-fg hover:bg-surface-2",
              )}
            >
              {busy && a.primary && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
