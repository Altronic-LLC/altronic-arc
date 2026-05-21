import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, ExternalLink, Info, Repeat } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { CURRENT_VERSION } from "@/data/changelog";
import { cn } from "@/lib/cn";

// =============================================================================
// About page — high-level system map.
//
// IMPORTANT: this page is the source of truth for "how does this app fit
// together." If you add a view, route, hook category, API surface, or
// SharePoint list, edit the data arrays below in the same commit.
//
// We used to render this with Mermaid; the parser kept tripping over any
// shape that mixed quotes, parens, or <br/> tags. Replaced with a hand-laid
// HTML + Tailwind layout — same information, easier to read, and zero
// chance of "syntax error in text" on the live page.
// =============================================================================

/**
 * Visual palette — kept in one place so colour stays consistent across both
 * diagrams. Each kind maps to a Tailwind class set (border + background +
 * text) tuned for both light and dark themes.
 */
const PALETTE = {
  ui: "border-cooper-red/40 bg-cooper-red/15 text-fg",
  auth: "border-superior-blue/40 bg-superior-blue/15 text-fg",
  gateway: "border-superior-blue/40 bg-superior-blue/10 text-fg",
  list: "border-cooper-green/40 bg-cooper-green/15 text-fg",
  mock: "border-border bg-surface-2 text-fg-muted",
  entity: "border-cooper-red/40 bg-cooper-red/15 text-fg",
  shared: "border-superior-blue/40 bg-superior-blue/15 text-fg",
} as const;

type PaletteKey = keyof typeof PALETTE;

interface NodeSpec {
  label: string;
  /** Optional second line — a short subtitle in muted text. */
  hint?: string;
  palette: PaletteKey;
}

// =============================================================================
// System flow tiers — top-down, browser at the top, SharePoint at the bottom.
// =============================================================================

interface Tier {
  label: string;
  nodes: NodeSpec[];
}

const SYSTEM_TIERS: Tier[] = [
  {
    label: "User",
    nodes: [{ label: "User in browser", hint: "altronic-llc.github.io", palette: "ui" }],
  },
  {
    label: "React SPA",
    nodes: [
      { label: "Views", hint: "Dashboard · List · Kanban · Detail · EIRs · Admin", palette: "ui" },
      { label: "React Query hooks", hint: "useTasks · useEirs · useAdmins · useAttachments", palette: "ui" },
      { label: "API layer", hint: "src/api/tasks · eirs · admins · attachments · email", palette: "ui" },
    ],
  },
  {
    label: "Auth & transport",
    nodes: [
      { label: "MSAL Entra ID", hint: "Sites.Selected · Mail.Send.Shared · AllSites.Manage", palette: "auth" },
      { label: "Microsoft Graph v1.0", hint: "Lists, items, users, mail", palette: "gateway" },
      { label: "SharePoint REST", hint: "Attachments only", palette: "gateway" },
      { label: "Mock store", hint: "in-memory + localStorage (demo mode)", palette: "mock" },
      { label: "Shared mailbox", hint: "@-mention notifications", palette: "mock" },
    ],
  },
  {
    label: "SharePoint lists",
    nodes: [
      { label: "Project Task List", palette: "list" },
      { label: "Projects", palette: "list" },
      { label: "Test Results", palette: "list" },
      { label: "EIRs", palette: "list" },
      { label: "Admins", palette: "list" },
    ],
  },
];

// =============================================================================
// Data model — relationships are wired up inside the ReferenceHierarchy
// component below (the tier layout shows them naturally). The shared
// concepts list is the supporting cast that every entity touches.
// =============================================================================

const SHARED_CONCEPTS: NodeSpec[] = [
  { label: "Person", hint: "Email + display name + lookupId", palette: "shared" },
  { label: "Comments", hint: "Communication field, pipe-delimited", palette: "shared" },
  { label: "Attachments", hint: "Files on the SharePoint list item", palette: "shared" },
];

