import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Calculator, GraduationCap, Mail, MousePointerClick, Search, X } from "lucide-react";
import type { Person } from "@/types/task";
import type { PricingRequestStatus, PricingRoleEntry } from "@/types/pricing";
import { buildAddedToSapEmails, buildPricedEmails, buildPricingRequestRaisedEmails, requestDetails } from "@/lib/pricingAlerts";
import type { ChangeEmail } from "@/lib/changeAlerts";
import { targetOf } from "@/hooks/usePricingRequests";
import { sanitiseHtml } from "@/lib/sanitiseHtml";
import { cn } from "@/lib/cn";
import { PricingStatusChip } from "./pricingFields";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// The Pricing tour (Ray, 2026-11-23: "a guided tutorial on using the price
// request tool when a user presses Tour … demo screens showing the requester
// what to do and what happens, with a preview of how the person pricing things
// will work, and the email workflow").
//
// Two tracks — REQUESTING a price and PRICING a request — each a few steps of
// an explanation beside a DEMO SCREEN. Nothing here reads or writes a list:
// every figure, name and number is invented.
//
// THE EMAILS ARE THE REAL ONES. Each preview is built by the same builders the
// workflow sends (lib/pricingAlerts.ts), fed demo data — so when the wording
// or the recipients change there, the tour changes with them.
// =============================================================================

// ----------------------------------------------------------------------------- demo data (invented)

const REQUESTER: Person = { displayName: "Alex Requester", email: "alex.requester@example.com" };
const MANAGER: Person = { displayName: "Pat Pricing", email: "pat.pricing@example.com" };
const ADMIN: Person = { displayName: "Sam SAP-Admin", email: "sam.sapadmin@example.com" };
const WATCHER: Person = { displayName: "Jordan Watcher", email: "jordan.watcher@example.com" };

const ROLES: PricingRoleEntry[] = [
  { id: 1, email: MANAGER.email!, displayName: MANAGER.displayName, roles: ["manager"], note: "" },
  { id: 2, email: ADMIN.email!, displayName: ADMIN.displayName, roles: ["admin"], note: "" },
  { id: 3, email: REQUESTER.email!, displayName: REQUESTER.displayName, roles: ["requester"], note: "" },
];

const DEMO = {
  id: 42,
  requestNumber: "PR-2026-0042",
  altronicPartNumber: "799999-08",
  sapPartNumber: "9999-0001-00",
  description: "DEMO IGNITION MODULE, 8 CYL",
  customerName: "Demo Compression Co.",
  customerSoldTo: "100001",
};

const TARGET = targetOf(DEMO);

function demoEmails() {
  const details = requestDetails(DEMO);
  const raisedInSap = buildPricingRequestRaisedEmails({
    target: TARGET,
    actor: REQUESTER,
    requester: REQUESTER,
    roles: ROLES,
    inSap: true,
    details,
  });
  const raisedNotInSap = buildPricingRequestRaisedEmails({
    target: TARGET,
    actor: REQUESTER,
    requester: REQUESTER,
    roles: ROLES,
    inSap: false,
    details,
  });
  const addedToSap = buildAddedToSapEmails({
    target: TARGET,
    actor: ADMIN,
    requester: REQUESTER,
    roles: ROLES,
    sapPartNumber: DEMO.sapPartNumber,
  });
  const priced = buildPricedEmails({
    target: TARGET,
    actor: MANAGER,
    requester: REQUESTER,
    watchers: [WATCHER],
    listPrice: 3450,
    customerName: DEMO.customerName,
    customerPrice: 2277,
    leaveAsContactFactory: false,
    repriced: false,
  });
  const forPerson = (emails: ChangeEmail[], p: Person) => emails.find((e) => e.email === p.email) ?? null;
  return {
    toManagers: forPerson(raisedInSap, MANAGER),
    receipt: forPerson(raisedInSap, REQUESTER),
    toAdmins: forPerson(raisedNotInSap, ADMIN),
    receiptNotInSap: forPerson(raisedNotInSap, REQUESTER),
    readyToPrice: forPerson(addedToSap, MANAGER),
    inSapNow: forPerson(addedToSap, REQUESTER),
    pricedToRequester: forPerson(priced, REQUESTER),
    pricedToWatcher: forPerson(priced, WATCHER),
  };
}

