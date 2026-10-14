import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Calculator, Lock } from "lucide-react";
import type { PricingRequestStatus } from "@/types/pricing";
import { accessPricingGate, managePricingRolesGate } from "@/lib/pricingRoles";
import { useMyPricingAccess, type MyPricingAccess } from "@/hooks/usePricingRoles";
import { LoadingTasks } from "./LoadingTasks";
import { cn } from "@/lib/cn";

// =============================================================================
// Sales Pricing — the small shared pieces every pricing screen uses: the
// status chip, the sub-navigation, the access gate and the card shells.
// =============================================================================

const STATUS_TONE: Record<PricingRequestStatus, string> = {
  "Awaiting SAP": "bg-ajax-yellow/15 text-fg border-ajax-yellow/40",
  Submitted: "bg-superior-blue/10 text-superior-blue border-superior-blue/30",
  "In Review": "bg-accent/10 text-accent border-accent/30",
  Priced: "bg-cooper-green/10 text-cooper-green border-cooper-green/30",
  Cancelled: "bg-surface-2 text-fg-muted border-border",
};

export function PricingStatusChip({ status }: { status: PricingRequestStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        STATUS_TONE[status] ?? STATUS_TONE.Submitted,
      )}
    >
      {status}
    </span>
  );
}

/**
 * Requests / New Products / Customer Quotes / Roles. The middle two show only
 * to managers and admins, Roles only to whoever can manage it. Navigation,
 * not security — every screen and write asks its own gate.
 */
export function PricingNav() {
  const access = useMyPricingAccess();
  const tabs = [
    { to: "/sales/pricing", label: "Requests", end: true, show: access.rights.canAccess },
    { to: "/sales/pricing/new-products", label: "New Products", end: false, show: access.rights.canPrice },
    { to: "/sales/pricing/quotes", label: "Customer Quotes", end: false, show: access.rights.canPrice },
    { to: "/sales/pricing/roles", label: "Roles", end: false, show: managePricingRolesGate(access).allowed },
  ].filter((t) => t.show);
  if (tabs.length <= 1) return null;
  return (
    <nav aria-label="Sales pricing" className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            cn(
              "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
              isActive ? "bg-accent text-white shadow-sm" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function PricingPage({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("mx-auto flex flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6", wide ? "max-w-[1500px]" : "max-w-[1200px]")}>
      <PricingNav />
      {children}
    </div>
  );
}

/**
 * What every pricing screen says before it shows anything: still finding out
 * who you are, the tool is in review, or you have no pricing role. Never a
 * blank page. `children` is a function so the screen's queries only run once
 * access is settled.
 */
export function PricingAccessGate({
  children,
  allowRolesManagerOnly = false,
}: {
  children: (access: MyPricingAccess) => React.ReactNode;
  /** The roles screen: an ARC admin may manage it without a pricing role. */
  allowRolesManagerOnly?: boolean;
}) {
  const access = useMyPricingAccess();
  const gate = accessPricingGate(access);
  const rolesGate = managePricingRolesGate(access);

  if (gate.resolving) {
    return (
      <PricingPage>
        <LoadingTasks noun="your pricing access" />
      </PricingPage>
    );
  }
  if (!gate.allowed && !(allowRolesManagerOnly && rolesGate.allowed)) {
    return (
      <PricingPage>
        <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-fg-muted">
          <Lock className="mx-auto h-8 w-8" />
          <p className="mt-3 font-medium text-fg">
            {access.inPreviewOnly
              ? "Sales Pricing is still being reviewed and isn't open yet."
              : access.failed
                ? gate.hint
                : "You don't have access to Sales Pricing."}
          </p>
          {!access.inPreviewOnly && !access.failed && <p className="mt-1">{gate.hint}</p>}
        </div>
      </PricingPage>
    );
  }
  return <>{children(access)}</>;
}

/**
 * The managers-and-admins screens (New Products, Customer Quotes): a
 * requester is told plainly rather than shown an empty list. `configured`
 * false names the list still to be created.
 */
export function PricingManagerGate({
  children,
  configured,
  listName,
  envVar,
}: {
  children: (access: MyPricingAccess) => React.ReactNode;
  configured: boolean;
  listName: string;
  envVar: string;
}) {
  return (
    <PricingAccessGate>
      {(access) =>
        !access.rights.canPrice ? (
          <PricingPage>
            <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-fg-muted">
              <Lock className="mx-auto h-8 w-8" />
              <p className="mt-3 font-medium text-fg">This is for pricing managers and admins.</p>
            </div>
          </PricingPage>
        ) : !configured ? (
          <PricingPage>
            <div className="rounded-xl border border-ajax-yellow/40 bg-ajax-yellow/10 p-4 text-sm text-fg">
              <p className="font-medium">The {listName} list isn't set up yet.</p>
              <p className="mt-1 text-fg-muted">
                Run <code>scripts/create-pricing-lists.ps1</code> again (it only adds what's missing), set{" "}
                <code>{envVar}</code> as a repo variable, and redeploy.
              </p>
            </div>
          </PricingPage>
        ) : (
          children(access)
        )
      }
    </PricingAccessGate>
  );
}

export function PricingHeader({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
          <Calculator className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">{title}</h1>
          {subtitle && <div className="text-sm text-fg-muted">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function PricingCard({
  title,
  action,
  children,
  testId,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5" data-testid={testId}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ReadField({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")}>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-fg">
        {empty ? <span className="text-fg-muted">—</span> : children}
      </dd>
    </div>
  );
}

export function ActionButton({
  onClick,
  children,
  icon,
  disabled,
  primary = false,
  title,
}: {
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  primary?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        primary
          ? "bg-accent text-white hover:bg-accent/90"
          : "border border-border bg-surface text-fg hover:bg-surface-2",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// Every field in the price row shares one grid: a label row, a control row
// and a hint row, each a FIXED height. That is what makes the boxes line up
// whatever sits in the label row (a plain label, or the Target GM / List
// price toggle) and whatever the control is (an input, or Yes / No pills).
export function FieldColumn({ header, hint, children }: { header: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex h-6 items-end">{header}</div>
      <div className="flex h-9 items-center gap-1">{children}</div>
      {hint && <span className="max-w-[16rem] text-[11px] text-fg-muted">{hint}</span>}
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="font-semibold uppercase tracking-wider text-fg-muted">{children}</span>;
}
