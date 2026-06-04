import { useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CURRENT_VERSION } from "@/data/changelog";
import { cn } from "@/lib/cn";

// =============================================================================
// User Manual — the in-app "how does this work" page.
//
// IMPORTANT: this is the source of truth for end-user documentation. Treat
// it the way you treat the About-page diagrams: any user-visible feature
// change should update the relevant section here in the SAME commit.
// CLAUDE.md's "User-visible changes" rule applies to this file.
//
// Each section is defined as data:
//   { id, title, keywords[], searchText, render: () => JSX }
//
// The keywords + searchText are what the in-page search ranks against. When
// you add or edit a section, update keywords with synonyms users would type
// ("ping", "tag", "at-mention" all → comments section), and update
// searchText with a concise summary of the body. Both are case-insensitive.
//
// Section ids are stable anchor targets — don't rename them or external
// links into the manual break.
// =============================================================================

interface ManualSection {
  id: string;
  title: string;
  /** Synonyms / phrasings users might search for. Weighted highest in scoring. */
  keywords: string[];
  /** Plain-text summary used by the search scorer. */
  searchText: string;
  render: () => React.ReactNode;
}

const SECTIONS: ManualSection[] = [
  {
    id: "quick-start",
    title: "Quick start",
    keywords: [
      "sign in",
      "log in",
      "login",
      "first time",
      "getting started",
      "open the app",
      "where do i start",
    ],
    searchText:
      "Sign in with your altronic-llc.com account. The Dashboard opens after sign-in with your open tasks. Use the top nav to switch between Dashboard, List, Kanban, and the Engineering Requests dropdown (EIRs, Test Sheets).",
    render: () => (
      <>
        <P>
          Sign in with your <code>@altronic-llc.com</code> Microsoft account when
          prompted. Once you're in, the <strong>Dashboard</strong> opens with a
          summary of your open work. The top nav has direct links for the views
          of the task list — <strong>Dashboard</strong>, <strong>List</strong>,
          and the <strong>Kanban</strong> board — and an{" "}
          <strong>Engineering Requests</strong> dropdown that holds the other
          SharePoint lists (currently <strong>EIRs</strong> and{" "}
          <strong>Test Sheets</strong>). Your tasks are filtered to you by
          default — pick "Anyone" in the Assigned filter to see the rest of the
          team's work.
        </P>
        <Tip>
          All views share the same data — a change you make in one shows up in
          the others within seconds.
        </Tip>
      </>
    ),
  },
  {
    id: "dashboard",
    title: "The Dashboard",
    keywords: [
      "dashboard",
      "home page",
      "landing page",
      "metrics",
      "summary",
      "open tasks count",
      "how many tasks",
      "EIR",
      "ECN",
      "build request",
    ],
    searchText:
      "The Dashboard shows big-number cards for My Open Tasks, All Open Tasks, EIRs, ECNs, and Build Requests, plus a status breakdown panel. Filter by Project Reference at the top scopes every metric. Click a card to open the List with that filter.",
    render: () => (
      <>
        <P>The home page after sign-in. Five big-number cards show open-work counts:</P>
        <UL>
          <LI>
            <strong>My Open Tasks</strong> — assigned to you and not Complete.
            Click to open the List view with that filter.
          </LI>
          <LI>
            <strong>All Open Tasks</strong> — the team's active backlog. Click
            to open the List view with all assignees.
          </LI>
          <LI>
            <strong>EIRs</strong> (Engineering Information Requests),{" "}
            <strong>ECNs</strong> (Engineering Change Notices), and{" "}
            <strong>Build Requests</strong> show mock counts today — those
            SharePoint lists aren't wired up yet. They'll switch to real numbers
            automatically once the lists exist.
          </LI>
        </UL>
        <P>
          Below the cards is a <strong>Task status breakdown</strong> panel —
          mini bars showing how your (or the team's) tasks are split across
          statuses. Toggle <strong>Mine / Company</strong> in the panel header
          to switch scope. Click any bar to jump to the List filtered to that
          status.
        </P>
        <P>
          The <strong>Filter by Project</strong> dropdown at the top of the
          page scopes every number on the dashboard to a single project. Pick a
          project and every card + the breakdown panel re-counts for it.
        </P>
      </>
    ),
  },
  {
    id: "list-view",
    title: "Task List view",
    keywords: [
      "list",
      "all tasks",
      "task list",
      "show all tasks",
      "table view",
      "rows",
      "status pills",
    ],
    searchText:
      "The List view shows every task with status pills at the top, a filter bar (Project, Assigned, Created By, Search), and a New Task button. Click a row to open the task detail. Filters live in the URL so views are shareable.",
    render: () => (
      <>
        <P>
          <code>/list</code> — every task in one scrollable list. The top of the
          page has:
        </P>
        <UL>
          <LI>
            <strong>Status pills</strong> — quick filters for Active, Backlog,
            In Progress, On Hold, Blocked, Complete. The counts update as you
            change the other filters below.
          </LI>
          <LI>
            <strong>Filter bar</strong> — Project Reference, Assigned, Created
            By (each multi-select with type-to-search), plus a free-text Search
            field that matches title, description, comments, and the numbered
            title.
          </LI>
          <LI>
            <strong>New Task</strong> button — opens the create form (see{" "}
            <a href="#tasks" className="text-accent underline-offset-2 hover:underline">
              Working with tasks
            </a>
            ).
          </LI>
        </UL>
        <P>
          Click any row to open the task's detail page. Filters live in the
          URL, so you can bookmark or share a filtered view as a link.
        </P>
      </>
    ),
  },
  {
    id: "kanban",
    title: "Kanban board",
    keywords: [
      "kanban",
      "board",
      "drag",
      "drop",
      "drag and drop",
      "columns",
      "status board",
      "move task",
      "change status",
    ],
    searchText:
      "The Kanban board groups tasks by status across six columns. Drag a card between columns to change status. On phones, drag is disabled — tap to open and change status from the detail page.",
    render: () => (
      <>
        <P>
          <code>/kanban</code> — every task as a card grouped by status. Six
          columns: Backlog → Selected for Development → In Progress → On Hold →
          Blocked → Complete.
        </P>
        <UL>
          <LI>
            <strong>Drag a card</strong> across columns to change its status.
            Works on desktop and tablet. On phones, drag is disabled to keep
            horizontal scrolling smooth — tap a card to open it and change the
            status from there.
          </LI>
          <LI>
            <strong>Click a card</strong> to open the task detail page.
          </LI>
          <LI>The same filter bar from the List view applies here too.</LI>
        </UL>
      </>
    ),
  },
  {
    id: "tasks",
    title: "Working with tasks",
    keywords: [
      "create task",
      "new task",
      "make a task",
      "add a task",
      "edit task",
      "task fields",
      "status",
      "priority",
      "category",
      "assignee",
      "watchers",
      "due date",
      "labels",
      "parent project",
      "parent task",
      "related projects",
      "numbered title",
      "complete a task",
      "mark complete",
    ],
    searchText:
      "Create tasks with the New Task button. Required: Title and Parent Project. NumberedTitle is auto-generated as T{n}-{projectRef}-{title}. Edit fields inline from the right sidebar of the detail page. Use Mark Complete or change Status to close out.",
    render: () => (
      <>
        <H3>Creating a task</H3>
        <P>
          Click <strong>New Task</strong> from the List, Kanban, or Dashboard.
          Fields:
        </P>
        <UL>
          <LI>
            <strong>Title</strong> (required) — short summary.
          </LI>
          <LI>
            <strong>Parent Project</strong> (required) — the project this task
            belongs to. The number prefix in the resulting{" "}
            <strong>NumberedTitle</strong> (e.g.{" "}
            <code>T15-0017-Endurance run</code>) is generated from this.
          </LI>
          <LI>
            <strong>Status, Priority, Category, Due Date, Labels</strong> —
            optional metadata.
          </LI>
          <LI>
            <strong>Assigned / Watchers</strong> — searchable dropdowns of
            team members. Multi-select; pick everyone who should be on this
            task.
          </LI>
          <LI>
            <strong>Description, Software Revision</strong> — free-text
            fields.
          </LI>
          <LI>
            <strong>Parent Task / Related Projects</strong> — for tasks that
            belong under a larger one or touch multiple projects.
          </LI>
        </UL>
        <P>
          On submit, the app auto-generates the NumberedTitle as{" "}
          <code>T&#123;n&#125;-&#123;projectRef&#125;-&#123;title&#125;</code>{" "}
          where <em>n</em> is the count of existing tasks under that project +
          1, and the project ref is the four-character code prefix (e.g.{" "}
          <code>0017</code> for "0017-AMP-5000 Refresh").
        </P>
        <H3>Editing a task</H3>
        <P>
          On the task detail page, the <strong>right sidebar</strong> lets you
          change status, priority, category, due date, labels, parent task,
          parent project, related projects, assignees, watchers, and software
          revision inline — no need to open a separate form. Every change is
          optimistic: the UI updates the moment you click, SharePoint catches
          up in the background.
        </P>
        <P>
          The <strong>Edit</strong> button at the top of the detail page opens
          the full task form for bulk edits of title + description in one go.
        </P>
        <H3>Marking complete</H3>
        <P>
          Use the <strong>Mark Complete</strong> button on the task detail
          page, or change the Status to "Complete" via the dropdown, or drag
          the card to the Complete column on the Kanban.
        </P>
      </>
    ),
  },
  {
    id: "pcb-checklist",
    title: "PCB checklist",
    keywords: [
      "pcb",
      "checklist",
      "schematic",
      "gerber",
      "bom",
      "smt",
      "build request",
      "ecn",
      "pre-release",
      "released",
      "category pcb",
      "board",
      "part number pulled",
      "altium",
      "cad output",
    ],
    searchText:
      "Tasks with category PCB show a Checklist card on the detail page with 17 items — 13 Yes/No checkboxes and 4 Choice radio groups. Items cover schematic + PCB part numbers, archive backup, SMT data output, BOM compare + send to CAD, 3D model export, revision documentation, build request, ordering, and gerber package. Checking a box writes to SharePoint instantly; a small done/total counter in the card header tracks progress. The card only renders for category=PCB tasks.",
    render: () => (
      <>
        <P>
          When a task is set to category <strong>PCB</strong>, a{" "}
          <strong>Checklist</strong> card appears on the detail page above
          the Attachments section. It mirrors the 17-item checklist from
          the original Power Apps form: 13 Yes/No items as checkboxes and
          4 multi-option items as radio groups, laid out in two columns.
        </P>
        <H3>What's on the list</H3>
        <P>
          The checklist covers everything from pulling new schematic / PCB
          part numbers, placing backups on the archive server, comparing
          BOM with SAP, outputting BOM + 3D model + gerber files, sending
          to CAD, submitting the build request, and the ordering /
          pre-release vs released documentation flow. The radio groups
          (Schematic and PCB revision, Send Gerber Package, Order_Parts)
          let you pick the right path through SharePoint's allowed choice
          values for that column.
        </P>
        <H3>Tracking progress</H3>
        <P>
          A small <strong>done / total</strong> counter in the card header
          shows how many items are checked or chosen out of the total —
          useful for confirming you've completed everything before
          submitting a board build, and for skimming an existing PCB task
          to see if it's done.
        </P>
        <H3>Saving</H3>
        <P>
          Every checkbox flip and radio change writes to SharePoint
          immediately — optimistic, so the UI updates instantly. If the
          save fails on the network round-trip, the field flips back and
          a red toast shows the error. The standard undo lives in the
          toast for a few seconds in case you bumped a box by accident.
        </P>
        <Tip>
          If a checklist row shows a red "column missing on the
          SharePoint Task list" note, that specific SharePoint column was
          renamed or deleted — the rest of the checklist still works;
          flag the missing column to an admin so it can be restored.
        </Tip>
      </>
    ),
  },
  {
    id: "comments",
    title: "Comments & @-mentions",
    keywords: [
      "comment",
      "mention",
      "mentioning",
      "at mention",
      "at-mention",
      "tag someone",
      "ping someone",
      "ping",
      "tag",
      "@",
      "@someone",
      "notify someone",
      "send email to teammate",
      "reply",
      "attachment",
      "attach file",
      "screenshot",
      "edit comment",
      "delete comment",
      "thread",
    ],
    searchText:
      "Type @ in the comment composer to open the mention picker. Arrow keys and Enter to pick. Mentioned people get an email with the task name, the comment quote, and a link. Attach files by drag-drop or click Attach. You can edit your own comments inline. Ctrl+Enter sends.",
    render: () => (
      <>
        <P>
          Every task has a comments thread. To post: scroll down the detail
          page and use the composer.
        </P>
        <H3>@-mentioning someone</H3>
        <P>
          Type <code>@</code> in the composer. A dropdown opens with everyone
          who's been an assignee or watcher across the team. Use arrow keys to
          highlight + Enter to pick, or click. The mention becomes a styled
          chip in your comment and the mentioned person receives an email
          notification when you send.
        </P>
        <P>
          Anyone you @-mention also <strong>becomes a watcher</strong> on
          the task or EIR automatically (unless they already are). They
          get future notifications on follow-up activity. To stop
          watching, the mentioned user removes themselves from the
          Watchers field on the detail sidebar. (Heads-up: a fresh
          @-mention will re-add them, so if you keep mentioning a
          colleague who's already left the thread on purpose, expect
          them to keep removing themselves.)
        </P>
        <Tip>
          You <em>can</em> mention yourself — useful as a "remind me later"
          that lands in your inbox and pins the task to your watched
          list.
        </Tip>
        <H3>Attachments</H3>
        <P>
          Drag a file onto the composer, or click <strong>Attach</strong>.
          Multiple files OK; previewed inline. On a <strong>task</strong>{" "}
          comment, dropped files upload to the task's SharePoint project
          folder before the comment posts, and a clickable hyperlink to
          each file is inlined into the comment body — same routing
          described in the Attachments section below. On an{" "}
          <strong>EIR</strong> comment, attachments are still in-session
          previews only (legacy behaviour; the EIR attachment migration is
          on the backlog).
        </P>
        <H3>Editing your own comments</H3>
        <P>
          A pencil icon appears next to comments you authored. Click it to
          edit in place. Editing won't re-spam mentions that were already
          there — only newly added mentions get an email.
        </P>
        <H3>Sending and confirmation</H3>
        <P>
          Press{" "}
          <kbd className="rounded border border-border bg-bg px-1 py-0.5 text-[10px]">
            Ctrl
          </kbd>
          +
          <kbd className="rounded border border-border bg-bg px-1 py-0.5 text-[10px]">
            Enter
          </kbd>{" "}
          to send, or click <strong>Send</strong>. Comments appear in the
          thread immediately; the network round-trip to SharePoint happens in
          the background.
        </P>
      </>
    ),
  },
  {
    id: "attachments",
    title: "Task attachments",
    keywords: [
      "attachment",
      "attachments",
      "upload",
      "file",
      "files",
      "drawing",
      "datasheet",
      "pdf",
      "image",
      "project folder",
      "documents library",
      "miscellaneous",
      "view all",
      "where do files go",
      "sharepoint folder",
      "where used",
    ],
    searchText:
      "Task attachments are stored in two places at once: the task itself in SharePoint (as list-item attachments) and the project folder under General/Project Folders. Files specific to a task show under 'On this task'; shared project files show under 'From <folder name>'. Task-specific attachments take priority and appear first. Deletes are scoped — removing from one place doesn't touch the other. Comment attachments use the project-folder path only, since they end up as hyperlinks inside the comment body.",
    render: () => (
      <>
        <P>
          Task attachments land in <strong>two places</strong> at once when
          you upload a file:
        </P>
        <ul className="ml-6 list-disc text-sm leading-relaxed text-fg-muted">
          <li>
            <strong>On the task itself</strong> as a SharePoint list-item
            attachment — visible inline on the task in the native SharePoint
            UI and in anything that reads list-item attachments downstream.
          </li>
          <li>
            <strong>In the project folder</strong> under{" "}
            <code>Documents / General / Project Folders / &lt;Project&gt;</code>{" "}
            — visible across every task in the same project, useful for
            engineering artefacts that belong to the project rather than to
            one task.
          </li>
        </ul>
        <H3>What you see on the task</H3>
        <P>
          The Attachments card on a task shows two sub-lists:
        </P>
        <ul className="ml-6 list-disc text-sm leading-relaxed text-fg-muted">
          <li>
            <strong>On this task</strong> — task-specific list-item
            attachments. Listed first because they take priority (they were
            attached to this task explicitly, not shared across a project).
          </li>
          <li>
            <strong>From &lt;folder name&gt;</strong> — the 5 most-recently
            modified files in the matching project folder. A{" "}
            <strong>View all in SharePoint →</strong> link at the bottom
            opens the full folder so you can browse the rest, including
            older files.
          </li>
        </ul>
        <H3>Uploading a file</H3>
        <P>
          Open the task and use the <strong>Add file</strong> button on the
          Attachments card. The file uploads to both storages in the same
          click. If your tenant isn't fully wired up for the list-item path
          (the SharePoint admin hasn't granted the SP REST scope), the
          project-folder copy still goes through and the file shows up
          there — uploads never silently fail.
        </P>
        <P>
          Project-folder routing: the app picks the folder tagged with your
          task's <strong>Project Reference</strong>. If no folder matches,
          the file lands in the shared <code>Miscellaneous</code> folder
          with the project code prepended onto the filename (e.g.{" "}
          <code>349-MT-ACI_drawing.pdf</code>) so it stays findable by
          search.
        </P>
        <H3>Removing a file</H3>
        <P>
          The trash icon next to each filename deletes <em>only that
          copy</em>. Removing a file from "On this task" doesn't touch the
          project folder; removing from the project folder doesn't touch
          the task. Each list has its own scoped delete confirmation so
          there's no surprise.
        </P>
        <H3>Comment attachments</H3>
        <P>
          Files dropped into a task comment use the project-folder path
          only — they end up as clickable hyperlinks inlined into the
          comment body (`📎 filename.pdf`). No list-item attachment is
          created for comment files, because the hyperlink in the comment
          is already the durable reference.
        </P>
        <H3>Limits</H3>
        <P>
          Files up to 4 MB upload directly. Above that, large-file upload
          sessions aren't wired up yet — drop the file into SharePoint
          directly and it'll show up on the next refresh.
        </P>
        <Tip>
          EIRs still use a list-item-only model for now (attached to the
          EIR itself, no project folder mirroring). The migration to the
          same dual-routing model is on the backlog.
        </Tip>
      </>
    ),
  },
  {
    id: "eirs",
    title: "EIRs (Engineering Information Requests)",
    keywords: [
      "eir",
      "eirs",
      "engineering information request",
      "ecr",
      "engineering change request",
      "temporary deviation",
      "request type",
      "obsolete part",
      "part replacement",
      "mfg eol",
      "mfg discontinued",
      "ltb",
      "engineering response",
      "buyer code",
      "risk part",
      "procurement",
      "where used",
      "create eir",
      "new eir",
      "views",
      "view tabs",
      "needs assigned",
      "unassigned",
      "triage",
    ],
    searchText:
      "The EIRs tab shows Engineering Information Requests with workflow View tabs (All, New, Needs Assigned, At Risk Parts), status pills (Under Review, Response Accepted, Closed, etc.) and a filter bar for Project, Assigned Engineer, Reporter, and search. New = no project reference and no engineer assigned; Needs Assigned = has a project reference but still no engineer. Click an EIR to open the detail page with Description, Engineering Response, Part Details (MFG, P/N, EAU, etc.), Comments, and a sidebar to edit Status, Resolution, Request Type, Priority, Reporter, Assigned Engineers, Watchers, Project, Task Reference, Requested Completion Date, LTB Date.",
    render: () => (
      <>
        <P>
          The <strong>EIRs</strong> tab in the top nav lists every entry from
          the SharePoint Engineering Information Request list. EIRs cover three
          request types — straight EIR, ECR (Engineering Change Request), and
          Temporary Deviation — and progress through their own status workflow
          separate from tasks.
        </P>
        <H3>List view</H3>
        <P>
          <strong>View tabs</strong> at the top group EIRs by triage stage:
          <strong> All</strong>, <strong>New</strong> (no project reference{" "}
          <em>and</em> no engineer assigned — freshly submitted, needs triage),
          <strong> Needs Assigned</strong> (a project reference has been set
          but no engineer is assigned yet), and <strong>At Risk Parts</strong>{" "}
          (the part's RiskPart flag is Active). Each tab shows a live count.
        </P>
        <P>
          Below the tabs, status pills (Open, Under Review, Response Accepted,
          Closed, etc.) and a filter bar with Project Reference (multi-select),
          Assigned Engineer (multi-select), free-text Search across title / EIR
          No / MFG / P/N / description, and Reporter (single-select). The view,
          status, and filters all live in the URL so a view is shareable.
        </P>
        <H3>Creating one</H3>
        <P>
          Click <strong>New EIR</strong> at the top right. <strong>Title</strong>{" "}
          and <strong>Project Reference</strong> are required. The form pre-fills
          Reporter to you and Request Type to "EIR". Optional fields on create
          include the part details (Where Used, MFG, MFG P/N, Altronic Part
          Number) and Requested Completion Date — everything else can be
          completed from the detail sidebar after creation.
        </P>
        <H3>Detail page</H3>
        <P>
          The main column shows the EIR No header, request-type chip,
          Description, Engineering Response (with its own inline editor), Part
          Details (Where Used, MFG, MFG P/N, Altronic Part Number, EAU, Current
          Stock, Current Price, Buyer Code — all editable inline by clicking),
          and the comments thread.
        </P>
        <P>
          The sidebar holds the workflow fields: Status, Resolution, Request
          Type, Requested Priority, Reporter, Assigned (Engineers), Project
          Reference (each assigned project is listed on its own line with a ✕
          to remove it; click <strong>Add / edit</strong> to open the picker
          and choose more), Requested Completion Date, LTB Date, plus Watchers
          at the bottom. Every change is optimistic with toast + undo, same as
          everywhere else.
        </P>
        <H3>Linked Task & promotion</H3>
        <P>
          A <strong>Linked Task</strong> card sits in the main column above
          the Attachments section. It shows the task this EIR has been
          promoted to (or any other task you want to reference) — clickable
          row with the numbered title on the left and the task's current
          status badge on the right, identical in feel to the Child Tasks
          card on the task detail. Hit <strong>Edit</strong> in the card
          header to type a new reference (e.g. <code>T115</code>) or paste a
          Power Apps task URL; the app extracts the task ID either way.
        </P>
        <H3>Attachments</H3>
        <P>
          EIRs have an <strong>Attachments</strong> card on the detail
          page that stores files directly against the SharePoint list
          item (the classic AttachmentFiles endpoint). If the section
          shows an "unavailable" notice, an admin still needs to grant
          the app the SharePoint REST permission (Office 365 SharePoint
          Online → AllSites.Manage). Task attachments use a different
          routing — see the "Task attachments" section.
        </P>
      </>
    ),
  },
  {
    id: "test-sheets",
    title: "Test Sheets",
    keywords: [
      "test sheet",
      "test sheets",
      "test results",
      "engineering test",
      "tester",
      "test record",
      "create test sheet",
      "test report",
      "firmware version",
      "serial number",
    ],
    searchText:
      "Test Sheets log engineering test records. Create one from the Test Sheets page (blank) or from a task's detail page (pre-fills Project + Task reference). Edit fields inline. Tasks show their linked test sheets as clickable pills.",
    render: () => (
      <>
        <P>
          The <strong>Test Sheets</strong> tab in the top nav lists every entry
          from the SharePoint "Test Results" list — engineering test records
          with their product, serial number, purpose, results, test date, and
          the responsible tester.
        </P>
        <H3>Creating one</H3>
        <P>
          Either click <strong>New Test Sheet</strong> on the Test Sheets page
          for a blank form, or click <strong>New Test Sheet</strong> on a
          task's detail page to create one with that task's Parent Project and
          Task Reference pre-filled (and locked — you're explicitly creating a
          sheet for THIS task).
        </P>
        <H3>Editing</H3>
        <P>
          Click a row in the Test Sheets list to open the detail page, then
          click <strong>Edit</strong> to open the form. Same fields as create.
          Saves are optimistic, with toast + undo on every change.
        </P>
        <H3>Cross-referencing</H3>
        <P>
          When a task has test sheets linked to it, they appear as a list of
          clickable pills below the task description. Open any test sheet
          detail page and the <strong>Project Reference</strong> +{" "}
          <strong>Task Reference</strong> in the sidebar are clickable links
          back to those records.
        </P>
      </>
    ),
  },
  {
    id: "admin",
    title: "Admin section",
    keywords: [
      "admin",
      "administrator",
      "permissions",
      "access control",
      "who can edit",
      "grant access",
      "add admin",
      "remove admin",
      "admin link",
      "project references",
      "projects admin",
      "manage projects",
      "eir roles",
      "engineer role",
      "supply chain role",
      "field permissions",
      "who can edit",
    ],
    searchText:
      "Admins manage three things from the Admin section in the header: the list of admin users (/admin/admins), the project references catalogue (/admin/projects), and EIR roles (/admin/eir-roles) which control who can edit the Engineering Response (engineer role) and Buyer Code (supply chain role) fields on an EIR. The Admin link only appears in the header for users on the admin list. Add an admin from the Admins page; their name appears in the header on their next sign-in. Removing yourself is disabled to prevent lockouts. A small hardcoded bootstrap set of admins stays in the code as a safety net.",
    render: () => (
      <>
        <P>
          The <strong>Admin</strong> link in the header only shows up for users
          whose email is in the Admins list. Click it to land on the Admins
          page, which has a table of everyone who has admin access.
        </P>
        <H3>Adding or removing admins</H3>
        <P>
          Click <strong>Add admin</strong> on the Admins page. Enter the user's
          @altronic-llc.com email, optionally a display name and a short note
          about why they're being granted access, and hit Save. The new admin
          sees the Admin link the next time they reload the app.
        </P>
        <P>
          To revoke access, click <strong>Remove</strong> on the row you want
          to drop. You can't remove yourself — there's always a hardcoded
          bootstrap set of accounts in the code as a safety net, so the system
          stays accessible even if the Admins list is emptied by accident.
        </P>
        <H3>Project References admin</H3>
        <P>
          The <strong>Projects admin →</strong> link on the Admins page (or
          navigate to <code>/admin/projects</code> directly) opens the Project
          References editor. Add new projects there and they immediately
          become available as parent / related project choices on every task.
        </P>
        <H3>EIR Roles admin</H3>
        <P>
          The <strong>EIR Roles admin →</strong> link (or{" "}
          <code>/admin/eir-roles</code>) controls who can edit the two
          restricted EIR fields. Add a user, then tick <strong>Engineer</strong>{" "}
          (lets them edit an EIR's <strong>Engineering Response</strong>) and/or{" "}
          <strong>Supply Chain</strong> (lets them edit the{" "}
          <strong>Buyer Code</strong>). A user can hold both. Everyone signed in
          can still edit every other EIR field — only those two are gated. The
          checkboxes save instantly; remove a user to drop all their EIR roles.
        </P>
        <P>
          On the EIR itself, a locked field shows a small lock icon and a
          tooltip explaining which role is required. Until the EIR Roles list is
          set up in SharePoint (real mode), gating stays off and everyone can
          edit both fields.
        </P>
        <Tip>
          If you're trying to add yourself and the modal closes silently with
          no row appearing, the SharePoint Admins list isn't configured yet —
          a yellow notice at the top of the Admins page tells you so. An
          admin needs to create the list and set <code>VITE_SP_ADMINS_LIST_ID</code>.
        </Tip>
      </>
    ),
  },
  {
    id: "filters",
    title: "Filtering & search",
    keywords: [
      "filter",
      "search",
      "find",
      "narrow",
      "show only",
      "filter by project",
      "filter by person",
      "filter by status",
      "share filter",
      "bookmark filter",
      "url filter",
    ],
    searchText:
      "The filter bar on List, Kanban, and Test Sheets has Project Reference (multi), Assigned (multi, defaults to you), free-text Search, and Created By (single). Filters live in the URL — bookmark or share a filtered view as a link.",
    render: () => (
      <>
        <P>
          The filter bar appears on the List, Kanban, and Test Sheets views and
          has the same shape everywhere:
        </P>
        <UL>
          <LI>
            <strong>Project Reference</strong> — multi-select. Pick one or many
            to scope the view to specific projects.
          </LI>
          <LI>
            <strong>Assigned</strong> — multi-select. Defaults to "you" so the
            first thing you see is your own work.
          </LI>
          <LI>
            <strong>Search</strong> — free text. Matches title, numbered title,
            description, and comment bodies.
          </LI>
          <LI>
            <strong>Created By</strong> — single-select. Filter to tasks
            created by a particular person.
          </LI>
        </UL>
        <P>
          Every multi-select dropdown has a search box at the top for finding a
          specific name or project quickly, and the options you've already
          selected sort to the top of the list when you open it. Pick "Anyone"
          (or click the ✕ on the dropdown) to clear that filter.
        </P>
        <Tip>
          Filters live in the URL (<code>?assigned=…&amp;project=…</code>) — so
          you can bookmark a particular view or share it as a link.
        </Tip>
      </>
    ),
  },
  {
    id: "notifications",
    title: "Notifications",
    keywords: [
      "email",
      "alert",
      "ping",
      "notify",
      "subscribe",
      "watch",
      "watching",
      "follow",
      "unwatch",
      "stop watching",
      "get notified",
      "watch a task",
    ],
    searchText:
      "Mention email goes to mentioned people from automation@altronic-llc.com with a link. Editing a comment only emails NEW mentions. Use the Watch button to subscribe to a task — Power Automate flows email watchers on changes.",
    render: () => (
      <>
        <H3>Email — @-mentions</H3>
        <P>
          When you @-mention someone in a comment, they receive an email from{" "}
          <strong>automation@altronic-llc.com</strong> with a greeting, the
          task name, the comment quoted, and a button to open the task. Any
          attachments you added ride along as email attachments.
        </P>
        <P>
          Editing a comment to add a NEW mention emails just the new person.
          Existing mentions don't get re-spammed.
        </P>
        <H3>Watching a task</H3>
        <P>
          Click <strong>Watch</strong> on the task detail page to add yourself
          to the watchers list. Power Automate flows running on the SharePoint
          list send watchers email updates when the task is changed or
          commented on. Click <strong>Watching</strong> again to stop.
        </P>
      </>
    ),
  },
  {
    id: "undo",
    title: "Undo & confirmation",
    keywords: [
      "undo",
      "revert",
      "mistake",
      "wrong",
      "accidental",
      "rollback",
      "took it back",
      "fix mistake",
      "go back",
      "confirmation",
      "toast",
    ],
    searchText:
      "Every change shows a toast at the bottom-right. Most carry an Undo button — click within 7 seconds to revert in UI and SharePoint. Failures show a red toast and roll back automatically. No undo for comment add, task create, task delete.",
    render: () => (
      <>
        <P>
          Every change you make — status, priority, due date, parent project,
          assignees, watchers, etc. — surfaces a confirmation toast at the
          bottom-right of the screen. Most carry an <strong>Undo</strong>{" "}
          button.
        </P>
        <P>
          Click Undo within ~7 seconds of an accidental change and the previous
          value is restored both in the UI and on SharePoint. After that the
          toast dismisses and the change is locked in.
        </P>
        <P>
          If a write fails, a red toast tells you what went wrong and the
          change automatically rolls back — you don't have to do anything.
        </P>
        <P>
          The mutations that <em>don't</em> have Undo: comment add (SharePoint
          doesn't expose delete-a-comment), task create (we'd have to delete
          the newly-created task and renumber), and project create. You'll see
          a confirmation but no Undo button.
        </P>
      </>
    ),
  },
  {
    id: "mobile",
    title: "Using on mobile",
    keywords: [
      "mobile",
      "phone",
      "tablet",
      "iphone",
      "android",
      "small screen",
      "responsive",
      "dark mode",
      "light mode",
      "theme",
    ],
    searchText:
      "On phones, Kanban drag is disabled — tap a card to open it. Tablet and desktop work normally. Theme toggle (Sun / Moon) at the top-right switches light/dark and is remembered per browser.",
    render: () => (
      <>
        <P>The app works on phones and tablets with a few intentional differences:</P>
        <UL>
          <LI>
            <strong>Phone (&lt; 640 px)</strong> — Kanban drag is disabled to
            keep horizontal scrolling smooth. Tap a card to open it; change
            the status from the detail page. Detail forms stack vertically
            for readability.
          </LI>
          <LI>
            <strong>Tablet / desktop</strong> — drag works normally. List view
            shows full task rows; sidebar editor opens beside the description.
          </LI>
          <LI>
            <strong>Theme toggle</strong> at the top-right (Sun / Moon)
            switches between light and dark. Your choice is remembered per
            browser.
          </LI>
        </UL>
      </>
    ),
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    keywords: [
      "error",
      "broken",
      "not working",
      "trouble",
      "fix",
      "problem",
      "issue",
      "stuck",
      "loading forever",
      "didn't save",
      "didn't work",
      "not showing",
      "missing",
      "permission denied",
      "report issue",
      "report bug",
      "notify app manager",
    ],
    searchText:
      "Loading hangs? Often sign-in / permission. F12 console: 401 means token expired (re-sign-in), 403 means missing SharePoint access. Change reverted? Someone may have edited at the same time. New task missing? Default Assigned filter is you — pick Anyone. Mention email not sent? Manual @Name typing doesn't make a chip — pick from dropdown. Report issue button in the header captures console errors and emails them to the app manager.",
    render: () => (
      <>
        <H3>"Loading tasks…" hangs forever</H3>
        <P>
          Usually a sign-in / permission issue. F12 → Console: a 401 means
          your token expired (sign out + sign in). A 403 means the app
          doesn't have read access to the SharePoint site — talk to IT.
        </P>
        <H3>A change didn't stick</H3>
        <P>
          If the toast turned red, the SharePoint write was rejected — open
          the task again to confirm. If the toast was green but the change
          reverted on refresh, someone else may have changed the same field
          at the same time; reapply your change.
        </P>
        <H3>I don't see my new task</H3>
        <P>
          The default Assigned filter is set to your email. If you created a
          task for someone else, it won't appear in the default list view —
          pick "Anyone" in the Assigned filter, or change the URL's{" "}
          <code>assigned</code> parameter.
        </P>
        <H3>Mention email didn't arrive</H3>
        <P>Most common reasons in order:</P>
        <UL>
          <LI>
            You typed <code>@Name</code> manually instead of picking from the
            dropdown — without selecting a person from the menu, the chip's{" "}
            <code>data-email</code> is missing and the email path skips it.
          </LI>
          <LI>
            The recipient's email is spelled differently in SharePoint than
            the user expects. Pick them from the dropdown to make sure the
            address is right.
          </LI>
          <LI>
            The shared mailbox setup or Send-As permission isn't fully done
            on IT's end. Re-check with them.
          </LI>
        </UL>
        <H3>Something else broken — use "Report issue"</H3>
        <P>
          Click the <strong>Report issue</strong> button (life-buoy icon) in
          the top right of every page. It opens a small form where you can
          describe what went wrong. The app attaches every console error it
          has seen during your session — you don't need to open DevTools
          yourself. The report is emailed to the app maintainer with you
          CC'd, so you have a paper trail of exactly what was sent.
        </P>
        <P>
          The maintainer contact is also in the footer if you'd rather send
          a screenshot directly.
        </P>
      </>
    ),
  },
];

// Stopwords stripped before scoring. Lets queries like "how do I mention
// someone" rank against "mention someone" / "tag someone" without the
// throat-clearing words diluting the score.
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "how",
  "do",
  "does",
  "is",
  "are",
  "i",
  "me",
  "my",
  "to",
  "in",
  "on",
  "of",
  "for",
  "by",
  "at",
  "can",
  "could",
  "would",
  "will",
  "this",
  "that",
  "with",
  "and",
  "or",
  "you",
  "your",
  "what",
  "where",
  "when",
  "who",
  "be",
  "if",
]);

function scoreSection(section: ManualSection, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const title = section.title.toLowerCase();
  const keywords = section.keywords.join(" ").toLowerCase();
  const text = section.searchText.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (title.includes(t)) score += 3;
    if (keywords.includes(t)) score += 2;
    if (text.includes(t)) score += 1;
  }
  return score;
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9@]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

