import { ArrowDown, ArrowLeft, BookOpen, ExternalLink, Info } from "lucide-react";
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
// Data model — entities on the left, their relationships listed under each.
// =============================================================================

interface EntitySpec {
  name: string;
  palette: PaletteKey;
  references: { label: string; target: string }[];
  fields: { label: string; target: string }[];
}

const ENTITIES: EntitySpec[] = [
  {
    name: "Task",
    palette: "entity",
    references: [
      { label: "Parent Project", target: "Project" },
      { label: "Parent Task", target: "Task (self-link)" },
    ],
    fields: [
      { label: "Assigned · Watchers", target: "Person" },
      { label: "Communication", target: "Comments" },
      { label: "Attached files", target: "Attachments" },
    ],
  },
  {
    name: "EIR",
    palette: "entity",
    references: [
      { label: "Project Reference", target: "Project (multi-choice text)" },
      { label: "Task Reference", target: "Task (text or Power Apps URL)" },
    ],
    fields: [
      { label: "Reporter · Engineers · Watchers", target: "Person" },
      { label: "Communication", target: "Comments" },
      { label: "Attached files", target: "Attachments" },
    ],
  },
  {
    name: "Test Sheet",
    palette: "entity",
    references: [
      { label: "Task Reference", target: "Task" },
      { label: "Project Reference", target: "Project" },
    ],
    fields: [{ label: "Tester", target: "Person" }],
  },
  {
    name: "Project",
    palette: "entity",
    references: [],
    fields: [{ label: "Title", target: "0000-Engineering Apps, …" }],
  },
  {
    name: "Admin",
    palette: "entity",
    references: [],
    fields: [{ label: "Email", target: "Person (grants admin UI access)" }],
  },
];

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
        description="The SharePoint lists this app reads and the shared concepts they share (people, comments, attachments). Each entity card lists the lookups it owns and the person / comment / file relationships."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-3">
            {ENTITIES.map((e) => (
              <EntityCard key={e.name} entity={e} />
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Shared concepts
            </h3>
            {SHARED_CONCEPTS.map((n) => (
              <DiagramNode key={n.label} node={n} className="w-full" />
            ))}
          </div>
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

function EntityCard({ entity }: { entity: EntitySpec }) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 shadow-sm",
        PALETTE[entity.palette],
      )}
    >
      <div className="mb-2 font-display text-sm font-semibold uppercase tracking-wide">
        {entity.name}
      </div>
      {entity.references.length > 0 && (
        <RelList title="References" items={entity.references} />
      )}
      {entity.fields.length > 0 && (
        <RelList title="Fields" items={entity.fields} />
      )}
    </div>
  );
}

function RelList({
  title,
  items,
}: {
  title: string;
  items: { label: string; target: string }[];
}) {
  return (
    <div className="mb-1.5 last:mb-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-muted">
        {title}
      </div>
      <ul className="mt-0.5 space-y-0.5">
        {items.map((it) => (
          <li key={`${it.label}-${it.target}`} className="text-xs">
            <span className="font-medium text-fg">{it.label}</span>
            <span className="text-fg-muted"> → </span>
            <span className="text-fg-muted">{it.target}</span>
          </li>
        ))}
      </ul>
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
