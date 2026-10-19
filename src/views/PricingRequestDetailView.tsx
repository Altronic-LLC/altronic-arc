import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Ban, CheckCircle2, Download, Loader2, RotateCcw, X } from "lucide-react";
import type { Comment, Person } from "@/types/task";
import {
  collectPricingPeople,
  useAddPricingRequestComment,
  useCancelPricingRequest,
  useEditPricingRequestComment,
  useMarkAddedToSap,
  usePricingHistory,
  usePricingRequest,
  usePricingRequests,
  useReopenPricingRequest,
  useSetPricingRequestWatchers,
  useStartPricingReview,
} from "@/hooks/usePricingRequests";
import type { MyPricingAccess } from "@/hooks/usePricingRoles";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useCommentFileUpload } from "@/hooks/useAttachments";
import { addedToSapGate, cancelRequestGate, priceGate, seePricingCostGate } from "@/lib/pricingRoles";
import { matchesAnyEmail } from "@/lib/emailIdentity";
import { mergePeople, personKey } from "@/lib/people";
import { formatMoney } from "@/lib/quoteMoney";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { SAP_DATA_CONNECTED } from "@/api/pricingLookup";
import { downloadBlob } from "@/hooks/useQuotePdf";
import { generatePricingPdf, pricingPdfFileName, requestPdfModel } from "@/lib/pricingPdf";
import { pushToast } from "@/components/Toast";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { CommentComposer } from "@/components/CommentComposer";
import { CommentThread } from "@/components/CommentThread";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { PersonMultiField } from "@/components/PersonMultiField";
import { PricingWorkbench } from "@/components/PricingWorkbench";
import { useOverlayDismiss } from "@/components/useOverlayDismiss";
import {
  ActionButton,
  PricingAccessGate,
  PricingCard,
  PricingPage,
  PricingStatusChip,
  ReadField,
} from "@/components/pricingAtoms";

// =============================================================================
// One pricing request (/sales/pricing/request/:id).
//
// Everybody with a pricing role sees the request, its FINAL price, the
// discussion and attachments. A pricing manager or admin also sees the
// pricing panel (PricingWorkbench) — cost, discounts, comparables, history.
//
// Opening a Submitted request as a manager moves it to In Review, once, so the
// requester can see somebody has picked it up.
// =============================================================================

export function PricingRequestDetailView() {
  return <PricingAccessGate>{(access) => <RequestDetail access={access} />}</PricingAccessGate>;
}