// ----------------------------------------------------------------------------- building blocks

/** A browser-ish frame around a demo screen, so it never reads as the real page. */
function DemoScreen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg shadow-xs" aria-label={`Demo screen: ${title}`} role="img">
      <div className="flex items-center gap-1.5 border-b border-border bg-surface-2 px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-cooper-red/60" />
        <span className="h-2 w-2 rounded-full bg-ajax-yellow/60" />
        <span className="h-2 w-2 rounded-full bg-cooper-green/60" />
        <span className="ml-2 truncate text-[11px] text-fg-muted">{title}</span>
        <span className="ml-auto rounded-sm bg-ajax-yellow/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-fg-muted">Demo</span>
      </div>
      <div className="flex flex-col gap-2 p-3 text-xs">{children}</div>
    </div>
  );
}

/** "Press this" — a ring around the control the step is about. The label sits over its RIGHT edge: every one is on the right. */
function Press({ children, label = "Press this" }: { children: React.ReactNode; label?: string }) {
  return (
    <span className="relative inline-flex">
      <span className="rounded-md ring-2 ring-accent ring-offset-2 ring-offset-bg">{children}</span>
      <span className="absolute -top-5 right-0 flex items-center gap-1 whitespace-nowrap rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">
        <MousePointerClick className="h-3 w-3" /> {label}
      </span>
    </span>
  );
}

function FakeButton({ children, primary = false }: { children: React.ReactNode; primary?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium",
        primary ? "bg-accent text-white" : "border border-border bg-surface text-fg",
      )}
    >
      {children}
    </span>
  );
}

function FakeField({ label, value, required = false, hint, muted = false }: { label: string; value: string; required?: boolean; hint?: string; muted?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
        {label} {required && <span className="text-cooper-red">*</span>}
      </span>
      <span className={cn("rounded-md border border-border bg-surface px-2 py-1", muted ? "text-fg-muted italic" : "text-fg")}>{value || " "}</span>
      {hint && <span className="text-[10px] text-fg-muted">{hint}</span>}
    </div>
  );
}

function Row({ cells, highlight = false }: { cells: React.ReactNode[]; highlight?: boolean }) {
  return (
    <div className={cn("grid grid-cols-[6.5rem_1fr_6.5rem] items-center gap-2 rounded-md px-2 py-1.5", highlight ? "bg-accent/10 ring-1 ring-accent" : "bg-surface")}>
      {cells.map((c, i) => (
        <span key={i} className="truncate">
          {c}
        </span>
      ))}
    </div>
  );
}

/** One email as the recipient sees it — the real builder's wording. */
function EmailPreview({ email, to }: { email: ChangeEmail | null; to: string }) {
  if (!email) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface text-xs shadow-xs" aria-label={`Email: ${email.subject}`}>
      <div className="flex items-center gap-1.5 bg-cooper-red px-3 py-1.5 text-white">
        <Mail className="h-3.5 w-3.5" />
        <span className="font-semibold">ARC</span>
        <span className="ml-auto text-[10px] opacity-90">from ARC's notification mailbox</span>
      </div>
      <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-0.5 border-b border-border px-3 py-1.5 text-[11px]">
        <dt className="text-fg-muted">To</dt>
        <dd className="text-fg">{to}</dd>
        <dt className="text-fg-muted">Subject</dt>
        <dd className="font-semibold text-fg">{TARGET.title}</dd>
        <dt className="text-fg-muted">Preview</dt>
        <dd className="text-fg">{email.subject}</dd>
      </dl>
      <div className="flex flex-col gap-1 px-3 py-2">
        <div dangerouslySetInnerHTML={{ __html: sanitiseHtml(email.headlineHtml) }} />
        {email.detailHtml && <div className="text-fg-muted" dangerouslySetInnerHTML={{ __html: sanitiseHtml(email.detailHtml) }} />}
        <span className="mt-1 self-start rounded-md bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">Open in ARC</span>
      </div>
    </div>
  );
}