export function AboutView() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-4 sm:px-6 sm:py-6">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="mb-6 rounded-lg border border-border bg-surface p-5">
        <div className="mb-2 flex items-center gap-2">
          <Info className="h-4 w-4 text-fg-muted" />
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            About this app
          </h1>
          <span className="ml-auto text-xs text-fg-muted">v{CURRENT_VERSION}</span>
        </div>
        <p className="text-sm leading-relaxed text-fg-muted">
          The Altronic Engineering Task System is a SharePoint-backed task
          tracker, kanban board, EIR log, and test-sheet log for the
          engineering team. It runs as a static React SPA on GitHub Pages,
          signs you in through Microsoft Entra ID, and reads/writes a handful
          of SharePoint lists via Microsoft Graph (plus the SharePoint REST
          API for list-item attachments).
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <Link
            to="/manual"
            className="inline-flex items-center gap-1 rounded-md border border-accent bg-accent/10 px-2 py-1 font-medium text-accent transition-colors hover:bg-accent/20"
          >
            <BookOpen className="h-3 w-3" /> User Manual
          </Link>
          <a
            href="https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering/Lists/Project%20Task%20List/AllItems.aspx"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-fg-muted hover:border-fg-muted hover:text-fg"
          >
            <ExternalLink className="h-3 w-3" /> Project Task List
          </a>
          <a
            href="https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering/Lists/Test%20Results/AllItems.aspx"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-fg-muted hover:border-fg-muted hover:text-fg"
          >
            <ExternalLink className="h-3 w-3" /> Test Results
          </a>
          <Link
            to="/"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-fg-muted hover:border-fg-muted hover:text-fg"
          >
            Back to tasks
          </Link>
        </div>
      </div>

      <Section
        title="System flow"
        description="Top-down. A request starts in the browser, travels through the SPA's view → hook → API layers, then either short-circuits to the mock store (demo mode) or out to Graph / SharePoint REST. Tokens come from MSAL."
      >
        <div className="flex flex-col items-stretch gap-2">
          {SYSTEM_TIERS.map((tier, i) => (
            <div key={tier.label}>
              <TierBlock label={tier.label} nodes={tier.nodes} />
              {i < SYSTEM_TIERS.length - 1 && <TierArrow />}
            </div>
          ))}
        </div>
        <Legend
          items={[
            { palette: "ui", label: "SPA" },
            { palette: "auth", label: "Entra ID" },
            { palette: "gateway", label: "Graph / SP REST" },
            { palette: "list", label: "SharePoint list" },
            { palette: "mock", label: "Demo / mailbox" },
          ]}
        />
      </Section>

      <Section
        title="Data model"
        description="How the SharePoint entities reference each other. Project sits at the top — Task, EIR, and Test Sheet all reference it. Task is referenced in turn by EIR and Test Sheet. Each arrow shows the actual SharePoint column carrying the reference."
      >
        <ReferenceHierarchy />

        <h3 className="mt-6 font-display text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Shared concepts (used by all entities)
        </h3>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {SHARED_CONCEPTS.map((n) => (
            <DiagramNode key={n.label} node={n} className="w-full" />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-fg-muted sm:grid-cols-2">
          <SharedRow concept="Person" sources="Task (Assigned · Watchers) · EIR (Reporter · Engineers · Watchers) · Test Sheet (Tester) · Admin (Email)" />
          <SharedRow concept="Comments" sources="Task, EIR — via the Communication field" />
          <SharedRow concept="Attachments" sources="Task, EIR — list-item files via SharePoint REST" />
          <SharedRow concept="Admin" sources="Standalone list — only links to Person via email; everyone in the list sees the Admin nav link" />
        </div>

        <Legend
          items={[
            { palette: "entity", label: "Entity (SharePoint list)" },
            { palette: "shared", label: "Shared concept" },
          ]}
        />
      </Section>

      <div className="mt-6 rounded-lg border border-dashed border-border bg-surface-2/40 p-4 text-xs text-fg-muted">
        <strong className="text-fg">For contributors:</strong> if you add a
        new view, route, hook category, API surface, or SharePoint list, edit
        the data arrays at the top of{" "}
        <code className="rounded bg-bg px-1 py-0.5">src/views/AboutView.tsx</code>{" "}
        in the same commit.
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <h2 className="font-display text-base font-semibold text-fg sm:text-lg">{title}</h2>
      <p className="mt-1 text-xs text-fg-muted">{description}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function TierBlock({ label, nodes }: Tier) {
  return (
    <div className="rounded-md border border-border bg-bg p-3 sm:p-4">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">
        {nodes.map((n) => (
          <DiagramNode key={n.label} node={n} />
        ))}
      </div>
    </div>
  );
}

function TierArrow() {
  return (
    <div className="flex justify-center py-1">
      <ArrowDown className="h-4 w-4 text-fg-muted" />
    </div>
  );
}

function DiagramNode({
  node,
  className,
}: {
  node: NodeSpec;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 shadow-sm",
        PALETTE[node.palette],
        className,
      )}
    >
      <div className="text-sm font-semibold">{node.label}</div>
      {node.hint && <div className="mt-0.5 text-[11px] text-fg-muted">{node.hint}</div>}
    </div>
  );
}

/**
 * Three-tier reference hierarchy. Project at top → Task in the middle →
 * EIR + Test Sheet at the bottom. Between each tier we render a labelled
 * "reference bar" showing the exact SharePoint columns carrying the
 * relationship (and which source entity sets each one).
 *
 * Visual cue: every arrow points UPWARD because references in SharePoint
 * point at the parent (the child stores the lookup id).
 */
function ReferenceHierarchy() {
  return (
    <div className="flex flex-col items-stretch gap-1">
      {/* Tier 1 — Project */}
      <TierRow>
        <BigNode label="Project" palette="entity" />
      </TierRow>

      <ReferenceBar
        upRefs={[
          { field: "Parent Project Reference", from: "Task" },
          { field: "Project Reference (multi-choice)", from: "EIR" },
          { field: "Project Reference", from: "Test Sheet" },
        ]}
      />

      {/* Tier 2 — Task (with self-link callout) */}
      <TierRow>
        <div className="flex items-center gap-2">
          <BigNode label="Task" palette="entity" />
          <SelfLoopBadge label="Parent Task — self-link (optional)" />
        </div>
      </TierRow>

      <ReferenceBar
        upRefs={[
          { field: "Task Reference (text or Power Apps URL)", from: "EIR" },
          { field: "Task Reference", from: "Test Sheet" },
        ]}
      />

      {/* Tier 3 — EIR + Test Sheet */}
      <TierRow>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <BigNode label="EIR" palette="entity" />
          <BigNode label="Test Sheet" palette="entity" />
        </div>
      </TierRow>
    </div>
  );
}

function TierRow({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-center py-1">{children}</div>;
}

function BigNode({
  label,
  palette,
}: {
  label: string;
  palette: PaletteKey;
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-5 py-2.5 text-center shadow-sm",
        PALETTE[palette],
      )}
    >
      <div className="font-display text-sm font-semibold uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
}

function SelfLoopBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-surface-2 px-2 py-1 text-[10px] uppercase tracking-wider text-fg-muted">
      <Repeat className="h-3 w-3" />
      {label}
    </span>
  );
}

