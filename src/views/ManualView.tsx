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
      "Sign in with your altronic-llc.com account. The Dashboard opens after sign-in. Use the top nav to switch between Dashboard, the Departments dropdown, and Admin. The Departments dropdown mirrors the dashboard: Engineering (Engineering Tasks, EIRs, Test Sheets, Project Folders, Build Requests, Drawing File Logs, CSA Listings, Where Am I?, ECNs), Panels, Operations, Coils (Potting Sample Log), Quality Control (Digital QC and Ignition QC Defect Logs), Supply Chain (Gray Market Requests, FAITs, Suppliers/SRM Tool), and Customer Service / Sales (Open Orders Report, Visit Reports, Customers/CRM Tool).",
    render: () => (
      <>
        <P>
          Sign in with your <code>@altronic-llc.com</code> Microsoft account when
          prompted. Once you're in, the <strong>Dashboard</strong> opens with a
          summary of your open work. The top nav has a{" "}
          <strong>Departments</strong> dropdown that mirrors the dashboard's
          sections — <strong>Engineering</strong> (Engineering Tasks, EIRs, Test
          Sheets, Project Folders, Build Requests, Drawing File Logs, CSA
          Listings, Where Am I?, ECNs), <strong>Panels</strong>,{" "}
          <strong>Operations</strong>, <strong>Coils</strong> (Potting Sample
          Log), <strong>Quality Control</strong> (Digital QC and Ignition QC
          Defect Logs), <strong>Supply Chain</strong> (Gray Market Requests,
          FAITs, and the Suppliers SRM tool), and{" "}
          <strong>Customer Service / Sales</strong> (Open Orders Report, Visit
          Reports, and the Customers CRM tool). Engineering Tasks use the{" "}
          <strong>List</strong> and{" "}
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
      "maintenance card",
      "work orders card",
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
      "quick links",
      "dashboard buttons",
      "dashboard shortcuts",
      "quick link buttons",
    ],
    searchText:
      "The Dashboard is grouped into department sections — Engineering, Panels, Operations, Coils, Quality Control, Supply Chain, and Customer Service / Sales — each a divider heading with its cards beneath. A department can show a row of admin-managed Quick Links buttons above its cards, linking out to a SharePoint site or another tool outside ARC; the row only appears once an admin has added at least one for that department, at /admin/quick-links. Engineering has live cards: Engineering Tasks, EIRs, Test Sheets and more. Coils has the Potting Sample Log; Quality Control has the Digital QC and Ignition QC Defect Logs; Supply Chain has Gray Market Requests, Suppliers (the SRM tool), Cost Impact Notices and FAITs; Customer Service / Sales has Open Orders Report, Visit Reports and Customers (the CRM tool). Most live cards show the count of active items (tasks not Complete, EIRs not Closed), a colour-coded status mini-bar, and click through to that type's page; a few — Open Orders Report, Visit Reports, Suppliers, Cost Impact Notices and Customers — are description-only, since there's no count that reads as more useful than the tool itself. A Mine / Company switch flips every count and bar between your own items and the whole company's; Mine is the default. A project picker sits next to it and works the same way — pick a project and every card's count and mini-bar narrows to just that project, in place, combining with Mine/Company rather than navigating anywhere. Clicking a card afterward opens that type's full list pre-filtered to the picked project.",
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
          A department can also show a row of <strong>Quick Links</strong>{" "}
          buttons above its cards — shortcuts to a SharePoint site, a vendor
          portal, or anywhere else outside ARC that team opens often. Admins
          manage these at <strong>Admin → Quick Links</strong>; the row only
          appears once a department has at least one configured, and clicking
          a button opens it in a new tab.
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
          Defect Log), <strong>Supply Chain</strong> (Gray Market Requests,
          Suppliers, Cost Impact Notices, FAITs) and{" "}
          <strong>Customer Service / Sales</strong> (Open Orders Report,
          Visit Reports, Customers) all open straight to their lists, and{" "}
          <strong>Panels</strong> and <strong>Operations</strong> link to
          their orders, tasks, the Teradyne Log and{" "}
          <strong>Maintenance</strong> — whose card counts open work orders,
          says how many are overdue, and opens the Maintenance Calendar. The{" "}
          <strong>Customers</strong> and <strong>Suppliers</strong> cards
          describe the CRM/SRM tool rather than showing a count — neither a
          customer nor a supplier is "assigned" the way a task or an EIR is,
          so there's no number that reads as more useful than the tool
          itself.
        </P>
        <P>
          Types whose SharePoint list isn't built yet — Coils'{" "}
          <strong>Coil Defect Log</strong>,
          Quality Control's <strong>QC Forms</strong>, and{" "}
          <strong>Customer Service / Sales</strong> (Customer Feedback,
          Pricing Requests) — appear as dimmed{" "}
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
      "show all",
      "slow",
    ],
    searchText:
      "The List view shows every task with status pills at the top, a filter bar (Project, Assigned, Created By, Search), and a New Task button. Search matches all fields on every list; multiple words are ANDed together, and double quotes match an exact phrase. Click a row to open the task detail. Filters live in the URL so views are shareable. Only the first 150 matches are rendered at once, with a show all link if there are more — filtering, sorting and the count always cover everything.",
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
          <LI>
            On a big list, only the first 150 matches are shown at once — a{" "}
            <strong>Showing 150 — show all</strong> link appears above the
            rows if there are more. Filtering, sorting, and the "Showing N of
            M" count always cover every match; the cap only limits what's
            drawn on screen, which is what keeps typing in the search box
            responsive on a list with hundreds or thousands of rows. Narrow
            your search below 150 matches and it stops applying automatically.
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
      "Type @ in the comment composer to open the mention picker. Arrow keys then Enter or Tab to pick. You can type a first name and surname after the @ — the space no longer closes the picker — and matching works in any order or by email address. admin.first.last accounts are not listed. Comment boxes auto-grow as you type or paste. Mentioned people get an email with the task/EIR name, the comment quote, and a link. Attach files by drag-drop, click Attach, or paste with Ctrl+V. Pasting a screenshot opens a naming prompt before it attaches anywhere — Cancel discards it instead of attaching it — and the named file uploads to the task's SharePoint project folder like any other attachment; a name already taken there is saved as name (2).ext instead of overwriting it. You can edit your own comments inline (a comment is yours if its saved name or email matches you, so older imported comments count too). Check Notify everyone again when editing to re-email every watcher and mention. Ctrl+Enter sends.",
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
          visible. You can type a <strong>full name</strong> after the @ —
          "@Jerrod W" keeps the picker open and narrows it, which matters when
          two people share a first name. Editing an existing comment has the
          same @-mention picker,
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
    id: "maintenance",
    title: "Maintenance work orders",
    group: "Operations",
    keywords: [
      "maintenance",
      "cmms",
      "work order",
      "work orders",
      "wo number",
      "repair",
      "breakdown",
      "corrective",
      "machine broken",
      "fix a machine",
      "awaiting parts",
      "waiting on parts",
      "maintenance board",
      "maintenance list",
      "maintenance kanban",
      "who can complete",
      "mark complete",
      "close a work order",
      "downtime",
      "labor hours",
      "labour hours",
      "failure cause",
      "parts used",
      "resolution",
      "tech notes",
      "due status",
      "on-track",
      "late",
      "task type",
      "request",
      "regular maintenance",
      "maintenance roles",
      "maintenance role",
      "maintenance departments",
      "maintenance locations",
      "add a department",
      "add a location",
      "rename a department",
      "retire a department",
      "reference lists",
      "tech role",
      "maintenance admin",
      "maintenance permissions",
      "why can't i complete",
      "why is complete disabled",
      "who can log a pm",
      "who can edit a schedule",
    ],
    searchText:
      "Maintenance is the CMMS under Operations, backed by the Altronic Maintenance Tasks list on the Altronic_PMO SharePoint site. A work order is one job on one machine. The WO number is generated by ARC as WO-YYYY-#### and is read-only. Status is Backlog, Up Next, Started, Awaiting Parts, On Hold, Complete or Canceled - Awaiting Parts is its own board column so work blocked on supply is visible instead of being lumped in with On Hold. Priority is Low, Med, High or Emergency. Category is Corrective / Repair, Preventive, Inspection, Calibration, Cleaning, Oil Change, Safety or Improvement. Task Type is derived, not picked: Regular Maintenance when the work order came off a PM schedule, Request when somebody raised it directly. Due Status (On-Track / Late) is displayed but never edited in ARC - a Power Automate flow maintains that column. Marking a work order Complete needs the Tech or Admin maintenance role - any tech can close out any work order, whoever it is assigned to, and Completed By records who actually did it. If nobody is assigned, whoever completes it is assigned in the same action so the record shows who did the job. The button is disabled with the reason on it rather than failing after the fact, and the same applies to dragging a card onto the board's Complete column. Raising a work order, editing an open one, commenting and attaching files are open to everyone signed in. Maintenance roles are managed by an ARC admin at Admin - Maintenance Roles: Tech can complete work orders and log PMs, Admin can also create, edit and retire PM schedules and manage the asset register. Admin outranks Tech, ARC admins always count as maintenance admins, and until the roles list is configured nothing is gated at all. The list opens on the open queue and is deliberately not filtered to you - a maintenance backlog is a shared queue. Filters (equipment, assigned, category, department, search) live in the URL so a filtered view is shareable and survives the switch between list and board. The write-up fields - Failure Cause, Resolution, Parts Used, Tech Notes, labour hours and downtime hours - are edited behind one Edit button on the card. Comments, @-mentions, watchers and attachments work exactly as they do on a task. Department and Location are picked from lists a maintenance admin maintains at Maintenance - Departments & Locations: adding a value makes it available everywhere immediately, renaming one carries every record already pointing at it, and there is no delete - a value is retired, which takes it out of the pickers while every record already using it keeps showing it.",
    render: () => (
      <>
        <P>
          <strong>Maintenance</strong> is ARC's CMMS — the maintenance module
          under <strong>Operations</strong>, backed by its own SharePoint lists
          on the same Altronic_PMO site as Operations tasks. The{" "}
          <strong>Departments</strong> dropdown's Operations group has four
          entries for it, because they answer four different questions:{" "}
          <strong>Maintenance Calendar</strong> (what is due),{" "}
          <strong>Work Orders</strong> (what needs doing),{" "}
          <strong>Maintenance Schedules</strong> (the recurring rules) and{" "}
          <strong>Maintenance Dashboard</strong> (the numbers). The Dashboard's{" "}
          <strong>Maintenance</strong> card counts open work orders and opens
          the calendar.
        </P>
        <P>
          A <strong>work order</strong> is one job on one machine. Raise one
          with <strong>New work order</strong> on the list or the board. ARC
          generates the <strong>WO number</strong> — <code>WO-YYYY-####</code> —
          and it can't be edited.
        </P>
        <H3>The fields</H3>
        <UL>
          <LI>
            <strong>Status</strong> — Backlog / Up Next / Started /{" "}
            <strong>Awaiting Parts</strong> / On Hold / Complete / Canceled.
            Awaiting Parts has its own board column on purpose: work blocked on
            supply is a different problem from work somebody paused, and lumping
            the two into On Hold hides it.
          </LI>
          <LI>
            <strong>Priority</strong> — Low / Med / High / Emergency.
          </LI>
          <LI>
            <strong>Category</strong> — Corrective / Repair, Preventive,
            Inspection, Calibration, Cleaning, Oil Change, Safety, Improvement.
          </LI>
          <LI>
            <strong>Task Type</strong> is <em>derived, not picked</em> —{" "}
            <strong>Regular Maintenance</strong> when the work order came off a
            maintenance schedule, <strong>Request</strong> when somebody raised
            it directly.
          </LI>
          <LI>
            <strong>Due Status</strong> (On-Track / Late) is{" "}
            <strong>shown but never edited in ARC</strong>. A Power Automate
            flow outside ARC maintains that column; there's no picker for it
            anywhere, and ARC strips it from every save.
          </LI>
          <LI>
            <strong>Equipment</strong> — the machine the job is on. Clicking it
            opens that machine's asset page.
          </LI>
        </UL>
        <H3>Who can mark a work order Complete</H3>
        <P>
          Anyone holding the <strong>Tech</strong> or <strong>Admin</strong>{" "}
          maintenance role (see <em>Maintenance roles</em> below). Any tech can
          close out <strong>any</strong> work order, whoever it happens to be
          assigned to — picking somebody else's job up off the backlog is
          ordinary, and the record still says who did it, because your name is
          written to <strong>Completed By</strong>. For anyone without the role
          the Complete button is disabled with the reason on it and Complete is
          dropped from the status picker, rather than letting you try and fail
          — and the same applies to dragging a card onto the board's Complete
          column.
        </P>
        <P>
          If a work order is <strong>unassigned</strong>, completing it{" "}
          <strong>assigns it to you</strong> in the same action, so the record
          has an owner in every report that reads it. The page tells you that
          before you press it.
        </P>
        <P>
          Everything else on a work order — raising one, editing an open one,
          commenting, @-mentioning, watching and attaching files — is open to{" "}
          <strong>everyone signed in</strong>. Only closing one out is gated.
        </P>
        <H3>Maintenance roles</H3>
        <P>
          The CMMS has <strong>two</strong> roles, managed by an ARC admin at{" "}
          <strong>Admin → Maintenance Roles</strong>:
        </P>
        <UL>
          <LI>
            <strong>Tech</strong> — can mark a work order Complete, and can log
            a PM (Start / Complete / Skip) against a schedule.
          </LI>
          <LI>
            <strong>Admin</strong> — everything a Tech can do, plus creating,
            editing and retiring PM schedules, and managing the asset register,
            departments and locations. Admin outranks Tech, so an Admin needs
            no Tech tag as well, and an <em>ARC</em> admin always counts as a
            maintenance Admin.
          </LI>
        </UL>
        <P>
          Roles are matched on your <strong>email address</strong>, never on
          your name. If you have been given a role and it doesn't seem to
          apply, the address on the list is the first thing to check — the
          admin screen flags a row whose value isn't an address, because such a
          row grants nothing and reports no error anywhere.
        </P>
        <P>
          Until the Maintenance Roles list is set up,{" "}
          <strong>nothing is gated</strong>: everyone signed in can do
          everything they can today. Roles take effect only once an admin
          configures the list, and it should be populated first so nobody loses
          what they already had.
        </P>
        <H3>Departments and locations</H3>
        <P>
          Every asset, work order and PM schedule carries a{" "}
          <strong>Department</strong> and a <strong>Location</strong>, and both
          are picked from a list a maintenance admin maintains at{" "}
          <strong>Maintenance → Departments & Locations</strong>, inside the
          maintenance module itself rather than under the app-wide Admin menu
          — gated by the same Maintenance Roles admin tag as the asset
          register. Adding a department or a location there makes it
          available everywhere in the CMMS immediately — no ticket, no
          waiting.
        </P>
        <P>
          <strong>Renaming one is safe.</strong> Every record already pointing
          at it follows the new name automatically, so fixing a typo is a
          one-line change rather than an edit to every row that held the old
          spelling.
        </P>
        <P>
          There is <strong>no delete</strong>. A value that is no longer used is{" "}
          <strong>retired</strong>: it disappears from the pickers, while every
          record already pointing at it keeps showing it. If you open a record
          whose department was retired, it still shows — marked{" "}
          <em>(retired)</em> in the picker — so nothing is silently blanked and
          you can leave it as it is or pick something current.
        </P>
        <P>
          The Locations list came across from the old system with its
          duplicates intact ("Q.C." beside "QC", "HARNESS DEPARMENT" beside
          "HARNESS DEPARTMENT"). The admin screen{" "}
          <strong>points them out but never merges them</strong> — which of a
          pair survives, and what happens to the records pointing at the other,
          is a decision for whoever knows the shop.
        </P>
        <P>
          A work order's Department and Location are <strong>its own</strong>,
          not an echo of the asset's: picking a machine fills them in as a
          convenience, and it never overwrites a value you set yourself. A job
          against something the register has never heard of — a light, a door,
          a leaking pipe — carries them on its own.
        </P>
        <H3>List and board</H3>
        <P>
          The list opens on the <strong>open queue</strong> (Complete and
          Canceled are history), and it's deliberately{" "}
          <strong>not filtered to you</strong> the way the Engineering task list
          is — a maintenance backlog is a shared queue, and the question people
          open it to ask is "what needs doing", not "what's mine". The status
          pills narrow it further, and the counts always describe what's on
          screen.
        </P>
        <P>
          Filter by <strong>Equipment</strong>, <strong>Assigned</strong>{" "}
          (Unassigned is the first option — on a shop floor the jobs nobody has
          picked up are what people are looking for), <strong>Category</strong>,{" "}
          <strong>Department</strong> and free-text <strong>search</strong>. The
          filters live in the URL, so a filtered view is shareable, survives a
          refresh, and carries across when you switch between the list and the
          board.
        </P>
        <P>
          The <strong>board</strong> is one column per status — drag a card
          between columns to move it. Like every Kanban in ARC it needs more
          width than a phone has, so on a phone the board link opens the list
          instead.
        </P>
        <H3>Writing the job up</H3>
        <P>
          <strong>Failure Cause</strong>, <strong>Resolution</strong>,{" "}
          <strong>Parts Used</strong>, <strong>Tech Notes</strong>,{" "}
          <strong>Labor Hours</strong> and <strong>Downtime Hours</strong> sit on
          the work order's write-up card behind one <strong>Edit</strong>{" "}
          button, and only the fields you change are saved. Downtime hours are
          what the Maintenance Dashboard's downtime-by-asset chart is built
          from, so they're worth filling in.
        </P>
        <P>
          Comments with @-mentions, watchers, the Watch / Watching toggle and
          attachments all work exactly as they do on a task — see{" "}
          <em>Comments and @-mentions</em> and <em>Notifications</em>.
        </P>
      </>
    ),
  },
  {
    id: "maintenance-calendar",
    title: "Maintenance Calendar",
    group: "Operations",
    keywords: [
      "maintenance calendar",
      "what is due",
      "due this month",
      "pm calendar",
      "scheduled job",
      "projected",
      "dashed",
      "dashed outline",
      "solid chip",
      "start a pm",
      "complete a pm",
      "skip a pm",
      "skip reason",
      "log a completion",
      "overdue",
      "overdue strip",
      "past due maintenance",
      "agenda",
      "maintenance on my phone",
    ],
    searchText:
      "The Maintenance Calendar is a month grid of everything due. A solid chip is a real work order - click it to open it. A dashed outline is a projected occurrence a maintenance schedule implies: it appears automatically, but it is not a record yet, there is nothing to open, and nothing has been logged. Clicking one offers Start, Complete or Skip, and that action is what creates the work order and rolls the schedule forward. Skipping requires a reason, and the reason is written into the new work order's Resolution; a skip moves the next due date but does NOT record a completion, so a Floating schedule's clock is not restarted by work that was not done. The new work order is dated to the occurrence, not to today, which is what makes the dashed outline give way to the solid chip. It is assigned to whoever logged the action, and the schedule's own assignee stays on it as a watcher. An overdue occurrence never disappears and never rolls forward on its own: it keeps its place on the day it was actually due, and an overdue strip above the grid shows on every month so paging to another month does not lose it. Filters for type, assignee and equipment live in the URL. On a phone the grid is replaced by an agenda list grouped Today, Tomorrow and then by date.",
    render: () => (
      <>
        <P>
          The <strong>Maintenance Calendar</strong> answers "what's due, and
          when" — a month grid carrying both kinds of thing that can be due. The
          difference between them is the one thing this screen exists to get
          across:
        </P>
        <UL>
          <LI>
            A <strong>solid chip is a real work order</strong>. It's a row on the
            work-order list with a status, an assignee and a history. Clicking it
            opens it.
          </LI>
          <LI>
            A <strong>dashed outline is a projected occurrence</strong> — a date
            one of your maintenance schedules says something is due. It appears
            on the calendar <em>automatically</em>, but{" "}
            <strong>it isn't a record yet</strong>: nothing has been logged and
            there's nothing to open.
          </LI>
        </UL>
        <H3>Turning a scheduled job into a record</H3>
        <P>
          Clicking a dashed occurrence offers <strong>Start</strong>,{" "}
          <strong>Complete</strong> or <strong>Skip</strong>. Any of the three{" "}
          <strong>creates the work order</strong>, and the two that close it out
          also <strong>roll the schedule forward</strong> to its next due date.
          Until you do one of them, the schedule keeps projecting and nothing has
          been recorded.
        </P>
        <UL>
          <LI>
            <strong>Skip requires a reason</strong>, and the reason is kept on
            the work order as its Resolution. A skipped PM that says nothing is
            indistinguishable from one nobody got to, and the sentence explaining
            it is the whole point of recording the skip.
          </LI>
          <LI>
            <strong>A skip doesn't record a completion.</strong> It moves the
            next due date and leaves Last Completed alone — writing a completion
            date for work that was explicitly not done would restart a Floating
            schedule's clock and lie in every report that reads it.
          </LI>
          <LI>
            <strong>The work order is dated to the occurrence, not to
            today.</strong> That's what makes the dashed outline give way to the
            solid chip instead of the two sitting side by side on the same day.
          </LI>
          <LI>
            <strong>It's assigned to whoever logged the action</strong>, and the
            schedule's own assignee stays on it as a watcher — which matches the
            completion rule, since only the assignee or an admin can close a work
            order out.
          </LI>
        </UL>
        <H3>Overdue work never disappears</H3>
        <P>
          A scheduled job that goes past due{" "}
          <strong>doesn't roll forward on its own</strong> and is never re-dated
          to today. It keeps its place on the day it was actually due, and it
          stays in the overdue count, until somebody closes it out. So that
          paging to another month can't hide it, a permanent{" "}
          <strong>overdue strip</strong> above the grid lists it on every month
          you look at.
        </P>
        <H3>Filters, and the calendar on a phone</H3>
        <P>
          Narrow the month by <strong>type</strong> (work orders, scheduled
          occurrences, or both), <strong>assignee</strong> and{" "}
          <strong>equipment</strong>. The filters live in the URL, so the view
          you're looking at is shareable and carries across to the schedules
          screen and back.
        </P>
        <P>
          On a <strong>phone</strong> seven columns are unreadable, so the grid
          is replaced by an <strong>agenda list</strong> of what's coming up,
          grouped <strong>Today</strong>, <strong>Tomorrow</strong> and then by
          date. It's the same filtered set drawn differently — solid and dashed
          still mean the same two things, and Start / Complete / Skip still work.
        </P>
      </>
    ),
  },
  {
    id: "maintenance-schedules",
    title: "Maintenance Schedules (PM library)",
    group: "Operations",
    keywords: [
      "maintenance schedules",
      "pm library",
      "preventive maintenance",
      "recurring",
      "repeat",
      "frequency",
      "every 90 days",
      "annual",
      "quarterly",
      "fixed",
      "floating",
      "schedule basis",
      "hourmeter",
      "hour meter",
      "run hours",
      "running hours",
      "machine hours",
      "every 500 hours",
      "meter based pm",
      "reading",
      "stale reading",
      "next due date",
      "grace days",
      "lead time",
      "retire a schedule",
      "deactivate",
      "active",
      "loto",
      "requires shutdown",
    ],
    searchText:
      "Maintenance Schedules is the PM library - the recurring rules that produce what the Maintenance Calendar projects. A schedule carries instructions, the machine, a category and priority, a frequency (an interval plus Days, Weeks, Months, Years or Hours), a first due date or a first due reading, an assignee and watchers, an estimated time, grace days, lead time days, and the Requires Shutdown and LOTO Required flags. Schedule Basis is the setting that decides where the next occurrence comes from: Fixed takes the next due date from the DUE date, so an annual certification stays on its date even when it is done three weeks late; Floating takes it from the COMPLETION date, so a 90-day filter change restarts from when it was actually done; Hourmeter has no date at all - it is due at a run-hours READING off the asset's hourmeter. An Hourmeter schedule is due when the asset's Current Machine Hours reaches Next Due Hours, which is the reading of the last completion plus the interval. The PM library shows it as Due at 5,200 hrs, now 5,043 hrs, 157 to go, and it only appears on the calendar on the day the reading actually passes the target - there is no estimated date, because guessing one from average usage would invent a figure nobody measured. If the asset has no hourmeter reading, or no asset is linked at all, the library says CAN'T TELL rather than showing it as not due: a schedule in that state can never come due. If the asset's row has not been edited in long enough for a whole interval to have gone by, the library warns that the reading may be stale. Grace days and lead time days are in DAYS and do not apply to an Hourmeter schedule - it is due the moment the reading reaches the target - so both boxes are disabled with the reason on them. Logging a completion on an Hourmeter schedule asks for the hourmeter reading off the machine, and the next target is worked out from the reading it was actually done at. Skipping one cannot move its target. Grace days say how late a job can be before it counts as overdue; lead time days say how far ahead of the due date it starts appearing. Month arithmetic is calendar-correct - 31 January plus a month is 28 February, not 2 March. An overdue schedule sorts to the top, says how late it is, and never rolls forward by itself. There is no delete: a schedule is retired by turning Active off, which stops it projecting anything while every work order it ever produced still points at something real. You can also log a completion from here for a job done off a paper round rather than from the calendar. Creating, editing and retiring a schedule needs the Admin maintenance role; logging an occurrence needs Tech or Admin; reading the library is open to everyone. Where you cannot, the control is disabled with the reason on it, and on the calendar the day-cell plus button that seeds a new schedule is not offered at all.",
    render: () => (
      <>
        <P>
          <strong>Maintenance Schedules</strong> is the PM library. The calendar
          answers "what's due"; this answers{" "}
          <strong>"what rules produce it"</strong> — it's where a recurring job
          is created, corrected, retired, and logged when somebody does it off a
          paper round rather than off the calendar.
        </P>
        <H3>Setting one up</H3>
        <P>
          A schedule carries its <strong>instructions</strong>, the{" "}
          <strong>machine</strong>, a category and priority, a{" "}
          <strong>frequency</strong> (an interval plus Days / Weeks / Months /
          Years / <strong>Hours</strong>), a <strong>first due date</strong> — or,
          on a run-hours schedule, a first due <strong>reading</strong> — an
          assignee and watchers, an estimated time, and the{" "}
          <strong>Requires Shutdown</strong> and <strong>LOTO Required</strong>{" "}
          flags for planning.
        </P>
        <H3>Fixed, Floating or Hourmeter — where the next occurrence comes from</H3>
        <P>
          Every schedule is one of the three, and it's the setting that most
          changes what you see on the calendar:
        </P>
        <UL>
          <LI>
            <strong>Fixed</strong> — the next due date comes from the{" "}
            <strong>due</strong> date. An annual certification due every 1 March
            is due next on 1 March whether it was done on the day or three weeks
            late.
          </LI>
          <LI>
            <strong>Floating</strong> — the next due date comes from the{" "}
            <strong>completion</strong> date. A 90-day filter change is due 90
            days after it was <em>actually</em> done, not 90 days after it was
            supposed to happen.
          </LI>
          <LI>
            <strong>Hourmeter</strong> — there is <strong>no date at all</strong>.
            The job is due at a <strong>reading</strong>: an oil change every 500
            run hours, last done at 4,700 hours, is next due at 5,200. It becomes
            due when the machine's <strong>Current Machine Hours</strong> reaches
            that figure. Picking this basis sets the unit to Hours and swaps the
            First due date for a first due <em>reading</em>.
          </LI>
        </UL>
        <H3>Run-hours (Hourmeter) schedules</H3>
        <P>
          A run-hours schedule is <strong>not on the calendar until it is
          actually due</strong>. There is no honest date to put it on — how long
          500 hours takes depends on how hard the machine runs — and ARC
          deliberately does <em>not</em> estimate one from average usage, because
          that would put a figure on the calendar nobody measured. On the day the
          reading passes the target it appears as a chip on today, and it stays
          there, like any overdue job, until it is logged.
        </P>
        <P>
          The <strong>PM library is where you watch one coming</strong>. Instead
          of a date, its Next due column reads{" "}
          <strong>"Due at 5,200 hrs · now 5,043 hrs · 157 to go"</strong>, with
          the date the asset's row was last edited underneath it.
        </P>
        <P>
          <strong>A reading that is missing or out of date is the thing that
          breaks a run-hours PM</strong>, so ARC says so out loud rather than
          showing it as fine:
        </P>
        <UL>
          <LI>
            <strong>"Can't tell"</strong> — the asset has no hourmeter reading at
            all, or the schedule has no asset linked. Either way it{" "}
            <em>can never come due</em>. This is shown in red on the row, and
            counted on the maintenance dashboard beside the number that are due.
            Note a reading of <strong>0</strong> is a real reading off a new
            machine, and is treated as one — it is a blank reading that is the
            problem, not a zero.
          </LI>
          <LI>
            <strong>"Reading may be stale"</strong> — the asset's row hasn't been
            edited in long enough that a whole interval could have gone by
            without anybody noticing, so "not due" isn't worth much. It's a rough
            check rather than a fact: SharePoint doesn't record when an
            individual column was last changed, so the closest signal is when the
            asset row was last edited at all.
          </LI>
        </UL>
        <P>
          Keep <strong>Current Machine Hours</strong> up to date on the asset —
          it's editable straight from the asset register and the asset page.
          That one number is what makes every run-hours PM on that machine work.
        </P>
        <P>
          <strong>Grace days and lead time days are in days, so they don't apply
          here</strong> — a run-hours job is due the moment the reading reaches
          the target. Both boxes are disabled on the form with the reason on
          them, rather than being quietly reused as hours: three grace days is
          not three grace hours.
        </P>
        <P>
          <strong>Logging a completion asks for the reading off the machine.</strong>{" "}
          It's filled in from the asset for you and you can correct it. The next
          target is worked out from the reading it was <em>actually</em> done at —
          a job due at 5,000 and done at 5,340 is next due at 5,840, so being late
          once doesn't make it late for ever. <strong>Skipping</strong> a
          run-hours job can't move its target (that would mean inventing a
          reading), so it stays due until the work is done or the schedule is
          retired.
        </P>
        <P>
          Month arithmetic is calendar-correct, so a monthly job anchored on the
          31st lands on 28 (or 29) February rather than drifting into March.
        </P>
        <UL>
          <LI>
            <strong>Grace days</strong> — how late a job can run before it counts
            as overdue.
          </LI>
          <LI>
            <strong>Lead time days</strong> — how far <em>ahead</em> of its due
            date an occurrence starts showing on the calendar, so there's time to
            plan it.
          </LI>
        </UL>
        <H3>Overdue, and retiring a schedule</H3>
        <P>
          An <strong>overdue schedule sorts to the top</strong> and says how late
          it is. It doesn't roll forward on its own and nothing here hides it — a
          schedule that quietly re-dated itself every time it was missed is a
          schedule nobody ever does.
        </P>
        <P>
          There is <strong>no delete</strong>. A schedule you no longer want is{" "}
          <strong>retired</strong> by turning <strong>Active</strong> off: it
          stops projecting anything at all, while every work order it ever
          produced still points at something real. Search, and the Active /
          Retired / All filter, cover the rest.
        </P>
        <H3>Who can change a schedule</H3>
        <P>
          <strong>Creating, editing and retiring</strong> a schedule needs the{" "}
          <strong>Admin</strong> maintenance role — a schedule decides what the
          whole shop is told is due, so it's a narrower right than doing the
          work. <strong>Logging</strong> an occurrence (Start / Complete /
          Skip) needs <strong>Tech</strong> or <strong>Admin</strong>. Reading
          the library, and every filter on it, is open to everyone signed in.
        </P>
        <P>
          Where you can't, the control is <em>disabled with the reason on it</em>{" "}
          rather than failing after you've filled a form in — and on the
          calendar the day-cell "+" that seeds a new schedule simply isn't
          offered.
        </P>
      </>
    ),
  },
  {
    id: "maintenance-assets",
    title: "Assets and equipment",
    group: "Operations",
    keywords: [
      "asset",
      "assets",
      "equipment",
      "equipment list",
      "asset register",
      "machine",
      "machine history",
      "nameplate",
      "serial number",
      "manufacturer",
      "model number",
      "criticality",
      "asset status",
      "machine down",
      "in service",
      "standby",
      "retired asset",
      "responsible tech",
      "parent asset",
      "manuals",
      "wiring diagram",
      "department",
      "location",
      "asset register",
      "asset tag",
      "machine hours",
      "hourmeter",
      "meter reading",
      "needs attention",
      "retire an asset",
    ],
    searchText:
      "The Altronic Equipment List is the plant's asset register - 378+ machines - and it is what every work order and maintenance schedule is hung off. Open a machine's page by clicking its name anywhere it appears. The page shows the nameplate (type, department, location, criticality, asset tag, machine hours, serial number, manufacturer, model, parent machine, install date, warranty expiry), the work currently open on it, everything ever done to it, the maintenance schedules that drive it, and its manuals, wiring diagrams and nameplate photos as attachments. Asset Status (In Service, Down, Standby, Retired) and Responsible Tech are edited on the asset page itself and save immediately when picked. Everything else is edited on the asset register at Maintenance - Assets, which lists all machines with search and filters, a Needs attention view showing what each row is missing, an Add asset button, and an inline editor for Current Machine Hours. Managing assets - adding a new one included - is limited to maintenance admins; anyone signed in can search and read the register. ARC still cannot delete an asset - a machine that has left the plant is set to Retired, because work orders and schedules point at the row. Department and Location are two different columns - Department is the one every maintenance report groups by - and both are picked from the lists a maintenance admin maintains at Maintenance - Departments & Locations. Current Machine Hours is the hourmeter reading a meter-based PM counts against, so an asset with no reading recorded is one whose meter PM can never come due; blank and zero are different answers.",
    render: () => (
      <>
        <P>
          The <strong>Altronic Equipment List</strong> is the plant's asset
          register — 378 machines — and it's what every work order and
          maintenance schedule hangs off. Click a machine's name anywhere it
          appears (a work order, a filter, the dashboard) to open its page.
        </P>
        <P>An asset page gives you the whole picture of one machine:</P>
        <UL>
          <LI>
            <strong>Nameplate</strong> — equipment type, department, location,
            criticality, serial number, manufacturer, model number, parent
            machine, install date and warranty expiry.
          </LI>
          <LI>
            <strong>Open work orders</strong> on it right now.
          </LI>
          <LI>
            <strong>Full history</strong> — everything ever done to it.
          </LI>
          <LI>
            <strong>Its maintenance schedules</strong>, and when each is next
            due.
          </LI>
          <LI>
            <strong>Manuals</strong> — the machine's manuals, wiring diagrams and
            nameplate photos, attached to the asset rather than to whichever work
            order last needed them.
          </LI>
        </UL>
        <H3>What you can change on the asset page</H3>
        <P>
          <strong>Asset Status</strong> (In Service / Down / Standby / Retired){" "}
          <strong>and Responsible Tech.</strong> Both save the moment you pick
          them. They're the edits a technician makes with the machine in front of
          them — marking it down, and moving who owns it.
        </P>
        <P>
          Everything else on the nameplate is edited on the{" "}
          <strong>asset register</strong> (below), which the page links to.
        </P>

        <H3>The asset register</H3>
        <P>
          <strong>Maintenance → Assets</strong> lists all 378 machines in one
          table you can search and filter — by name, asset tag, serial number,
          model, department, location, criticality, status or type. Anyone signed
          in can search and read it. <strong>Editing is limited to maintenance
          admins</strong>, because every work order and PM schedule points at
          these rows; if you don't have the level the controls are greyed out and
          the screen says what to ask for.
        </P>
        <P>
          The <strong>Edit</strong> button on a row opens the whole nameplate:
          name, asset tag, machine hours, status, criticality, department,
          location, responsible tech, manufacturer, model, serial number, install
          date, warranty expiry and description. Only the fields you actually
          changed are saved.
        </P>
        <P>
          <strong>Add asset</strong> at the top of the register adds a new row —
          limited to maintenance admins, same as every other write here. There's
          still no delete: an asset row exists because the plant bought a
          machine, and deleting one would orphan every work order and schedule
          pointing at it — so a machine that has left the plant gets{" "}
          <strong>Asset Status = Retired</strong> instead.
        </P>

        <H3>Needs attention — finding what's missing</H3>
        <P>
          Much of the register was imported and is only half filled in. The strip
          above the table counts what's missing across the whole register, and
          every count is a filter: press <strong>No department (190)</strong> and
          the table shows exactly those rows. <strong>Needs attention</strong>{" "}
          shows every incomplete row at once, and{" "}
          <strong>Most gaps first</strong> in the sort box floats them to the top.
          Each incomplete row also carries amber badges naming what it's missing.
        </P>
        <P>
          Retired assets are never counted — a machine that has left the plant
          doesn't need its meter read or its tag chased.
        </P>

        <H3>Machine hours</H3>
        <P>
          <strong>Current Machine Hours</strong> is the hourmeter reading. Click
          the figure in the table to type a new one — you don't need to open the
          edit form, because keeping it current matters more than anything else
          on the row: <strong>a meter-based PM counts against this number, so an
          asset whose reading never moves is one whose PM never comes due.</strong>
        </P>
        <P>
          Blank and zero are different answers. Blank means nobody has ever read
          the meter, and shows as <strong>Never recorded</strong>; zero is a real
          reading off a machine that has just been installed. The{" "}
          <strong>Updated</strong> column beside it is the date the asset row was
          last edited in any field — SharePoint doesn't record when an individual
          column changed, so it's the closest thing to "is this reading stale".
        </P>
        <Tip>
          <strong>Department</strong> and <strong>Location</strong> are two
          different columns. Location is where the machine physically sits;{" "}
          <strong>Department</strong> is the one every maintenance report groups
          by, so it's the one worth keeping filled in.
        </Tip>
      </>
    ),
  },
  {
    id: "maintenance-dashboard",
    title: "Maintenance Dashboard",
    group: "Operations",
    keywords: [
      "maintenance dashboard",
      "maintenance metrics",
      "maintenance kpi",
      "pm compliance",
      "planned vs unplanned",
      "planned work",
      "workload",
      "workload by technician",
      "backlog trend",
      "downtime by asset",
      "assets down",
      "open by status",
      "open by priority",
      "by department",
      "no department set",
      "reporting period",
    ],
    searchText:
      "The Maintenance Dashboard is the overview for the CMMS. Four headline figures - overdue work orders, PM compliance, planned work and assets down - sit above charts for open work orders by status and by priority, workload by technician, assets by department, open work by department, downtime by asset (top ten), backlog trend, and the assets currently down broken out by criticality. A reporting-period switch covers 30 days, 90 days and 12 months. PM compliance is the share of preventive occurrences due in the period that were completed inside their schedule's grace window; an occurrence still inside its grace window is not counted as a miss, a canceled one is not counted at all, and the figure reads as no PMs due rather than a confident 0 percent when nothing has a decided outcome. Every chart groups by Department, never by Location - and because Department is set on only 194 of the 378 assets, each department chart carries an explicit No department set bucket with its own count rather than quietly leaving half the plant out.",
    render: () => (
      <>
        <P>
          The <strong>Maintenance Dashboard</strong> is the overview for the
          whole module. Four headline figures —{" "}
          <strong>overdue work orders</strong>, <strong>PM compliance</strong>,{" "}
          <strong>planned work</strong> and <strong>assets down</strong> — sit
          above the charts:
        </P>
        <UL>
          <LI>
            <strong>Open work orders by status</strong> and{" "}
            <strong>by priority</strong>.
          </LI>
          <LI>
            <strong>Workload by technician</strong> — who's carrying what.
          </LI>
          <LI>
            <strong>Assets by department</strong> and{" "}
            <strong>open work by department</strong>.
          </LI>
          <LI>
            <strong>Downtime by asset</strong> — the worst ten, built from the
            Downtime Hours entered on work orders.
          </LI>
          <LI>
            <strong>Backlog trend</strong>, and{" "}
            <strong>assets currently down</strong> broken out by criticality, so
            a critical machine isn't buried among standard ones.
          </LI>
        </UL>
        <P>
          A <strong>reporting period</strong> switch covers{" "}
          <strong>30 days</strong>, <strong>90 days</strong> and{" "}
          <strong>12 months</strong>, and every figure on the page is measured at
          one instant, so the charts always agree with each other.
        </P>
        <H3>How PM compliance is counted</H3>
        <P>
          Of the preventive occurrences <strong>due in the period</strong>, the
          share completed <strong>inside their schedule's grace window</strong>.
          A job still inside its grace window isn't counted as a miss — its
          outcome isn't known yet — and a canceled occurrence isn't counted at
          all. When nothing in the period has a decided outcome the page says so
          rather than printing a confident 0% or 100%.
        </P>
        <H3>Everything groups by Department, and says what it left out</H3>
        <P>
          Every chart on this page groups by <strong>Department</strong>, never
          by Location. Department is set on only <strong>194 of the 378</strong>{" "}
          assets, so each department chart carries an explicit{" "}
          <strong>"No department set"</strong> bucket with its own count. A chart
          that quietly covered half the plant while looking complete would be
          worse than showing nothing at all — if that bucket is large, the fix is
          to fill Department in on those assets in SharePoint.
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
    id: "qc-time-tracking",
    title: "QC Time Tracking",
    group: "Panels",
    keywords: [
      "qc time",
      "qc time tracking",
      "hours",
      "performed by",
      "effort type",
      "panel qc",
      "sap number",
      "serial number",
    ],
    searchText:
      "QC Time Tracking is a simple log on the ALTRONICPANELTEAM SharePoint site of hours QC spent on each panel project — who did the work, when, and how long. Fields: Project, Week, Date into QC, Date Started, SAP#, Serial#, Performed By (one or more people), Hours (free text — some entries aren't a plain number), Effort Type (Repeat Panel, Support, New Panel, Project Work), and Notes. Reach it from the Departments dropdown's Panels group. Any signed-in user can add an entry with New Entry, or click a row to edit it in the same form. There is no delete, no comments, no watchers, and no admin gate on this list — correcting a mistake is an edit.",
    render: () => (
      <>
        <P>
          <strong>QC Time Tracking</strong> is a plain log of hours QC spent
          on a panel project — who did the work, when, and how long. Reach it
          from the <strong>Departments</strong> dropdown's Panels group.
        </P>
        <H3>Logging and editing an entry</H3>
        <P>
          Click <strong>New Entry</strong> to log one, or click any row to
          edit it in the same form. Only <strong>Project</strong> is
          required — the rest (Week, Date into QC, Date Started, SAP#,
          Serial#, Performed By, Hours, Effort Type, Notes) can be filled in
          as much or as little as you know at the time. <strong>Hours</strong>{" "}
          is a plain text field rather than a number, since not every entry
          is a clean figure. <strong>Performed By</strong> takes one or more
          people — pick everyone who worked on it.
        </P>
        <P>
          Any signed-in user can add or edit an entry. There's no delete, no
          comments, and no watchers on this list — it's a straightforward
          record, and a mistake is corrected with an edit.
        </P>
      </>
    ),
  },
  {
    id: "panel-qc-issue-tracker",
    title: "Panel QC Issue Tracker",
    group: "Panels",
    keywords: ["panel qc", "issue tracker", "defect", "production", "repair", "status", "watchers", "attachments", "comments"],
    searchText: "Panel QC Issue Tracker records panel and board defects from production through resolution. Fields are split into a Panel Department section and a Repair Department section. Defect categories come from a shared list and can be added while recording an issue. Issues have a Status, watchers, a comment thread with @-mentions, and file attachments.",
    render: () => (
      <>
        <P>
          <strong>Panel QC Issue Tracker</strong> is the Panels department's
          production defect log. It uses the
          <em>PANEL COMPONENT FAILURES</em> list on the ALTRONICPANELTEAM
          SharePoint site.
        </P>
        <P>
          The New Issue form only shows the <strong>Panel Department</strong>{" "}
          fields — Panel Serial Number, Panel Part Number, Date, Defect
          Category, Sub Component Part Number, Sub Component Serial Number,
          Part Description, Watchers, Failure Reported and Panels Resolution.
          Choose a defect category from the searchable picker; anyone signed
          in can add a new category to <em>PANEL COMPONENT DEFECTS</em>{" "}
          directly from the form and use it immediately. TAG Number is
          assigned automatically, and every new issue starts at{" "}
          <strong>Created</strong> status. Click New Issue to open the entry
          view, or click a row to open its edit view.
        </P>
        <P>
          The <strong>Repair Department</strong> section — Repair Technician,
          Repair Defect Category, Repair Issue Found, Repair Resolution —
          only appears once an issue exists, since it's filled in by the
          repair team after the panel department has raised the issue. The
          edit view's header shows the issue's current Status next to its TAG
          Number, and a Status picker sits beside Save Changes so it can be
          moved along its workflow (Created → Repair Received → Repair
          In-Process → Repair Hold/Repair Completed → Panels Completed) as
          part of the same save.
        </P>
        <P>
          Once an issue exists, its edit view also shows{" "}
          <strong>Watchers</strong>, a <strong>Communication</strong> comment
          thread, and an <strong>Attachments</strong> card — the same pattern
          used across ARC. On the New Issue form, files can be picked ahead of
          saving; they upload automatically once the issue is created. Click{" "}
          <strong>Watch</strong> to follow an issue, or @-mention someone in a
          comment to notify them by email and add them as a watcher
          automatically. The issue list's search box also matches the comment
          thread and watcher names, and shows a comment count and a paperclip
          icon for issues with attachments.
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
    id: "coil-defect-log",
    title: "Coil Defect Log (Coils)",
    group: "Coils",
    keywords: ["coils", "coil", "defect", "other fault", "qccoils"],
    searchText: "Coil Defect Log at /coils/defect-log, under Departments > Coils. Add or edit a coil part number, date, failed count, named defect counts and Other faults. Failed must equal every named defect count total. When Other is greater than zero, the Other faults table must total the Other count. CoilPN supplies part numbers and CoilOtherFaultList supplies Other defect types.",
    render: () => (
      <>
        <P>
          <strong>Departments → Coils → Coil Defect Log</strong> (<code>/coils/defect-log</code>) records coil failures and their defect breakdown.
        </P>
        <UL>
          <LI><strong>Add entry</strong> and the row pencil open the entry form. Pick a Coil Part Number, select the Date, and enter each named defect count.</LI>
          <LI><strong>Failed</strong> must equal the total of every named defect count before the entry can save.</LI>
          <LI>Enter <strong>Other</strong> to reveal the Other faults table. Pick each defect, enter its Count and Comments, and make those counts add up to Other.</LI>
          <LI><strong>Show all defects</strong> expands the desktop list, while phones show one compact card per record.</LI>
        </UL>
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
    id: "open-orders-report",
    title: "Open Orders Report Tool",
    group: "Customer Service / Sales",
    keywords: [
      "open orders",
      "open order report",
      "oor",
      "backlog",
      "past due",
      "aging",
      "customer workbook",
      "weekly report",
      "sap extract",
      "repairs",
      "zs1",
      "excel",
      "dashboard",
      "sales",
      "combine",
      "combined report",
      "two accounts",
      "download all",
      "zip",
      "mm/dd/yyyy",
      "date format",
    ],
    searchText:
      "Open Orders Report Tool at /sales/open-orders, under Departments > Customer Service / Sales. The screen opens on the files: the latest master dashboard, then this week's customer workbooks already expanded, with older weeks collapsed beneath. Download any of them straight from ARC, or press Download all above a week's file list to get every customer workbook for that week as one zip. Building the reports is behind a Build this week's reports button below the lists, because most people come here to download rather than to generate. A once-a-week job: export the open orders report out of SAP, upload the xlsx here, and ARC builds a branded master dashboard plus one workbook per customer on the managed report list. Files are written to SharePoint under General/Order Management/OPEN ORDERS on the ALTRONICSALESTEAM site — master dashboards at the top, customer workbooks in a folder per week called Week of YYYY-MM-DD (the Monday), and the raw extract filed in RAW UPLOADS. Download anything from the screen. Every workbook is a single sheet. The master carries every open line in whatever columns and order that week's raw SAP export used — a column SAP adds, drops, or renames week to week shows up (or drops out) the same way — so it can be read against the export side by side. Every date column in both the master/raw table and a customer workbook reads mm/dd/yyyy. Each customer workbook is the same single sheet of their own lines, with one difference: their standard orders are in one table and their repair orders in a separate table below it. Both are styled to the Altronic brand, with the official wordmark on the sheet: black and white, rows banded light grey and white like a table, and a past-due ship date shown in bold. Each customer workbook has a Summary tab and an Open Orders tab carrying their standard orders in one table and their repair orders in a separate table below it. Aging is measured on the Ship Date (our promise) against the run date, in buckets Past due, 0-30, 31-60, 61-90, 90+ and No promise date. Repair orders are identified by the order type or a repair order number, never by the description — a priced REPAIR KIT part is a normal parts order. Money is totalled per currency; no exchange rate is applied. The customer list is managed at /sales/open-orders/customers, where the customer name is the name the file is named after, Active takes somebody off the weekly run without deleting the row, and Import from an extract reads the accounts out of a raw export. If somebody is added after the week has already been built, Build report on their row produces just their workbook from the extract already filed in RAW UPLOADS, into the same week folder and against the same run date as the rest of that week's files, so there is no need to re-run everything. Combine… next to Build report on an active account lets you pick a second account and download one workbook covering both, each on its own tab — a direct download that is never filed in SharePoint and never merges the two accounts' figures. Any signed-in user can run the weekly job, edit the customer list and download the reports, but only an admin can add or remove a customer from the report list. The past-due figure on the reports counts standard orders only and says how many repair lines it excluded. Optional role gating exists (Admin > Open Orders Roles) but is switched off unless a roles list is configured. Re-running a week REPLACES that week's files.",
    render: () => (
      <>
        <P>
          <strong>Departments → Customer Service / Sales → Open Orders Report</strong>{" "}
          (<code>/sales/open-orders</code>) turns the raw SAP open-orders export
          into the reports the team actually sends out: one branded master
          dashboard, and one workbook per customer on the report list.
        </P>
        <P>
          <strong>The screen opens on the files.</strong> The latest master
          dashboard is at the top, this week's customer workbooks are listed
          below it already expanded, and older weeks are collapsed underneath.
          Everything has a <strong>Download</strong> button that saves the file
          straight to your computer. Building a new set is behind the{" "}
          <strong>Build this week's reports</strong> button below the lists —
          most people come here to take a file off the shelf, not to run the
          job.
        </P>
        <P>
          Need all of a week's customer workbooks at once — to file them, or
          send the whole batch on? Expand that week and press{" "}
          <strong>Download all</strong> above the file list to get every
          workbook in that folder as a single zip. Individual{" "}
          <strong>Download</strong> buttons stay on each file too, for the
          common case of sending one customer their own workbook.
        </P>
        <P>
          <strong>It is a once-a-week job, done by a person.</strong> ARC has no
          scheduler — nothing happens until somebody exports the report from SAP
          and uploads it here. The screen says so, and the run date you choose is
          what every aging figure is measured against, so re-running Monday's
          extract on Wednesday still produces Monday's numbers.
        </P>
        <H3>Running it</H3>
        <P>
          Press <strong>Build this week's reports</strong> to open the tool.
          Pick the <strong>run date</strong>, choose the <strong>xlsx</strong> you
          exported, and ARC reads it and shows you what it found — line count,
          how many customers are in the file, how many workbooks it will build,
          and the past-due value — before anything is written. Anything odd is
          listed too: a column ARC doesn't read, lines with no price, more than
          one currency, rows with no ship date.
        </P>
        <P>
          Press <strong>Build</strong>, confirm, and the files go to SharePoint
          under{" "}
          <code>General/Order Management/OPEN ORDERS</code> — the master at the
          top, the customer workbooks in{" "}
          <strong>Week of &lt;Monday&gt;</strong>, and a copy of the extract in{" "}
          <strong>RAW UPLOADS</strong>. Running the same week again{" "}
          <strong>replaces</strong> that week's files rather than piling up a
          second copy, because two workbooks for one customer and one week is
          worse than one that was refreshed.
        </P>
        <P>
          When the run finishes the tool closes itself and the lists refresh, so
          what you're left looking at is the week you just built.
        </P>
        <H3>What's in the reports</H3>
        <P>
          The <strong>master workbook</strong> is one consolidated sheet: every
          open line, in <strong>whatever columns and order that week's raw SAP
          export used</strong>, so you can read the two side by side — a
          column SAP adds, drops, or renames week to week shows up (or drops
          out) here the same way. It's filterable, the header row is frozen,
          and the columns that are worth totalling are totalled at the bottom.
        </P>
        <P>
          Each <strong>customer workbook</strong> is the same single sheet, of
          their lines only, with one difference: their standard orders are in
          one table and their{" "}
          <strong>repair orders in a separate table below it</strong>, each with
          its own totals. Their headline figures — open lines, open value, how
          much is past due — sit on one line under the title. Every column from
          the extract is included, comments as well.
        </P>
        <P>
          Both carry the <strong>Altronic wordmark</strong> and are styled to
          the brand: black and white, rows banded light grey and white like a
          table, and a <strong>past-due ship date shown in bold</strong> rather
          than by colouring the row.
        </P>
        <P>
          <strong>Aging runs on the Ship Date</strong> — our promise — against
          the run date: Past due, 0–30, 31–60, 61–90, 90+, and a bucket of its
          own for anything with no ship date at all. Past-due rows are tinted
          and their date shown in red. Repair orders are usually unpriced in the
          extract, so they add nothing to open value and the sheets say so
          rather than showing a table of zeros. Where an extract carries more
          than one currency, values are totalled per currency — no exchange rate
          is applied.
        </P>
        <H3>The customer list</H3>
        <P>
          <strong>Customer list</strong> (<code>/sales/open-orders/customers</code>)
          is who gets their own workbook. The{" "}
          <strong>customer name here is what the file is named after</strong> —
          SAP truncates its own at 30 characters, so this is the spelling
          customers see. Set a customer to{" "}
          <strong>not active</strong> to take them off the weekly run without
          losing the row, and use{" "}
          <strong>Import from an extract</strong> to pull the accounts out of a
          raw export rather than typing them in.
        </P>
        <P>
          Added somebody <strong>after</strong> the week was built?{" "}
          <strong>Build report</strong> on their row makes just their workbook,
          from the extract already filed in RAW UPLOADS, into the same week
          folder and against the same run date as everyone else's — so it sits
          alongside the rest of that week rather than being dated today.
        </P>
        <P>
          One recipient holding <strong>two sold-to numbers</strong> for what's
          really one customer? Press <strong>Combine…</strong> next to an
          active account's Build report button, pick the second account, and
          Download combined report builds one workbook with each account on
          its own tab — from the same extract already in SharePoint. This is a{" "}
          <strong>direct download only</strong>: nothing is filed in
          SharePoint, it doesn't touch either account's Active history, and
          the two accounts' figures stay on separate tabs rather than being
          added together.
        </P>
        <P>
          <strong>Only an admin can add or remove a customer</strong> from the
          report list — that decides who receives an external report each week.
          Everyone else can still edit anyone already on it, including setting
          them to <strong>not active</strong>, which takes them off the weekly
          run without removing the row.
        </P>
        <P>
          The <strong>past-due figure</strong> on the reports counts standard
          orders only, and says how many repair lines it left out. Repairs are
          unpriced and on their own workflow, so counting them made the headline
          read far worse than the parts backlog actually is — the late repair
          lines are still there in the table.
        </P>
        <P>
          <strong>Any signed-in user</strong> can run the weekly job, change the
          customer list and download the reports — the same as Visit Reports.
          Optional role gating exists behind{" "}
          <strong>Admin → Open Orders Roles</strong> and can be switched on later
          if the weekly run needs restricting to named people.
        </P>
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
      "calendar",
      "month view",
      "visit calendar",
      "schedule",
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
      "Visit Reports at /sales/visit-reports, under Departments > Customer Service / Sales, backed by the Visit Reports list on the ALTRONICSALESTEAM SharePoint site. A regional manager's record of a customer visit: Customer Name, RM Name, Reason For Visit (Home Office, General Visit, Site Visit, Sales Call, Training), Visit Date, Customer Status (Satisfied, Needs Attention, Issue, Quote Request, Potential New Customer, N/A), Visit Summary, Action Items, Product(s), City and State. Six of those are required: Customer Name, RM Name, Reason, Visit Date, Customer Status and Visit Summary. File one with New Visit Report; everything edits in place on the detail page, or use Edit for a bulk rewrite. Attachments — photos, quotes — can be added once the report is saved, by dragging them onto the Attachments card. The list filters by RM Name, Year, Reason and Customer Status, with an all-fields search, and the filters live in the URL so a filtered view can be shared. There is also a month Calendar view (List / Calendar buttons under the top nav) showing each visit on its day: click a day to file a visit for that date, click a visit to open it, arrows and Today move between months, and the filters carry across. The calendar is desktop and large-tablet only — on a phone the button is hidden and the URL opens the list. Reports cannot be deleted from ARC. Any signed-in user can file and edit.",
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
        <H3>The calendar</H3>
        <P>
          A <strong>Calendar</strong> button sits next to <strong>List</strong>{" "}
          under the top nav. It lays the month out as a grid with each visit on
          its day, which is the quick way to see what the team did in a month —
          and where the gaps are.
        </P>
        <UL>
          <LI>
            <strong>Click any day to file a visit for it</strong> — the form
            opens with that date already set.
          </LI>
          <LI>
            <strong>Click a visit</strong> to open the report.
          </LI>
          <LI>
            The arrows move a month at a time and <strong>Today</strong> jumps
            back; the coloured dot on each visit is its Customer Status.
          </LI>
          <LI>
            The filters work exactly as they do on the list, and they travel
            with you when you switch between the two views.
          </LI>
        </UL>
        <Tip>
          The calendar is a <strong>desktop and large-tablet</strong> view. Seven
          columns of visits can't be read on a phone, so the button is hidden
          there and a calendar link opens the list instead.
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
    id: "crm",
    title: "CRM Tool",
    group: "Customer Service / Sales",
    keywords: [
      "crm",
      "customer notes",
      "customers",
      "customer contacts",
      "contacts",
      "special pricing",
      "pricing",
      "capacity",
      "csr",
      "kam",
      "customer group",
      "customer type",
      "general notes",
      "compliance notes",
      "sap customer number",
    ],
    searchText:
      "The CRM Tool at /sales/customers, under Departments > Customer Service / Sales, backed by four lists on the salesOrderEntry SharePoint site: Customer Notes, Customer Contacts, Special Pricing and Capacity. Customer Notes is the anchor — open a customer to see their contacts, special pricing and capacity commitments; the other three lists have no screens of their own. A customer carries a name, SAP Customer Number, Old Customer Number, Group (a single choice — Arrow, CAT, CES, Cummins, Jenbacher, Other, Palmero, Perkins, Rolls-Royce, Wartsila, Waukesha), Customer Type (a multi-choice — OEM, AM, IC, Packager, GTI, Panels), a CSR (can be several people) and a KAM (one person), plus General Notes and Compliance Notes. The customer list searches by name and SAP number and filters by Group. Comments on a customer reach only whoever you @-mention — there are no watchers on this list, and no submitter either, so a comment with no mention notifies nobody. Any signed-in user can add, edit or remove a customer, a contact, a pricing entry or a capacity entry.",
    render: () => (
      <>
        <P>
          <strong>Departments → Customer Service / Sales → Customers</strong>{" "}
          (<code>/sales/customers</code>) is the CRM tool — one place to look
          up a customer and see everything Sales tracks about them: contacts,
          special pricing and capacity commitments, all in one page. The{" "}
          <strong>Customers</strong> card on the Dashboard opens here too —
          it describes the tool rather than showing a count, since a
          customer isn't "assigned" the way a task is.
        </P>
        <H3>Customer Notes — the anchor</H3>
        <P>
          The customer list searches by <strong>name or SAP number</strong>{" "}
          and filters by <strong>Group</strong>. Opening a customer shows:
        </P>
        <UL>
          <LI>
            <strong>General Notes</strong> and <strong>Compliance Notes</strong>{" "}
            — each has its own Edit button.
          </LI>
          <LI>
            <strong>Group</strong> (a single choice) and{" "}
            <strong>Customer Type</strong> (pick several) in the sidebar —
            both save the moment you change them.
          </LI>
          <LI>
            <strong>CSR</strong> (can be more than one person) and{" "}
            <strong>KAM</strong> (one person) — also save immediately, the
            same as a task's Assigned field.
          </LI>
        </UL>
        <H3>Contacts, Special Pricing and Capacity</H3>
        <P>
          Three sections further down the page, each scoped to the customer
          you're looking at, each with its own <strong>Add</strong> button:
        </P>
        <UL>
          <LI>
            <strong>Contacts</strong> — a person at the customer: name, email,
            phone, job title and notes.
          </LI>
          <LI>
            <strong>Special Pricing</strong> — a pricing note or agreement,
            with an AI Part Number.
          </LI>
          <LI>
            <strong>Capacity</strong> — a per-part weekly production capacity
            commitment, with the customer's own part number alongside it.
          </LI>
        </UL>
        <P>
          Clicking any row in these three sections reopens the same form for
          editing, with a <strong>Remove</strong> button on it.
        </P>
        <Tip>
          Unlike most comment threads in ARC, a comment on a customer reaches{" "}
          <strong>only the people you @-mention</strong> — there's no Watchers
          column on this list, and no "submitter" the way an EIR or an ECN
          has one. There is no Watch button here either: a comment that
          mentions nobody notifies nobody, so mention the people who need to
          see it, every time.
        </Tip>
      </>
    ),
  },
  {
    id: "faits",
    title: "FAITs",
    group: "Supply Chain",
    keywords: [
      "fait", "faits", "first article", "first article inspection",
      "inspection", "supplier", "sqe", "sign off", "quality",
      "cmm", "dimensional check", "first pass", "fait alerts",
      "fait notifications", "intake alert", "assign engineer",
      "assigned engineer", "kam", "kam sign off", "hide kam",
      "fait closed alert", "fait status", "change fait status",
      "fait initiator", "fait sidebar", "fait dates",
      "fait sign off", "sign-off chain", "sqe sign off", "eng sign off",
      "kam sign off", "sqe reviewers", "sqe failed", "this is with sqe",
      "this is with eng", "this is with kam", "auto advance status",
    ],
    searchText:
      "FAITs at /supply-chain/faits, under Supply Chain in the Departments menu, backed by the FAIT list on the Altronic Engineering SharePoint site. A First Article Inspection Test tracks a new or changed part from a supplier through inspection and three sign-offs: SQE, Engineering and KAM. The list opens on Open FAITs with pills for Open / Closed / All, filters for project, supplier and the stage it is sitting at, and an all-fields search. FAITs are identified by SAP Part Number rather than title. New FAIT asks for the part, supplier, project and what is being requested; inspection results and sign-offs are filled in on the FAIT itself, in five cards - Part, Request, Inspection, Results, Sign-off - each with one Edit button. Yes/No questions are answered by picking Yes or No. The sidebar steers the FAIT in two groups: Workflow (Status picker, sign-off chips, Project picker) and People (initiator, Assigned Engineer, KAM, watchers). Every sidebar control saves the moment it changes - no Save button, no modal. Status moves a FAIT along its workflow: Open, FAIT Part Received, with SQE, with Engineering, with the KAM, Closed. The Assigned Engineer and KAM are pickers - pick a person and they are saved immediately and added as a watcher; clearing one back to Not set does not remove them as a watcher. Initiator is filled in for you with whoever raised the FAIT and is not a picker. Failed First Pass Date and Waived Date are picked from a calendar. A change that cannot be saved says so and the old value comes back; a change that saved but could not be re-read says so and is left where you put it. A FAIT that does not need a KAM sign-off can simply have no KAM assigned - the KAM sign-off chip and fields hide themselves until a KAM is picked. FAITs carry comments with @-mentions, watchers and attachments. Whoever raises one watches it. Raising a FAIT emails Jerrod Waldron, Alexandra Russell and Katie Fleming with the part details; the raiser is left off their own alert. Changing a FAIT's Status emails its watchers and its initiator, engineer and KAM. Closing a FAIT emails everyone watching it plus that same intake list, de-duplicated so nobody gets two. The three sign-offs run as a chain: assigning an engineer or a KAM emails them a heads-up that says no action is required yet; moving a FAIT to This is with SQE emails the configured SQE reviewers (default Jerrod Waldron) asking for the SQE sign-off; approving the SQE sign-off emails the assigned engineer and moves the Status to This is with ENG; approving the Eng sign-off emails the KAM and moves the Status to This is with KAM, but only when a KAM sign-off is needed - with no KAM the chain finishes at the engineer and the FAIT is ready to close. An SQE sign-off set to Failed sends the FAIT back to whoever raised it and does not advance the status. The status moves itself as the sign-offs land; a Status you pick yourself in the same edit wins, re-saving a recorded sign-off asks nobody twice, and editing the sign-offs on a closed FAIT never reopens it. FAITs cannot be deleted from ARC.",
    render: () => (
      <>
        <P>
          <strong>Departments → Supply Chain → FAITs</strong>{" "}
          (<code>/supply-chain/faits</code>) tracks a{" "}
          <strong>First Article Inspection Test</strong> — a new or changed part
          arriving from a supplier, inspected and then signed off by SQE,
          Engineering and the KAM.
        </P>
        <UL>
          <LI>
            The list opens on <strong>Open</strong> FAITs. Filter by project,
            supplier, or the stage it's sitting at, and search across every
            field. The filters live in the address bar, so a filtered view can
            be shared.
          </LI>
          <LI>
            FAITs are identified by <strong>SAP Part Number</strong>, not a
            title — that's how the list has always been kept.
          </LI>
          <LI>
            <strong>New FAIT</strong> asks only for the part, the supplier, the
            project and what's being requested.
          </LI>
        </UL>
        <H3>Working one through</H3>
        <P>
          The FAIT itself is five cards — <strong>Part</strong>,{" "}
          <strong>Request</strong>, <strong>Inspection</strong>,{" "}
          <strong>Results</strong>, <strong>Sign-off</strong> — each with one{" "}
          <strong>Edit</strong> button. Press it, change what you need, and
          Save changes; only the fields you touched are written, so quality,
          engineering and the KAM can each fill in their own part without
          overwriting each other.
        </P>
        <P>
          The sidebar is where a FAIT is <em>steered</em>, in two groups.{" "}
          <strong>Workflow</strong> holds the <strong>Status</strong> picker,
          the three sign-off chips and the <strong>Project</strong> picker;{" "}
          <strong>People</strong> holds the initiator, the{" "}
          <strong>Assigned Engineer</strong>, the <strong>KAM</strong> and the
          watchers. Every control there saves the moment you change it — there
          is no Save button and no modal.
        </P>
        <P>
          <strong>Status</strong> moves a FAIT along its own workflow: Open,
          FAIT Part Received, with SQE, with Engineering, with the KAM, Closed.
          Pick the new one and it's written straight away, and everyone
          watching plus the initiator, engineer and KAM are emailed that it
          changed.
        </P>
        <P>
          <strong>Assigned Engineer</strong> and <strong>KAM</strong> are
          pickers in the same sidebar — pick a person and it saves immediately
          and adds them as a watcher, so they hear about comments and status
          changes without anyone having to remember to add them. Clearing one
          back to <strong>Not set</strong> doesn't remove them as a watcher.
        </P>
        <P>
          <strong>Initiator</strong> is filled in for you: it's whoever raised
          the FAIT, and it isn't a picker. Comments, watchers and attachments
          work as they do everywhere else in ARC, and whoever raises a FAIT
          watches it.
        </P>
        <P>
          <strong>Failed First Pass Date</strong> and{" "}
          <strong>Waived Date</strong> are picked from a calendar on the{" "}
          <strong>Results</strong> card, like every other date in ARC.
        </P>
        <Tip>
          If a change can't be saved, ARC says so and puts the old value back.
          The one case that reads differently is a change that <em>did</em>{" "}
          save but couldn't be re-read afterwards — that message says the
          change was saved and asks you to refresh, and the value is left where
          you put it.
        </Tip>
        <Tip>
          A FAIT that doesn't need a KAM sign-off doesn't need anything special
          done to it — just leave <strong>KAM</strong> set to Not set. The KAM
          sign-off chip in the sidebar and the KAM fields on the{" "}
          <strong>Sign-off</strong> card hide themselves whenever there's no
          KAM assigned and no KAM sign-off already recorded. Assigning a KAM
          later brings those fields straight back.
        </Tip>
        <P>
          <strong>Raising a FAIT emails Jerrod Waldron, Alexandra Russell and
          Katie Fleming</strong> — the intake list who pick a new one up —
          with the SAP Part Number, description, supplier and drawing number;
          the person who raised it is left off their own alert, and being on
          that list is not the same as watching the FAIT. Changing a FAIT's{" "}
          <strong>Status</strong> emails its watchers and the people it's
          assigned to (initiator, engineer, KAM) that it changed, and{" "}
          <strong>closing a FAIT also emails that same intake list</strong> —
          the people who were told a new one needed picking up also hear when
          it's finished.
        </P>
        <H3>The sign-off chain</H3>
        <P>
          The three sign-offs run in order — <strong>SQE</strong>, then{" "}
          <strong>Engineering</strong>, then the <strong>KAM</strong> — and
          each one tells the next person it's their turn, so nobody has to
          watch for it.
        </P>
        <UL>
          <LI>
            <strong>Assigning an engineer or a KAM emails them a
            heads-up</strong> that they're on the FAIT, saying plainly that{" "}
            <em>no action is required yet</em>. They're asked for something
            only when the sign-offs reach their stage.
          </LI>
          <LI>
            Moving a FAIT to <strong>This is with SQE</strong> emails the SQE
            reviewers (default Jerrod Waldron) asking for the SQE sign-off.
          </LI>
          <LI>
            Setting <strong>SQE Sign Off</strong> to Approved emails the{" "}
            <strong>assigned engineer</strong> to review it, and moves the
            Status to <strong>This is with ENG</strong> for you.
          </LI>
          <LI>
            Setting <strong>Eng Sign Off</strong> to Approved emails the{" "}
            <strong>KAM</strong> and moves the Status to{" "}
            <strong>This is with KAM</strong> — but only when a KAM sign-off
            is actually needed. With no KAM on the FAIT the chain finishes at
            the engineer and it's ready to close.
          </LI>
          <LI>
            Setting <strong>SQE Sign Off</strong> to <strong>Failed</strong>{" "}
            sends the FAIT back: the Status doesn't advance, the engineer
            isn't asked for anything, and whoever raised it is emailed. Put
            the reason in <strong>SQE Approval Notes</strong>.
          </LI>
          <LI>
            <strong>Closing</strong> a FAIT emails everyone watching it, plus
            the intake list who were told it needed picking up. Nobody on both
            lists gets two emails.
          </LI>
        </UL>
        <Tip>
          The status moves itself as the sign-offs land, so you don't have to
          set it by hand — and re-saving a sign-off that's already recorded
          asks nobody twice. If you do pick a Status yourself in the same
          edit, yours wins. Editing the sign-offs on a closed FAIT never
          reopens it.
        </Tip>
        <Tip>
          FAITs can't be deleted from ARC — a FAIT records an inspection that
          happened. Close it instead.
        </Tip>
      </>
    ),
  },
  {
    id: "gray-market-requests",
    title: "Gray Market Requests",
    group: "Supply Chain",
    keywords: [
      "gray market",
      "grey market",
      "gray market request",
      "gmr",
      "broker",
      "outside distribution",
      "counterfeit",
      "inspection flag",
      "supply chain",
      "vendor",
      "po",
      "purchase order",
      "qty purchased",
      "insp lot",
      "in circuit",
      "final assembly",
      "sign-off",
    ],
    searchText:
      "Gray Market Requests at /supply-chain/gray-market-requests, under Supply Chain in the Departments menu, backed by the Gray Market Request list on the Altronic_PMO SharePoint site. A gray market request tracks a part bought outside normal distribution from the request through purchasing, engineering test, inspection and production sign-off. The list opens on Open requests with pills for Open / Complete / All, filters for Requestor and Testing Required, and an all-fields search. New Request asks only for the Title (the Altronic assembly number), request date and the purchasing details; the Log No. is generated as GMR_YYYY-###. Testing Required is on the form but optional — that call is made later in the workflow, so it can be left Not set and answered on the request once it is decided. Everything else is filled in on the request itself, in five cards — Request, Purchasing, Engineering, Inspection, Production — each card with one Edit button in its header that opens a box holding that stage's fields; Save changes writes only the fields you touched. Requests carry comments with @-mentions, watchers, and attachments. Whoever raises a request watches it. Raising a request emails Katie Fleming, Alexandra Russell and Glenn Terry — the intake list who pick a new request up — with the assembly number, vendor and PO details; the person who raised it is left off their own alert, and being on that list is not the same as watching the request. Requests cannot be deleted from ARC.",
    render: () => (
      <>
        <P>
          <strong>Departments → Supply Chain → Gray Market Requests</strong>{" "}
          (<code>/supply-chain/gray-market-requests</code>) tracks a part bought{" "}
          <em>outside normal distribution</em> — from the request, through
          purchasing, engineering test, inspection, and production sign-off.
        </P>
        <P>
          Engineering has its part in the same record — the testing and
          sign-off fields on each request — but the feature itself lives under
          Supply Chain.
        </P>
        <H3>Raising a request</H3>
        <P>
          <strong>New Request</strong> asks only for what's known at the start:
          the <strong>Title</strong> (the Altronic assembly number), the{" "}
          <strong>request date</strong>, and the purchasing details — vendor,
          quantity, PO number, part numbers. The <strong>Log No.</strong>{" "}
          (<code>GMR_2026-004</code>) is assigned on save; you never type it.
        </P>
        <P>
          <strong>Testing Required</strong> is on the form but optional — that
          call is made later in the workflow, so leave it on{" "}
          <strong>Not set</strong> and answer it on the request itself once it's
          decided.
        </P>
        <P>
          You're recorded as the requestor and start watching it, so you hear
          about every comment and change from then on.
        </P>
        <P>
          Raising a request also emails <strong>Katie Fleming</strong>,{" "}
          <strong>Alexandra Russell</strong> and <strong>Glenn Terry</strong> —
          the people who pick a new request up — with the assembly number,
          vendor and PO details you filled in. You aren't emailed about your own
          request. Being on that list isn't the same as watching: they press{" "}
          <strong>Watch</strong> on a request to follow its comments and
          changes.
        </P>
        <H3>Working a request</H3>
        <P>
          The request page is the workflow, one card per stage —{" "}
          <strong>Request</strong>, <strong>Purchasing</strong>,{" "}
          <strong>Engineering</strong>, <strong>Inspection</strong>,{" "}
          <strong>Production</strong>. Each card has one{" "}
          <strong>Edit</strong> button in its header: press it and a box opens
          with that stage's fields, change what you need, then{" "}
          <strong>Save changes</strong>. Only the fields you actually touched
          are written, so four teams can fill in their parts without waiting
          for each other or overwriting each other's columns.
        </P>
        <UL>
          <LI>
            <strong>Request Status</strong>, <strong>Testing Required</strong>{" "}
            and the two dates live in the sidebar, along with the watchers.
          </LI>
          <LI>
            <strong>Comments</strong> work exactly as they do on a task or an
            EIR: @-mention someone and they're emailed and added as a watcher.
          </LI>
          <LI>
            <strong>Attachments</strong> — supplier paperwork, photos of the
            part, test results — drag onto the card, paste a screenshot, or use
            Add file.
          </LI>
        </UL>
        <Tip>
          There is no Delete. A request records a part that was actually
          bought, so correcting one is an edit; removing one has to be done
          deliberately in SharePoint.
        </Tip>
        <H3>Finding a request</H3>
        <P>
          The list opens on <strong>Open</strong> — the pills switch to{" "}
          <strong>Complete</strong> or <strong>All</strong>, and each carries
          its count. Filter by <strong>Requestor</strong> or{" "}
          <strong>Testing Required</strong>, and the search box matches every
          field, so a part number, a PO or a vendor all find the request.
        </P>
      </>
    ),
  },
  {
    id: "srm",
    title: "SRM Tool",
    group: "Supply Chain",
    keywords: [
      "srm",
      "suppliers",
      "supplier",
      "supplier list",
      "supplier contacts",
      "supplier contact list",
      "supplier issue",
      "supplier issue tracker",
      "supplier issue tracking",
      "core competency",
      "assigned buyer",
      "point of contact",
      "business partner number",
      "bp number",
      "supplier score",
      "supplier performance",
      "supplier logo",
      "logo",
      "company logo",
      "supplier onboarding",
      "medius",
      "sap onboarding",
    ],
    searchText:
      "The SRM Tool at /supply-chain/suppliers, under Departments > Supply Chain, backed by three lists on the Altronic_PMO SharePoint site: Suppliers List, Supplier Contact List and Supplier Issue Tracker. Suppliers List is the anchor — open a supplier to see their contacts and open issues; the other two lists have no screens of their own. A Supplier Onboarding link next to New Supplier opens Medius, Cooper's supplier-onboarding tool for SAP, in a new tab — a plain link today, with no automatic sync back into this list yet. A supplier carries a Company Name, Business Partner Number, Address, Website, Status (Active, Phase Out, Archive, Indirect), Core Competency (a multi-choice of ~59 material/part categories), an Assigned Buyer, a Point of Contact, Watchers, Notes, Supplier Score, three performance percentages, and a Logo image when one is on file — Change and Remove links on the detail page let anyone add, swap or remove a supplier's logo (an image under 5MB) without going to SharePoint. The supplier list searches by company name and BP number and filters by Status and Core Competency; each row shows the supplier's logo when it has one. Contacts and Issues each expand into a card on the supplier's page with their own fields, comments, watchers and attachments — the same expandable-card pattern Build Request parts use. Supplier Contacts have no delete on Suppliers or Issues — a supplier is the anchor other records point at, and an issue is closed by resolving it, not removing it; contacts can be removed. Any signed-in user can add, edit, comment on and watch a supplier, a contact or an issue.",
    render: () => (
      <>
        <P>
          <strong>Departments → Supply Chain → Suppliers</strong>{" "}
          (<code>/supply-chain/suppliers</code>) is the SRM tool — one place
          to look up a supplier and see everyone and everything tied to them:
          contacts and open issues, all in one page.
        </P>
        <P>
          <strong>Supplier Onboarding</strong>, next to New Supplier, opens{" "}
          <strong>Medius</strong> — Cooper's supplier-onboarding tool for
          SAP — in a new tab. It's a plain link; signing a new supplier up in
          Medius doesn't (yet) create anything here automatically.
        </P>
        <H3>Suppliers List — the anchor</H3>
        <P>
          The supplier list searches by <strong>company name or BP
          number</strong> and filters by <strong>Status</strong> and{" "}
          <strong>Core Competency</strong>. A row shows the supplier's{" "}
          <strong>logo</strong> when one is on file, and the detail page
          shows it again, larger, next to the name — with{" "}
          <strong>Change</strong> and <strong>Remove</strong> links beneath
          it there, so a logo can be added or swapped without going to
          SharePoint. Pick an image under 5MB; the old one is replaced, not
          kept alongside it. Opening a supplier shows:
        </P>
        <UL>
          <LI>
            <strong>Notes</strong> — its own Edit button.
          </LI>
          <LI>
            <strong>Status</strong> and <strong>Core Competency</strong> in
            the sidebar — save the moment you change them.
          </LI>
          <LI>
            <strong>Assigned Buyer</strong>, <strong>Point of Contact</strong>{" "}
            and <strong>Watchers</strong> — also save immediately.
          </LI>
          <LI>
            Three <strong>performance</strong> figures, when the supplier has
            them: overall, quality and logistical.
          </LI>
        </UL>
        <H3>Contacts and Issues</H3>
        <P>
          Two sections further down the page, each scoped to the supplier
          you're looking at:
        </P>
        <UL>
          <LI>
            <strong>Contacts</strong> — a person at the supplier: name,
            email, phone, status and notes.
          </LI>
          <LI>
            <strong>Issues</strong> — a quality or delivery problem, with a
            description, status, severity and a resolution.
          </LI>
        </UL>
        <P>
          Press <strong>Add</strong> to create either, then click any row to
          expand it into its own card — every field edits in place, and each
          card has its own <strong>Watchers</strong>, its own{" "}
          <strong>Attachments</strong>, and its own comment thread, exactly
          like a part on a Build Request. A contact card has a{" "}
          <strong>Remove</strong> button; an issue card doesn't — an issue is
          closed by resolving it, not deleting it.
        </P>
        <Tip>
          <strong>Status</strong> and <strong>Severity</strong> on an issue
          currently only offer placeholder options ("Choice 1", "Choice 2",
          "Choice 3") — Supply Chain hasn't set real values in SharePoint
          yet. The picker will show whatever the list offers once that's
          done.
        </Tip>
        <P>
          Comments on a supplier, a contact or an issue work exactly like a
          task or an EIR: @-mention someone and they're emailed and added as
          a watcher, and every watcher hears about every new comment.
        </P>
      </>
    ),
  },
  {
    id: "cost-impact-notices",
    title: "Cost Impact Notices",
    group: "Supply Chain",
    keywords: [
      "cost impact",
      "cost impact notice",
      "cost impact portal",
      "cost increase",
      "cost decrease",
      "delta cost",
      "original cost",
      "new cost",
      "time of impact",
      "where used",
      "price increase",
    ],
    searchText:
      "Cost Impact Notices at /supply-chain/cost-impact-notices, under Supply Chain in the Departments menu, backed by the Cost Impact Portal list on the ALTRONICSALESTEAM SharePoint site. Supply Chain raises a notice to tell Sales, Engineering and Purchasing that a purchased part's cost has changed - the original cost, the new cost, the delta SharePoint calculates automatically, and how soon the change bites (Immediate, Near Future under 6 months, or Future 6+ months). New notice asks for the part, the original and new cost, time of impact and where the part is used; supplier, SAP number, old part number, MPN, EAU and BP reference are optional. The notice itself is four cards - Part, Cost and Impact, Where Used, Notes - each with one Edit button. Raising a notice emails a fixed list - Keith Brooks, Ray White, David Bell, Matthew Traina, Mark Balent and Katie Fleming by default - so somebody always hears about a cost change the moment it is raised. Comments reach only the person who raised the notice and anyone you @-mention - this list has no watchers. Cost impact notices cannot be deleted from ARC.",
    render: () => (
      <>
        <P>
          <strong>Departments → Supply Chain → Cost Impact Notices</strong>{" "}
          (<code>/supply-chain/cost-impact-notices</code>) is how Supply Chain
          tells Sales, Engineering and Purchasing that a purchased part's cost
          has changed — the original price, the new price, the delta, and how
          soon it bites.
        </P>
        <UL>
          <LI>
            The list searches by part, supplier or SAP number, and filters by{" "}
            <strong>Time of Impact</strong>.
          </LI>
          <LI>
            <strong>Delta Cost</strong> is calculated automatically — you never
            type it. It shows as a chip: red for an increase, green for a
            decrease.
          </LI>
          <LI>
            <strong>New notice</strong> asks for the part, the original and
            new cost, time of impact, and where the part is used — the four
            SharePoint requires. Supplier, SAP number, old part number, MPN,
            EAU and BP reference can be filled in later.
          </LI>
        </UL>
        <H3>Working one through</H3>
        <P>
          A notice is four cards — <strong>Part</strong>,{" "}
          <strong>Cost &amp; Impact</strong>, <strong>Where Used</strong> and{" "}
          <strong>Notes</strong> — each with one <strong>Edit</strong> button.
          Only the fields you touch are saved.
        </P>
        <P>
          <strong>Raising a notice emails a fixed list</strong> — Keith
          Brooks, Ray White, David Bell, Matthew Traina, Mark Balent and Katie
          Fleming by default — so somebody always hears about a cost change
          the moment it's raised. Being on that list isn't the same as
          watching the notice.
        </P>
        <Tip>
          Unlike most comment threads in ARC, a comment here reaches{" "}
          <strong>only the person who raised the notice and anyone you
          @-mention</strong> — there's no Watchers column on this list, the
          same rule ECNs use.
        </Tip>
        <Tip>
          Cost impact notices can't be deleted from ARC — a notice records a
          cost change and who was told about it. A superseded one is a new
          notice, not a correction to the old one.
        </Tip>
      </>
    ),
  },
  {
    id: "where-am-i",
    title: "Where Am I?",
    group: "Engineering",
    keywords: [
      "where am i",
      "out of office",
      "ooo",
      "vacation",
      "pto",
      "holiday",
      "in the field",
      "away",
      "calendar",
      "who is out",
      "team calendar",
      "absence",
    ],
    searchText:
      "Where Am I? at /engineering/where-am-i, under Engineering — the team's out-of-office calendar, backed by the Where am I? list on the Altronic Engineering SharePoint site. Each entry is a line of text and a day: who you are and what you're doing (\"Sarah - half day vacation\"). On a computer it's a month grid: click a day to add yourself, click an entry to edit or remove it, arrows and Today move between months. On a phone the grid is replaced by an upcoming agenda grouped by day — Today, Tomorrow, then dates — because seven columns can't be read at phone width. Adding lets you set a Through date, which creates one entry per day (the list stores a single date per row), capped at 60 days. Anyone signed in can add, edit and remove entries, including other people's. The search box matches names and reasons.",
    render: () => (
      <>
        <P>
          <strong>Departments → Engineering → Where Am I?</strong>{" "}
          (<code>/engineering/where-am-i</code>) is the team's out-of-office
          calendar — who's away, who's in the field, and when. It reads and
          writes the same SharePoint list the team already uses, so an entry
          added here shows up there and the other way round.
        </P>
        <P>
          An entry is a <strong>line of text and a day</strong>. Put your name
          in the text, because that's all anyone sees:{" "}
          <em>"Sarah — half day vacation"</em>, <em>"GaryK — Keystone AM"</em>.
        </P>
        <H3>On a computer</H3>
        <UL>
          <LI>
            <strong>Click any day</strong> to add yourself to it — the date is
            filled in for you.
          </LI>
          <LI>
            <strong>Click an entry</strong> to change the wording or the date,
            or to remove it. Plans change; this calendar lets you take things
            off it.
          </LI>
          <LI>
            The arrows move a month at a time, and <strong>Today</strong> jumps
            back.
          </LI>
        </UL>
        <H3>Away for more than a day</H3>
        <P>
          The list stores <strong>one date per entry</strong>, so a week away is
          five entries. Rather than adding them one at a time, set a{" "}
          <strong>Through</strong> date when adding and the form creates one
          entry per day for you — it tells you how many before you save. Sixty
          days is the limit, which is a guard against a mistyped year rather
          than a rule about holidays.
        </P>
        <H3>On a phone</H3>
        <P>
          The month grid is replaced by an <strong>upcoming agenda</strong>:
          today first, then tomorrow, then the days after, with who's out under
          each. Seven columns of names can't be read on a phone, and "who's out
          today" is the question people open this on a phone to ask.
        </P>
        <Tip>
          The agenda looks <em>forward</em> — past entries aren't listed. Open
          it on a computer to look back over the month.
        </Tip>
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
      "The EIRs tab shows Engineering Information Requests with workflow View tabs (All, New, Needs Assigned, At Risk Parts, LTB), status pills (Under Review, Response Accepted, Closed, etc.) and a filter bar for Project, Assigned Engineer, Reporter, and search. EIRs have a Board (kanban) view as well as the list: List and Board buttons appear under the top nav, the board has one column per EIR status, and dragging a card between columns changes that EIR's status with a toast and Undo. The view tabs and filter bar work the same on both and travel between them; the board is hidden on phones. The Description field supports the same custom checklist syntax as a task's Description. New = no project reference and no engineer assigned; Needs Assigned = has a project reference but still no engineer. Description, Engineering Response and Where Used are rich text: editing one shows a toolbar with bold, italic, underline and bulleted/numbered lists, Ctrl+B/I/U work, paragraphs are preserved, and pasting from Word keeps the formatting but drops its colours. Click an EIR to open the detail page with Description, Engineering Response, Part Details (MFG, P/N, EAU, etc.), Comments, and a sidebar to edit Status, Resolution, Request Type, Priority, Reporter, Assigned Engineers, Watchers, Project, Task Reference, Requested Completion Date, LTB Date. New EIRs are auto-numbered as EIR_YYYY-#### (the next sequence for the year); the EIR Log No. is calculated from it. Each row in the list shows the date the EIR was raised, next to its EIR number, with the full timestamp on hover. Promote an EIR to a task by setting Resolution to Promoted to Task: a confirmation window creates a linked task carrying the title, description, project, watchers, and comment thread (tagged as from the EIR). Completing that task prompts for a final resolution, which is written back to the EIR's Engineering Response and marks the EIR Resolved and Closed. When an EIR is raised without a project reference, Sheila Horn is emailed asking her to add one; once it has a project reference, Glenn Terry and Brandon Mirto are asked to assign an engineer. When an EIR's status becomes Response Accepted, Sheila Horn and Ray White are emailed asking for it to be closed. When it becomes Response Not Accepted, the assigned engineers are asked to revisit and give a more detailed response; if no engineer is assigned the request goes to the assigners instead. The At Risk Parts view ignores the status pills entirely and lists every active at-risk part, open or closed. Only Sheila Horn and Ray White can change an EIR's Project Reference: for everyone else the field shows a padlock and the assigned projects read-only. Anyone can still set a project when first raising an EIR. An EIR raised with a project reference already on it skips the first step. Changing the project later doesn't re-send the request.",
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
          <strong>At Risk Parts ignores the status pills.</strong> It's a
          register of every part flagged at risk — open, closed or anything else
          — so narrowing it by status would hide the very rows it exists to
          show. The pills still appear there as a breakdown of what's on screen,
          but they don't filter, and none of them looks selected. Every other tab
          is a work queue, where the pills filter as usual.
        </P>
        <P>
          Below the tabs, status pills (Open, Under Review, Response Accepted,
          Closed, etc.) and a filter bar with Project Reference (multi-select),
          Assigned Engineer (multi-select), free-text Search across title / EIR
          No / MFG / P/N / description, and Reporter (single-select). The view,
          status, and filters all live in the URL so a view is shareable — with
          the one exception above: a status in the URL is ignored while At Risk
          Parts is the active tab.
        </P>
        <P>
          Each row shows <strong>the date the EIR was raised</strong>, beside its
          EIR number — the year is always included, since the list runs back
          several years. Hover it for the exact time. For EIRs that came across
          in a data migration this is the date of the import rather than the day
          somebody raised them.
        </P>
        <H3>Who can change the project reference</H3>
        <P>
          <strong>Only Sheila Horn and Ray White can change an EIR's Project
          Reference.</strong> For everybody else the field shows a padlock and
          the assigned projects read-only — hover it for the reason. If a project
          needs setting or correcting, ask one of them.
        </P>
        <P>
          Setting a project reference is what moves an EIR from "needs a project"
          to "needs an engineer" and sends that request out, which is why it sits
          with two named people rather than with a role. Note that{" "}
          <strong>raising</strong> a new EIR is unaffected: whoever files it can
          pick a project on the New EIR form, the same way the other restricted
          fields work. The lock applies to changing it afterwards.
        </P>
        <H3>Alerts on a status change</H3>
        <P>
          Two status changes raise a request rather than just a notification.
          Setting an EIR to <strong>Response Accepted</strong> emails{" "}
          <strong>Sheila Horn</strong> and <strong>Ray White</strong> asking for
          it to be closed — an accepted response is the point where somebody has
          to finish the job. Setting it to{" "}
          <strong>Response Not Accepted</strong> emails the{" "}
          <strong>assigned engineers</strong>, asking them to revisit and give a
          more detailed response; if no engineer is assigned, the request goes to
          the assigners instead so it doesn't land nowhere.
        </P>
        <P>
          Whoever made the change is left off their own alert — an engineer who
          rejects their own response isn't asked to revisit it; the request goes
          to the assigners instead. The only exception is a list of one: if the
          only person who could be told is the person who acted, they're told,
          rather than the alert reaching nobody. The ordinary "status changed"
          note still goes to the watchers and the reporter as before, and
          neither alert fires if a status is re-saved without actually changing.
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
          the EIR's title). Pick the parent project — defaulted from the EIR's
          Project Reference when it has one, and <strong>required</strong>:
          it sets the task's number prefix, so <strong>Create task</strong>{" "}
          stays disabled until a project is chosen. Then click{" "}
          <strong>Create task</strong>. The new task carries over the
          EIR's title, description, project, watchers, and attachments, and
          its whole comment thread is copied across with each comment tagged{" "}
          <em>"carried over from EIR …"</em>. The task opens with a{" "}
          <strong>From EIR</strong> link at the top that returns to the source
          EIR, and this EIR's Resolution, Linked Task card, and "Promoted to
          task" badge all update to point at the new task. Promoting is
          one-time — an EIR already marked promoted won't re-open the window.
          If the link back, the carried-over discussion, or the copied
          attachments couldn't be saved, a warning names what didn't make it
          across so you know to add it by hand — the task itself still gets
          created either way.
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
      "new folder",
      "create folder",
      "project reference",
      "tag folder",
    ],
    searchText:
      "Project Folders is a browser over the Engineering document library (General/Project Folders). Open the Project Folders card on the dashboard or the Departments menu. Navigate into a project folder and its subfolders with the breadcrumb, click a file or folder to open it in SharePoint, and upload files into the folder you're in (up to 250 MB — files over about 4 MB upload in chunks). At the top level, New project folder creates a folder and tags it with its project, so files uploaded from a task on that project land in it automatically; a project that already has a folder is marked and can't be given a second one. Deleting is done in SharePoint itself.",
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
          <LI>
            <strong>New project folder</strong> — at the top level, create a
            folder for a project. Pick the project and the name fills itself in
            to match; both stay editable.
          </LI>
        </UL>
        <P>
          Creating it here also <strong>tags it with the project</strong>, which
          is the part that matters: that tag is how a file uploaded from a task
          finds its way to the right folder. A folder made directly in
          SharePoint has to be tagged by hand, and until it is, uploads from
          that project's tasks go to <strong>Miscellaneous</strong> instead.
        </P>
        <Tip>
          A project can only have one folder. If it already has one, it's marked
          in the list as such and can't be picked again — two folders for the
          same project would leave ARC guessing which one to upload into.
        </Tip>
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
      "log number",
      "log#",
      "revision",
      "in house stock",
      "stock disposition",
      "drawings complete",
      "field returns",
      "on hold",
      "serial numbers",
      "final assembly",
      "attachment",
      "comment",
      "notification",
    ],
    searchText:
      "ECNs at /engineering/ecns, under Engineering — Engineering Change Notices, the record of a change to a released product, backed by the ECN NEW list on the Altronic Engineering SharePoint site. The table lists every notice newest first by Log#. Search covers everything including the Detailed Description, so you can find which ECN changed a part number. Filter by project, In House Stock disposition, whether the drawings are complete, and whether the notice is on hold. Click a row to open it. New ECN raises one: pick the project it belongs to, and type the Log# yourself because it comes off the ECN paperwork, and a revision keeps the number of the notice it revises with an R suffix (260059R1); the form refuses a number another ECN already has. On the notice, each card has one Edit button in its header that opens a box with that card's fields — Change (final assembly part numbers, detailed description, serial numbers), Disposition (in house stock, field returns impacted, drawings complete, on hold) and Sign-off (engineering comments, sign-off status). Save changes writes only the fields you touched. The Log#, Title and Project are edited the same way, from Edit Details in the sidebar. The Dashboard's ECN card counts the notices on file and narrows with the project picker, and clicking it opens the list already filtered to that project. Yes/No columns are picked as Yes or No rather than ticked. You can attach files to a notice. Comments work differently from the rest of ARC: an ECN has no watchers, so posting a comment emails the person who submitted the ECN and anyone you @-mention, and nobody else. Notices are never deleted; a superseded one is revised.",
    render: () => (
      <>
        <P>
          <strong>Departments → Engineering → ECNs</strong>{" "}
          (<code>/engineering/ecns</code>) is the register of{" "}
          <strong>Engineering Change Notices</strong> — what changed on a
          released product, which assemblies and serial numbers it touches,
          what happens to stock on hand, and whether the drawings have caught
          up. It reads and writes the same SharePoint list the team already
          uses.
        </P>

        <H3>Finding a notice</H3>
        <UL>
          <LI>
            The table lists every ECN, <strong>newest Log# first</strong>. Long
            lists render the first 150 rows with a <strong>show all</strong>
            {" "}beside the count.
          </LI>
          <LI>
            <strong>Search covers the Detailed Description</strong>, not just
            the title — so "which ECN changed 711478?" is a question you can
            answer by typing the part number.
          </LI>
          <LI>
            Filter by <strong>project</strong>, by <strong>In House Stock</strong>,
            by whether the <strong>drawings</strong> are complete or
            outstanding, and by <strong>on hold</strong>. The filters live in
            the address bar, so a filtered view can be shared.
          </LI>
        </UL>

        <H3>Raising one</H3>
        <P>
          <strong>New ECN</strong> asks for the part, the Log#, the{" "}
          <strong>project</strong> it belongs to, and what changes. <strong>You type the Log# yourself</strong> — it comes off
          the ECN paperwork rather than being generated, and a{" "}
          <strong>revision keeps the number of the notice it revises</strong>{" "}
          with an <code>R</code> suffix (<code>260059R1</code>). The form shows
          the latest number on the list so the next one is obvious, and it
          refuses a number another ECN already has.
        </P>

        <H3>Working it through</H3>
        <P>
          Each card on the notice has one <strong>Edit</strong> button in its
          header. Press it and a box opens with that card's fields; change what
          you need and press <strong>Save changes</strong>. Only the fields you
          touched are written, so several people can fill in their part without
          stepping on each other:
        </P>
        <UL>
          <LI>
            <strong>Change</strong> — final assembly part numbers, the detailed
            description, serial numbers.
          </LI>
          <LI>
            <strong>Disposition</strong> — what happens to in-house stock,
            whether field returns are impacted, whether the drawings are done,
            and whether the notice is on hold.
          </LI>
          <LI>
            <strong>Sign-off</strong> — engineering comments (the running,
            dated log) and sign-off status.
          </LI>
        </UL>
        <P>
          <strong>Attachments</strong> go on the notice — the marked-up
          drawing, the two-page ECN form, a photo of the board.
        </P>

        <P>
          The <strong>project</strong> sits in the sidebar and is changed from{" "}
          <strong>Edit Details</strong> alongside the Log# and Title. It's what
          the Dashboard's ECN card counts against: pick a project up there and
          the ECN count narrows with every other card, and clicking the card
          opens this list already filtered to it.
        </P>

        <Tip>
          <strong>Comments work differently here.</strong> An ECN has no
          watchers, so posting a comment emails the person who submitted the
          ECN and anyone you @-mention — nobody else. The page says who will
          hear you, just above the comment box. If someone should see the next
          comment too, mention them again: a mention notifies once, it doesn't
          subscribe anyone.
        </Tip>

        <P>
          There is no delete. An ECN records a change that was made; a
          superseded notice is revised, not removed.
        </P>
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
      "quick links",
      "quick links admin",
      "dashboard buttons",
      "dashboard shortcuts",
      "quick link order",
      "reorder quick links",
    ],
    searchText:
      "Admins manage several things from the Admin section in the header: the list of admin users (/admin/admins), the Engineering Project Log — the master project list (/admin/projects), EIR roles (/admin/eir-roles) which control who can edit the Engineering Response (engineer role) and Buyer Code (supply chain role) fields on an EIR, the Operations Projects list (/admin/operations-projects) — the master project list for Operations tasks, Panel Projects and Panel User Roles, and Quick Links (/admin/quick-links) — button links shown above each department's cards on the Dashboard, grouped by department, reordered with up/down arrows within their own department, and shown to everyone signed in even though only admins can manage them. The Admin link only appears in the header for users on the admin list, and non-admins who open an /admin URL directly are sent back to the dashboard — the admin pages never show for them. Add an admin from the Admins page; their name appears in the header on their next sign-in. Removing yourself is disabled to prevent lockouts. A small hardcoded bootstrap set of admins stays in the code as a safety net.",
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
          A <strong>Search</strong> box above the list narrows the projects
          shown, the same way search works everywhere else in ARC: multiple
          words all have to match, in any field, in any order, so{" "}
          <code>5000 AMP</code> still finds <code>0017-AMP-5000 Refresh</code>.
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
        <H3>Quick Links admin</H3>
        <P>
          The <strong>Quick Links →</strong> link (or{" "}
          <code>/admin/quick-links</code>) manages the button links shown
          above each department's cards on the Dashboard — a shortcut to a
          SharePoint site, a vendor portal, anywhere outside ARC people on
          that team open often. The page groups links into the same seven
          department bands the Dashboard uses; a link only shows to everyone
          under the department it's tagged with.
        </P>
        <P>
          Click <strong>Add link</strong> under a department, give it a
          button name and a full web address (starting with{" "}
          <code>https://</code> or <code>http://</code>), and save — it
          appears on the Dashboard immediately. Use the{" "}
          <strong>pencil</strong> to rename a link or move it to a different
          department, and <strong>Remove</strong> to take it off the
          Dashboard entirely.
        </P>
        <P>
          The <strong>▲ / ▼</strong> arrows next to a link move it up or down
          within its own department — that's the order the buttons appear in
          on the Dashboard. A link already first or last in its department has
          the arrow that would move it further disabled. A department with no
          links configured shows no Quick Links row at all on the Dashboard —
          not an empty heading.
        </P>
        <Tip>
          Everyone signed in sees the Quick Links buttons; only admins can add,
          rename, reorder or remove one. If the SharePoint Quick Links list
          isn't configured yet, a yellow notice at the top of the page says so
          and the Dashboard simply shows no Quick Links anywhere until it is.
        </Tip>
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
      "The filter bar on List, Kanban, and Test Sheets has Project Reference (multi), Assigned (multi, defaults to you), free-text Search, and Created By (single). Filters live in the URL — bookmark or share a filtered view as a link. People dropdowns (Assigned, Assigned Engineer, Reporter, Requestor, Watchers, Created By) match every word you type in any order, so first name plus surname works whichever way round the name is stored, and an email address finds someone too. admin.first.last accounts are hidden from people lists.",
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
        <H3>Searching for a person</H3>
        <P>
          Any dropdown that lists people — <strong>Assigned</strong>,{" "}
          <strong>Assigned Engineer</strong>, <strong>Reporter</strong>,{" "}
          <strong>Requestor</strong>, <strong>Watchers</strong>,{" "}
          <strong>Created By</strong> — searches on <strong>every word you
          type, in any order</strong>:
        </P>
        <UL>
          <LI>
            <strong>First name then surname</strong> both work, whichever way
            round the name is stored: <code>jerrod w</code> and{" "}
            <code>waldron jerrod</code> find the same person.
          </LI>
          <LI>
            <strong>An email address</strong> finds them too — type{" "}
            <code>jerrod.waldron</code> if two colleagues share a first name.
          </LI>
        </UL>
        <P>
          <strong>admin.</strong> accounts (the{" "}
          <code>admin.first.last</code> logins IT issues alongside a person's
          real account) are left out of these lists. They don't receive email,
          so anything assigned to one would go nowhere.
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
      "eir triage",
      "project reviewer",
      "assign an engineer email",
      "response accepted email",
      "response not accepted email",
      "gray market alert",
      "gray market intake",
      "maintenance email",
      "work order email",
      "work order due",
      "maintenance reminder",
      "pm reminder",
      "due soon email",
      "power automate",
      "fait alert",
      "fait intake",
      "fait notification",
      "fait sign off alert",
      "sqe reviewers",
      "sign-off chain",
      "intake alert",
      "intake list",
      "notification recipients",
      "who gets emailed",
      "wrong email address",
      "bounced email",
    ],
    searchText:
      "Commenting on a task, EIR, build request, or build request part emails everyone watching it, whoever it's assigned to, plus everyone you @-mention, from automation@altronic-llc.com. A comment with no mention at all still emails watchers and assignees. Mentioned people get a 'You were mentioned' email; assignees and other watchers get a 'New comment on' email that says whether it's assigned to them or they're watching. Build request parts have their own watcher lists and no Assigned field; part-comment emails deep-link to the request with that part expanded. You're never emailed for your own comment unless you @-mention yourself. @-mentioning auto-adds the person as a watcher. You also become a watcher automatically when you create an item and when something is assigned to you — on the create form and on later reassignments — alongside anyone added by hand to the Watchers field. Being unassigned does not remove you; use Unwatch. Comment timestamps are recorded on one company clock (Eastern) and displayed in your own local time, so a thread reads in the order it was written even when the authors are in different time zones. Editing a comment emails only newly added mentions by default, but checking 'Notify everyone again' resends an 'Updated comment on' email to watchers and assignees plus everyone mentioned in the new AND previous version of the comment. Change alerts: changing a Status (task, EIR, or build request), an EIR Resolution, a build request part's Part Status, or the assignees (including a build request's Engineer Assigned) emails the watchers, current assignees, and the EIR reporter or BR requestor. Checking or unchecking a Description checklist box (task, Operations task, or EIR) emails the watchers and current assignees with a Checklist updated on email naming the item. Being added as an assignee emails you 'You've been assigned'; being removed emails 'You've been unassigned'; everyone else gets a broadcast. Promoting an EIR to a task emails the EIR's watchers and reporter with a link to the new task. Creating/deleting parts and other field edits (lead time, customer, build request part checklists, WO No) send no email. You're never emailed for a change you made yourself. Intake alerts go to a fixed configured list rather than an item's watchers: an EIR raised with no project reference asks the project-reviewer list (default Sheila Horn, Ray White) to add one; a project reference landing on an EIR with none asks the assigner list (default Glenn Terry, Brandon Mirto) to assign an engineer. An EIR reaching Response Accepted asks the response-accepted list (default Sheila Horn, Ray White) to close it; Response Not Accepted asks the assigned engineers to revisit, or the assigner list if none are assigned. A new gray market request emails the intake list (default Katie Fleming, Alexandra Russell, Glenn Terry); a new FAIT emails its own intake list (default Jerrod Waldron, Alexandra Russell, Katie Fleming). Being on an intake list is not the same as watching the item, and the person who triggered it is left off their own alert unless that would leave nobody. FAIT status changes email its watchers plus its initiator, assigned engineer and KAM. The FAIT sign-off chain adds its own: being assigned as a FAIT's engineer or KAM emails you a heads-up that explicitly says no action is required yet; a FAIT reaching This is with SQE emails the configured SQE reviewer list (default Jerrod Waldron, VITE_FAIT_SQE_REVIEWERS - a separate list from the FAIT intake one); an approved SQE sign-off emails the assigned engineer, an approved Eng sign-off emails the KAM where one is needed, and either falls back to the SQE reviewers when that person is not assigned; a Failed SQE sign-off emails whoever raised the FAIT. Closing a FAIT emails everyone watching plus the intake list, de-duplicated so nobody gets two. Maintenance work orders follow the same rules as tasks: commenting, @-mentioning, assigning and changing a status emails the watchers and the assignee, and you start watching a work order you create, are assigned or are @-mentioned on. Time-based maintenance reminders — what is due soon, what has gone overdue — do NOT come from ARC: a Power Automate flow outside ARC sends those and maintains the Due Status column. ARC only sends the immediate emails, the ones caused by somebody doing something. Admins can check every configured list's addresses against the staff directory at Admin -> Notification recipients, which flags an address with no real mailbox before it fails silently.",
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

        <H3>Maintenance work orders, and what ARC does not send</H3>
        <P>
          A <strong>work order</strong> notifies exactly like a task: comments
          and @-mentions, assignment, and status changes all email its watchers
          and its assignee, and you start watching one you create, are assigned,
          or are @-mentioned on.
        </P>
        <P>
          What ARC does <em>not</em> send is anything driven by the clock.{" "}
          <strong>Time-based maintenance reminders</strong> — what's due soon,
          what has gone overdue — come from a{" "}
          <strong>Power Automate flow outside ARC</strong>, which also maintains
          each work order's <strong>Due Status</strong> (On-Track / Late). ARC
          sends the <em>immediate</em> emails: the ones caused by somebody doing
          something. If a due-date reminder isn't arriving, that flow is where to
          look, not ARC.
        </P>

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
              "An EIR is raised with no Project Reference",
              "The configured project-reviewer list (default Sheila Horn, Ray White)",
              "Please add a project reference",
            ],
            [
              "A Project Reference lands on an EIR that had none",
              "The configured assigner list (default Glenn Terry, Brandon Mirto)",
              "Please assign an engineer",
            ],
            [
              "An EIR's status becomes Response Accepted",
              "The configured response-accepted list (default Sheila Horn, Ray White)",
              "Please close it",
            ],
            [
              "An EIR's status becomes Response Not Accepted",
              "Its assigned engineers (minus you) — or the assigner list above if none are assigned",
              "Please revisit and give a more detailed response",
            ],
            [
              "A gray market request is raised",
              "The configured intake list (default Katie Fleming, Alexandra Russell, Glenn Terry)",
              "New gray market request: … — Please pick it up",
            ],
            [
              "A FAIT is raised",
              "The configured intake list (default Jerrod Waldron, Alexandra Russell, Katie Fleming)",
              "New FAIT: … — Please pick it up",
            ],
            [
              "A FAIT's Status changes",
              "Watchers + its initiator, assigned engineer and KAM (minus you)",
              "Status changed on …",
            ],
            [
              "You're assigned as a FAIT's engineer or KAM",
              "Just you",
              "You're the … on this FAIT — no action is required yet",
            ],
            [
              "A FAIT reaches This is with SQE",
              "The configured SQE reviewer list (default Jerrod Waldron)",
              "Please review it and record the SQE sign-off",
            ],
            [
              "A FAIT's SQE Sign Off becomes Approved",
              "Its assigned engineer — or the SQE reviewer list if none is assigned",
              "Please review it and record your engineering sign-off",
            ],
            [
              "A FAIT's SQE Sign Off becomes Failed",
              "Whoever raised the FAIT (minus you)",
              "SQE sign-off failed — it's back with you",
            ],
            [
              "A FAIT's Eng Sign Off becomes Approved, and a KAM is needed",
              "Its KAM — or the SQE reviewer list if none is assigned",
              "Please review it and record your KAM sign-off",
            ],
            [
              "A FAIT is closed",
              "Everyone watching it, plus the intake list — never both",
              "FAIT closed: …",
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

        <H3>Intake alerts — a fixed list, not the item's watchers</H3>
        <P>
          A few alerts don't go to an item's watchers at all: <strong>EIR
          triage</strong> (no project reference, or a project with no
          engineer), a new <strong>gray market request</strong>, and a new{" "}
          <strong>FAIT</strong> each email a small, <strong>configured list</strong>{" "}
          of the people who work that queue — an admin can change who's on
          each list without ARC being redeployed. Three rules hold for all of
          them:
        </P>
        <UL>
          <LI>
            <strong>Being on the list isn't the same as watching the item.</strong>{" "}
            It's a one-time "something needs picking up" nudge; later comments
            and status changes follow the normal watcher rules. Press{" "}
            <strong>Watch</strong> on the item if you also want the rest of the
            thread.
          </LI>
          <LI>
            <strong>The person who raised it is left off their own alert</strong> —
            unless they're the only person on the list, in which case they're
            told anyway rather than the alert reaching nobody.
          </LI>
          <LI>
            EIR triage chains: an EIR raised with{" "}
            <strong>no project reference</strong> asks the project-reviewer
            list to add one; once a project reference lands on an EIR that had
            none, it asks the assigner list to assign an engineer. An EIR
            raised <em>with</em> a project reference skips straight to that
            second step.
          </LI>
        </UL>
        <Tip>
          An admin can check every one of these lists — EIR triage, EIR
          response alerts, gray market intake, FAIT intake — against the
          staff directory at <strong>Admin → Notification recipients</strong>.
          It flags any configured address with no real mailbox behind it,
          which otherwise fails silently: the send is accepted, the bounce
          lands in a mailbox nobody reads, and the person who was supposed to
          be told never is.
        </Tip>

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
      "agenda",
      "calendar on a phone",
      "dark mode",
      "light mode",
      "theme",
    ],
    searchText:
      "On phones the Kanban board isn't available — use the List view to see and update tasks; Kanban links open the List instead. The Maintenance Calendar becomes an agenda list grouped Today / Tomorrow / by date, and the Visit Reports calendar opens its list view instead. Kanban works on tablets larger than an iPad mini and on desktop. Theme toggle (Sun / Moon) at the top-right switches light/dark and is remembered per browser.",
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
            <strong>Calendars on a phone</strong> — the{" "}
            <strong>Maintenance Calendar</strong> swaps its month grid for an{" "}
            <strong>agenda list</strong> of what's coming up, grouped Today /
            Tomorrow / by date; seven columns aren't readable at that width. The
            Visit Reports calendar has a list view to fall back on, so on a phone
            it opens that instead.
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
    id: "feature-requests",
    title: "ARC Feature Requests",
    group: "General",
    keywords: [
      "feature request",
      "suggest a feature",
      "suggestion",
      "idea",
      "request a feature",
      "new feature",
      "enhancement",
      "wishlist",
      "feedback",
    ],
    searchText:
      "ARC Feature Requests at /feature-requests, reached from the Suggest a feature button (lightbulb icon) in the header next to Report issue. A place to ask for a new ARC feature or change — Report issue is for something BROKEN, this is for something you WANT. Any signed-in user can submit one: a short summary, a description of what's needed and why, an optional Department and Priority. Requested By is filled in automatically to whoever submits it. Every request starts as Pending Review and moves through In Work, Completed or Not Implementing — the status, priority, department and target version can all be changed by any signed-in user from the request's detail page, not just an admin. Requests have a comment thread and watchers, same as everywhere else in ARC, so a discussion about the idea stays attached to it. The list is open-first: Pending Review and In Work requests sort above Completed and Not Implementing ones, newest first within each group.",
    render: () => (
      <>
        <P>
          <strong>Suggest a feature</strong> (lightbulb icon, next to{" "}
          <strong>Report issue</strong> in the header) opens{" "}
          <strong>ARC Feature Requests</strong> (<code>/feature-requests</code>
          ) — a place to ask for a new ARC feature or a change to an existing
          one. Use <strong>Report issue</strong> instead when something is
          actually broken; this is for something you'd like to see built.
        </P>
        <H3>Submitting a request</H3>
        <P>
          Click <strong>Suggest a Feature</strong> and fill in:
        </P>
        <UL>
          <LI>
            <strong>Summary</strong> — a short title, required.
          </LI>
          <LI>
            <strong>Description</strong> — what's needed, and why.
          </LI>
          <LI>
            <strong>Department</strong> — which team this is for, or
            Cross-department if it isn't any one team's.
          </LI>
          <LI>
            <strong>Priority</strong> — Low, Medium or High.
          </LI>
        </UL>
        <P>
          You don't pick who requested it or what status it starts at — ARC
          fills in <strong>Requested By</strong> as you, sets{" "}
          <strong>Status</strong> to Pending Review, and adds you as a
          watcher automatically.
        </P>
        <H3>Tracking a request</H3>
        <P>
          Every request has its own page with a comment thread and watchers,
          the same as a task or an EIR. Anyone signed in — not just an admin
          — can change a request's <strong>Status</strong> (Pending Review →
          In Work → Completed or Not Implementing),{" "}
          <strong>Priority</strong>, <strong>Department</strong> or{" "}
          <strong>Target Version</strong> from its sidebar, so the person
          picking up the work can keep the record current as it moves along.
        </P>
        <P>
          The list sorts open requests (Pending Review, In Work) above closed
          ones (Completed, Not Implementing), newest first within each group,
          so the ones still awaiting a look stay at the top. Filter by
          Department or search across the summary, description and requester.
        </P>
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