function StatusFlow({ current }: { current: PricingRequestStatus }) {
  const flow: PricingRequestStatus[] = ["Awaiting SAP", "Submitted", "In Review", "Priced"];
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label="Status flow">
      {flow.map((s, i) => (
        <span key={s} className="flex items-center gap-1">
          <span className={cn(s === current ? "" : "opacity-45")}>
            <PricingStatusChip status={s} />
          </span>
          {i < flow.length - 1 && <ArrowRight className="h-3 w-3 text-fg-muted" />}
        </span>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------- the steps

interface TourStep {
  title: string;
  body: React.ReactNode;
  screen: React.ReactNode;
}

type Track = "request" | "price";

function useSteps(): Record<Track, TourStep[]> {
  return useMemo(() => {
    const m = demoEmails();
    const request: TourStep[] = [
      {
        title: "Welcome to Pricing",
        body: (
          <>
            <p>
              Pricing is where you ask for a price on an Altronic part, and where the pricing managers work it out and send
              it back to you.
            </p>
            <p>
              This tour walks you through <strong>requesting a price</strong>, then shows what happens on the{" "}
              <strong>pricing side</strong> and every email that goes out on the way. Everything you'll see is demo data.
            </p>
            <p className="text-fg-muted">Who can do what comes from the Pricing Roles list: Requester, Manager or Admin.</p>
          </>
        ),
        screen: (
          <DemoScreen title="Pricing — Requests">
            <div className="flex items-center gap-2">
              <span className="font-display text-sm font-semibold">Pricing requests</span>
              <span className="ml-auto">
                <FakeButton primary>+ New request</FakeButton>
              </span>
            </div>
            <Row cells={["PR-2026-0041", "HARNESS, DEMO, 25 FT", <PricingStatusChip key="s" status="In Review" />]} />
            <Row cells={["PR-2026-0040", "DEMO DISPLAY MODULE", <PricingStatusChip key="s" status="Priced" />]} />
            <Row cells={["PR-2026-0039", "DEMO SENSOR KIT", <PricingStatusChip key="s" status="Awaiting SAP" />]} />
          </DemoScreen>
        ),
      },
      {
        title: "1. Press New request",
        body: (
          <p>
            On the Requests tab, press <strong>New request</strong>. The list opens on the requests still in progress;
            the pills across the top filter by status, and every column sorts.
          </p>
        ),
        screen: (
          <DemoScreen title="Pricing — Requests">
            <div className="flex items-center gap-2 pt-4">
              <span className="font-display text-sm font-semibold">Pricing requests</span>
              <span className="ml-auto">
                <Press>
                  <FakeButton primary>+ New request</FakeButton>
                </Press>
              </span>
            </div>
            <Row cells={["PR-2026-0041", "HARNESS, DEMO, 25 FT", <PricingStatusChip key="s" status="In Review" />]} />
          </DemoScreen>
        ),
      },
      {
        title: "2. Enter the part — ARC finds it in SAP",
        body: (
          <>
            <p>
              Type the <strong>Altronic part #</strong> or the <strong>SAP part #</strong>, whichever you know. ARC looks it
              up in SAP as you type and fills in the other number and the description.
            </p>
            <p className="text-fg-muted">Don't know either? Type a description — the managers will sort it out.</p>
          </>
        ),
        screen: (
          <DemoScreen title="New pricing request">
            <div className="grid grid-cols-2 gap-2">
              <FakeField label="Altronic part #" value={DEMO.altronicPartNumber} />
              <FakeField label="SAP part #" value={DEMO.sapPartNumber} hint="Filled in from SAP" />
            </div>
            <FakeField label="Description" value={DEMO.description} required hint="Filled in from SAP — yours is kept too" />
            <span className="flex items-center gap-1 text-[11px] text-cooper-green">
              <Search className="h-3 w-3" /> Found in SAP: {DEMO.altronicPartNumber} · {DEMO.sapPartNumber}
            </span>
          </DemoScreen>
        ),
      },
      {
        title: "3. Who it's for, and the customer",
        body: (
          <>
            <p>
              <strong>Requested by</strong> is you, unless you're raising it for someone else. Then find the{" "}
              <strong>customer</strong>: type their sold-to number or name and pick them from SAP — their customer group
              fills in, which is what decides their discount.
            </p>
            <p>
              Only the <strong>customer name</strong> is required. Leave the sold-to number blank for a prospect or a new
              account. Add any <strong>notes</strong> the manager should know — volumes, timing, what the customer asked
              for.
            </p>
          </>
        ),
        screen: (
          <DemoScreen title="New pricing request">
            <FakeField label="Requested by" value={`Me (${REQUESTER.displayName})`} required />
            <div className="grid grid-cols-3 gap-2">
              <FakeField label="Sold-to #" value={DEMO.customerSoldTo} hint="Optional" />
              <div className="col-span-2">
                <FakeField label="Customer name" value={DEMO.customerName} required />
              </div>
            </div>
            <FakeField label="Customer group" value="From SAP" muted />
            <FakeField label="Notes" value="About 40 a year, first order in March." />
            <div className="flex justify-end pt-4">
              <Press label="Then press Submit">
                <FakeButton primary>Submit</FakeButton>
              </Press>
            </div>
          </DemoScreen>
        ),
      },
      {
        title: "4. Submit — where it goes next",
        body: (
          <>
            <p>When you submit, ARC checks the part in SAP once more:</p>
            <ul className="list-disc pl-5">
              <li>
                <strong>In SAP</strong> — the request is <strong>Submitted</strong>, the pricing managers are emailed, and
                you get a receipt.
              </li>
              <li>
                <strong>Not in SAP yet</strong> — it is <strong>Awaiting SAP</strong>, and the pricing admins are asked to
                set the part up first. You're told that too.
              </li>
            </ul>
            <p className="text-fg-muted">Here are the emails, exactly as ARC sends them.</p>
          </>
        ),
        screen: (
          <div className="flex flex-col gap-2">
            <StatusFlow current="Submitted" />
            <EmailPreview email={m.receipt} to={`${REQUESTER.displayName} (you)`} />
            <EmailPreview email={m.toManagers} to="The pricing managers" />
          </div>
        ),
      },
      {
        title: "If the part isn't in SAP yet",
        body: (
          <>
            <p>
              A part SAP doesn't hold yet waits at <strong>Awaiting SAP</strong>. A pricing admin sets it up in SAP and
              presses <strong>Added to SAP</strong> on your request — it moves to Submitted, the managers are told it's
              ready to price, and so are you.
            </p>
          </>
        ),
        screen: (
          <div className="flex flex-col gap-2">
            <StatusFlow current="Awaiting SAP" />
            <EmailPreview email={m.toAdmins} to="The pricing admins" />
            <EmailPreview email={m.inSapNow} to={`${REQUESTER.displayName} (you), once it's added`} />
          </div>
        ),
      },
      {
        title: "5. Follow it, talk about it",
        body: (
          <>
            <p>
              Open your request any time to see where it is. The first time a manager opens it, it moves to{" "}
              <strong>In Review</strong>.
            </p>
            <p>
              Use the <strong>comments</strong> to answer questions — type <strong>@</strong> and a name to bring someone
              in; they're emailed and start watching. Anyone <strong>watching</strong> hears about comments and the
              price. Attach drawings or the customer's email under Attachments.
            </p>
            <p className="text-fg-muted">Changed your mind? Cancel it with a reason, any time before it's priced.</p>
          </>
        ),
        screen: (
          <DemoScreen title={`${DEMO.requestNumber} — ${DEMO.altronicPartNumber}`}>
            <StatusFlow current="In Review" />
            <div className="rounded-md border border-border bg-surface p-2">
              <span className="text-[10px] font-semibold uppercase text-fg-muted">Comments</span>
              <p className="mt-1">
                <strong>{MANAGER.displayName}</strong>: Is this the standard 8-cylinder, or the extended-temp version?
              </p>
              <p className="mt-1">
                <strong>{REQUESTER.displayName}</strong>: Standard. <span className="rounded-sm bg-accent/15 px-1 text-accent">@{WATCHER.displayName}</span> can
                confirm the volumes.
              </p>
            </div>
            <div className="flex gap-2">
              <FakeButton>Watch</FakeButton>
              <FakeButton>Attachments</FakeButton>
              <FakeButton>Cancel request</FakeButton>
            </div>
          </DemoScreen>
        ),
      },
      {
        title: "6. Priced — the answer comes to you",
        body: (
          <>
            <p>
              When the manager sets the price, the request is <strong>Priced</strong> and you and everyone watching are
              emailed the <strong>final price</strong> — the list price, the price for your customer, and whether the
              part stays <strong>Contact Factory</strong>.
            </p>
            <p>
              You see the final price only, never cost or margin. Download a <strong>Customer PDF</strong> from the
              request to send the customer.
            </p>
          </>
        ),
        screen: (
          <div className="flex flex-col gap-2">
            <StatusFlow current="Priced" />
            <EmailPreview email={m.pricedToRequester} to={`${REQUESTER.displayName} (you) and everyone watching`} />
            <DemoScreen title={`${DEMO.requestNumber} — Final price`}>
              <div className="grid grid-cols-2 gap-2">
                <FakeField label="List price" value="$3,450.00" />
                <FakeField label={`Price for ${DEMO.customerName}`} value="$2,277.00" />
              </div>
              <div className="flex justify-end">
                <Press label="For the customer">
                  <FakeButton>Customer PDF</FakeButton>
                </Press>
              </div>
            </DemoScreen>
          </div>
        ),
      },
    ];

    const price: TourStep[] = [
      {
        title: "The pricing side",
        body: (
          <>
            <p>
              This is a preview of what the <strong>pricing managers</strong> do with your request. Managers and admins
              see cost and margin; requesters never do.
            </p>
            <p>
              A new request lands in their inbox and on the Requests list as <strong>Submitted</strong>. Opening it moves it
              to <strong>In Review</strong> — so you can see someone's on it. No email goes out for that.
            </p>
          </>
        ),
        screen: (
          <div className="flex flex-col gap-2">
            <EmailPreview email={m.toManagers} to={`${MANAGER.displayName} and the other pricing managers`} />
            <StatusFlow current="In Review" />
          </div>
        ),
      },
      {
        title: "1. Cost and the market, from SAP",
        body: (
          <>
            <p>
              The manager's <strong>Price this request</strong> panel shows SAP's current <strong>cost</strong> and the{" "}
              <strong>distributor discount</strong> for the part's material price group.
            </p>
            <p>
              Beside it are <strong>comparables</strong>: other parts in the same material price group and the same
              six-digit family, each with its list price, cost and margin, and the average — so a new price sits sensibly
              among the parts customers already buy.
            </p>
          </>
        ),
        screen: (
          <DemoScreen title={`${DEMO.requestNumber} — Price this request`}>
            <div className="grid grid-cols-3 gap-2">
              <FakeField label="Cost (SAP)" value="$1,180.00" />
              <FakeField label="Price group" value="QX" />
              <FakeField label="Distributor discount" value="34%" />
            </div>
            <div className="rounded-md border border-superior-blue/40 bg-superior-blue/5 p-2">
              <span className="text-[10px] font-semibold uppercase text-fg-muted">Comparables — same family</span>
              <Row cells={["799999-16", "DEMO MODULE, 16 CYL", "base GM 48%"]} />
              <Row cells={["799999-18", "DEMO MODULE, 18 CYL", "base GM 51%"]} />
              <span className="text-[10px] text-fg-muted">Average base GM 49.5% over 2 parts</span>
            </div>
          </DemoScreen>
        ),
      },
      {
        title: "2. Set the price",
        body: (
          <>
            <p>
              The manager types a <strong>target margin</strong> or a <strong>list price</strong>. ARC works out the rest:
              the list price, the margin it earns, and the price for <em>this</em> customer after their own discount.
            </p>
            <p>
              They also answer <strong>Leave as Contact Factory?</strong> — Yes or No — which you'll see with the price.
            </p>
          </>
        ),
        screen: (
          <DemoScreen title={`${DEMO.requestNumber} — Price this request`}>
            <div className="grid grid-cols-3 gap-2">
              <FakeField label="Target GM" value="49%" />
              <FakeField label="List price" value="$3,450.00" />
              <FakeField label="Customer price" value="$2,277.00" />
            </div>
            <FakeField label="Leave as Contact Factory?" value="No" required />
            <div className="flex justify-end pt-4">
              <Press label="Sends the price">
                <FakeButton primary>Set price</FakeButton>
              </Press>
            </div>
          </DemoScreen>
        ),
      },
      {
        title: "3. Set price — what happens",
        body: (
          <>
            <p>
              <strong>Set price</strong> saves how the price was reached to the <strong>price history</strong> first (only
              managers and admins can read it), then puts the final price on the request and marks it{" "}
              <strong>Priced</strong>.
            </p>
            <p>The requester and everyone watching are emailed. The manager who priced it isn't.</p>
            <p className="text-fg-muted">
              A manager can <strong>reopen</strong> a priced request to change it; the earlier price stays in the history,
              and the new one goes out as <em>Re-priced</em>.
            </p>
          </>
        ),
        screen: (
          <div className="flex flex-col gap-2">
            <StatusFlow current="Priced" />
            <EmailPreview email={m.pricedToWatcher} to={`${REQUESTER.displayName}, ${WATCHER.displayName} and other watchers`} />
          </div>
        ),
      },
      {
        title: "Every email, in one place",
        body: (
          <>
            <p>Nobody needs to remember who to tell — ARC sends these by itself:</p>
            <table className="mt-1 w-full text-left text-xs">
              <thead className="text-fg-muted">
                <tr>
                  <th className="py-1 pr-2 font-semibold">When</th>
                  <th className="py-1 font-semibold">Who's emailed</th>
                </tr>
              </thead>
              <tbody className="align-top">
                <tr className="border-t border-border">
                  <td className="py-1 pr-2">Raised, part in SAP</td>
                  <td className="py-1">The pricing managers; a receipt to the requester</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="py-1 pr-2">Raised, part not in SAP</td>
                  <td className="py-1">The pricing admins, to set it up; a receipt to the requester</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="py-1 pr-2">Added to SAP</td>
                  <td className="py-1">The pricing managers; the requester</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="py-1 pr-2">Priced / Re-priced</td>
                  <td className="py-1">The requester and every watcher</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="py-1 pr-2">A comment</td>
                  <td className="py-1">Watchers, and anyone @-mentioned (who then watch it)</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="py-1 pr-2">In Review, Cancelled</td>
                  <td className="py-1">No email — the status shows on the request</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-fg-muted">
              You never get an email about something you did yourself. Every email about one request lands in one Outlook
              conversation.
            </p>
          </>
        ),
        screen: (
          <div className="flex flex-col gap-2">
            <EmailPreview email={m.readyToPrice} to="The pricing managers, after Added to SAP" />
            <EmailPreview email={m.receiptNotInSap} to={`${REQUESTER.displayName}, when the part isn't in SAP yet`} />
          </div>
        ),
      },
      {
        title: "Also on the Pricing bar",
        body: (
          <>
            <p>
              <strong>Calculator</strong> — a quick customer price from a cost and a margin, with SAP's cost for any SAP part
              number. Nothing is saved. Every pricing role has it.
            </p>
            <p>
              <strong>New Products</strong> — managers price a product not in SAP yet from its sub-assemblies and parts.{" "}
              <strong>Customer Quotes</strong> — managers build a quote with a customer PDF.
            </p>
            <p className="text-fg-muted">Press Tour on the Pricing bar to see this again.</p>
          </>
        ),
        screen: (
          <DemoScreen title="Pricing bar">
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-1 pt-5">
              <span className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white">Requests</span>
              <span className="px-3 py-1 text-xs font-semibold text-fg-muted">New Products</span>
              <span className="px-3 py-1 text-xs font-semibold text-fg-muted">Customer Quotes</span>
              <span className="ml-auto flex gap-1">
                <FakeButton>
                  <GraduationCap className="h-3.5 w-3.5" /> Tour
                </FakeButton>
                <Press label="Quick price">
                  <FakeButton>
                    <Calculator className="h-3.5 w-3.5" /> Calculator
                  </FakeButton>
                </Press>
              </span>
            </div>
          </DemoScreen>
        ),
      },
    ];
    return { request, price };
  }, []);
}

// ----------------------------------------------------------------------------- the dialog

export function PricingTour({ onClose }: { onClose: () => void }) {
  const steps = useSteps();
  const [track, setTrack] = useState<Track>("request");
  const [index, setIndex] = useState(0);
  const list = steps[track];
  const step = list[Math.min(index, list.length - 1)];
  const last = index >= list.length - 1;
  const overlayDismiss = useOverlayDismiss(onClose);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, list.length - 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, list.length]);

  function choose(next: Track) {
    setTrack(next);
    setIndex(0);
  }

  function next() {
    if (!last) setIndex(index + 1);
    else if (track === "request") choose("price");
    else onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4" {...overlayDismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pricing tour"
        className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-xl"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <GraduationCap className="h-5 w-5 text-accent" />
          <h2 className="font-display text-base font-semibold">Pricing tour</h2>
          <div className="ml-2 flex gap-1 rounded-lg border border-border bg-surface p-0.5" role="tablist" aria-label="Tour track">
            {(
              [
                ["request", "Requesting a price"],
                ["price", "Pricing a request"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={track === key}
                onClick={() => choose(key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-semibold",
                  track === key ? "bg-accent text-white" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} aria-label="Close tour" className="ml-auto rounded-sm p-1 text-fg-muted hover:text-fg">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section aria-label="Step" className="flex flex-col gap-2 text-sm leading-relaxed text-fg">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Step {index + 1} of {list.length}
            </span>
            <h3 className="font-display text-lg font-semibold">{step.title}</h3>
            <div className="flex flex-col gap-2">{step.body}</div>
          </section>
          <section aria-label="Demo" className="flex flex-col gap-2">
            {step.screen}
          </section>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <div className="flex gap-1" aria-label="Steps">
            {list.map((s, i) => (
              <button
                key={s.title}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Go to step ${i + 1}: ${s.title}`}
                aria-current={i === index ? "step" : undefined}
                className={cn("h-2 rounded-full transition-all", i === index ? "w-5 bg-accent" : "w-2 bg-border hover:bg-fg-muted")}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setIndex(index - 1)}
            disabled={index === 0}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg disabled:opacity-40"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <button
            type="button"
            onClick={next}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
          >
            {!last ? (
              <>
                Next <ArrowRight className="h-4 w-4" />
              </>
            ) : track === "request" ? (
              <>
                See the pricing side <ArrowRight className="h-4 w-4" />
              </>
            ) : (
              "Finish"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The Tour button on the Pricing bar. */
export function PricingTourButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Pricing tour"
        title="A guided tour of requesting and pricing"
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <GraduationCap className="h-3.5 w-3.5" />
        Tour
      </button>
      {open && <PricingTour onClose={() => setOpen(false)} />}
    </>
  );
}
