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
  group?: string;
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
      "Sign in with your altronic-llc.com account. The Dashboard opens after sign-in. Use the top nav to switch between Dashboard, the Departments dropdown, and Admin. The Departments dropdown mirrors the dashboard: Engineering (Engineering Tasks, EIRs, Test Sheets, plus Build Requests and ECNs coming soon), Operations, Supply Chain, and Customer Service / Sales.",
    render: () => (
      <>
        <P>
          Sign in with your <code>@altronic-llc.com</code> Microsoft account when
          prompted. Once you're in, the <strong>Dashboard</strong> opens with a
          summary of your open work. The top nav has a{" "}
          <strong>Departments</strong> dropdown that mirrors the dashboard's
          sections — <strong>Engineering</strong> (Engineering Tasks, EIRs, Test
          Sheets, with Build Requests and ECNs coming soon),{" "}
          <strong>Operations</strong>, <strong>Supply Chain</strong>, and{" "}
          <strong>Customer Service / Sales</strong> (all coming soon). Engineering
          Tasks use the <strong>List</strong> and <strong>Kanban</strong> views.
          Your tasks are filtered to you by default — pick "Anyone" in the
          Assigned filter to see the rest of the team's work.
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
      "cards",
      "counts",
      "active items",
      "engineering tasks card",
      "eirs card",
      "test sheets card",
      "build requests",
      "ecns",
      "operational tasks",
      "maintenance tasks",
      "coming soon",
      "placeholder",
      "mine",
      "company",
      "my stats",
      "company stats",
      "per user",
      "departments",
      "engineering",
      "panels",
      "panel dashboard",
      "panel tasks",
      "project folders",
      "operations",
      "supply chain",
      "customer service",
      "sales",
      "sections",
      "project filter",
      "project picker",
      "choose a project",
      "all projects",
    ],
    searchText:
      "The Dashboard is grouped into department sections — Engineering, Operations, Supply Chain, and Customer Service / Sales — each a divider heading with its cards beneath. Engineering has live cards: Engineering Tasks, EIRs, Test Sheets, plus placeholders for Build Requests and ECNs. Operations, Supply Chain, and Customer Service / Sales show Coming soon placeholders. Each live card shows the count of active items (tasks not Complete, EIRs not Closed), a colour-coded status mini-bar, and clicks through to that type's page. A Mine / Company switch flips every count and bar between your own items and the whole company's; Mine is the default. A project picker sits next to it and works the same way — pick a project and every card's count and mini-bar narrows to just that project, in place, combining with Mine/Company rather than navigating anywhere. Clicking a card afterward opens that type's full list pre-filtered to the picked project.",
    render: () => (
      <>
        <P>
          The home page after sign-in is organised into{" "}
          <strong>department sections</strong> — Engineering, Operations, Supply
          Chain, and Customer Service / Sales — each a divider heading across the
          page with that team's cards beneath it. Engineering is the only
          department with live data today; the rest show placeholders.
        </P>
        <P>
          Within a section you get one <strong>card per work type</strong>. Each
          live card shows the count of <strong>active items</strong> for that
          type, a colour-coded status mini-bar (each status a distinct colour),
          and clicks through to that type's page.
        </P>
        <P>
          A <strong>Mine / Company</strong> switch in the top right flips every
          count and bar between <strong>your own items</strong> and the{" "}
          <strong>whole company's</strong>. <strong>Mine</strong> is the default
          — "yours" means items assigned to you (an assignee on a task, an
          assigned engineer on an EIR, the tester on a test sheet).
        </P>
        <P>
          A <strong>project picker</strong> sits next to it and works the same
          way. Pick a project and every card's count and mini-bar narrows down
          to just <strong>tasks</strong>, <strong>EIRs</strong>, and{" "}
          <strong>test sheets</strong> tied to that project reference — in
          place, no navigation. It combines with Mine/Company (e.g. "my active
          tasks on Project X"). Clicking a card afterward opens that type's
          full list pre-filtered to the picked project.
        </P>
        <UL>
          <LI>
            <strong>Engineering Tasks</strong> — tasks that aren't Complete.
            Opens the Task List (filtered to you in Mine). The mini-bar splits
            the active tasks by status.
          </LI>
          <LI>
            <strong>EIRs</strong> — EIRs that aren't Closed. Opens the EIRs list
            (filtered to you in Mine), with a status mini-bar.
          </LI>
          <LI>
            <strong>Test Sheets</strong> — test records (yours in Mine). Opens
            the Test Sheets list.
          </LI>
        </UL>
        <P>
          Types whose SharePoint list isn't built yet — Engineering's{" "}
          <strong>Build Requests</strong> and <strong>ECNs</strong>,{" "}
          <strong>Panels</strong> (Panel Dashboard, Panel Tasks, Project
          Folders), all of <strong>Operations</strong> (Operational Tasks,
          Maintenance Tasks), <strong>Supply Chain</strong> (Grey Market Part
          Requests, Supplier Issue Tracking, Supplier List, Supplier Contacts,
          Cost Impact Notices, FAIT), and{" "}
          <strong>Customer Service / Sales</strong> (Customer Feedback, Visit
          Reporting, Customers, Customer Contacts List, Special Pricing, Capacity
          Tracking, Pricing Requests) — appear as dimmed{" "}
          <strong>Coming soon</strong> placeholders. They'll light up with live
          counts as each department comes online.
        </P>
      </>
    ),
  },
  {
    id: "list-view",
    title: "Task List view",
    group: "Tasks",
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
    group: "Tasks",
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
      "The Kanban board groups tasks by status across six columns. Drag a card between columns to change status. Kanban is only available on tablets larger than an iPad mini and on desktop — on phones the Kanban option is hidden and links open the List view instead.",
    render: () => (
      <>
        <P>
          <code>/kanban</code> — every task as a card grouped by status. Six
          columns: Backlog → Selected for Development → In Progress → On Hold →
          Blocked → Complete.
        </P>
        <UL>
          <LI>
            <strong>Drag a card</strong> across columns to change its status —
            works on desktop and tablets. <strong>Kanban isn't available on
            phones</strong> (the board needs more width than a phone offers); on
            a phone the Kanban option is hidden and any Kanban link opens the{" "}
            <strong>List</strong> view instead.
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
    group: "Tasks",
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
      "checklist",
      "check list",
      "checkbox in description",
      "task list in description",
      "turn into checklist",
      "to-do list",
    ],
    searchText:
      "Create tasks with the New Task button. Required: Title and Parent Project. NumberedTitle is auto-generated as T{n}-{projectRef}-{title}. Edit fields inline from the right sidebar of the detail page. Use Mark Complete or change Status to close out. The Description field can hold a custom checklist — click Turn into checklist while editing, or type - [ ] lines yourself, and check items off directly from the detail page.",
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
        <H3>Custom checklists in the Description</H3>
        <P>
          Any Description can double as a checklist. While editing, click{" "}
          <strong>Turn into checklist</strong> next to the Description field —
          it converts each existing line into its own checkable item (an
          empty Description gets one blank item to start typing into). You
          can also type the syntax yourself:{" "}
          <code>- [ ] Buy the part</code> for an unchecked item,{" "}
          <code>- [x] Buy the part</code> for a checked one.
        </P>
        <P>
          Once saved, checklist items render as real checkboxes on the task
          detail page — click one to check it off right there, no need to
          open the edit form. Regular text lines can sit alongside checklist
          lines in the same Description; only the <code>- [ ]</code>/
          <code>- [x]</code> lines become checkboxes.
        </P>
        <H3>Marking complete</H3>
        <P>
          Use the <strong>Mark Complete</strong> button on the task detail
          page, or change the Status to "Complete" via the dropdown, or drag
          the card to the Complete column on the Kanban.
        </P>
        <P>
          If the task was promoted from an EIR (it shows a{" "}
          <strong>From EIR</strong> link at the top), completing it from the
          detail page first asks for the <strong>final resolution</strong>.
          What you enter is written back to the source EIR's Engineering
          Response, and that EIR is marked Resolved &amp; Closed. See{" "}
          <em>EIRs → Linked Task &amp; promotion</em> for the full round-trip.
        </P>
      </>
    ),
  },
  {
    id: "pcb-checklist",
    title: "PCB checklist",
    group: "Tasks",
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
    group: "Tasks",
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
      "renotify",
      "notify everyone again",
      "resend notification",
    ],
    searchText:
      "Type @ in the comment composer to open the mention picker. Arrow keys then Enter or Tab to pick. Comment boxes auto-grow as you type or paste. Mentioned people get an email with the task/EIR name, the comment quote, and a link. Attach files by drag-drop or click Attach. You can edit your own comments inline. Check Notify everyone again when editing to re-email every watcher and mention. Ctrl+Enter sends.",
    render: () => (
      <>
        <P>
          Every task has a comments thread. To post: scroll down the detail
          page and use the composer.
        </P>
        <H3>@-mentioning someone</H3>
        <P>
          Type <code>@</code> in the composer. A dropdown opens with everyone
          who's been an assignee or watcher across the team. Use the arrow keys
          to highlight, then <strong>Enter or Tab</strong> to pick (or click).
          The mention becomes a styled chip in your comment and the mentioned
          person receives an email notification when you send. The comment box
          also grows automatically as you type or paste, so long comments stay
          fully visible.
        </P>
        <P>
          Anyone you @-mention also <strong>becomes a watcher</strong> on
          the task or EIR automatically (unless they already are).{" "}
          <strong>Watchers are emailed on every new comment</strong> — not just
          when they're mentioned — so the whole thread stays in the loop. You're
          never emailed for your own comment, unless you @-mention yourself. To stop
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
          there — only newly added mentions get an email. If you'd rather
          make sure everyone sees the update, check{" "}
          <strong>Notify everyone again</strong> before saving — it re-emails
          every watcher and mentioned person (marked as an update, not a
          brand-new comment), regardless of who was already notified.
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
    group: "Tasks",
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
    id: "operations-tasks",
    title: "Operations Tasks",
    group: "Operations",
    keywords: [
      "operations",
      "operational tasks",
      "operations task list",
      "operations projects",
      "altronic equipment",
      "equipment picker",
      "task type",
      "location field",
      "shop floor",
      "operations kanban",
      "operations list view",
      "pmo",
    ],
    searchText:
      "Operations Tasks is the second department wired into ARC after Engineering, backed by the Operations Task List and Operations Projects lists on the Altronic_PMO SharePoint site. Same flow as Engineering tasks — List and Kanban views, a detail page, comments with @-mentions, watchers, attachments, and the Description checklist — with a few real differences: Assigned is a single person (not multiple), Status is Backlog/WIP/On Hold/Complete/Canceled, Priority is Low/Med/High, there's a Task Type field instead of Category, plus a Location field (shop-floor area) and an Equipment picker that Engineering tasks don't have. Reach it from the Dashboard's Operational Tasks card or the Departments dropdown's Operations group.",
    render: () => (
      <>
        <P>
          <strong>Operations Tasks</strong> is the second department wired
          into ARC after Engineering — the same List/Kanban/Detail flow,
          backed by a different SharePoint site (Altronic_PMO) and its own
          Operations Task List. Reach it from the <strong>Operational
          Tasks</strong> card on the Dashboard, or the{" "}
          <strong>Departments</strong> dropdown's Operations group.
        </P>
        <H3>How it's different from Engineering tasks</H3>
        <UL>
          <LI>
            <strong>Assigned is a single person</strong>, not a list — pick
            one person from the dropdown instead of adding several.
          </LI>
          <LI>
            <strong>Status</strong> is Backlog / WIP / On Hold / Complete /
            Canceled (five values, two of which — Complete and Canceled —
            count as "done" for the Active count and the status pills).
          </LI>
          <LI>
            <strong>Priority</strong> is Low / Med / High (note "Med", not
            "Medium").
          </LI>
          <LI>
            <strong>Task Type</strong> takes the place of Category (Fixtures,
            Programming, Plant Relayout, Quality Data Review, and so on).
          </LI>
          <LI>
            <strong>Location</strong> (shop-floor area, e.g. Machine Shop,
            Conformal Coating, Repair) and an <strong>Equipment</strong>{" "}
            picker (sourced from the Altronic Equipment List) are new fields
            Engineering tasks don't have.
          </LI>
          <LI>
            No parent/child task hierarchy and no related projects — Operations
            tasks are flat, each tied to at most one Project Ref.
          </LI>
        </UL>
        <H3>What works exactly the same</H3>
        <P>
          Comments (with @-mentions, watchers, and the "Notify everyone
          again" checkbox on edits), the Description field's custom
          checklist support, and file attachments on the task itself all
          work identically to Engineering tasks. The one attachments
          difference: Operations tasks only support list-item attachments
          (no project-folder mirroring) — same as EIRs today.
        </P>
        <H3>Operations Projects</H3>
        <P>
          Operations tasks reference their own project list — Operations
          Projects — separate from the Engineering Project Log. Admins
          manage it at <code>/admin/operations-projects</code>; see the{" "}
          <em>Admin section → Operations Projects admin</em> topic for
          details.
        </P>
      </>
    ),
  },
  {
    id: "eirs",
    title: "EIRs (Engineering Information Requests)",
    group: "Engineering requests",
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
      "eir numbering",
      "eir number",
      "eir no",
      "eir log no",
      "auto number",
      "number format",
      "views",
      "view tabs",
      "needs assigned",
      "unassigned",
      "triage",
      "promote to task",
      "promoted to task",
      "promote eir",
      "eir to task",
      "convert eir",
      "final resolution",
      "close task",
      "linked task",
      "checklist",
      "turn into checklist",
    ],
    searchText:
      "The EIRs tab shows Engineering Information Requests with workflow View tabs (All, New, Needs Assigned, At Risk Parts, LTB), status pills (Under Review, Response Accepted, Closed, etc.) and a filter bar for Project, Assigned Engineer, Reporter, and search. The Description field supports the same custom checklist syntax as a task's Description. New = no project reference and no engineer assigned; Needs Assigned = has a project reference but still no engineer. Click an EIR to open the detail page with Description, Engineering Response, Part Details (MFG, P/N, EAU, etc.), Comments, and a sidebar to edit Status, Resolution, Request Type, Priority, Reporter, Assigned Engineers, Watchers, Project, Task Reference, Requested Completion Date, LTB Date. New EIRs are auto-numbered as EIR_YYYY-#### (the next sequence for the year); the EIR Log No. is calculated from it. Promote an EIR to a task by setting Resolution to Promoted to Task: a confirmation window creates a linked task carrying the title, description, project, watchers, and comment thread (tagged as from the EIR). Completing that task prompts for a final resolution, which is written back to the EIR's Engineering Response and marks the EIR Resolved and Closed.",
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
          but no engineer is assigned yet), <strong>At Risk Parts</strong>{" "}
          (the part's RiskPart flag is Active, grouped by RiskPart Level), and{" "}
          <strong>LTB</strong> (any EIR with a last-time-buy date set). Each tab
          shows a live count.
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
          Click <strong>New EIR</strong> at the top right. Required:{" "}
          <strong>Subject</strong>, <strong>Description</strong>,{" "}
          <strong>Reporter</strong> (pre-filled to you),{" "}
          <strong>Requested Priority</strong>, and <strong>Request Type</strong>{" "}
          (defaults to "EIR"). The Purchasing section also takes EAU, Current
          Stock, Current Price, MFG, MFG P/N, LTB Date, Buyer Code, Risk Part,
          Risk Part Level, Technical Priority, Altronic Part Number, and Where
          Used. Project Reference, Assigned Engineers, and attachments are set
          from the detail page after creation.
        </P>
        <H3>EIR numbering</H3>
        <P>
          On save, each EIR is automatically assigned an <strong>EIR No</strong>{" "}
          in the format <code>EIR_YYYY-####</code> — the current year plus the
          next 4-digit sequence for that year (e.g. the 84th EIR logged in 2026
          becomes <code>EIR_2026-0084</code>). The numbering restarts at{" "}
          <code>0001</code> each new year. The SharePoint{" "}
          <strong>EIR Log No.</strong> column is calculated from EIR No, so it
          follows the same format automatically — you never type it in.
        </P>
        <H3>Detail page</H3>
        <P>
          The main column shows the EIR No header, request-type chip,
          Description, Engineering Response (with its own inline editor), Part
          Details (Where Used, MFG, MFG P/N, Altronic Part Number, EAU, Current
          Stock, Current Price, Buyer Code — all editable inline by clicking),
          and the comments thread. Like a task's Description, the EIR's
          Description can hold a custom checklist — click{" "}
          <strong>Turn into checklist</strong> while editing it; see{" "}
          <em>Working with tasks → Custom checklists in the Description</em>{" "}
          for the syntax.
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
        <P>
          <strong>Promoting an EIR to a task.</strong> Click the{" "}
          <strong>Promote to Task</strong> button at the top of the EIR (or set
          the sidebar <strong>Resolution</strong> to{" "}
          <strong>Promoted to Task</strong>) and a confirmation window opens.
          Adjust the <strong>task title</strong> if you want (it defaults to
          the EIR's title). Pick the parent project (defaulted from
          the EIR's Project Reference — it sets the task's number prefix) and
          click <strong>Create task</strong>. The new task carries over the
          EIR's title, description, project, and watchers, and its whole
          comment thread is copied across with each comment tagged{" "}
          <em>"carried over from EIR …"</em>. The task opens with a{" "}
          <strong>From EIR</strong> link at the top that returns to the source
          EIR, and this EIR's Resolution, Linked Task card, and "Promoted to
          task" badge all update to point at the new task. Promoting is
          one-time — an EIR already marked promoted won't re-open the window.
        </P>
        <P>
          <strong>Closing the loop.</strong> When someone marks the promoted
          task <strong>Complete</strong>, they're asked for the final
          resolution. That text is appended to this EIR's{" "}
          <strong>Engineering Response</strong> (dated and credited to the
          task), and the EIR is set to Resolution <strong>Resolved</strong> /
          Status <strong>Closed</strong> automatically.
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
    group: "Engineering requests",
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
    id: "project-folders",
    title: "Project Folders",
    group: "Engineering requests",
    keywords: [
      "project folders",
      "documents",
      "document library",
      "files",
      "browse files",
      "upload file",
      "sharepoint files",
      "folders",
      "drawings",
    ],
    searchText:
      "Project Folders is a browser over the Engineering document library (General/Project Folders). Open the Project Folders card on the dashboard or the Departments menu. Navigate into a project folder and its subfolders with the breadcrumb, click a file or folder to open it in SharePoint, and upload files into the folder you're in (up to 4 MB). Deleting is done in SharePoint itself.",
    render: () => (
      <>
        <P>
          <strong>Project Folders</strong> (dashboard card under Engineering, or
          the Departments menu) browses the Engineering document library —{" "}
          <code>General / Project Folders</code> — right inside ARC.
        </P>
        <UL>
          <LI>
            <strong>Navigate</strong> — the top level lists every project folder
            (with its linked project name). Click a folder to go in; use the{" "}
            <strong>breadcrumb</strong> at the top to come back up. Subfolders
            are fully navigable.
          </LI>
          <LI>
            <strong>Open</strong> — click a file to open it in SharePoint;
            folders have an open-in-SharePoint icon too.
          </LI>
          <LI>
            <strong>Upload</strong> — inside any folder, click{" "}
            <strong>Upload file</strong> to add a file to that folder (up to
            4&nbsp;MB per file). Uploading isn't offered at the top level — pick
            a folder first.
          </LI>
        </UL>
        <P>
          Deleting isn't done from ARC — remove files in SharePoint directly, so
          the shared library stays under its normal controls.
        </P>
      </>
    ),
  },
  {
    id: "ecns",
    title: "ECNs (Engineering Change Notices)",
    group: "Engineering requests",
    keywords: [
      "ecn",
      "ecns",
      "engineering change notice",
      "change notice",
      "dashboard card",
      "notification",
      "count",
      "mock data",
      "build request",
      "engineering request",
    ],
    searchText:
      "The Dashboard shows ECN counts as part of the engineering metrics. ECNs are currently represented as dashboard metrics and will be wired to their SharePoint list when available. Use the dashboard to track ECN volume alongside EIRs and Build Requests.",
    render: () => (
      <>
        <P>
          The <strong>ECNs</strong> card on the Dashboard tracks Engineering
          Change Notices alongside tasks, EIRs, and Build Requests.
        </P>
        <H3>What it means</H3>
        <P>
          ECNs are counted as a company-wide metric on the Dashboard. The card
          shows how many ECNs are currently open in the system and is meant as
          a quick way to see change activity at a glance.
        </P>
        <H3>Current status</H3>
        <P>
          Right now, <strong>ECNs are shown as dashboard metrics only</strong>.
          The app is prepared to wire in the real ECN SharePoint list later,
          at which point the count will switch from mock/demo data to live
          data automatically.
        </P>
        <Tip>
          When the ECN list is available, the same dashboard filter controls
          and project scoping that already work for Tasks and EIRs will apply.
        </Tip>
      </>
    ),
  },
  {
    id: "build-requests",
    title: "Build Requests",
    group: "Engineering requests",
    keywords: [
      "build request",
      "build requests",
      "request for build",
      "assembly request",
      "dashboard",
      "engineering request",
      "production request",
      "mock count",
    ],
    searchText:
      "Build Requests appear as a Dashboard metric today and will be connected to a real SharePoint list in a future update. The Dashboard card helps keep build activity visible while the rest of the app grows.",
    render: () => (
      <>
        <P>
          The <strong>Build Requests</strong> card on the Dashboard is the home
          for requests to build or kit hardware. It lives alongside Tasks,
          EIRs, and ECNs so you can see overall engineering workload at a glance.
        </P>
        <H3>How it works today</H3>
        <P>
          Today it is a <strong>dashboard-only metric</strong>. The app includes
          the card to reserve the slot for Build Requests and to keep the
          dashboard complete, even before the SharePoint list exists.
        </P>
        <H3>Future behavior</H3>
        <P>
          When the Build Requests list is added, this section will describe how
          to create, edit, and cross-reference build requests just like the
          existing Tasks, EIRs, and Test Sheets workflows.
        </P>
      </>
    ),
  },
  {
    id: "admin",
    title: "Admin section",
    group: "Admin",
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
      "engineering project log",
      "project log",
      "manage projects",
      "eir roles",
      "engineer role",
      "supply chain role",
      "field permissions",
      "who can edit",
      "operations projects admin",
      "operations project log",
    ],
    searchText:
      "Admins manage four things from the Admin section in the header: the list of admin users (/admin/admins), the Engineering Project Log — the master project list (/admin/projects), EIR roles (/admin/eir-roles) which control who can edit the Engineering Response (engineer role) and Buyer Code (supply chain role) fields on an EIR, and the Operations Projects list (/admin/operations-projects) — the master project list for Operations tasks. The Admin link only appears in the header for users on the admin list, and non-admins who open an /admin URL directly are sent back to the dashboard — the admin pages never show for them. Add an admin from the Admins page; their name appears in the header on their next sign-in. Removing yourself is disabled to prevent lockouts. A small hardcoded bootstrap set of admins stays in the code as a safety net.",
    render: () => (
      <>
        <P>
          The <strong>Admin</strong> link in the header only shows up for users
          whose email is in the Admins list. Click it to land on the Admins
          page, which has a table of everyone who has admin access. If a
          non-admin opens an <code>/admin</code> URL directly, they're redirected
          to the dashboard — the admin pages never render for them.
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
        <H3>Engineering Project Log admin</H3>
        <P>
          The <strong>Engineering Project Log →</strong> link on the Admins page
          (or navigate to <code>/admin/projects</code> directly) opens the
          Engineering Project Log — the master list of projects. Add new projects
          there and they immediately become available as Project Reference
          choices on tasks, EIRs, and test sheets.
        </P>
        <P>
          To <strong>edit an existing project's number or name</strong>, hover
          the project and click the <strong>pencil</strong>. Both the number and
          the name live in the project title (e.g. <code>0017-AMP-5000 Refresh</code>),
          so one edit changes either — and if you change the leading number, the
          project moves to the matching table automatically.
        </P>
        <P>
          The existing projects are split into tables by their project number —
          laid out as a 2×2 grid of quadrants on computer screens and stacked one
          below another on smaller screens, sorted by project title descending in
          each table:
        </P>
        <UL>
          <LI>
            <strong>New Projects</strong> — a three-digit number plus the
            requesting engineer's initials (e.g. <code>347-RW</code>).
          </LI>
          <LI>
            <strong>Legacy Projects</strong> — the four-digit <code>2000</code>
            -series that never had a number assigned previously.
          </LI>
          <LI>
            <strong>Engineering Items</strong> (<code>0xxx</code>) — engineering
            entries that aren't products.
          </LI>
          <LI>
            <strong>Insourcing</strong> (<code>5xxx</code>).
          </LI>
          <LI>
            <strong>Other</strong> — anything without a leading number (only
            shown when there's something in it).
          </LI>
        </UL>
        <H3>EIR Roles admin</H3>
        <P>
          The <strong>EIR Roles admin →</strong> link (or{" "}
          <code>/admin/eir-roles</code>) controls who can edit the restricted
          EIR fields. Add a user, then tick <strong>Engineer</strong> (lets them
          edit an EIR's <strong>Engineering Response</strong> and{" "}
          <strong>Technical Priority</strong>) and/or <strong>Supply Chain</strong>{" "}
          (lets them edit <strong>Buyer Code</strong>, <strong>Risk Part</strong>,
          and <strong>Risk Part Level</strong>). A user can hold both. Everyone
          signed in can still edit every other EIR field — only those are gated.
          The checkboxes save instantly; remove a user to drop all their EIR roles.
        </P>
        <P>
          On the EIR itself, a locked field shows a small lock icon and a
          tooltip explaining which role is required. Until the EIR Roles list is
          set up in SharePoint (real mode), gating stays off and everyone can
          edit both fields.
        </P>
        <H3>Operations Projects admin</H3>
        <P>
          The <strong>Operations Projects →</strong> link (or navigate to{" "}
          <code>/admin/operations-projects</code>) opens the master list of
          Operations projects — a separate list from the Engineering Project
          Log. Add a project's <strong>Number</strong> and <strong>Name</strong>{" "}
          and it immediately becomes available as a Project Ref choice on
          Operations tasks. Unlike the Engineering Project Log, there's no
          bucketed 0xxx/2xxx/5xxx table split — Operations project numbers
          are just sequential, so it's one flat list sorted newest-first.
          Hover a project and click the pencil to edit its number or name.
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
    group: "General",
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
    group: "General",
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
      "comment notification",
      "new comment email",
      "watcher email",
      "self mention",
      "why did i get an email",
      "status change email",
      "assigned email",
      "you've been assigned",
      "reassigned",
      "change alert",
      "reassignment notification",
      "resolution change email",
      "promoted to task email",
      "promotion notification",
    ],
    searchText:
      "Commenting on a task or EIR emails everyone watching it plus everyone you @-mention, from automation@altronic-llc.com. Mentioned people get a 'You were mentioned' email; other watchers get a 'New comment on' email. You're never emailed for your own comment unless you @-mention yourself. @-mentioning auto-adds the person as a watcher. Editing a comment emails only newly added mentions by default, but checking 'Notify everyone again' resends an 'Updated comment on' email to watchers plus everyone mentioned in the new AND previous version of the comment. Click Watch on the detail page to follow; click Watching to stop. Change alerts: changing a Status, an EIR Resolution, or the assignees emails the watchers, current assignees, and (for EIRs) the reporter. Being added as an assignee emails you 'You've been assigned'; being removed emails 'You've been unassigned'; everyone else gets a broadcast. Promoting an EIR to a task emails the EIR's watchers and reporter with a link to the new task. You're never emailed for a change you made yourself.",
    render: () => (
      <>
        <P>
          ARC emails come from <strong>automation@altronic-llc.com</strong>, and
          every one names the task or EIR and carries a button to open it. Two
          rules hold across <em>all</em> of them:
        </P>
        <UL>
          <LI>
            You are <strong>never emailed about your own action</strong> — even
            if you're a watcher or assignee — with the single exception of
            @-mentioning yourself.
          </LI>
          <LI>
            Recipients are <strong>deduped</strong>: you get at most one email
            per event, and the most specific message wins (a mention beats a
            watcher notice; a personal "assigned" note beats the broadcast).
          </LI>
        </UL>

        <H3>Every alert at a glance</H3>
        <AlertTable
          rows={[
            [
              "You comment (no mention)",
              "Everyone watching the item (minus you)",
              "New comment on …",
            ],
            [
              "You @-mention someone in a comment",
              "The mentioned person (other watchers still get the comment email)",
              "You were mentioned in …",
            ],
            [
              "You edit a comment to add a new @-mention",
              "Only the newly added person",
              "You were mentioned in …",
            ],
            [
              "You edit a comment and check \"Notify everyone again\"",
              "Watchers + everyone @-mentioned in the new AND the previous version of the comment (minus you)",
              "Updated comment on …",
            ],
            [
              "Status changes (task or EIR)",
              "Watchers + current assignees + EIR reporter (minus you)",
              "Status changed on …",
            ],
            [
              "EIR Resolution changes",
              "Watchers + assignees + reporter (minus you)",
              "Resolution changed on …",
            ],
            [
              "Someone is added as an assignee",
              "The person added",
              "You've been assigned to …",
            ],
            [
              "Someone is removed as an assignee",
              "The person removed",
              "You've been unassigned from …",
            ],
            [
              "Assignees change (for everyone else)",
              "Watchers + remaining assignees + reporter (minus you and the added/removed people)",
              "Assignees changed on …",
            ],
            [
              "An EIR is promoted to a task",
              "The EIR's watchers + reporter (minus you)",
              "… was promoted to a task (the button opens the new task)",
            ],
            [
              "A task promoted from an EIR is completed",
              "The EIR's watchers + assignees + reporter",
              "Status changed on … + Resolution changed on … (the EIR is set Closed / Resolved)",
            ],
          ]}
        />

        <H3>Comments &amp; @-mentions</H3>
        <P>
          Posting a comment emails <strong>everyone watching</strong> the item
          plus <strong>everyone you @-mention</strong>. The mail quotes the
          comment and carries along any files you attached.
        </P>
        <UL>
          <LI>
            People you <strong>@-mention</strong> get a "You were mentioned"
            email; other <strong>watchers</strong> get a "New comment on…" email.
          </LI>
          <LI>
            <strong>@-mentioning someone auto-adds them as a watcher</strong>, so
            they stay on the thread for future comments.
          </LI>
          <LI>
            You are <strong>never emailed for your own comment</strong> —{" "}
            <em>unless</em> you @-mention yourself (handy as a personal reminder).
          </LI>
          <LI>
            Editing a comment to add a <strong>new</strong> mention emails just
            that new person — existing mentions and other watchers aren't
            re-notified, unless you use the checkbox below.
          </LI>
          <LI>
            Checking <strong>"Notify everyone again"</strong> while editing
            resends to the whole group — watchers, plus everyone
            @-mentioned in the new comment <em>and</em> anyone who was
            @-mentioned in the version you're replacing (even if you removed
            or reworded their mention). The email is labelled "Updated
            comment on …" so it reads as an edit, not a fresh post.
          </LI>
        </UL>

        <H3>Status &amp; resolution changes</H3>
        <P>
          Changing a task's or EIR's <strong>Status</strong>, or an EIR's{" "}
          <strong>Resolution</strong>, alerts everyone who cares —{" "}
          <strong>watchers</strong>, <strong>current assignees</strong>, and, for
          EIRs, the <strong>reporter</strong>. The email spells out the change
          (e.g. <em>"In Progress → Complete"</em>) and who made it. Completing a
          task that was promoted from an EIR closes that EIR (Resolved &amp;
          Closed), which alerts the EIR's followers too.
        </P>

        <H3>Assignee changes</H3>
        <P>
          When assignees change, the affected people get a{" "}
          <strong>personal</strong> note and everyone else gets a{" "}
          <strong>broadcast</strong>:
        </P>
        <UL>
          <LI>
            The person <strong>added</strong> → "You've been assigned to …".
          </LI>
          <LI>
            The person <strong>removed</strong> → "You've been unassigned from
            …".
          </LI>
          <LI>
            Watchers, other assignees, and the EIR reporter → "Assignees changed
            on …", naming who was added and removed. (People who already got a
            personal note aren't sent this too.)
          </LI>
        </UL>

        <H3>Promoting an EIR to a task</H3>
        <P>
          When an EIR is <strong>promoted to a task</strong>, the EIR's{" "}
          <strong>watchers</strong> and <strong>reporter</strong> get an email
          (minus whoever did the promoting) with a button that opens the new
          task. Later, when that task is completed, the same followers hear about
          it again as the EIR is closed out.
        </P>

        <H3>What does NOT send email</H3>
        <P>
          To keep inboxes sane, most edits are silent. No email is sent for{" "}
          <strong>description or part-detail text edits</strong>,{" "}
          <strong>priority</strong>, <strong>due date</strong>,{" "}
          <strong>category</strong>, <strong>labels</strong>, or{" "}
          <strong>project reference</strong> changes.
        </P>

        <H3>Watching a task or EIR</H3>
        <P>
          On a <strong>task</strong>, click <strong>Watch</strong> on the detail
          page to add yourself (it toggles to <strong>Watching</strong> — click
          again to stop). On an <strong>EIR</strong>, add or remove yourself via
          the <strong>Watchers</strong> field in the detail sidebar. Watchers get
          comment emails and all the change alerts above, and{" "}
          <strong>@-mentioning someone adds them as a watcher</strong>{" "}
          automatically.
        </P>

        <Tip>
          Assignees and (for EIRs) the reporter are alerted on status/resolution
          and assignment changes whether or not they're watching — so you don't
          have to watch an item you're already responsible for.
        </Tip>
      </>
    ),
  },
  {
    id: "undo",
    title: "Undo & confirmation",
    group: "General",
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
    group: "General",
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
      "On phones the Kanban board isn't available — use the List view to see and update tasks; Kanban links open the List instead. Kanban works on tablets larger than an iPad mini and on desktop. Theme toggle (Sun / Moon) at the top-right switches light/dark and is remembered per browser.",
    render: () => (
      <>
        <P>The app works on phones and tablets with a few intentional differences:</P>
        <UL>
          <LI>
            <strong>Phone</strong> — the <strong>Kanban board isn't offered</strong>{" "}
            (it needs more width than a phone has); the Kanban option is hidden
            and Kanban links open the <strong>List</strong> view. This holds{" "}
            <em>even in landscape</em> — rotating a phone won't unlock Kanban.
            Use the List to see and update tasks. Detail forms stack vertically
            for readability.
          </LI>
          <LI>
            <strong>Tablet (larger than an iPad mini) / desktop</strong> — the
            full Kanban board is available with drag-and-drop; the List view
            shows full task rows and the sidebar editor opens beside the
            description.
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
    group: "General",
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
      "session expired",
      "signed out",
      "signing you out",
      "blank dashboard",
      "everything shows zero",
      "app went blank",
      "left it open overnight",
      "idle",
      "stale session",
    ],
    searchText:
      "Loading hangs? Often sign-in / permission. F12 console: 401 means token expired (re-sign-in), 403 means missing SharePoint access. Change reverted? Someone may have edited at the same time. New task missing? Default Assigned filter is you — pick Anyone. Mention email not sent? Manual @Name typing doesn't make a chip — pick from dropdown. Report issue button in the header captures console errors and emails them to the app manager. Left the tab open a long time and everything shows zero, or a 'Your session has expired' message appears? The app signs you out automatically and sends you back to the sign-in page — just sign in again.",
    render: () => (
      <>
        <H3>"Loading tasks…" hangs forever</H3>
        <P>
          Usually a sign-in / permission issue. F12 → Console: a 401 means
          your token expired (sign out + sign in). A 403 means the app
          doesn't have read access to the SharePoint site — talk to IT.
        </P>
        <H3>The app was left open a long time and everything shows zero</H3>
        <P>
          If a browser tab sits idle for a long stretch, your Microsoft
          sign-in can go stale in the background. Previously this showed a
          confusing dashboard where every card read "0" instead of your real
          counts. Now, the moment any data request notices the session has
          gone stale, the app automatically signs you out and shows{" "}
          <strong>"Your session has expired — signing you out so you can
          sign back in…"</strong>, then returns you to the sign-in page.
          Click <strong>Sign in with Microsoft</strong> again and you're
          back to normal — no reload needed, and nothing you were doing is
          lost beyond needing to re-sign-in.
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
          When a new app version is deployed, a banner appears at the top of
          the page telling you the latest version is available. Click
          <strong>Refresh</strong> to load the newest build.
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

  const groupedSections = useMemo(() => {
    const groups = new Map<string, ManualSection[]>();
    for (const section of filtered) {
      const group = section.group ?? "General";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(section);
    }
    // Map preserves insertion order, and sections are inserted in manual
    // order — so group order here naturally follows the manual's order.
    return Array.from(groups.keys()).map((name) => ({
      name,
      sections: groups.get(name)!,
    }));
  }, [filtered]);

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
        {/* Sidebar TOC — mirrors the filtered set when searching. The panel
            scrolls independently of the page once it's taller than the
            viewport, so every section stays reachable without scrolling
            through the whole manual to find it. */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="flex flex-col rounded-lg border border-border bg-surface p-3 lg:max-h-[calc(100vh-2rem)]">
            <div className="mb-2 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-accent">
              {tokens.length === 0 ? "Contents" : "Best matches"}
            </div>
            <nav className="scroll-hidden flex min-h-0 flex-col gap-3 overflow-y-auto text-sm">
              {filtered.length === 0 ? (
                <div className="px-2 py-1 text-xs text-fg-muted">No matches</div>
              ) : (
                groupedSections.map((group) => (
                  <div key={group.name}>
                    <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-accent">
                      {group.name}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {group.sections.map((s) => (
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
                      ))}
                    </div>
                  </div>
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
      <h3 className="mb-3 font-display text-lg font-semibold text-accent sm:text-xl">
        {title}
      </h3>
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

/**
 * Compact three-column reference table (Trigger / Who's emailed / Subject),
 * used by the Notifications section to catalog every alert. Scrolls
 * horizontally on narrow screens rather than forcing the page to.
 */
function AlertTable({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[540px] border-collapse text-left text-sm">
        <thead>
          <tr className="bg-surface-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            <th className="border-b border-border px-3 py-2">When this happens</th>
            <th className="border-b border-border px-3 py-2">Who gets emailed</th>
            <th className="border-b border-border px-3 py-2">Subject line</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([trigger, who, subject], i) => (
            <tr key={i} className="align-top text-fg">
              <td className="border-b border-border px-3 py-2 font-medium">{trigger}</td>
              <td className="border-b border-border px-3 py-2 text-fg-muted">{who}</td>
              <td className="border-b border-border px-3 py-2">
                <span className="italic">{subject}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
