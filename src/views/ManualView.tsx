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
      "Sign in with your altronic-llc.com account. The Dashboard opens after sign-in. Use the top nav to switch between Dashboard, the Departments dropdown, and Admin. The Departments dropdown mirrors the dashboard: Engineering (Engineering Tasks, EIRs, Test Sheets, Project Folders, Build Requests, Drawing File Logs, CSA Listings, with ECNs coming soon), Panels, Operations, Coils (Potting Sample Log), Quality Control (Digital QC and Ignition QC Defect Logs), Supply Chain, and Customer Service / Sales (Visit Reports).",
    render: () => (
      <>
        <P>
          Sign in with your <code>@altronic-llc.com</code> Microsoft account when
          prompted. Once you're in, the <strong>Dashboard</strong> opens with a
          summary of your open work. The top nav has a{" "}
          <strong>Departments</strong> dropdown that mirrors the dashboard's
          sections — <strong>Engineering</strong> (Engineering Tasks, EIRs, Test
          Sheets, Project Folders, Build Requests, Drawing File Logs, CSA
          Listings, with ECNs coming soon), <strong>Panels</strong>,{" "}
          <strong>Operations</strong>, <strong>Coils</strong> (Potting Sample
          Log), <strong>Quality Control</strong> (Digital QC and Ignition QC
          Defect Logs), <strong>Supply Chain</strong>, and{" "}
          <strong>Customer Service / Sales</strong> (Visit Reports, with the
          rest still coming soon). Engineering Tasks use the <strong>List</strong> and{" "}
          <strong>Kanban</strong> views.
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
      "The Dashboard is grouped into department sections — Engineering, Panels, Operations, Coils, Quality Control, Supply Chain, and Customer Service / Sales — each a divider heading with its cards beneath. Engineering has live cards: Engineering Tasks, EIRs, Test Sheets and more. Coils has the Potting Sample Log; Quality Control has the Digital QC and Ignition QC Defect Logs; Customer Service / Sales has Visit Reports. Supply Chain and Customer Service / Sales show Coming soon placeholders. Each live card shows the count of active items (tasks not Complete, EIRs not Closed), a colour-coded status mini-bar, and clicks through to that type's page. A Mine / Company switch flips every count and bar between your own items and the whole company's; Mine is the default. A project picker sits next to it and works the same way — pick a project and every card's count and mini-bar narrows to just that project, in place, combining with Mine/Company rather than navigating anywhere. Clicking a card afterward opens that type's full list pre-filtered to the picked project.",
    render: () => (
      <>
        <P>
          The home page after sign-in is organised into{" "}
          <strong>department sections</strong> — Engineering, Panels,
          Operations, Coils, Quality Control, Supply Chain, and Customer Service
          / Sales — each a divider heading across the page with that team's
          cards beneath it. A card is either live or a dimmed{" "}
          <strong>Coming soon</strong> placeholder, so the sections fill in as
          each team's tools come online.
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
          Other departments have their own cards further down the page —{" "}
          <strong>Coils</strong> (Potting Sample Log),{" "}
          <strong>Quality Control</strong> (Digital QC Defect Log, Ignition QC
          Defect Log) and <strong>Customer Service / Sales</strong> (Visit
          Reports) all open straight to their lists, and{" "}
          <strong>Panels</strong> and <strong>Operations</strong> link to their
          orders, tasks and the Teradyne Log.
        </P>
        <P>
          Types whose SharePoint list isn't built yet — Engineering's{" "}
          <strong>ECNs</strong>, Coils' <strong>Coil Defect Log</strong>,
          Quality Control's <strong>QC Forms</strong>, Operations'{" "}
          <strong>Maintenance Tasks</strong>, all of{" "}
          <strong>Supply Chain</strong> (Grey Market Part Requests, Supplier
          Issue Tracking, Supplier List, Supplier Contacts, Cost Impact Notices,
          FAIT), and <strong>Customer Service / Sales</strong> (Customer
          Feedback, Customers, Customer Contacts List, Special
          Pricing, Capacity Tracking, Pricing Requests) — appear as dimmed{" "}
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
      "search",
      "multiple keywords",
      "search syntax",
      "exact phrase",
      "quotes",
    ],
    searchText:
      "The List view shows every task with status pills at the top, a filter bar (Project, Assigned, Created By, Search), and a New Task button. Search matches all fields on every list; multiple words are ANDed together, and double quotes match an exact phrase. Click a row to open the task detail. Filters live in the URL so views are shareable.",
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
            field.
          </LI>
          <LI>
            <strong>New Task</strong> button — opens the create form (see{" "}
            <a href="#tasks" className="text-accent underline-offset-2 hover:underline">
              Working with tasks
            </a>
            ).
          </LI>
        </UL>
        <H3>How search works (all lists)</H3>
        <P>
          The Search box behaves the same on every list — Tasks, EIRs,
          Operations Tasks, Test Sheets:
        </P>
        <UL>
          <LI>
            It matches against <strong>every field</strong> on the item —
            title, description, status, people's names and emails, project
            names, part numbers, comment text and authors, due dates
            (as <code>2026-07-16</code>), everything.
          </LI>
          <LI>
            <strong>Multiple words narrow the results</strong>: each word must
            match somewhere, in any field, in any order.{" "}
            <code>coil bracket</code> finds items that mention both "coil" and
            "bracket" anywhere.
          </LI>
          <LI>
            <strong>Quotes search an exact phrase</strong>:{" "}
            <code>"purchase order"</code> only matches those two words
            side-by-side, in that order.
          </LI>
          <LI>
            Matching is case-insensitive, and results update a beat after you
            stop typing.
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
      "sub-task",
      "subtask",
      "indent",
      "nested checklist",
      "to-do list",
    ],
    searchText:
      "Create tasks with the New Task button. Required: Title and Parent Project. NumberedTitle is auto-generated as T{n}-{projectRef}-{title}. Edit fields inline from the right sidebar of the detail page. Use Mark Complete or change Status to close out. The Description field can hold a custom checklist — click Turn into checklist while editing, or type - [ ] lines yourself, and check items off directly from the detail page. Checking a box instantly records your name and the time next to the item; unchecking asks Are you sure first and records who unchecked it. Indent a checklist line with Tab (or spaces) to make it a sub-task of the item above it; Shift+Tab outdents. One level of nesting; the parent shows a 1/2 count of its sub-tasks done and is never ticked automatically. Tab only indents on a checklist line — elsewhere it moves to the next field.",
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
            belong under a larger one or touch multiple projects. Both are{" "}
            <strong>searchable dropdowns</strong>: open one and start typing to
            narrow the list rather than scrolling it. Related Projects takes
            several — each pick lands as a chip you can remove with its ✕, and
            the task's own parent project isn't offered.
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
          <strong>Related Projects</strong> in the sidebar is a{" "}
          <strong>searchable dropdown</strong> — open it, type to find the
          project, and tick it. Ticking a project that's already on the task
          takes it off again, so the same control both adds and removes. The
          projects currently on the task stay above it as chips you can click
          to open that project.
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
        <P>
          Checking a box is instant — <strong>your name and the current
          time are recorded</strong> and shown in small print right next to
          the item (e.g. <em>✓ Ray White · 7/17/2026, 10:15 AM</em>).
          Unchecking asks <strong>"Are you sure?"</strong> first, since it
          undoes recorded work — if you confirm, your name and the time are
          recorded as unchecking it (shown as{" "}
          <em>✗ Ray White · 7/17/2026, 10:15 AM</em>), replacing the
          checked-by record. Either way, the item's{" "}
          <strong>watchers and assignees get an email</strong> naming the item
          and whether it was checked or unchecked (see{" "}
          <em>Notifications → Checklist toggles</em>). This works everywhere
          Description checklists exist: Engineering tasks, Operations tasks,
          EIR descriptions, panel order notes, and panel tasks.
        </P>
        <H3>If a notification can't be sent</H3>
        <P>
          Notification emails go out from a shared mailbox, and each person has to
          be granted permission to send from it. If you post a comment and see{" "}
          <strong>"you don't have access to send notification email"</strong>, then{" "}
          <strong>your comment saved normally</strong> — but the people you
          mentioned were <em>not</em> emailed, and the message names who missed out.
        </P>
        <P>
          Send the wording to IT and ask to be added to <strong>Send As</strong> on
          the notifications mailbox. Until that's done, mentions still appear in
          the app but no email goes out, so tell anyone you needed to reach
          directly. This applies to change alerts too, not just comments.
        </P>
        <H3>Sub-tasks: indent a checklist line</H3>
        <P>
          <strong>Indent a checklist line to make it a sub-task</strong> of the
          item above it. Press <strong>Tab</strong> on the line while editing the
          Description — or type spaces, both work the same way.{" "}
          <strong>Shift+Tab</strong> takes the indent back off.
        </P>
        <P>So this:</P>
        <P>
          <code>- [ ] Fit the new sensor</code>
          <br />
          <code>&nbsp;&nbsp;&nbsp;&nbsp;- [ ] Order the bracket</code>
          <br />
          <code>&nbsp;&nbsp;&nbsp;&nbsp;- [x] Update the drawing</code>
          <br />
          <code>- [ ] Bench test</code>
        </P>
        <P>
          renders the two middle items indented under "Fit the new sensor", and
          that parent shows a small <strong>1/2</strong> count of how many of its
          sub-tasks are done.
        </P>
        <P>
          Three things worth knowing. There is <strong>one level</strong> of
          nesting — indenting twice still makes a sub-task of the same parent,
          not a sub-sub-task. A parent is{" "}
          <strong>never ticked automatically</strong> when its sub-tasks are all
          done, because that would put a name and time against a box nobody
          clicked — tick it yourself when the work is finished. And ticking a
          sub-task leaves the parent and the other sub-tasks exactly as they were.
        </P>
        <P>
          Tab only indents when the cursor is already on a checklist line.
          Anywhere else in the Description it moves to the next field, as usual.
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
      "paste screenshot",
      "name screenshot",
      "rename attachment",
      "duplicate file name",
      "overwrite",
      "edit comment",
      "delete comment",
      "thread",
      "renotify",
      "notify everyone again",
      "resend notification",
    ],
    searchText:
      "Type @ in the comment composer to open the mention picker. Arrow keys then Enter or Tab to pick. Comment boxes auto-grow as you type or paste. Mentioned people get an email with the task/EIR name, the comment quote, and a link. Attach files by drag-drop, click Attach, or paste with Ctrl+V. Pasting a screenshot opens a naming prompt before it attaches anywhere — Cancel discards it instead of attaching it — and the named file uploads to the task's SharePoint project folder like any other attachment; a name already taken there is saved as name (2).ext instead of overwriting it. You can edit your own comments inline (a comment is yours if its saved name or email matches you, so older imported comments count too). Check Notify everyone again when editing to re-email every watcher and mention. Ctrl+Enter sends.",
    render: () => (
      <>
        <P>
          Every task has a comments thread. To post: scroll down the detail
          page and use the composer.
        </P>
        <H3>@-mentioning someone</H3>
        <P>
          Type <code>@</code> in the composer. A dropdown opens with everyone
          who's been an assignee or watcher across the team, plus every admin
          — so you can mention someone the very first time, before they've
          touched anything. Use the arrow keys to highlight, then{" "}
          <strong>Enter or Tab</strong> to pick (or click). The mention
          becomes a styled chip in your comment and the mentioned person
          receives an email notification when you send. Typing a name without
          picking it from the dropdown leaves it as plain text — it won't
          notify anyone or add them as a watcher. The comment box also grows
          automatically as you type or paste, so long comments stay fully
          visible. Editing an existing comment has the same @-mention picker,
          so you can add someone while making an edit, not just when first
          posting.
        </P>
        <P>
          Comments are listed <strong>newest first</strong>, in the order they
          were actually posted — every timestamp is recorded on one company
          clock and then shown in your local time, so a thread between people
          in different time zones still reads in order.
        </P>
        <P>
          Anyone you @-mention also <strong>becomes a watcher</strong> on
          the item automatically (unless they already are) — tasks, EIRs,
          build requests, and individual build request parts alike.{" "}
          <strong>
            Watchers and whoever the item is assigned to are emailed on every new
            comment
          </strong>{" "}
          — not just when they're mentioned — so the whole thread stays in the
          loop. The email says why it reached you: mentioned, assigned to you, or
          watching. You're
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
          Drag a file onto the composer, click <strong>Attach</strong>, or{" "}
          <strong>paste with Ctrl+V</strong>. Multiple files OK; previewed
          inline. Pasting is the quick way to get a screenshot in: take one
          with <strong>Win+Shift+S</strong> (or Print Screen) and paste it
          straight into the comment box — a{" "}
          <strong>Name this screenshot</strong> prompt appears before it's
          attached anywhere. Type a real name (or keep the suggested one)
          and click <strong>Attach</strong> or press Enter; click{" "}
          <strong>Cancel</strong> or press Escape and the screenshot is
          discarded instead of attached. A pasted image that already has a
          real filename — copied from File Explorer or off a web page, say —
          skips the prompt. The named file uploads to the task's SharePoint
          project folder exactly like every other attachment; it isn't
          embedded as a picture in the comment. If that name is already
          taken in the folder, the file is saved as{" "}
          <code>name (2).ext</code> instead of overwriting what's already
          there, so two people naming a screenshot the same thing never
          clobber each other. Copying cells out of Excel or text out of
          Word still pastes as text, not as a picture of it. You can also
          paste a screenshot directly into the{" "}
          <strong>Attachments</strong> card — click the card first so it has
          focus, then Ctrl+V; the same naming prompt and no-overwrite rule
          apply there. On a <strong>task</strong>{" "}
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
          A pencil icon appears next to comments you authored — in every area
          (Engineering, EIRs, Operations, Build Requests, Panels). A comment
          counts as yours if its saved <strong>name or email</strong> matches
          your account, so older comments carried over from the previous system
          are editable too. Click the pencil to
          edit in place. Editing won't re-spam mentions that were already
          there — only newly added mentions get an email. If you'd rather
          make sure everyone sees the update, check{" "}
          <strong>Notify everyone again</strong> before saving — it re-emails
          every watcher, assignee and mentioned person (marked as an update, not
          a brand-new comment), regardless of who was already notified.
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
      "duplicate file name",
      "overwrite",
      "rename attachment",
    ],
    searchText:
      "Task attachments are stored in two places at once: the task itself in SharePoint (as list-item attachments) and the project folder under General/Project Folders. Files specific to a task show under 'On this task'; shared project files show under 'From <folder name>'. Task-specific attachments take priority and appear first. Deletes are scoped — removing from one place doesn't touch the other. Comment attachments use the project-folder path only, since they end up as hyperlinks inside the comment body. Uploading a file whose name is already used in the project folder doesn't overwrite it — it's saved as name (2).ext instead.",
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
          Open the task and <strong>drag the files onto the Attachments
          card</strong> — the card highlights while you're over it, and
          several at once is fine. You can also{" "}
          <strong>paste a screenshot</strong> into the card with Ctrl+V, or
          click <strong>Add file</strong> and pick them. However they arrive,
          they upload to both storages in the same step. If your tenant isn't fully wired up for the list-item path
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
          Files up to <strong>250 MB</strong> upload. Anything over about 4 MB
          is sent in chunks, so a big drawing or a short video goes up the same
          way a small file does — it just takes longer, and the Uploading…
          state stays put until it finishes. Past 250 MB, put the file into the
          project folder in SharePoint directly and paste the link into a
          comment; it'll show up in the file list on the next refresh.
        </P>
        <P>
          Uploading a file whose name is already sitting in that project
          folder doesn't overwrite it — the new file is saved as{" "}
          <code>name (2).ext</code> (then <code>(3)</code>, and so on)
          instead, so nothing gets silently replaced. A pasted screenshot
          works the same way: it gets a naming prompt before it attaches
          anywhere, and the name it's given is checked against the folder
          the same as any other upload — see the Attachments section under
          Comments for the prompt itself.
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
    id: "teradyne-log",
    title: "Teradyne Log",
    group: "Operations",
    keywords: [
      "teradyne",
      "teradyne log",
      "board test",
      "test log",
      "pcb test",
      "spea",
      "test station",
      "defective parts",
      "boards tested",
      "failures per board",
      "clock number",
      "employee clock",
      "sap number",
      "altronic part number",
      "old sap number",
      "part number",
      "operator notes",
      "remark",
      "manage lists",
      "year",
      "prior year",
      "previous year",
      "last year",
      "december entry",
      "recall year",
      "current year",
      "legacy data",
      "old entries",
      "history",
      "slow",
      "16000 rows",
      "indexed column",
      "admin only",
      "can't edit entry",
      "no edit button",
      "who can delete",
      "teradyne employees",
      "teradyne products",
      "teradyne remarks",
      "reference list",
      "lookup list",
    ],
    searchText:
      "The log shows the current year. Admins also get a Year picker going five years back, so an entry made in late December can still be corrected in January; a banner marks when you're viewing a past year and offers a way back. Non-admins always see the current year. Older history was imported into the SharePoint list for reporting and is normally read there, not in ARC. The table shows the newest 200 matching entries with a Show all button underneath, so searching stays quick; filters and totals always cover the whole chosen year. The log can take a few seconds to open on a big list; the entries shown are always the year you picked. Teradyne Log records board test failures off the Teradyne / Spea stations — the product tested, which parts were defective, a canned remark, board counts, the SAP number and the Altronic part number, and up to two employees with their clock numbers. The Altronic part number is the field previously labelled 'Old SAP Number'; it has its own column in the table. It's a table, not a detail page: rows are added and edited in a modal, and there are no comments or attachments. Anyone signed in can add an entry and correct one; only admins can delete. In the Employee box you can type either a name or a clock number to find someone. Name and clock number fill each other in: pick a person and their number appears, pick a number and their name appears; clearing one clears the other. Both boxes choose from the Employees list — the clock number is never typed, so it can't disagree with the employee record. Operator notes show inline under Defective Parts. The entry's name is built automatically as 'Product - Defective Parts' when you save — there's no name field to fill in and nothing shown in the form. Clock numbers are maintained on the Employees list, not per entry. Remarks carry a remark number you enter when adding one and can edit afterwards. Filter by Product, Remark, Employee, or free-text search; all filters live in the URL so a filtered view is shareable. The three lookup lists (Employees, Products, Remarks) are edited from the Manage lists menu on the Teradyne Log toolbar — any signed-in user can add or rename rows, no admin needed. A row already used by a log entry can't be deleted; rename it instead so past entries keep reading correctly.",
    render: () => (
      <>
        <P>
          <strong>Teradyne Log</strong> is where board test failures off the
          Teradyne / Spea stations get recorded. Reach it from the{" "}
          <strong>Teradyne Log</strong> card on the Dashboard, or the{" "}
          <strong>Departments</strong> dropdown's Operations group.
        </P>
        <P>
          It's deliberately a <strong>table</strong>, not a detail page — this
          list gets appended to and scanned far more than it gets discussed, so
          there are no comments and no attachments. Adding or editing a row
          opens a form; everything else happens in the table.
        </P>
        <H3>Adding an entry</H3>
        <P>
          Click <strong>New entry</strong>. Enter Date defaults to today.{" "}
          <strong>Product</strong> is the only required field, because it's half
          of the entry's name.
        </P>
        <UL>
          <LI>
            <strong>The entry's name is built for you</strong> —{" "}
            <em>Product - Defective Parts</em>, assembled when you save. There's
            no name box to fill in and nothing to check, and it can never drift
            from the two fields it's made of.
          </LI>
          <LI>
            <strong>Name and clock number fill each other in</strong> — pick a
            person in the Employee box and their clock number appears; pick a
            clock number and their name appears. Use whichever you know. Clearing
            one clears the other, because they're the same person.
          </LI>
          <LI>
            <strong>Both boxes choose from the Employees list</strong> — neither
            is free text, so an entry can't end up with a clock number that
            disagrees with the employee record. A clock number belongs to the
            employee, so you change it once under{" "}
            <em>Manage lists → Employees</em> rather than per entry. Someone with
            no clock number on their row simply won't appear in the clock list;
            fill it in there and they will.
          </LI>
          <LI>
            <strong>Find yourself by name or by clock number</strong> — type
            either into the Employee box and it'll match. Each person reads as
            "Name · #Clock · Work centre". The clock box lists the numbers on
            their own, since the name appears beside it as soon as you pick one.
          </LI>
          <LI>
            <strong>Two employee slots</strong> — Employee 1 and Employee 2 are
            separate fields, so a two-person test records both.
          </LI>
          <LI>
            Leaving a number field blank clears it rather than writing a zero.
          </LI>
        </UL>
        <H3>Finding entries</H3>
        <P>
          The log shows the <strong>current year</strong>. Years of older history
          were imported into the SharePoint list for reporting, and they're read
          there rather than here — so ARC stays focused on this year's work.
        </P>
        <P>
          <strong>Admins get a Year picker</strong> (up to five years back), for
          the case where something logged in late December needs correcting in
          January and would otherwise be out of reach. While a past year is
          selected the page says so and offers a one-click way back to the
          current year. New entries are always logged against today's date, no
          matter which year you're viewing.
        </P>
        <P>
          Filter by <strong>Product</strong>, <strong>Remark</strong>, or{" "}
          <strong>Employee</strong> (each accepts several values), and search
          across everything — including SAP and Altronic part numbers, and
          operator notes. Adding
          more words narrows the results. Every filter lives in the URL, so you
          can send someone a link to exactly what you're looking at. The line
          above the table totals the defective and tested boards for whatever
          is currently showing.
        </P>
        <P>
          Operator notes appear under the Defective Parts column, trimmed to one
          line — hover to read a long one in full.
        </P>
        <P>
          Even one year can run long, so the table shows the{" "}
          <strong>newest 200</strong> matching entries and offers{" "}
          <strong>Show all</strong> underneath — that keeps searching and
          filtering quick. Filters and the board totals always cover every entry
          in the chosen year, not just the rows on screen, so a count never lies
          to you.
        </P>

        <H3>Editing and deleting</H3>
        <P>
          <strong>Anyone can add an entry and correct one</strong> — hover a row
          for the pencil. Only <strong>admins can delete</strong>: an edit leaves a
          corrected record where a delete leaves nothing, so if a row needs
          removing rather than fixing, ask an admin. Deleting asks first and can't
          be undone from the app.
        </P>
        <H3>Manage lists — Employees, Products, Remarks</H3>
        <P>
          The Product, Employee and Remark dropdowns are fed by three
          SharePoint lists, and you maintain them yourself from{" "}
          <strong>Manage lists</strong> on the Teradyne Log toolbar. No admin
          rights needed — the people running the tester are the ones who know
          when a new product or remark is required.
        </P>
        <UL>
          <LI>
            <strong>Employees</strong> — first name, last name, clock number,
            work center. The displayed name is built from the first and last
            name, so renaming someone updates them everywhere the log shows
            them.
          </LI>
          <LI>
            <strong>Products</strong> — the product name (keep it as it appears
            on the tester, since it's half of every entry's name) and which
            station it's tested on.
          </LI>
          <LI>
            <strong>Remarks</strong> — the canned failure descriptions, each with
            its <strong>remark number</strong>. Enter the number alongside the
            description when adding one, and correct it later with the pencil.
            The number shows as a badge at the front of each row; the smaller
            grey <code>#n</code> on the right is SharePoint's own item id, not
            the remark number. A remark with no number shows a dashed
            placeholder. Add one and it's immediately available on the log.
          </LI>
        </UL>
        <P>
          Each row shows how many log entries use it. A row that's{" "}
          <strong>in use can't be deleted</strong> — edit it instead, so past
          entries keep reading correctly. Only unused rows offer the bin.
        </P>
      </>
    ),
  },
  {
    id: "panel-orders",
    title: "Panel Orders",
    group: "Panels",
    keywords: [
      "panel",
      "panels",
      "panel order",
      "panel orders",
      "panel dashboard",
      "panel production",
      "sales order",
      "panel project reference",
      "panel user roles",
      "order notes",
      "panel team",
    ],
    searchText:
      "Panel Orders is the Panels department's first ARC feature, backed by the Panel Order Headers, Panel Project Reference, and Panel User Roles lists on the ALTRONICPANELTEAM SharePoint site. Each order tracks a panel sales order: title, status (Submitted, In Engineering, In Production, Testing, Shipped, On Hold), a project reference picked from the admin-managed Panel Project Reference list, sales order and purchase order numbers, customer, customer reference, customer contact email, an assigned engineer, watchers, attachments, comments with @-mentions, and Order Notes that support checklists. Reach it from the Dashboard's Panel Orders card or the Departments dropdown's Panels group. Create orders with the New Panel Order button; new orders start as Submitted and you're auto-added as a watcher. The Open pill counts everything not Shipped. Admins manage the project reference list at /admin/panel-projects and the Panel User Roles list at /admin/panel-roles; roles don't lock any fields yet.",
    render: () => (
      <>
        <P>
          <strong>Panel Orders</strong> is the Panels department's first ARC
          feature — the panel production team's view of panel sales orders,
          backed by its own SharePoint site (ALTRONICPANELTEAM). Reach it
          from the <strong>Panel Orders</strong> card on the Dashboard, or
          the <strong>Departments</strong> dropdown's Panels group.
        </P>
        <H3>The order list</H3>
        <P>
          Status pills sit above the list — <strong>Open</strong> counts
          everything not yet Shipped, and one pill per status (Submitted, In
          Engineering, In Production, Testing, Shipped, On Hold) narrows to
          that status. The filter bar adds Project Reference, Engineer
          Assigned, and the multi-keyword Search (same syntax as everywhere
          else). All filters live in the URL, so a filtered view can be
          shared. The Dashboard card's click-through carries your{" "}
          <em>mine</em> scope as a visible, dismissible chip — "your" panel
          orders are the ones where you're the assigned engineer or a
          watcher.
        </P>
        <H3>Creating an order</H3>
        <P>
          Click <strong>New Panel Order</strong>. Title is required;
          everything else — project reference (picked from the admin-managed
          list), sales order, purchase order, customer, customer reference,
          contact email, engineer, and order notes — is optional and can be
          edited later from the detail page. New orders start as{" "}
          <strong>Submitted</strong> and you're auto-added as a watcher.
        </P>
        <H3>The detail page</H3>
        <P>
          Everything is edited in place: the title inline, the sidebar's
          Status / Project Reference / Engineer / order-number / customer
          fields directly, and <strong>Order Notes</strong> as an editable
          card that supports the same <code>- [ ]</code> checklists as a
          task Description — checked boxes record who and when, unchecking
          asks "Are you sure?", and toggles email the watchers and engineer.
          Comments (with @-mentions and auto-watch), Watchers, and file
          attachments work exactly like tasks and EIRs. Status changes and
          engineer changes send the same email alerts other departments get.
        </P>
        <H3>Admin lists</H3>
        <P>
          Two admin-only pages back this feature (both restricted to ARC
          admins): <strong>Panel Projects</strong>{" "}
          (<code>/admin/panel-projects</code>) manages the project reference
          numbers orders pick from — each row holds the reference number,
          project type, description, DWG NO, customer, and department.{" "}
          <strong>Panel User Roles</strong> (<code>/admin/panel-roles</code>)
          tags panel team members with a role (Super User, Manager, Tech,
          Engineer, Admin, Viewer) — one row per user per role. Roles don't
          lock any panel order fields yet; they're recorded now so
          field-level permissions can be switched on later.
        </P>
      </>
    ),
  },
  {
    id: "panel-tasks",
    title: "Panel Tasks",
    group: "Panels",
    keywords: [
      "panel task",
      "panel tasks",
      "drawings",
      "soo",
      "sequence of operations",
      "quote",
      "administrative",
      "panel to-do",
      "panel work",
    ],
    searchText:
      "Panel Tasks is the panel team's task list on the ALTRONICPANELTEAM SharePoint site — drawings, SOOs, quotes, and administrative work. Each task has a title, status (Pending, In Process, On Hold, Complete), a Task Type (Drawings, SOO, Quote, Administrative), a single Assigned person, a project reference picked from the same Panel Project Reference list panel orders use, a Description that supports checklists, watchers, attachments, and comments with @-mentions. Reach it from the Dashboard's Panel Tasks card or the Departments dropdown's Panels group. Create with New Panel Task; new tasks start Pending and you're auto-added as a watcher. The Open pill counts everything not Complete. Status changes, assignee changes, comments, and checklist toggles send email like the other departments.",
    render: () => (
      <>
        <P>
          <strong>Panel Tasks</strong> is the panel team's task list — drawings,
          sequences of operations (SOOs), quotes, and administrative work.
          Reach it from the <strong>Panel Tasks</strong> card on the
          Dashboard, or the <strong>Departments</strong> dropdown's Panels
          group.
        </P>
        <H3>The task list</H3>
        <P>
          Status pills sit above the list — <strong>Open</strong> counts
          everything not yet Complete, and one pill each for Pending, In
          Process, On Hold, and Complete. The filter bar adds Project
          Reference, Assigned, and the multi-keyword Search; all filters live
          in the URL so a filtered view is shareable. The Dashboard card's
          click-through carries your <em>mine</em> scope as a dismissible chip
          — "your" tasks are the ones you're assigned to or watching.
        </P>
        <H3>Creating &amp; working a task</H3>
        <P>
          Click <strong>New Panel Task</strong>. Only the title is required;
          Task Type, Assigned person, project reference, and description are
          optional and editable later. New tasks start as{" "}
          <strong>Pending</strong> and you're auto-added as a watcher. On the
          detail page everything edits in place — the title inline, the
          sidebar's Status / Task Type / Project Reference / Assigned fields
          directly, and the <strong>Description</strong> as a card that
          supports <code>- [ ]</code> checklists (checked boxes record who and
          when; unchecking asks first; toggles email watchers + the assignee).
          Comments, watchers, and attachments behave exactly like every other
          department. Panel tasks share the <em>Panel Project Reference</em>{" "}
          list with panel orders, and admins manage it at{" "}
          <code>/admin/panel-projects</code>.
        </P>
      </>
    ),
  },
  {
    id: "digital-qc",
    title: "Digital QC Defect Log",
    group: "Quality Control",
    keywords: [
      "qc",
      "quality control",
      "digital qc",
      "defect log",
      "defects",
      "product family",
      "pyrometer",
      "serial number",
      "endsn",
      "startsn",
      "work order",
      "operator",
      "qty tested",
      "qty rejected",
      "solder",
      "ncm",
      "to rp",
      "tachometer",
      "annunciator",
      "exacta",
      "enbase",
    ],
    searchText:
      "Digital QC Defect Log at /digital-qc, under Departments > Quality Control. 18 product families, each backed by its own SharePoint list: A.F.M., A.F.C., Annunciators, DE Display, DE Terminal, DriveCOM, EnBase, EPC-10X/50, EX-200, Exacta, Digital Misc., Moris 1,2, P.M.M., Power Supply, Pressure Gauges, Pyrometer, Saves, Tachometer. Pick a family to open its table; Change product family goes back to the buttons. Add entry opens the form; the pencil on a row edits it. Date Tested defaults to now, every count field defaults to 0, and a blank Work Order saves as N/A. The filter box searches every field at once and any column header sorts, click again to reverse. Comments show as a hoverable icon in the table and as a large multi-line box at the bottom of the form. On Pyrometer, three tiles show the highest EndSN used this calendar month for old material 378-1443, 357-4880 and 343-4631. Any signed-in user can add and edit entries; entries cannot be deleted from ARC.",
    render: () => (
      <>
        <P>
          <strong>Departments → Quality Control → Digital QC Defect Log</strong>{" "}
          (<code>/digital-qc</code>) is the digital product test log — one row
          per work order tested, with the reject counts broken out by defect
          type.
        </P>
        <H3>Pick a product family first</H3>
        <P>
          The page opens on a grid of <strong>18 product family</strong> buttons
          — A.F.M., A.F.C., Annunciators, DE Display, DE Terminal, DriveCOM,
          EnBase, EPC-10X/50, EX-200, Exacta, Digital Misc., Moris 1,2, P.M.M.,
          Power Supply, Pressure Gauges, Pyrometer, Saves and Tachometer. Each
          family is its own log, so pick one to open its table.{" "}
          <strong>Change product family</strong> at the top left brings the
          buttons back.
        </P>
        <H3>Adding and editing entries</H3>
        <UL>
          <LI>
            <strong>Add entry</strong> (top right) opens the form. The{" "}
            <strong>pencil</strong> at the end of a row opens the same form on
            that entry.
          </LI>
          <LI>
            <strong>Date Tested</strong> starts at the current date and time,
            every count field starts at <strong>0</strong>, and a blank{" "}
            <strong>Work Order</strong> saves as <code>N/A</code> — so a clean
            run only needs the fields that actually changed.
          </LI>
          <LI>
            <strong>Comments</strong> is the large box at the bottom of the
            form. In the table it's a small icon — hover it to read the comment
            without opening the entry.
          </LI>
          <LI>
            Saving writes straight to that family's SharePoint list. Any
            signed-in user can add and edit; there is no delete in ARC — a wrong
            entry gets corrected, or removed by an admin in SharePoint.
          </LI>
        </UL>
        <H3>Finding an entry</H3>
        <P>
          The <strong>filter box</strong> searches every field at once — work
          order, operator, part numbers, serial numbers, comments — and{" "}
          <strong>Clear filters</strong> resets it. Click any{" "}
          <strong>column header</strong> to sort by it; click the same header
          again to reverse the order.
        </P>
        <H3>Pyrometer serial tracking</H3>
        <P>
          The <strong>Pyrometer</strong> family shows three tiles above the
          table for old material <code>378-1443</code>, <code>357-4880</code>{" "}
          and <code>343-4631</code>. Each shows the{" "}
          <strong>highest EndSN recorded this calendar month</strong> for that
          material, so the next unit's starting serial is on screen rather than
          scrolled for. The tiles reset when the month rolls over.
        </P>
      </>
    ),
  },
  {
    id: "ignition-qc",
    title: "Ignition QC Defect Log",
    group: "Quality Control",
    keywords: [
      "ignition qc",
      "ignition",
      "qc",
      "quality control",
      "defect log",
      "defects",
      "product family",
      "cpu95",
      "cpu2k",
      "cpu-xl",
      "altronic iii",
      "altronic v",
      "alternator",
      "regulator",
      "distributor",
      "cd200",
      "work order",
    ],
    searchText:
      "Ignition QC Defect Log at /ignition-qc, under Departments > Quality Control. 37 ignition product families, each backed by its own SharePoint list — 24V Alternator, 24V Regulator, Alt 1 Module and Unit, Altronic III and V boards and units, CCD/WCD, CD200, CIM, the CPU II / CPU2K / CPU95 / CPU-XL families, DISN/CEC/IPMD, GOV/AGV and more. Works exactly like Digital QC: pick a family, Add entry or the pencil to edit, Date Tested defaults to now, counts default to 0, blank Work Order saves as N/A, all-fields filter box, sortable column headers, and Comments as a hoverable icon plus a large box in the form. There are no StartSN/EndSN columns and no Pyrometer tiles — those are Digital QC only. Any signed-in user can add and edit; entries cannot be deleted from ARC.",
    render: () => (
      <>
        <P>
          <strong>
            Departments → Quality Control → Ignition QC Defect Log
          </strong>{" "}
          (<code>/ignition-qc</code>) is the ignition-side counterpart to
          Digital QC, covering <strong>37 product families</strong> — the 24V
          Alternator and Regulator, the Altronic I / III / V boards and units,
          CCD/WCD, CD200, CIM, the CPU II, CPU2K, CPU95/TEM and CPU-XL families,
          DISN/CEC/IPMD, GOV/AGV and the rest.
        </P>
        <P>
          Everything works the same way as <strong>Digital QC</strong>: pick a
          family to open its table, <strong>Change product family</strong> to go
          back, <strong>Add entry</strong> or the row <strong>pencil</strong> to
          record or correct one, Date Tested pre-filled with now, counts
          starting at <strong>0</strong>, a blank Work Order saved as{" "}
          <code>N/A</code>, an all-fields filter box, sortable column headers,
          and Comments as a hoverable icon in the table with a large box at the
          bottom of the form.
        </P>
        <Tip>
          Ignition entries have <strong>no StartSN / EndSN columns</strong> and
          no Pyrometer tiles — serial tracking is a Digital QC feature. Every
          other column, including the defect-type counts, matches.
        </Tip>
      </>
    ),
  },
  {
    id: "potting-sample-log",
    title: "Potting Sample Log (Coils)",
    group: "Coils",
    keywords: [
      "coils",
      "coil",
      "potting",
      "potting sample",
      "psr",
      "sample log",
      "spec limit",
      "lower limit",
      "upper limit",
      "out of limit",
      "weight",
      "volume",
      "notification list",
      "psr notification",
    ],
    searchText:
      "Potting Sample Log at /coils/potting-sample-log, under Departments > Coils. Record a potting sample's date, volume and weight. The date defaults to now and the volume to 125, so a normal sample is just the weight plus Save entry. The current Lower and Upper Spec Limits show above the form, and any saved sample outside them is flagged in red in the table as Below lower limit or Above upper limit. Saving an out-of-limit sample automatically emails everyone on the Coil PSR Notification List with the entry's date, volume and weight and both spec limits. Manage lists opens the two reference lists: Spec Limits at /coils/potting-limits and the PSR Notification List at /coils/psr-notifications, where you add or remove people by name and email. Both are editable by any signed-in user, the same as the Teradyne reference lists.",
    render: () => (
      <>
        <P>
          <strong>Departments → Coils → Potting Sample Log</strong> (
          <code>/coils/potting-sample-log</code>) records the weight of a
          potting sample and raises the alarm when one falls outside spec.
        </P>
        <H3>Logging a sample</H3>
        <UL>
          <LI>
            <strong>Date</strong> is pre-filled with the current date and time
            and <strong>Volume</strong> with <strong>125</strong>, so a routine
            sample is just the <strong>Weight</strong> and{" "}
            <strong>Save entry</strong>.
          </LI>
          <LI>
            The current <strong>spec limits</strong> show in a strip above the
            form, so you can see what you're measuring against before you save.
          </LI>
          <LI>
            The entry appears in the table below immediately. A weight outside
            the limits is shown in red with a{" "}
            <strong>Below lower limit</strong> or{" "}
            <strong>Above upper limit</strong> flag beside it.
          </LI>
        </UL>
        <H3>Out-of-limit alerts</H3>
        <P>
          Saving a sample outside the limits{" "}
          <strong>automatically emails</strong> everyone on the{" "}
          <strong>Coil PSR Notification List</strong>. The email gives the
          entry's date, volume and weight alongside both spec limits, so the
          reader can see how far out it landed without opening ARC. Nothing is
          sent for a sample inside the limits.
        </P>
        <H3>Manage lists</H3>
        <P>
          The <strong>Manage lists</strong> menu in the page header opens the
          two reference lists behind the log:
        </P>
        <UL>
          <LI>
            <strong>Spec Limits</strong> (<code>/coils/potting-limits</code>) —
            the Lower and Upper Spec Limit used for the flags and the alert
            email. Changing them affects every row on the log, since the flag is
            worked out from the current limits each time the page loads.
          </LI>
          <LI>
            <strong>PSR Notification List</strong> (
            <code>/coils/psr-notifications</code>) — who gets the out-of-limit
            email. <strong>Add person</strong> takes a name and an email
            address; the bin icon removes someone.
          </LI>
        </UL>
        <Tip>
          Both reference lists are editable by{" "}
          <strong>any signed-in user</strong>, the same arrangement as the
          Teradyne reference lists — no admin needed to add a name or nudge a
          limit.
        </Tip>
      </>
    ),
  },
  {
    id: "visit-reports",
    title: "Visit Reports",
    group: "Customer Service / Sales",
    keywords: [
      "visit report",
      "visit reports",
      "customer visit",
      "site visit",
      "sales call",
      "rm",
      "rm name",
      "regional manager",
      "customer status",
      "action items",
      "trip report",
      "call report",
      "sales",
      "customer service",
    ],
    searchText:
      "Visit Reports at /sales/visit-reports, under Departments > Customer Service / Sales, backed by the Visit Reports list on the ALTRONICSALESTEAM SharePoint site. A regional manager's record of a customer visit: Customer Name, RM Name, Reason For Visit (Home Office, General Visit, Site Visit, Sales Call, Training), Visit Date, Customer Status (Satisfied, Needs Attention, Issue, Quote Request, Potential New Customer, N/A), Visit Summary, Action Items, Product(s), City and State. Six of those are required: Customer Name, RM Name, Reason, Visit Date, Customer Status and Visit Summary. File one with New Visit Report; everything edits in place on the detail page, or use Edit for a bulk rewrite. Attachments — photos, quotes — can be added once the report is saved, by dragging them onto the Attachments card. The list filters by RM Name, Year, Reason and Customer Status, with an all-fields search, and the filters live in the URL so a filtered view can be shared. Reports cannot be deleted from ARC. Any signed-in user can file and edit.",
    render: () => (
      <>
        <P>
          <strong>Departments → Customer Service / Sales → Visit Reports</strong>{" "}
          (<code>/sales/visit-reports</code>) is the regional managers' record
          of customer visits — who they saw, why, what happened, and what needs
          doing next. It reads and writes the same SharePoint list the team has
          been using, so a report filed here shows up in SharePoint and vice
          versa.
        </P>
        <H3>Filing a report</H3>
        <P>
          <strong>New Visit Report</strong> opens the form. Six fields are
          required, because the list requires them:
        </P>
        <UL>
          <LI>
            <strong>Customer Name</strong> — who you visited.
          </LI>
          <LI>
            <strong>RM Name</strong> — the regional manager. The picker lists
            the current managers plus anyone already on an existing report, so
            an older report keeps the person who actually filed it.
          </LI>
          <LI>
            <strong>Reason For Visit</strong> — Home Office, General Visit,
            Site Visit, Sales Call or Training.
          </LI>
          <LI>
            <strong>Visit Date</strong> — pre-filled with today; pick the day
            of the visit from the calendar.
          </LI>
          <LI>
            <strong>Customer Status</strong> — Satisfied, Needs Attention,
            Issue, Quote Request, Potential New Customer or N/A. This is the
            colour-coded chip on the list, so it's the field that makes a
            customer needing attention findable.
          </LI>
          <LI>
            <strong>Visit Summary</strong> — what happened.
          </LI>
        </UL>
        <P>
          <strong>Action Items</strong>, <strong>Product(s)</strong>,{" "}
          <strong>City</strong> and <strong>State</strong> are optional. Saving
          opens the new report so you can attach anything to it.
        </P>
        <H3>Editing and attachments</H3>
        <P>
          On the detail page everything edits in place — the sidebar's RM,
          date, reason, status, product and location save the moment you change
          them, and Visit Summary and Action Items have their own Edit / Save.
          The <strong>Edit</strong> button at the top opens the full form when
          you'd rather change several things at once.
        </P>
        <P>
          <strong>Attachments</strong> — site photos, a quote, a signed
          document — go on the card at the bottom: drag files onto it, paste a
          screenshot, or use Add file.
        </P>
        <Tip>
          There is no Delete. A visit report is a record of something that
          happened, so correcting one is an edit; removing one has to be done
          in SharePoint deliberately.
        </Tip>
        <H3>Finding a report</H3>
        <P>
          The filter bar narrows by <strong>RM Name</strong>,{" "}
          <strong>Year</strong>, <strong>Reason</strong> and{" "}
          <strong>Customer Status</strong>, and the search box matches{" "}
          <em>every</em> field — customer, summary, action items, product, city
          — so searching a product code finds every visit that mentioned it.
          The filters live in the URL, so a filtered view can be bookmarked or
          pasted to someone else.
        </P>
        <P>
          The table shows the newest 150 visits with a{" "}
          <strong>show all</strong> link underneath; filters and the count
          always run over every report, not just the ones on screen.
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
      "eir board",
      "eir kanban",
      "drag eir",
      "eir columns",
    ],
    searchText:
      "The EIRs tab shows Engineering Information Requests with workflow View tabs (All, New, Needs Assigned, At Risk Parts, LTB), status pills (Under Review, Response Accepted, Closed, etc.) and a filter bar for Project, Assigned Engineer, Reporter, and search. EIRs have a Board (kanban) view as well as the list: List and Board buttons appear under the top nav, the board has one column per EIR status, and dragging a card between columns changes that EIR's status with a toast and Undo. The view tabs and filter bar work the same on both and travel between them; the board is hidden on phones. The Description field supports the same custom checklist syntax as a task's Description. New = no project reference and no engineer assigned; Needs Assigned = has a project reference but still no engineer. Description, Engineering Response and Where Used are rich text: editing one shows a toolbar with bold, italic, underline and bulleted/numbered lists, Ctrl+B/I/U work, paragraphs are preserved, and pasting from Word keeps the formatting but drops its colours. Click an EIR to open the detail page with Description, Engineering Response, Part Details (MFG, P/N, EAU, etc.), Comments, and a sidebar to edit Status, Resolution, Request Type, Priority, Reporter, Assigned Engineers, Watchers, Project, Task Reference, Requested Completion Date, LTB Date. New EIRs are auto-numbered as EIR_YYYY-#### (the next sequence for the year); the EIR Log No. is calculated from it. Promote an EIR to a task by setting Resolution to Promoted to Task: a confirmation window creates a linked task carrying the title, description, project, watchers, and comment thread (tagged as from the EIR). Completing that task prompts for a final resolution, which is written back to the EIR's Engineering Response and marks the EIR Resolved and Closed.",
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
        <H3>Board view</H3>
        <P>
          <strong>List</strong> and <strong>Board</strong> buttons appear under
          the top nav whenever you're on an EIR. The board is the same set of
          EIRs arranged as columns — one per status (Under Review, EIR Not
          Accepted, Response Accepted, Response Not Accepted, Closed).{" "}
          <strong>Drag a card into another column to change its status</strong>;
          the change saves immediately, with a toast and Undo, and watchers,
          assigned engineers and the reporter get the usual status-change
          email. If the save fails, the card returns to the column it came
          from.
        </P>
        <P>
          The view tabs and filter bar sit above the board and do exactly what
          they do on the list, so you can narrow to (say) At Risk Parts for one
          project and still work the columns. Switching between List and Board
          carries your filters and the active view tab across. The status pills
          don't travel — on the board the columns <em>are</em> the statuses.
          The board isn't offered on phone-sized screens (dragging between
          columns needs the room), so opening it there shows the list instead.
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
          from the detail page after creation — <strong>Assigned</strong> is a
          dropdown with a search box, so type a few letters of a name rather
          than scanning the whole staff list; the people already assigned show
          as chips you can remove one at a time.
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
        <H3>Formatting an EIR's text</H3>
        <P>
          <strong>Description</strong>, <strong>Engineering Response</strong>{" "}
          and <strong>Where Used</strong> are formatted fields. Editing one
          gives you a small toolbar — <strong>bold</strong>,{" "}
          <em>italic</em>, underline, bulleted and numbered lists — and the
          usual <strong>Ctrl+B / Ctrl+I / Ctrl+U</strong> shortcuts. This
          applies on the New EIR form too.
        </P>
        <UL>
          <LI>
            <strong>Your paragraphs are kept.</strong> Blank lines stay blank
            lines wherever the EIR is read — in ARC, in SharePoint, and in the
            notification emails.
          </LI>
          <LI>
            <strong>Pasting from Word or Outlook keeps the formatting</strong>{" "}
            but drops the source's fonts and colours, so nothing arrives as
            black text on the dark theme.
          </LI>
          <LI>
            A Description that holds a <strong>checklist</strong> switches back
            to the plain editor — checklist lines are text by design. Clicking{" "}
            <strong>Turn into checklist</strong> makes that swap for you.
          </LI>
        </UL>
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
      "Project Folders is a browser over the Engineering document library (General/Project Folders). Open the Project Folders card on the dashboard or the Departments menu. Navigate into a project folder and its subfolders with the breadcrumb, click a file or folder to open it in SharePoint, and upload files into the folder you're in (up to 250 MB — files over about 4 MB upload in chunks). Deleting is done in SharePoint itself.",
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
    id: "drawing-file-logs",
    title: "Drawing File Logs",
    group: "Engineering",
    keywords: [
      "drawing",
      "drawings",
      "drawing log",
      "drawing file logs",
      "cad",
      "ccc",
      "cec",
      "sketch",
      "sketches",
      "engineering sketches",
      "change log",
      "drawing work sheet",
      "work sheet",
      "form e006",
      "print a drawing",
      "print distribution",
      "ecn",
      "revision",
      "rev",
      "dwg",
      "part number",
      "sk_num",
      "ventura",
      "record a change",
    ],
    searchText:
      "Drawing File Logs brings Engineering's drawing registers together on one screen as tabs: CAD Drawings, CCC Drawings, CEC Drawings and Engineering Sketches. Each tab is a searchable table; click any row for the full record and its change log — the dated revisions and ECNs that SharePoint stores across 48 columns. Search covers the ECNs too, so you can find which drawing a change notice affected. Admins can add a drawing, edit its details, and record a change, which also updates the drawing's current revision. Admins can also correct an existing change entry with the pencil beside it, which edits just that entry without moving the drawing's current revision; clearing all three values empties the slot and frees it for reuse. A drawing has sixteen change slots; once they're used the app says so rather than overwriting an old entry. CAD drawings carry By, Entered By and Software, which behave like drop-downs built from the values already in use while still accepting a new one, and the New Drawing field is no longer on the add or edit form. Engineering Sketches has its own columns (sketch number, V code, Ventura) and no change log, because the list doesn't have one. Reading and searching are open to everyone. Open a CAD drawing and click Work Sheet to print FORM #E006, the Drawing Work Sheet that accompanies a drawing until release: it opens in a new tab already filled in from the register, laid out for 8.5 x 11 portrait, with the print dialog open so you can print it or Save as PDF. It prints everything the register holds — including the Entered By / By initials and all sixteen change slots, both of which the old form left off — plus the sections that exist only on paper: Prototype / Preliminary / Production, the checked-approved, entered-in-system and to-mylar dates, and the Print Distribution block, all left blank to fill in by hand. The Work Sheet is CAD only.",
    render: () => (
      <>
        <P>
          <strong>Drawing File Logs</strong> puts Engineering's drawing registers
          on one screen. Reach it from the <strong>Drawing File Logs</strong> card
          on the Dashboard, or the <strong>Departments</strong> dropdown's
          Engineering group.
        </P>
        <P>
          The registers are <strong>tabs</strong>: CCC Drawings, CEC Drawings and
          Engineering Sketches (CAD Drawings joins them shortly). The tab is part
          of the link, so a shared URL opens on the same register.
        </P>
        <H3>The change log</H3>
        <P>
          <strong>Click any row</strong> for the full record. On the drawing
          registers that includes the <strong>change log</strong> — each revision
          with its date and the ECN that caused it. SharePoint keeps this spread
          across forty-eight columns where nobody can read it; here it's a table.
        </P>
        <P>
          Search covers the ECNs as well as drawing numbers, part numbers and
          descriptions — so "which drawing did ECN-0031 change?" is a question you
          can actually answer. Type the ECN.
        </P>
        <H3>Recording a change — admins</H3>
        <P>
          Open a drawing and use <strong>Record a change</strong>: a date, the ECN
          and the new revision. The revision you enter also becomes the drawing's
          current revision, so the table and the change log can't drift apart.
        </P>
        <P>
          <strong>Correcting a change:</strong> hover a row in the change log and
          use the pencil. That edits just that entry — it doesn't touch the
          drawing's current revision, since fixing an old typo shouldn't make an
          old date the latest. Clearing all three values empties the slot and frees
          it for reuse, which is how you undo a change recorded by mistake.
        </P>
        <P>
          Each drawing has <strong>sixteen change slots</strong> — that's the
          SharePoint list's limit, not the app's. The panel shows how many are
          used (e.g. "3/16"). Once all sixteen are full the button is disabled and
          the app explains why; it won't quietly overwrite the oldest entry.
          Further changes need recording in SharePoint, or more columns adding to
          the list.
        </P>
        <H3>Initials and software on CAD</H3>
        <P>
          CAD drawings carry <strong>By</strong>, <strong>Entered By</strong> and{" "}
          <strong>Software</strong>. These behave like drop-downs: click the arrow
          to pick from what's already been used, or just type. A value nobody has
          used before is flagged as new, and once saved it becomes one of the
          choices for everyone next time — so the lists build themselves and nobody
          has to maintain them.
        </P>
        <P>
          The <strong>New Drawing</strong> field is no longer on the add or edit
          form; existing values still show on the drawing's panel.
        </P>

        <H3>Printing the Drawing Work Sheet</H3>
        <P>
          Open a CAD drawing and click <strong>Work Sheet</strong>. That opens{" "}
          <strong>FORM #E006</strong> — the Drawing Work Sheet that accompanies a
          drawing until it's released to production — in a new tab, already filled
          in from the register, with the print dialog open. Choose your printer, or{" "}
          <em>Save as PDF</em>. It's laid out for 8.5 × 11 portrait.
        </P>
        <P>
          It prints <strong>everything the register holds</strong>, including two
          things the old form left off: the <strong>Entered By</strong> and{" "}
          <strong>By</strong> initials, and the <strong>second half of the change
          history</strong> (revisions 9–16). All sixteen slots are printed, in the
          two columns the paper form uses, numbered so you can tell slot 4 from the
          fourth line down on a drawing with gaps.
        </P>
        <P>
          The rest of the form is <strong>deliberately blank</strong> — Prototype /
          Preliminary / Production, the checked-approved, entered-in-system and
          to-mylar dates, and the whole <strong>Print Distribution</strong> block.
          None of those exist in SharePoint; they're ruled lines to complete by hand
          as the drawing moves. The distribution note about prototype and
          preliminary prints is on there too.
        </P>
        <P>
          It's <strong>CAD only</strong>. The sheet is CAD's form, and the other
          registers don't carry the fields it prints.
        </P>

        <H3>Engineering Sketches is different</H3>
        <P>
          The sketch register has <strong>no change log</strong> — the list simply
          doesn't have those columns. It carries a sketch number, V code and
          Ventura reference instead, and the table and detail panel show those.
        </P>
        <H3>Who can change what</H3>
        <P>
          Drawing records are controlled documents, so{" "}
          <strong>adding, editing and recording changes is limited to admins</strong>.
          Everyone else gets the full table, the search and the change log —
          reading is the point — but no New button and no row actions.
        </P>
        <Tip>
          The table shows the first 200 matching rows with a "Show all" link
          underneath. Engineering Sketches runs to well over a thousand, so that
          keeps searching quick; the filters and counts always cover the whole
          register.
        </Tip>
      </>
    ),
  },
  {
    id: "csa-listings",
    title: "CSA Listings",
    group: "Engineering",
    keywords: [
      "csa",
      "csa listings",
      "certification",
      "certified",
      "listing",
      "file number",
      "lr number",
      "date certified",
      "also cover",
      "part no included",
      "certificate",
      "compliance",
      "approval",
      "standards",
    ],
    searchText:
      "CSA Listings is Altronic's register of CSA certification files, under Engineering. Each row is one file: its File Number (the CSA file identifier), the product, other products or variants the file also covers, the part numbers included, the certification date, and a running History. Certificates and supporting documents attach to a listing. Search covers everything including the long fields, so you can find a listing by a part number buried in Part No Included. Adding, editing and deleting listings is limited to admins because these are compliance records; reading and searching are open to everyone. Reach it from the CSA Listings card on the Dashboard or the Departments dropdown's Engineering group.",
    render: () => (
      <>
        <P>
          <strong>CSA Listings</strong> is the register of Altronic's CSA
          certification files. Reach it from the <strong>CSA Listings</strong>{" "}
          card on the Dashboard, or the <strong>Departments</strong> dropdown's
          Engineering group.
        </P>
        <P>
          Each row is one certification file. <strong>File Number</strong> is the
          CSA file identifier and how everyone refers to a listing;{" "}
          <strong>Also Cover</strong> and <strong>Part No Included</strong> list
          the other variants and the part numbers the file covers, and{" "}
          <strong>History</strong> is a running note of amendments and audits.
        </P>
        <H3>Finding a listing</H3>
        <P>
          One search box, and it reaches <em>everything</em> — including the long
          fields. That matters: if you're chasing whether a particular part number
          is covered, it's almost certainly buried in Part No Included rather than
          in the file number, and the table can only show the first line of those
          fields. Type the part number and the right file surfaces. Adding more
          words narrows. The search sits in the URL, so you can send someone a
          link to the listing you're looking at.
        </P>
        <P>
          Long fields show their first line with a <strong>+N more</strong> hint —
          hover to see the whole thing, or open the listing.
        </P>
        <H3>Certificates and documents</H3>
        <P>
          Files attach to a listing: open it and use the Attachments panel at the
          bottom. On a <em>new</em> listing you'll be asked to save first — a file
          needs a saved record to attach to.
        </P>
        <H3>Who can change what — admins only</H3>
        <P>
          Certification files are compliance records, so{" "}
          <strong>adding, editing and deleting are limited to admins</strong>.
          Everyone else gets the full table and search but no New button and no
          row actions, with a note saying so. Ask an admin if a listing needs
          updating.
        </P>
        <Tip>
          The small grey number beside a file number is the id the listing carried
          over from the original data. It's shown so you can tie a row back to the
          old records; nothing in ARC writes it.
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
      "BR",
      "br number",
      "add part",
      "parts",
      "part status",
      "pcb checklist",
      "harness checklist",
      "work order",
      "wo no",
      "rush",
      "lead time",
      "requestor",
      "prototype",
      "sample",
    ],
    searchText:
      "Build Requests ask manufacturing to build parts. Each request (BR_YYYY-####) has a header — status, type, lead time, requestor, engineer, customer — and any number of parts. Each part has its own comment thread, watchers, attachments, and a Part-Type checklist: PCB parts get the data-package checklist, Harness parts get the terminals checklist. Create from the Build Requests list; add parts from the detail page. Email notifications fire for comments (request or part level), BR Status changes, Engineer Assigned changes, and a part's Part Status changes; part-comment emails open the request with that part expanded. Lead Free requests show a green flag and a warning banner on part printouts; each part has a Print part button for the production floor.",
    render: () => (
      <>
        <P>
          <strong>Build Requests</strong> (Engineering menu → Build Requests)
          are how you ask manufacturing to build parts — prototypes, samples,
          production updates. Every request gets a number like{" "}
          <code>BR_2026-1019</code> (assigned automatically) and has two
          levels: the <strong>request header</strong> (status, type, lead
          time, requestor, engineer, customer) and any number of{" "}
          <strong>parts</strong> underneath it.
        </P>
        <H3>Creating a request</H3>
        <P>
          Click <strong>New Build Request</strong> on the list page. Give it a
          product or project name, pick the Type (Prototype, Standard, Sample,
          Modification, NPI, Component Obsolescence, or Design Update Testing)
          and Required Lead Time — picking <strong>Ship Date</strong> reveals a
          Quoted Ship Date field, and Type <strong>Sample (A-D)</strong>{" "}
          reveals the Sample Phase. You're set as the Requestor and a watcher
          automatically. The request opens ready for parts.
        </P>
        <H3>Adding and editing parts</H3>
        <P>
          On the detail page, click <strong>Add Part</strong> and enter the
          part number, quantity, drawing info, and Part Type. Each part shows
          as a collapsible card — click it to expand and edit everything
          inline: WO No (filled by manufacturing), Part Status, Disposition,
          and the multi-select Assembly / Operations / Testing pickers.
        </P>
        <H3>Part-Type checklists</H3>
        <P>
          <strong>PCB</strong> parts show the 14-box data-package checklist
          (BOMs, Gerbers, coordinate data, fiducials, schematic, HI-POT…);{" "}
          <strong>Harness</strong> parts show the 3-box harness checklist
          (Terminals Ordered, New Terminal Tool, New Harness Processes). Other
          part types have no checklist. The card header shows checklist
          progress (e.g. 6/14) and turns green when complete.
        </P>
        <H3>Printing a part for the production floor</H3>
        <P>
          Expand a part and click <strong>Print part</strong> — a
          printer-friendly page opens in a new tab and pops the print dialog
          automatically (pick "Save as PDF" or a real printer). It carries
          everything the floor needs: quantities, drawing info, WO No, the
          process selections, the checklist state, special instructions and
          test plan. If the request is <strong>Lead Free (RoHS)</strong>, the
          printout carries a large warning banner.
        </P>
        <H3>Lead Free flag</H3>
        <P>
          Requests marked Lead Free (RoHS) show a green{" "}
          <strong>Lead Free</strong> chip on the list row and the detail
          header, and the banner on every part printout — it changes solder
          and process requirements, so it's surfaced everywhere.
        </P>
        <H3>Two levels of comments</H3>
        <P>
          The <strong>request header</strong> has its own comment thread for
          request-wide discussion, and <strong>each part</strong> has its own
          thread for part-specific questions. @-mentions, auto-watching,
          watcher emails, and the "Notify everyone again" edit checkbox all
          work at both levels — a mention on a part emails a link that opens
          the request with that part expanded. Attachments also exist at both
          levels (on the header and on each part).
        </P>
        <H3>Email notifications</H3>
        <P>
          Build requests send email for: <strong>comments</strong> (request
          watchers + the assigned engineer, or a part's own watchers for part
          comments, plus anyone
          @-mentioned), <strong>BR Status changes</strong> (watchers + engineer
          + requestor), <strong>Engineer Assigned changes</strong> (personal
          "assigned / unassigned" notes plus a broadcast to watchers and the
          requestor), and a part's <strong>Part Status changes</strong> (that
          part's watchers). Nothing else emails — adding/removing parts,
          checklist ticks, WO No, lead time, and customer edits are quiet. See
          the{" "}
          <a href="#notifications" className="text-accent underline-offset-2 hover:underline">
            Notifications
          </a>{" "}
          section for the full recipient rules.
        </P>
        <H3>Finding requests</H3>
        <P>
          The list page has status pills (Open = everything not Complete),
          filters for Project / Engineer / Requestor, and the standard
          all-fields search — <strong>searching a part number finds its build
          request</strong>, even though parts don't appear in the list. Rush
          requests show a red Rush chip. The Dashboard's Build Requests card
          counts open requests (Mine = you're the requestor or the engineer).
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
      "panel projects admin",
      "panel user roles admin",
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
          Click <strong>Add admin</strong> on the Admins page and enter the
          user's @altronic-llc.com email — that's the only field on the form.
          The Name column in the table is derived from the email automatically
          (e.g. <code>matt.smith@…</code> shows as "Matt Smith"). The new admin
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
          The page lists what each role unlocks, so you can see what you're
          granting before you tick it.
        </P>
        <P>
          <strong>Add user</strong> is a <strong>search over people already in
          the system</strong> — type a few letters of a name or email address
          and pick the person; their email and display name are filled in for
          you, so there's no address to type and no typo to make. Anyone already
          on the list is left out of the results (adding them twice would create
          a second row that quietly does nothing). If the staff directory can't
          be read, the page says so and offers a manual email box as a fallback
          — a hand-typed address has to match exactly how the person signs in,
          or the row grants nothing.
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
          Hover a project and click the pencil to edit its number, name, or
          description. The optional description shows as a muted line under
          the project name in the list — only Admins (who already have
          access to this page) can add or edit it.
        </P>
        <H3>Panel Projects &amp; Panel User Roles admin</H3>
        <P>
          The Panels department has two admin pages of its own.{" "}
          <strong>Panel Projects</strong> (<code>/admin/panel-projects</code>)
          is the master list of panel project reference numbers — each row
          holds the reference number plus project type, description, DWG NO,
          customer, and department; new rows appear immediately in the
          Project Reference dropdown on panel orders.{" "}
          <strong>Panel User Roles</strong> (<code>/admin/panel-roles</code>)
          tags panel team members with a role (Super User, Manager, Tech,
          Engineer, Admin, Viewer), one row per user per role. Roles don't
          lock any panel order fields yet — see the <em>Panel Orders</em>{" "}
          section.
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
      "build request notification",
      "part status email",
      "engineer assigned email",
      "part comment email",
      "checklist email",
      "checkbox notification",
    ],
    searchText:
      "Commenting on a task, EIR, build request, or build request part emails everyone watching it, whoever it's assigned to, plus everyone you @-mention, from automation@altronic-llc.com. A comment with no mention at all still emails watchers and assignees. Mentioned people get a 'You were mentioned' email; assignees and other watchers get a 'New comment on' email that says whether it's assigned to them or they're watching. Build request parts have their own watcher lists and no Assigned field; part-comment emails deep-link to the request with that part expanded. You're never emailed for your own comment unless you @-mention yourself. @-mentioning auto-adds the person as a watcher. You also become a watcher automatically when you create an item and when something is assigned to you — on the create form and on later reassignments — alongside anyone added by hand to the Watchers field. Being unassigned does not remove you; use Unwatch. Comment timestamps are recorded on one company clock (Eastern) and displayed in your own local time, so a thread reads in the order it was written even when the authors are in different time zones. Editing a comment emails only newly added mentions by default, but checking 'Notify everyone again' resends an 'Updated comment on' email to watchers and assignees plus everyone mentioned in the new AND previous version of the comment. Change alerts: changing a Status (task, EIR, or build request), an EIR Resolution, a build request part's Part Status, or the assignees (including a build request's Engineer Assigned) emails the watchers, current assignees, and the EIR reporter or BR requestor. Checking or unchecking a Description checklist box (task, Operations task, or EIR) emails the watchers and current assignees with a Checklist updated on email naming the item. Being added as an assignee emails you 'You've been assigned'; being removed emails 'You've been unassigned'; everyone else gets a broadcast. Promoting an EIR to a task emails the EIR's watchers and reporter with a link to the new task. Creating/deleting parts and other field edits (lead time, customer, build request part checklists, WO No) send no email. You're never emailed for a change you made yourself.",
    render: () => (
      <>
        <P>
          ARC emails come from <strong>automation@altronic-llc.com</strong>, and
          every one names the item — a task, EIR, Operations task, build
          request, or an individual build request part — and carries a button
          to open it. Two rules hold across <em>all</em> of them:
        </P>
        <UL>
          <LI>
            You are <strong>never emailed about your own action</strong> — even
            if you're a watcher or assignee — with two exceptions:
            @-mentioning yourself, and the recovery email you get if one of
            your own saves fails to reach SharePoint (see below).
          </LI>
          <LI>
            Recipients are <strong>deduped</strong>: you get at most one email
            per event, and the most specific message wins (a mention beats an
            "assigned to you" notice, which beats a watcher notice; a personal
            "assigned" note beats the broadcast).
          </LI>
        </UL>

        <H3>Who is watching, and how you get there</H3>
        <P>
          Watchers are how ARC decides who to email. You join an item's watcher
          list in four ways — three of them automatic:
        </P>
        <UL>
          <LI>
            <strong>You created it.</strong> Whoever raises a task, EIR,
            Operations task, panel order, panel task, build request or build
            request part watches it from the moment it's saved.
          </LI>
          <LI>
            <strong>It's assigned to you.</strong> Assigning someone adds them
            as a watcher too — on the create form and on every later
            reassignment.
          </LI>
          <LI>
            <strong>Someone @-mentioned you</strong> in a comment.
          </LI>
          <LI>
            <strong>You were added by hand</strong> — the Watchers field on the
            item, or the Watch button.
          </LI>
        </UL>
        <P>
          Being <em>unassigned</em> doesn't remove you: you stay on the watcher
          list until you take yourself off with <strong>Unwatch</strong>, or
          someone removes you from the Watchers field. Nothing here emails you
          about your own actions — the rule above still holds.
        </P>
        <H3>Comment times</H3>
        <P>
          Comment timestamps are recorded on <strong>one company clock</strong>{" "}
          (Eastern) and shown to you in <strong>your own local time</strong>.
          A thread therefore reads in the order it was actually written, even
          when the people in it are in different time zones.
        </P>
        <H3>Every alert at a glance</H3>
        <AlertTable
          rows={[
            [
              "You comment (no mention)",
              "Everyone watching the item + whoever it's assigned to (minus you). Build request parts have their own watcher list — a part comment goes to that part's watchers, not the whole request's",
              "New comment on …",
            ],
            [
              "You comment on a build request part",
              "That part's watchers + anyone @-mentioned — parts have no Assigned field of their own. The email's button opens the request with that part already expanded",
              "New comment on a build request part …",
            ],
            [
              "You @-mention someone in a comment",
              "The mentioned person (watchers and assignees still get the comment email)",
              "You were mentioned in …",
            ],
            [
              "You edit a comment to add a new @-mention",
              "Only the newly added person",
              "You were mentioned in …",
            ],
            [
              "You edit a comment and check \"Notify everyone again\"",
              "Watchers + assignees + everyone @-mentioned in the new AND the previous version of the comment (minus you)",
              "Updated comment on …",
            ],
            [
              "Status changes (task, EIR, build request, panel order, or panel task)",
              "Watchers + current assignees + EIR reporter / BR requestor (minus you)",
              "Status changed on …",
            ],
            [
              "A build request part's Part Status changes",
              "That part's watchers (minus you)",
              "Part status changed on …",
            ],
            [
              "EIR Resolution changes",
              "Watchers + assignees + reporter (minus you)",
              "Resolution changed on …",
            ],
            [
              "A Description checklist box is checked or unchecked (task, Operations task, EIR, panel order notes, or panel task)",
              "Watchers + current assignees (minus you)",
              "Checklist updated on …",
            ],
            [
              "Someone is added as an assignee (incl. a build request's Engineer Assigned)",
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
              "Watchers + remaining assignees + EIR reporter / BR requestor (minus you and the added/removed people)",
              "Assignees changed on …",
            ],
            [
              "An EIR is promoted to a task",
              "The EIR's watchers + reporter (minus you)",
              "… was promoted to a task (the button opens the new task)",
            ],
            [
              "A save of yours fails to reach SharePoint (after automatic retries)",
              "Just you — a recovery copy so your work isn't lost",
              "ARC couldn't save your change — here's what you entered",
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
            You can <strong>@-mention or assign anyone at Altronic</strong> —
            the pickers list every staff member, not just people already on an
            item. Pick someone the app has never seen and it wires up their
            SharePoint access automatically the first time you assign or
            mention them. (If the directory hasn't been enabled by IT yet, the
            pickers fall back to people already known to the app.)
          </LI>
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
          Changing a task's, EIR's, or build request's <strong>Status</strong>,
          or an EIR's <strong>Resolution</strong>, alerts everyone who cares —{" "}
          <strong>watchers</strong>, <strong>current assignees</strong> (a build
          request's Engineer Assigned), plus the EIR{" "}
          <strong>reporter</strong> or build request <strong>requestor</strong>.
          The email spells out the change (e.g.{" "}
          <em>"In Progress → Complete"</em>) and who made it. On build requests,
          each part's <strong>Part Status</strong> also alerts — that goes to
          the part's own watchers. Completing a task that was promoted from an
          EIR closes that EIR (Resolved &amp; Closed), which alerts the EIR's
          followers too.
        </P>

        <H3>Checklist toggles</H3>
        <P>
          Checking or unchecking a box in a Description checklist (Engineering
          tasks, Operations tasks, EIRs, panel order notes, and panel tasks)
          emails the <strong>watchers</strong> and{" "}
          <strong>current assignees / assigned engineers</strong> — minus
          whoever clicked the box. The email names the item and whether it was
          checked (✓) or unchecked (✗). Build request part checklists (the
          PCB / Harness data-package boxes) are separate and stay quiet.
        </P>

        <H3>Assignee changes</H3>
        <P>
          When assignees change — including a build request's{" "}
          <strong>Engineer Assigned</strong> — the affected people get a{" "}
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
            Watchers, other assignees, and the EIR reporter / build request
            requestor → "Assignees changed on …", naming who was added and
            removed. (People who already got a personal note aren't sent this
            too.)
          </LI>
        </UL>

        <H3>What doesn't send email</H3>
        <P>
          Deliberately quiet: creating or deleting build request parts, and
          edits to other fields — lead time, type, customer info, build
          request part checklist ticks, WO No, due dates, description text
          edits, and so on. Only Status changes, assignee/engineer changes,
          Part Status changes, Description checklist toggles, and comments
          fire email.
        </P>

        <H3>Promoting an EIR to a task</H3>
        <P>
          When an EIR is <strong>promoted to a task</strong>, the EIR's{" "}
          <strong>watchers</strong> and <strong>reporter</strong> get an email
          (minus whoever did the promoting) with a button that opens the new
          task. Later, when that task is completed, the same followers hear about
          it again as the EIR is closed out.
        </P>

        <H3>If one of your saves fails</H3>
        <P>
          ARC waits out SharePoint throttling and brief network drops
          automatically, so almost every save goes through even if it takes a
          moment. In the rare case a save <em>still</em> can't be written —
          usually a permissions problem or a longer outage — the app undoes
          the change in the UI (so nothing looks saved when it isn't) and{" "}
          <strong>emails you a copy of exactly what you entered</strong>, plus
          the reason it failed. Look for <em>"ARC couldn't save your change —
          here's what you entered"</em> in your inbox, then re-enter it. This
          email goes only to you; it's the one time ARC emails you about your
          own action.
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
          assignees, watchers, admin-list rows, attachment deletes, etc. —
          applies <strong>instantly on screen</strong> while SharePoint saves
          in the background, and surfaces a confirmation toast at the
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
      "Loading hangs? Often sign-in / permission. F12 console: 401 means token expired (re-sign-in), 403 means missing SharePoint access. Change reverted? Someone may have edited at the same time. New task missing? Default Assigned filter is you — pick Anyone. Mention email not sent? Manual @Name typing doesn't make a chip — pick from dropdown. Report issue button in the header captures console errors and emails them to the app manager. Left the tab open a long time? Your Microsoft sign-in expires while idle and ARC shows the sign-in screen — click 'Sign in again', enter your password once, and the app comes back with fresh data. No sign-out, no refresh, no clicking Retry.",
    render: () => (
      <>
        <H3>"Loading tasks…" hangs forever</H3>
        <P>
          Usually a sign-in / permission issue. F12 → Console: a 401 means
          your token expired (sign out + sign in). A 403 means the app
          doesn't have read access to the SharePoint site — talk to IT.
        </P>
        <H3>The app was left open a long time and asks you to sign in again</H3>
        <P>
          If a browser tab sits idle for a long stretch, your Microsoft
          sign-in goes stale in the background. When ARC notices, it shows you
          the sign-in screen with{" "}
          <strong>"Your Microsoft sign-in expired while the tab was
          idle"</strong> and a <strong>Sign in again</strong> button. One
          password prompt is all it takes — the app comes straight back with
          fresh data. You do not need to sign out, refresh the page, or click
          anything twice.
        </P>
        <H3>A change didn't stick</H3>
        <P>
          If the toast turned red, the SharePoint write was rejected — open
          the task again to confirm. If the toast was green but the change
          reverted on refresh, someone else may have changed the same field
          at the same time; reapply your change.
        </P>
        <P>
          <strong>You won't lose the work.</strong> Whenever a save truly
          can't reach SharePoint — after ARC has automatically retried
          through any throttling or network blip — the app emails{" "}
          <em>you</em> a copy of exactly what you entered, along with the
          reason it failed (for example, a permissions problem). Check your
          inbox for <em>"ARC couldn't save your change — here's what you
          entered"</em>, then re-enter it. If it keeps failing, use{" "}
          <strong>Report Issue</strong> so the app manager can dig in.
        </P>
        <H3>A save felt slow for a few seconds</H3>
        <P>
          That's the app protecting your edit. If SharePoint is busy
          (throttling) or your connection blips, ARC quietly waits and
          retries in the background — for as long as SharePoint asks, up to
          several attempts — while your edit stays on screen. You only see
          a red toast if every retry fails, in which case the edit reverts
          and you should try again.
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
