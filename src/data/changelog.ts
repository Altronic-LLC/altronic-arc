// =============================================================================
// Application changelog.
//
// HOW TO UPDATE: When making a meaningful user-visible change, add a new
// entry to the TOP of this array (newest first). Bump the version using
// semver-lite rules:
//   - MAJOR (1.x.x → 2.0.0): big rework, breaking changes to data model
//   - MINOR (0.1.x → 0.2.0): new feature (Kanban view, comment editor, etc.)
//   - PATCH (0.1.0 → 0.1.1): bug fix, copy change, small UI polish
//
// Keep entries succinct — one line each, written from the user's POV.
// Group related changes under one version.
// =============================================================================

export interface ChangelogEntry {
  version: string;
  date: string; // YYYY-MM-DD
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.4.1",
    date: "2026-05-18",
    changes: [
      "Kanban board's horizontal scrollbar now stays at the bottom of the screen — previously you had to scroll the whole page down past tall columns to reach it",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-05-18",
    changes: [
      "Home page now filters to 'Assigned to me' by default — the first thing you see is your tasks, not everyone's; pick 'Anyone' in the dropdown to clear it",
      "Kanban board now has the same filter bar as the list view; filters apply to the cards in each column",
      "Filter state is shared between List and Kanban — switching views keeps your filters, and refreshing the page preserves them too",
      "Filters live in the URL so a link you share carries the same view the recipient sees",
    ],
  },
  {
    version: "0.3.5",
    date: "2026-05-15",
    changes: [
      "Fix a subtle bug where editing a comment would prepend a stray '0' record to the SharePoint Communication field (visible only in the raw stored data; the comment thread still rendered correctly, but the field grew slightly larger with each edit)",
      "Internal: backfill src/lib to 100% unit-test coverage (parser, sanitiser, mappers, graph helpers) as the first step toward the 100%-everywhere project standard",
    ],
  },
  {
    version: "0.3.4",
    date: "2026-05-15",
    changes: [
      "Edit your own comments in-place on the task detail page — a pencil icon next to your comment opens an inline editor with Save / Cancel; Esc cancels, Ctrl+Enter saves",
      "Edits preserve the original timestamp and author so the audit trail stays intact; only the body text changes",
      "Edit is limited to the comment's own author (matched by email); attachments on edited comments are preserved",
    ],
  },
  {
    version: "0.3.3",
    date: "2026-05-15",
    changes: [
      "Real-mode prep: request the narrower Sites.Selected Graph scope at sign-in instead of Sites.ReadWrite.All, matching the planned Entra app registration",
    ],
  },
  {
    version: "0.3.2",
    date: "2026-05-14",
    changes: [
      "Add the Altronic brandmark and wordmark to the top of the printable task view",
      "Add a confidential-information footer to the printable view ('Confidential — Altronic internal use only. Not to be shared externally.') plus a Confidential badge in the header",
    ],
  },
  {
    version: "0.3.1",
    date: "2026-05-14",
    changes: [
      "Fix Print button bouncing to the sign-in screen — the printable view now opens directly without re-asking for a demo bypass in the new tab",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-05-14",
    changes: [
      "Add a Print button on the task detail page that opens a clean printable view in a new tab and auto-opens the browser's print dialog — use 'Save as PDF' there to export the task",
      "The printable view includes the title, full metadata block (priority, dates, assignees, watchers, projects, labels, parent task, etc.), description, child tasks, and the complete comment thread with author and timestamp",
      "Print layout uses light styling regardless of the app theme so PDFs look the same whether you're in light or dark mode",
    ],
  },
  {
    version: "0.2.6",
    date: "2026-05-14",
    changes: [
      "When someone else comments on a task you're viewing, a banner appears above the thread (e.g. 'New comment from Bob') with a 'Show new' button — the comments stay frozen until you choose to refresh, so you don't lose your place mid-reply",
      "Background poll runs every 20 seconds while a task detail page is open; pauses when the tab is hidden",
      "Pre-flight check on Send: if someone else commented in the last minute, you'll be asked to confirm before posting (mitigates the Communication-field lost-update race without realtime infrastructure)",
    ],
  },
  {
    version: "0.2.5",
    date: "2026-05-13",
    changes: [
      "Add 'New Task' button on the List and Kanban views that opens a full task-creation form",
      "Add an 'Edit' button on the task detail page that opens the same form pre-filled, so all fields can be edited in one place",
      "The form covers title, description, status, priority, category, due date, labels, parent project, parent task, related projects, assignees, watchers, and software revision",
      "Default new tasks to Priority = Medium (matches the Power App default)",
      "Cycle detection in the parent-task picker prevents a task from being made its own ancestor",
      "ESC closes the modal; click outside to dismiss; title input is focused on open",
      "Demo mode now persists tasks and projects to localStorage so changes survive a refresh — Reset Demo clears them",
      "Add Software Revision field to the task type and surface it on the detail sidebar when set",
    ],
  },
  {
    version: "0.2.4",
    date: "2026-05-13",
    changes: [
      "Resolve signed-in user's SharePoint lookupId on first sign-in (fixes Watch button and assignee writes failing silently in real mode)",
      "Sanitise all user-authored HTML through DOMPurify before rendering (comments, descriptions) — defence-in-depth against XSS",
      "Fail loud at startup if real-mode env vars are missing, rather than rendering a half-broken page",
      "Switch MSAL token cache from sessionStorage to localStorage so users stay signed in across browser restarts",
      "Show a retryable error screen if MSAL initialisation fails, instead of getting stuck on 'Initialising authentication…'",
      "When person-field writes would silently drop the current user, throw a clear error instead",
      "Use the cached task list to populate the detail view, avoiding a redundant query",
      "Internal: add newline separator between comment records for safer parsing",
      "Internal: bump package.json version (was stuck at 0.1.0)",
      "Internal: remove dead lint script that pointed to nothing",
    ],
  },
  {
    version: "0.2.3",
    date: "2026-05-13",
    changes: [
      "Update sign-in page copy: 'Sign in with your altronic-llc email'",
    ],
  },
  {
    version: "0.2.2",
    date: "2026-05-13",
    changes: [
      "Demo mode now shows the sign-in page on every fresh tab, with a 'Continue as Demo User' button to bypass",
      "The 'Reset demo' menu item now clears the bypass so the sign-in page reappears after a reload",
    ],
  },
  {
    version: "0.2.1",
    date: "2026-05-13",
    changes: [
      "Disable Kanban drag-and-drop on phones (tablets and desktop still drag normally)",
      "On phones, tap a card to open it; change status from the detail page's Status dropdown",
      "Add a small hint at the top of the Kanban view on phones explaining the change",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-05-13",
    changes: [
      "Add picture and file attachments to comments, with drag-and-drop or click-to-attach",
      "Add parent project picker on the task detail page (dropdown of projects from SharePoint Project Overview list)",
      "Add multi-select 'Related Projects' field on each task; click a project chip to navigate to that project's overview",
      "Add a new project-overview page that lists every task linked to a given project (as parent or related)",
      "Add an Admin → Projects page where authorized users can create new project references",
      "Add parent / child task links: select a parent task on the detail page, see linked children listed below the description; clicking either navigates between them",
      "Cycle detection prevents a task from being its own ancestor",
      "Add Watch / Watching toggle that adds you to the SharePoint Watchers field (drives existing Power Automate watcher emails)",
      "Make Priority, Category, Labels, Due Date, and Assigned editable directly from the detail page sidebar",
      "Sign-in identity now drives the comment author and watch toggle (demo user in mock mode, MSAL account in real mode)",
      "Add a branded sign-in landing page shown when no user is authenticated (real mode only — demo mode bypasses sign-in automatically)",
      "Add a user menu in the header with initials avatar, full name, email, and Sign out",
      "Handle expired sessions gracefully: silent token refresh tries first, falls back to a sign-in popup, falls back to the sign-in page if all else fails",
      "Treat Microsoft Graph 401 responses as a session-expired event rather than a generic error",
    ],
  },
  {
    version: "0.1.4",
    date: "2026-05-13",
    changes: [
      "(Skipped — these changes shipped as part of v0.2.1)",
    ],
  },
  {
    version: "0.1.3",
    date: "2026-05-13",
    changes: [
      "Make the app fully responsive on mobile phones and tablets",
      "Header collapses to two rows on phones with a dedicated theme toggle",
      "Task list rows stack vertically on small screens; last-comment column hides on phones and tablets",
      "Kanban touch-drag now requires a 200ms long-press so normal scrolling still works",
      "Form inputs use 16px font on mobile to prevent iOS Safari auto-zoom",
      "Browser address bar matches app theme color (white on light, dark on dark)",
    ],
  },
  {
    version: "0.1.2",
    date: "2026-05-13",
    changes: [
      "Fix search placeholder text being hidden behind the magnifying-glass icon",
      "Add app footer with maintainer contact",
      "Add version history (this!)",
    ],
  },
  {
    version: "0.1.1",
    date: "2026-05-13",
    changes: [
      "Switch default theme to light (dark still available via toggle)",
      "Fix Kanban drag-and-drop — entire card is now draggable",
      "Replace generic logo with official Altronic brandmark and wordmark",
      "Logos auto-adapt to light/dark theme",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-05-13",
    changes: [
      "Initial release with mock data",
      "List view with status filters, project/assigned/search/created-by filters",
      "Kanban view with six status columns",
      "Task detail view with description, metadata sidebar, and comments",
      "Plain-text comment composer that appends to SharePoint Communication field",
      "Light and dark themes with persistent toggle",
      "Deployed to GitHub Pages with auto-build on push",
    ],
  },
];

/** Current version — derived from the top entry. */
export const CURRENT_VERSION = CHANGELOG[0].version;
