import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowLeft, BookOpen, ExternalLink, Info } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useTheme } from "@/hooks/useTheme";
import { CURRENT_VERSION } from "@/data/changelog";

// =============================================================================
// About page — high-level system map of the Altronic Engineering Task App.
//
// IMPORTANT: this page is the single source of truth for "how does this app
// fit together." If you add a view, a route, a hook category, an API surface,
// a SharePoint list, or any other structural piece, UPDATE THE DIAGRAMS
// below in the same commit. CLAUDE.md's "Architectural changes" section
// makes that a hard rule — don't let this page rot.
//
// Two diagrams:
//   1. systemDiagram — request flow: browser → views → hooks → API → Graph
//      → SharePoint lists, with the mock branch + auth path shown.
//   2. dataModelDiagram — entities (Task, Test Sheet, Project, Person) and
//      how they link to each other.
//
// Both are Mermaid syntax. Live edit at mermaid.live to preview before
// pasting back in.
// =============================================================================

const systemDiagram = `
flowchart TB
  Browser([User browser])

  subgraph FE["Frontend (React SPA)"]
    direction TB
    Views["Views<br/>Dashboard · List · Kanban<br/>Detail · Test Sheets · EIRs<br/>Admin (Projects · Admins)<br/>About · Manual"]
    Hooks["React Query hooks<br/>useTasks · useTestSheets · useEirs<br/>useAdmins · useAttachments<br/>useFilters · useCurrentUser"]
    API["API layer<br/>src/api/tasks.ts · testSheets.ts<br/>src/api/eirs.ts · admins.ts<br/>src/api/email.ts · attachments.ts"]
    Views --> Hooks --> API
  end

  Browser --> FE

  MSAL[/MSAL Entra ID/]
  Mock[("Mock store<br/>in-memory + localStorage")]
  Graph[/"Microsoft Graph v1.0"/]
  SPREST[/"SharePoint REST - attachments only"/]

  API -- "VITE_USE_MOCK=true" --> Mock
  API -- "VITE_USE_MOCK=false" --> Graph
  API -- "list-item attachments" --> SPREST

  Browser -. sign in .-> MSAL
  MSAL -. access token .-> Graph
  MSAL -. AllSites.Manage token .-> SPREST

  Mailbox[/"Shared mailbox<br/>VITE_SHARED_MAILBOX"/]
  API -- "@-mention notifications<br/>(Mail.Send.Shared)" --> Mailbox
  Mailbox -. email .-> Recipient([Mentioned user])

  subgraph SP["SharePoint lists"]
    direction TB
    ProjectTaskList[("Project Task List")]
    Projects[("Projects")]
    TestResults[("Test Results")]
    EIRs[("EIRs (Engineering<br/>Information Requests)")]
    Admins[("Admins")]
  end

  Graph --> SP
  SPREST --> SP
`.trim();

const dataModelDiagram = `
flowchart LR
  Project[("Project")]
  Task[("Task")]
  TestSheet[("Test Sheet")]
  EIR[("EIR")]
  Admin[("Admin")]

  Task -- "Parent Project Reference" --> Project
  Task -- "Parent Task self-link" --> Task
  TestSheet -- "Task Reference" --> Task
  TestSheet -- "Project Reference" --> Project
  EIR -- "Project Reference - multi-choice" --> Project
  EIR -- "Task Reference - text or URL" --> Task

  Person((Person))
  Comments[Comments]
  Attachments[File attachments - SharePoint REST]

  Task -- "Communication" --> Comments
  Task -- "Assigned · Watchers" --> Person
  Task -. "Attached files" .-> Attachments
  TestSheet -- "Tester" --> Person
  EIR -- "Reporter · Engineers · Watchers" --> Person
  EIR -- "Communication" --> Comments
  EIR -. "Attached files" .-> Attachments
  Admin -- "Email grants admin access" --> Person
`.trim();

const Mermaid = lazy(() => import("../components/MermaidDiagram"));

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
          tracker, kanban board, and test-sheet log for the engineering team.
          It runs as a static React SPA on GitHub Pages, signs you in
          through Microsoft Entra ID, and reads/writes three SharePoint
          lists via the Microsoft Graph v1.0 API. The two diagrams below
          show how requests flow through the app and how the data on
          SharePoint links together.
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

      <DiagramCard
        title="System flow"
        description="How a request travels from the browser to SharePoint. The mock branch shortcuts the network for demo mode; the real branch acquires a token via MSAL and hits Microsoft Graph."
        source={systemDiagram}
        cacheKey="about-system"
      />

      <DiagramCard
        title="Data model"
        description="The three SharePoint lists and how they reference one another. Lookups are written as `<Field>LookupId` for single values and use the @odata.type=Collection(Edm.Int32) shape for multi-value fields."
        source={dataModelDiagram}
        cacheKey="about-data-model"
      />

      <div className="mt-6 rounded-lg border border-dashed border-border bg-surface-2/40 p-4 text-xs text-fg-muted">
        <strong className="text-fg">For contributors:</strong> if you add a
        new view, route, hook category, API surface, or SharePoint list, edit
        the Mermaid sources at the top of{" "}
        <code className="rounded bg-bg px-1 py-0.5">src/views/AboutView.tsx</code>{" "}
        in the same commit. Preview your edits at{" "}
        <a
          href="https://mermaid.live/"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline-offset-2 hover:underline"
        >
          mermaid.live
        </a>
        .
      </div>
    </div>
  );
}

interface DiagramCardProps {
  title: string;
  description: string;
  source: string;
  cacheKey: string;
}

function DiagramCard({ title, description, source, cacheKey }: DiagramCardProps) {
  const { theme } = useTheme();
  // Force re-render on theme change so Mermaid re-renders with the new
  // colors. Mermaid initialises once with a theme — keying remounts.
  const [renderKey, setRenderKey] = useState(0);
  useEffect(() => {
    setRenderKey((k) => k + 1);
  }, [theme]);

  return (
    <div className="mb-6 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <h2 className="font-display text-base font-semibold text-fg sm:text-lg">{title}</h2>
      <p className="mt-1 text-xs text-fg-muted">{description}</p>
      <div className="mt-4 overflow-x-auto rounded-md border border-border bg-bg p-3">
        <Suspense
          fallback={<div className="py-8 text-center text-xs text-fg-muted">Loading diagram…</div>}
        >
          <Mermaid
            key={`${cacheKey}-${renderKey}`}
            source={source}
            theme={theme === "dark" ? "dark" : "default"}
          />
        </Suspense>
      </div>
    </div>
  );
}