/**
 * Reference bar between two tiers. Shows an upward arrow at the centre
 * (because references point at the parent) and lists each carrying
 * SharePoint column with its source entity called out.
 */
function ReferenceBar({
  upRefs,
}: {
  upRefs: { field: string; from: string }[];
}) {
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col items-center gap-1.5 py-1">
      <ArrowUp className="h-5 w-5 text-fg-muted" />
      <div className="w-full rounded-md border border-dashed border-border bg-surface-2/40 px-3 py-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
          References ↑
        </div>
        <ul className="space-y-0.5">
          {upRefs.map((r) => (
            <li
              key={`${r.field}-${r.from}`}
              className="flex flex-wrap items-baseline gap-x-2 text-xs"
            >
              <span className="font-medium text-fg">{r.field}</span>
              <span className="text-[10px] text-fg-muted">from</span>
              <span className="rounded bg-cooper-red/15 px-1.5 py-0.5 text-[10px] font-semibold text-fg">
                {r.from}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SharedRow({ concept, sources }: { concept: string; sources: string }) {
  return (
    <div className="flex gap-2 leading-snug">
      <span className="shrink-0 font-semibold text-fg">{concept}</span>
      <span>{sources}</span>
    </div>
  );
}

function Legend({
  items,
}: {
  items: { palette: PaletteKey; label: string }[];
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-[11px]">
      <span className="font-semibold uppercase tracking-wider text-fg-muted">
        Legend
      </span>
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              "inline-block h-3 w-3 rounded-sm border",
              PALETTE[it.palette],
            )}
          />
          <span className="text-fg-muted">{it.label}</span>
        </span>
      ))}
    </div>
  );
}