function RequestDetail({ access }: { access: MyPricingAccess }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const requestId = id ? parseInt(id, 10) : null;
  const uploadCommentFile = useCommentFileUpload("pricingRequest", requestId);

  const { data: request, isLoading, error, refetch } = usePricingRequest(requestId);
  const { data: requests = [] } = usePricingRequests();
  const canSeeCost = seePricingCostGate(access).allowed;
  const canPrice = priceGate(access).allowed;
  const { data: history = null } = usePricingHistory(requestId, canSeeCost);
  const currentUser = useCurrentUser();
  const directory = useDirectoryPeople();

  const addComment = useAddPricingRequestComment();
  const editComment = useEditPricingRequestComment();
  const setWatchers = useSetPricingRequestWatchers();
  const startReview = useStartPricingReview();
  const reopen = useReopenPricingRequest();
  const [dialog, setDialog] = useState<"sap" | "cancel" | null>(null);

  // Submitted → In Review the first time a manager opens it. Once per page.
  const reviewStarted = useRef(false);
  useEffect(() => {
    if (!request || !canPrice || request.status !== "Submitted" || reviewStarted.current) return;
    reviewStarted.current = true;
    startReview.mutate(request.id);
  }, [request, canPrice, startReview]);

  const mentionCandidates = useMemo(
    () => mergePeople(collectPricingPeople(requests), directory, [currentUser]),
    [requests, directory, currentUser],
  );

  if (isLoading) {
    return (
      <PricingPage>
        <LoadingTasks noun="the request" />
      </PricingPage>
    );
  }
  if (error && !request) {
    return (
      <PricingPage>
        {isPermissionDenied(error) ? (
          <ListAccessNotice list="Pricing Requests" site="ALTRONICSALESTEAM" onRetry={() => void refetch()} />
        ) : (
          <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">Couldn't load the request.</p>
            <p className="mt-1">{error instanceof Error ? error.message : "Unknown error"}</p>
          </div>
        )}
      </PricingPage>
    );
  }
  if (!request) {
    return (
      <PricingPage>
        <div className="py-10 text-center">
          <p className="text-sm text-fg-muted">That request doesn't exist.</p>
          <button onClick={() => navigate("/sales/pricing")} className="mt-3 text-sm text-accent hover:underline">
            Back to pricing requests
          </button>
        </div>
      </PricingPage>
    );
  }

  const r = request;
  const isMine = !!r.requestedBy?.email && matchesAnyEmail([currentUser.email ?? ""], r.requestedBy.email);
  const sapGate = addedToSapGate(access);
  const cancelGate = cancelRequestGate(access, { status: r.status, isMine });

  function handleAddComment(bodyHtml: string) {
    return addComment
      .mutateAsync({
        id: r.id,
        comment: { authorName: currentUser.displayName, authorEmail: currentUser.email ?? "", bodyHtml },
      })
      .then(() => undefined);
  }

  async function handleEditComment(comment: Comment, newBodyHtml: string) {
    await editComment.mutateAsync({
      id: r.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      bodyHtml: newBodyHtml,
      previousBodyHtml: comment.bodyHtml,
    });
  }

  async function downloadPdf() {
    const model = requestPdfModel(r, { name: currentUser.displayName, email: currentUser.email ?? "" });
    if (!model) return;
    try {
      downloadBlob(await generatePricingPdf(model), pricingPdfFileName(model));
    } catch (err) {
      pushToast({ message: `Couldn't build the PDF: ${err instanceof Error ? err.message : "unknown error"}`, variant: "error" });
    }
  }

  function toggledWatchers(person: Person): Person[] {
    const key = personKey(person);
    return r.watchers.some((p) => personKey(p) === key)
      ? r.watchers.filter((p) => personKey(p) !== key)
      : [...r.watchers, person];
  }

  return (
    <PricingPage wide>
      <DetailTopBar category="Pricing" listTo="/sales/pricing" />

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">{r.requestNumber}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <PricingStatusChip status={r.status} />
            <span className="font-mono text-fg">{r.altronicPartNumber}</span>
            <span className="text-fg-muted">{r.description}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {r.status === "Awaiting SAP" && sapGate.allowed && (
            <ActionButton primary onClick={() => setDialog("sap")} icon={<CheckCircle2 className="h-4 w-4" />}>
              Added to SAP
            </ActionButton>
          )}
          {r.status === "Priced" && r.listPrice !== null && (
            <ActionButton onClick={() => void downloadPdf()} icon={<Download className="h-4 w-4" />}>
              Customer PDF
            </ActionButton>
          )}
          {r.status === "Priced" && canPrice && (
            <ActionButton
              onClick={() => reopen.mutate(r.id)}
              disabled={reopen.isPending}
              icon={reopen.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            >
              Reopen to re-price
            </ActionButton>
          )}
          {cancelGate.allowed && (
            <ActionButton onClick={() => setDialog("cancel")} icon={<Ban className="h-4 w-4" />}>
              {isMine && r.status !== "Priced" && !canPrice ? "Withdraw request" : "Cancel request"}
            </ActionButton>
          )}
        </div>
      </div>

      {r.status === "Awaiting SAP" && (
        <div role="status" className="rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 px-4 py-3 text-sm text-fg">
          This part isn't in SAP yet. A pricing admin sets it up in SAP and presses <strong>Added to SAP</strong>; then it
          goes to the pricing managers.
        </div>
      )}
      {r.status === "Cancelled" && r.cancelReason && (
        <div role="status" className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-fg">
          <strong>Cancelled:</strong> {r.cancelReason}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <PricingCard title="Request">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ReadField label="Altronic part #">{r.altronicPartNumber}</ReadField>
              <ReadField label="SAP part #">{r.sapPartNumber}</ReadField>
              <ReadField label="Description" wide>
                {r.description}
              </ReadField>
              {r.requestedDescription && r.requestedDescription !== r.description && (
                <ReadField label="As requested" wide>
                  {r.requestedDescription}
                </ReadField>
              )}
              <ReadField label="Customer">
                {r.customerName ? `${r.customerName}${r.customerSoldTo ? ` (${r.customerSoldTo})` : ""}` : null}
              </ReadField>
              <ReadField label="Customer group">{r.customerGroup}</ReadField>
              <ReadField label="Material price group">{r.mpg}</ReadField>
              <ReadField label="Requested by">{r.requestedBy?.displayName}</ReadField>
              <ReadField label="Notes" wide>
                {r.notes}
              </ReadField>
            </dl>
          </PricingCard>

          <PricingCard title="Price" testId="request-price" tone="price">
            {r.listPrice === null ? (
              <p className="text-sm text-fg-muted">
                {r.status === "Cancelled" ? "Not priced." : "Not priced yet — you'll be emailed when it is."}
              </p>
            ) : (
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <ReadField label="List price">
                  <span className="text-lg font-semibold">{formatMoney(r.listPrice)}</span>
                </ReadField>
                <ReadField label={`Price for ${r.customerName || "the customer"}`}>
                  {r.customerPrice === null ? null : (
                    <span className="text-lg font-semibold">
                      {formatMoney(r.customerPrice)}
                      {r.customerDiscountPct !== null && (
                        <span className="ml-1 text-xs font-normal text-fg-muted">({r.customerDiscountPct}% off list)</span>
                      )}
                    </span>
                  )}
                </ReadField>
                <ReadField label="Leave as Contact Factory">
                  {r.leaveAsContactFactory === null ? null : (
                    <span className="text-lg font-semibold">{r.leaveAsContactFactory ? "Yes" : "No"}</span>
                  )}
                </ReadField>
                <ReadField label="Priced">
                  {r.pricedBy
                    ? `${r.pricedBy.displayName}${r.pricedAt ? ` · ${new Date(r.pricedAt).toLocaleDateString()}` : ""}`
                    : null}
                </ReadField>
              </dl>
            )}
          </PricingCard>

          {canSeeCost && r.status !== "Awaiting SAP" && (
            <PricingWorkbench key={`${r.id}-${r.status}`} request={r} history={history} canPrice={canPrice} />
          )}

          <div className="min-w-0">
            <AttachmentsSection parent="pricingRequest" itemId={r.id} />
          </div>

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Discussion</h2>
            <CommentComposer
              draftKey={`pricingRequest:${r.id}`}
              uploadFile={uploadCommentFile}
              onSubmit={handleAddComment}
              mentionablePeople={mentionCandidates}
            />
            <div className="mt-5">
              <CommentThread
                uploadFile={uploadCommentFile}
                comments={r.comments}
                currentUserEmail={currentUser.email}
                currentUserName={currentUser.displayName}
                mentionablePeople={mentionCandidates}
                onEdit={handleEditComment}
                onReply={handleAddComment}
                draftKey={`pricingRequest:${r.id}`}
              />
            </div>
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
            <Sidebar label="Watchers">
              <PersonMultiField
                value={r.watchers}
                allPeople={mentionCandidates}
                onToggle={(p) => setWatchers.mutate({ id: r.id, people: toggledWatchers(p) })}
                emptyLabel="No watchers"
                searchPlaceholder="Add a watcher…"
              />
            </Sidebar>
            <Sidebar label="Raised">
              <p className="px-1 text-sm text-fg">
                {r.createdBy?.displayName ?? "—"}
                {r.createdAt && <span className="text-fg-muted"> · {new Date(r.createdAt).toLocaleDateString()}</span>}
              </p>
            </Sidebar>
            {r.addedToSapBy && (
              <Sidebar label="Added to SAP">
                <p className="px-1 text-sm text-fg">
                  {r.addedToSapBy.displayName}
                  {r.addedToSapAt && <span className="text-fg-muted"> · {new Date(r.addedToSapAt).toLocaleDateString()}</span>}
                </p>
              </Sidebar>
            )}
          </div>
        </aside>
      </div>

      {dialog === "sap" && <AddedToSapDialog requestId={r.id} partNumber={r.altronicPartNumber} onClose={() => setDialog(null)} />}
      {dialog === "cancel" && <CancelDialog requestId={r.id} number={r.requestNumber} onClose={() => setDialog(null)} />}

    </PricingPage>
  );
}

function Sidebar({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

function Dialog({
  title,
  onClose,
  pending,
  children,
}: {
  title: string;
  onClose: () => void;
  pending: boolean;
  children: React.ReactNode;
}) {
  const overlay = useOverlayDismiss(onClose, pending);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" {...overlay}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-fg">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-sm p-1 text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AddedToSapDialog({ requestId, partNumber, onClose }: { requestId: number; partNumber: string; onClose: () => void }) {
  const mark = useMarkAddedToSap();
  const [sap, setSap] = useState("");
  async function confirm() {
    try {
      await mark.mutateAsync({ id: requestId, sapPartNumber: sap });
      onClose();
    } catch {
      // The hook toasts the reason.
    }
  }
  return (
    <Dialog title="Added to SAP" onClose={onClose} pending={mark.isPending}>
      <p className="text-sm text-fg">
        ARC checks SAP for <strong>{partNumber}</strong>, fills in its SAP number and description, and sends the request to
        the pricing managers.
      </p>
      {!SAP_DATA_CONNECTED && (
        <label className="mt-3 flex flex-col gap-1 text-xs">
          <span className="font-semibold uppercase tracking-wider text-fg-muted">SAP part # it was set up under</span>
          <input value={sap} onChange={(e) => setSap(e.target.value)} className="input" autoFocus />
          <span className="text-[11px] text-fg-muted">SAP data isn't connected yet, so ARC can't look it up.</span>
        </label>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg">
          Not yet
        </button>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={mark.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {mark.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          It's in SAP
        </button>
      </div>
    </Dialog>
  );
}

function CancelDialog({ requestId, number, onClose }: { requestId: number; number: string; onClose: () => void }) {
  const cancel = useCancelPricingRequest();
  const [reason, setReason] = useState("");
  async function confirm() {
    try {
      await cancel.mutateAsync({ id: requestId, reason });
      onClose();
    } catch {
      // The hook toasts the reason.
    }
  }
  return (
    <Dialog title={`Cancel ${number}?`} onClose={onClose} pending={cancel.isPending}>
      <p className="text-sm text-fg">The request stays on record as Cancelled — nothing is deleted.</p>
      <label className="mt-3 flex flex-col gap-1 text-xs">
        <span className="font-semibold uppercase tracking-wider text-fg-muted">Why?</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="input" autoFocus />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg">
          Keep it
        </button>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={cancel.isPending || !reason.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-cooper-red px-3 py-1.5 text-sm font-medium text-white hover:bg-cooper-red/90 disabled:opacity-50"
        >
          {cancel.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Cancel request
        </button>
      </div>
    </Dialog>
  );
}
