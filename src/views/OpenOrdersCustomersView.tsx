import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Combine,
  FileSpreadsheet,
  Lock,
  Pencil,
  Plus,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import {
  useCreateOpenOrdersCustomer,
  useDeleteOpenOrdersCustomer,
  useMyOpenOrdersAccess,
  useOpenOrdersCustomers,
  useUpdateOpenOrdersCustomer,
} from "@/hooks/useOpenOrdersCustomers";
import {
  useGenerateCombinedCustomerReport,
  useGenerateCustomerReport,
  useParseExtract,
} from "@/hooks/useOpenOrdersReports";
import { SP_OPEN_ORDERS_CUSTOMERS_LIST_ID, USE_MOCK } from "@/api/config";
import { customerRollup, sameAccount } from "@/lib/openOrders";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ChoicePills } from "@/components/ChoicePills";
import { SingleSelect } from "@/components/SearchableSelect";
import type {
  OpenOrderCustomerAccount,
  OpenOrderCustomerAccountInput,
} from "@/types/task";
import { cn } from "@/lib/cn";

// =============================================================================
// The managed customer list — who gets an individual workbook each week.
//
// Two things this screen exists to make easy:
//
//  1. **Fixing the name.** SAP truncates Customer Name at 30 characters
//     ("Wabtec Transportation Systems,", "INNIO Waukesha Canada Corporat"),
//     and the workbook a CUSTOMER receives is named from this list. So the
//     name here is editable and the account number is the key.
//  2. **Getting started at all.** The live extract carries 71 accounts, and
//     nobody is typing those in one at a time — hence Import, which reads an
//     extract with the same parser the report uses and offers what it found.
// =============================================================================

const EMPTY: OpenOrderCustomerAccountInput = {
  accountNumber: "",
  customerName: "",
  active: true,
  notes: "",
};