export function ManualView() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const tokens = useMemo(() => tokenize(query), [query]);
  const filtered = useMemo(() => {
    if (tokens.length === 0) return SECTIONS;
    return SECTIONS.map((s) => ({ section: s, score: scoreSection(s, tokens) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.section);
  }, [tokens]);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-4 sm:px-6 sm:py-6">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="mb-6 rounded-lg border border-border bg-surface p-5">
        <div className="mb-2 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-fg-muted" />
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            User Manual
          </h1>
          <span className="ml-auto text-xs text-fg-muted">v{CURRENT_VERSION}</span>
        </div>
        <p className="mb-4 text-sm leading-relaxed text-fg-muted">
          How to use ARC (Altronic Resource Center). Search for what you
          need, or scroll through the sections.
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search the manual (e.g. "how do I mention someone")'
            className="h-10 w-full rounded-md border border-border bg-bg pl-9 pr-9 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {query.trim().length > 0 && (
          <div className="mt-2 text-xs text-fg-muted">
            {filtered.length === 0
              ? "No matching sections — try different words."
              : `${filtered.length} section${filtered.length === 1 ? "" : "s"} match${filtered.length === 1 ? "es" : ""} "${query.trim()}". Best match first.`}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        {/* Sidebar TOC — mirrors the filtered set when searching */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              {tokens.length === 0 ? "Contents" : "Best matches"}
            </div>
            <nav className="flex flex-col gap-0.5 text-sm">
              {filtered.length === 0 ? (
                <div className="px-2 py-1 text-xs text-fg-muted">No matches</div>
              ) : (
                filtered.map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    className={cn(
                      "rounded-md px-2 py-1 transition-colors hover:bg-surface-2",
                      "text-fg-muted hover:text-fg",
                    )}
                  >
                    {s.title}
                  </a>
                ))
              )}
            </nav>
          </div>
        </aside>

        {/* Main content — only render filtered sections */}
        <article className="flex flex-col gap-8 leading-relaxed text-fg">
          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center text-sm text-fg-muted">
              <p>No sections match <strong>"{query}"</strong>.</p>
              <p className="mt-2">
                Try different words — for example "mention" instead of "tag", or
                "filter" instead of "narrow".{" "}
                <button
                  onClick={() => setQuery("")}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  Clear search
                </button>{" "}
                to see all sections.
              </p>
            </div>
          ) : (
            filtered.map((s) => (
              <Section key={s.id} id={s.id} title={s.title}>
                {s.render()}
              </Section>
            ))
          )}
        </article>
      </div>
    </div>
  );
}

// =============================================================================
// Tiny presentational helpers — keep the body terse and the styles in one place.
// =============================================================================

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4">
      <h2 className="mb-3 font-display text-lg font-semibold text-fg sm:text-xl">
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-2 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-fg">{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="ml-5 list-disc space-y-1 text-sm text-fg">{children}</ul>;
}

function LI({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>;
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-fg">
      <strong className="text-accent">Tip:</strong> {children}
    </div>
  );
}