export function OpenOrdersCustomersView() {
  const access = useMyOpenOrdersAccess();
  const { data: accounts = [], isLoading, error } = useOpenOrdersCustomers();

  // Whether the SharePoint list exists at all. Checked BEFORE anything invites
  // somebody to add a customer: the list used to render as "nobody here yet,
  // add one", and the real answer only arrived as a toast after they had typed
  // a name in and pressed Save (Ray, 2026-08-24).
  const configured = USE_MOCK || !!SP_OPEN_ORDERS_CUSTOMERS_LIST_ID;
  const create = useCreateOpenOrdersCustomer();
  const update = useUpdateOpenOrdersCustomer();
  const remove = useDeleteOpenOrdersCustomer();
  const generateOne = useGenerateCustomerReport();
  const generateCombined = useGenerateCombinedCustomerReport();

  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<OpenOrderCustomerAccountInput>(EMPTY);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  // Which row has its "combine with…" picker open. Exclusive — like `editing`
  // above, only one row can be mid-action at a time, so opening one closes
  // any other row's edit/combine state rather than stacking panels.
  const [combining, setCombining] = useState<number | null>(null);
  const [combineWith, setCombineWith] = useState<string | null>(null);

  const canEdit = access.isReportManager && configured;
  // Adding and removing are admin-only (Ray, 2026-08-25) — narrower than
  // editing, because who receives an external report is a different decision
  // from correcting a name or taking somebody off this week's run.
  const canAddOrRemove = access.canAddOrRemove && configured;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.customerName.toLowerCase().includes(q) ||
        a.accountNumber.toLowerCase().includes(q) ||
        a.notes.toLowerCase().includes(q),
    );
  }, [accounts, search]);

  const activeCount = accounts.filter((a) => a.active).length;

  if (isLoading) return <LoadingTasks />;

  function startEdit(account: OpenOrderCustomerAccount) {
    setCombining(null);
    setEditing(account.id);
    setDraft({
      accountNumber: account.accountNumber,
      customerName: account.customerName,
      active: account.active,
      notes: account.notes,
    });
  }

  function startCombine(accountId: number) {
    setEditing(null);
    setCombining(accountId);
    setCombineWith(null);
  }

  function save() {
    if (!draft.accountNumber.trim()) return;
    if (editing === "new") create.mutate(draft);
    else if (typeof editing === "number")
      update.mutate({ id: editing, input: draft });
    setEditing(null);
    setDraft(EMPTY);
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-2">
        <Link
          to="/sales/open-orders"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Open Orders
        </Link>
        <h1 className="flex items-center gap-2 font-display text-xl font-semibold text-fg">
          <Users className="h-5 w-5 text-accent" />
          Weekly report customers
        </h1>
        <p className="max-w-3xl text-sm text-fg-muted">
          Everyone on this list gets their own workbook each week. The{" "}
          <span className="font-medium text-fg">customer name</span> here is
          what the file is named after — SAP truncates its own at 30 characters,
          so this is the one customers see. Turn a customer{" "}
          <span className="font-medium text-fg">off</span> to take them out of
          the weekly run without losing the row.
        </p>
        <p className="max-w-3xl text-sm text-fg-muted">
          Added somebody after this week was already built?{" "}
          <strong className="text-fg">Build report</strong> on their row
          produces just their workbook from the extract already filed in
          SharePoint, into the same week folder as the rest — no need to re-run
          everything.
        </p>
        <p className="text-xs text-fg-muted">
          {activeCount} active of {accounts.length}
        </p>
        {configured && !canAddOrRemove && !access.isResolving && (
          <p className="text-xs text-fg-muted">
            Adding and removing customers is limited to admins. You can still
            edit anyone already on the list — including setting them to{" "}
            <strong className="text-fg">not active</strong>, which takes them
            off the weekly run.
          </p>
        )}
      </header>

      {!configured ? (
        <SetupNotice />
      ) : (
        !canEdit && (
          <div className="flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
            <span className="text-fg-muted">
              {access.isResolving
                ? "Checking your access…"
                : "This list is read-only for you. Ask an admin to add you as a report manager at Admin → Open Orders Roles."}
            </span>
          </div>
        )
      )}

      {/* A configured list that still failed to load is a different problem —
          usually SharePoint permission — and must not be reported as "not set
          up yet". */}
      {configured && error && (
        <div className="flex items-start gap-3 rounded-lg border border-cooper-red/30 bg-cooper-red/5 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-cooper-red" />
          <span className="text-fg-muted">
            <span className="font-medium text-fg">
              Couldn't load the customer list.
            </span>{" "}
            {error instanceof Error ? error.message : "Unknown error."}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, account or notes…"
          className="input min-w-48 flex-1"
        />
        {canAddOrRemove && (
          <>
            <button
              type="button"
              onClick={() => {
                setEditing("new");
                setDraft(EMPTY);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent/90"
            >
              <Plus className="h-4 w-4" />
              Add customer
            </button>
            <button
              type="button"
              onClick={() => setImporting(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface hover:text-fg"
            >
              <Upload className="h-4 w-4" />
              Import from an extract
            </button>
          </>
        )}
      </div>

      {editing === "new" && (
        <EditRow
          draft={draft}
          setDraft={setDraft}
          onSave={save}
          onCancel={() => setEditing(null)}
          busy={create.isPending}
        />
      )}

      {accounts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface/60 px-4 py-8 text-center text-sm text-fg-muted">
          {!configured
            ? "There's no list to read yet — see the setup steps above."
            : canAddOrRemove
              ? "Nobody on the list yet. Add a customer, or import the accounts from a raw extract."
              : "Nobody on the list yet. An admin needs to add the customers who get a weekly workbook."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {shown.map((account) =>
            editing === account.id ? (
              <li key={account.id} className="p-3">
                <EditRow
                  draft={draft}
                  setDraft={setDraft}
                  onSave={save}
                  onCancel={() => setEditing(null)}
                  busy={update.isPending}
                />
              </li>
            ) : (
              <Fragment key={account.id}>
              <li
                className="flex items-center gap-3 px-4 py-3"
              >
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    account.active ? "bg-cooper-green" : "bg-fg-muted/40",
                  )}
                  title={
                    account.active ? "On the weekly run" : "Off the weekly run"
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span
                      className={cn(
                        "truncate text-sm font-medium",
                        account.active
                          ? "text-fg"
                          : "text-fg-muted line-through",
                      )}
                    >
                      {account.customerName || "(no name)"}
                    </span>
                    <span className="font-mono text-xs text-fg-muted">
                      {account.accountNumber}
                    </span>
                  </div>
                  {account.notes && (
                    <span className="block truncate text-xs text-fg-muted">
                      {account.notes}
                    </span>
                  )}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-1">
                    {account.active && (
                      <button
                        type="button"
                        disabled={generateOne.isPending}
                        onClick={() => generateOne.mutate(account)}
                        title={`Build ${account.customerName || account.accountNumber}'s workbook from the extract already in SharePoint`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface hover:text-fg disabled:opacity-60"
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                        {generateOne.isPending &&
                        generateOne.variables?.id === account.id
                          ? (generateOne.step ?? "Working…")
                          : "Build report"}
                      </button>
                    )}
                    {account.active && activeCount > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          combining === account.id ? setCombining(null) : startCombine(account.id)
                        }
                        aria-expanded={combining === account.id}
                        title={`Combine ${account.customerName || account.accountNumber} with a second account, each on its own tab`}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                          combining === account.id
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-border bg-surface-2 text-fg-muted hover:bg-surface hover:text-fg",
                        )}
                      >
                        <Combine className="h-3.5 w-3.5" />
                        Combine…
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => startEdit(account)}
                      aria-label={`Edit ${account.customerName || account.accountNumber}`}
                      className="rounded p-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {canAddOrRemove && (
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove ${account.customerName || account.accountNumber} from the report list?\n\n` +
                                "To take them off the weekly run but keep the row, edit them and set Active to No instead.",
                            )
                          ) {
                            remove.mutate(account.id);
                          }
                        }}
                        aria-label={`Remove ${account.customerName || account.accountNumber}`}
                        className="rounded p-1.5 text-fg-muted transition-colors hover:bg-cooper-red/10 hover:text-cooper-red"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </li>
              {combining === account.id && (
                <li className="border-t border-dashed border-border bg-surface-2/40 px-4 py-3">
                  <CombinePanel
                    account={account}
                    others={accounts.filter(
                      (a) => a.active && !sameAccount(a.accountNumber, account.accountNumber),
                    )}
                    combineWith={combineWith}
                    setCombineWith={setCombineWith}
                    onBuild={(other) => generateCombined.mutate([account, other])}
                    onCancel={() => setCombining(null)}
                    busy={generateCombined.isPending}
                    step={generateCombined.step}
                  />
                </li>
              )}
              </Fragment>
            ),
          )}
        </ul>
      )}

      {importing && (
        <ImportPanel
          existing={accounts}
          onClose={() => setImporting(false)}
          onAdd={(input) => create.mutate(input)}
        />
      )}
    </div>
  );
}

/**
 * What to do when the SharePoint list doesn't exist yet.
 *
 * Spells out all three steps, because the third one is the one that gets
 * missed: `VITE_*` variables are baked into the bundle at BUILD time, so
 * setting the repo variable does nothing until ARC is redeployed. Without that
 * sentence the list looks broken after the variable is set.
 */
function SetupNotice() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/5 px-4 py-3 text-sm">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-ajax-yellow" />
        <span className="font-medium text-fg">
          The customer list hasn't been created in SharePoint yet
        </span>
      </div>
      <p className="text-fg-muted">
        Until it exists there's nowhere to save a customer, so adding is
        switched off rather than failing after you've typed one in. Three steps,
        in order:
      </p>
      <ol className="ml-4 flex list-decimal flex-col gap-1 text-fg-muted">
        <li>
          Run{" "}
          <span className="font-mono text-xs text-fg">
            ./scripts/create-open-orders-lists.ps1
          </span>{" "}
          from the repo (needs SharePoint admin — it creates the list).
        </li>
        <li>
          Set the repo variable it prints,{" "}
          <span className="font-mono text-xs text-fg">
            VITE_SP_OPEN_ORDERS_CUSTOMERS_LIST_ID
          </span>
          , under GitHub → Settings → Secrets and variables → Actions.
        </li>
        <li>
          <span className="font-medium text-fg">Redeploy ARC.</span> That
          variable is baked into the app when it's built, so it has no effect
          until the next deploy — this is the step that looks like the list is
          still broken.
        </li>
      </ol>
      <p className="text-xs text-fg-muted">
        Everything else on the Open Orders screen keeps working meanwhile: the
        reports already in SharePoint are listed and can be downloaded.
      </p>
    </div>
  );
}

/**
 * The "combine with…" panel that opens under a customer row.
 *
 * Builds a single workbook covering this account and a second one, each on
 * its own tab — for one recipient who holds two sold-to numbers for what is
 * really one customer, rather than two accounts that each need their own
 * file. See `useGenerateCombinedCustomerReport` for why this is a direct
 * download and never touches the OPEN ORDERS folder or the weekly run.
 */
function CombinePanel({
  account,
  others,
  combineWith,
  setCombineWith,
  onBuild,
  onCancel,
  busy,
  step,
}: {
  account: OpenOrderCustomerAccount;
  /** Every OTHER active account — this one is excluded, and inactive accounts
   * aren't offered: the weekly run already leaves them out, so a combined
   * report shouldn't quietly include figures nobody else is being sent. */
  others: OpenOrderCustomerAccount[];
  combineWith: string | null;
  setCombineWith: (id: string | null) => void;
  onBuild: (other: OpenOrderCustomerAccount) => void;
  onCancel: () => void;
  busy: boolean;
  step: string | null;
}) {
  const chosen = others.find((a) => String(a.id) === combineWith) ?? null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-fg-muted">
        Build one workbook with{" "}
        <strong className="text-fg">
          {account.customerName || account.accountNumber}
        </strong>{" "}
        and a second account, each on its own tab. Downloaded straight to your
        computer — nothing is filed in SharePoint or added to the weekly run.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-64">
          <SingleSelect
            options={others.map((a) => ({
              value: String(a.id),
              label: a.customerName
                ? `${a.customerName} (${a.accountNumber})`
                : a.accountNumber,
            }))}
            selected={combineWith}
            onChange={setCombineWith}
            allLabel="Choose the second account…"
            searchPlaceholder="Search customers…"
            ariaLabel="Second account to combine with"
            disabled={busy}
          />
        </div>
        <button
          type="button"
          disabled={!chosen || busy}
          onClick={() => chosen && onBuild(chosen)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:opacity-60"
        >
          <Combine className="h-3.5 w-3.5" />
          {busy ? (step ?? "Working…") : "Download combined report"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md px-2 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
      {others.length === 0 && (
        <p className="text-xs text-cooper-red">
          There's no other active account to combine with.
        </p>
      )}
    </div>
  );
}

function EditRow({
  draft,
  setDraft,
  onSave,
  onCancel,
  busy,
}: {
  draft: OpenOrderCustomerAccountInput;
  setDraft: (d: OpenOrderCustomerAccountInput) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-surface p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Account number" hint="The sold-to number, as SAP has it">
          <input
            autoFocus
            value={draft.accountNumber}
            onChange={(e) =>
              setDraft({ ...draft, accountNumber: e.target.value })
            }
            placeholder="105126"
            className="input font-mono"
          />
        </Field>
        <Field label="Customer name" hint="What the workbook is named after">
          <input
            value={draft.customerName}
            onChange={(e) =>
              setDraft({ ...draft, customerName: e.target.value })
            }
            placeholder="Wabtec Transportation Systems"
            className="input"
          />
        </Field>
        <Field label="On the weekly run" plain>
          <ChoicePills
            label="On the weekly run"
            name="open-orders-active"
            options={["Yes", "No"]}
            value={draft.active ? "Yes" : "No"}
            onChange={(v) => setDraft({ ...draft, active: v === "Yes" })}
          />
        </Field>
      </div>
      <Field label="Notes">
        <input
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          className="input"
        />
      </Field>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={busy || !draft.accountNumber.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-60"
        >
          <Check className="h-3.5 w-3.5" />
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Import accounts out of a raw extract.
 *
 * Reads it with the SAME parser the report uses, so the account numbers are
 * exactly what the weekly run will look for. Accounts already on the list are
 * shown as such and can't be added twice — the whole point of the list is one
 * row per customer, and a duplicate would produce two workbooks with the same
 * name racing for the same path.
 */
function ImportPanel({
  existing,
  onClose,
  onAdd,
}: {
  existing: OpenOrderCustomerAccount[];
  onClose: () => void;
  onAdd: (input: OpenOrderCustomerAccountInput) => void;
}) {
  const { parse, parsing } = useParseExtract();
  const [found, setFound] = useState<
    Array<{
      soldTo: string;
      customerName: string;
      lines: number;
      openValue: number;
    }>
  >([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const extract = await parse(file);
      const rollup = customerRollup(extract.lines, new Date());
      setFound(
        rollup.map((r) => ({
          soldTo: r.soldTo,
          // SAP's truncation is stripped of its trailing comma, which is the
          // most visible half of the damage. The rest is fixed by hand.
          customerName: r.customerName.replace(/[,\s]+$/, ""),
          lines: r.metrics.lines,
          openValue: r.metrics.openValue,
        })),
      );
      setPicked(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that file.");
    }
  }

  const isOnList = (soldTo: string) =>
    existing.some((a) => sameAccount(a.accountNumber, soldTo));

  const addable = found.filter((f) => !isOnList(f.soldTo));

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg">
            Import from an extract
          </h2>
          <p className="text-xs text-fg-muted">
            Reads the accounts out of a raw SAP export. Names come across
            truncated — fix them afterwards, which is what the name column is
            for.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close import"
          className="rounded p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <input
        type="file"
        accept=".xlsx,.xls"
        onChange={(e) => void onPick(e.target.files?.[0])}
        className="block w-full cursor-pointer rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg file:mr-3 file:rounded file:border-0 file:bg-surface-2 file:px-3 file:py-1 file:text-sm file:font-medium file:text-fg"
      />

      {parsing && <p className="text-sm text-fg-muted">Reading…</p>}
      {error && <p className="text-sm text-cooper-red">{error}</p>}

      {found.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span>
              {found.length} accounts in the file · {addable.length} not on the
              list yet
            </span>
            <button
              type="button"
              onClick={() => setPicked(new Set(addable.map((a) => a.soldTo)))}
              className="rounded border border-border px-2 py-0.5 hover:text-fg"
            >
              Select all new
            </button>
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              className="rounded border border-border px-2 py-0.5 hover:text-fg"
            >
              Clear
            </button>
          </div>

          <ul className="max-h-80 overflow-y-auto rounded-md border border-border">
            {found.map((f) => {
              const onList = isOnList(f.soldTo);
              return (
                <li
                  key={f.soldTo}
                  className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-0"
                >
                  <input
                    type="checkbox"
                    disabled={onList}
                    checked={picked.has(f.soldTo)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(f.soldTo);
                      else next.delete(f.soldTo);
                      setPicked(next);
                    }}
                    className="h-4 w-4 shrink-0 rounded border-border disabled:opacity-40"
                    aria-label={`Add ${f.customerName}`}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">
                      {f.customerName}
                    </span>
                    <span className="font-mono text-xs text-fg-muted">
                      {f.soldTo}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-fg-muted">
                    {f.lines} line{f.lines === 1 ? "" : "s"}
                  </span>
                  {onList && (
                    <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                      On list
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            disabled={picked.size === 0}
            onClick={() => {
              for (const soldTo of picked) {
                const entry = found.find((f) => f.soldTo === soldTo);
                if (!entry) continue;
                onAdd({
                  accountNumber: entry.soldTo,
                  customerName: entry.customerName,
                  active: true,
                  notes: "Imported from a raw extract — check the name",
                });
              }
              onClose();
            }}
            className="inline-flex w-fit items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            Add {picked.size} customer{picked.size === 1 ? "" : "s"}
          </button>
        </>
      )}
    </section>
  );
}

function Field({
  label,
  hint,
  plain,
  children,
}: {
  label: string;
  hint?: string;
  plain?: boolean;
  children: React.ReactNode;
}) {
  const Wrapper = plain ? "div" : "label";
  return (
    <Wrapper className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {children}
      {hint && <span className="text-[11px] text-fg-muted">{hint}</span>}
    </Wrapper>
  );
}
