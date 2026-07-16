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
    version: "0.57.0",
    date: "2026-07-16",
    changes: [
      "Fix the search box freezing the app — typing is now instant, with results updating a beat after you stop typing",
      "Search now looks at every field on an item (people, projects, statuses, part numbers, comments, dates), on every list — Tasks, EIRs, Operations Tasks, Test Sheets",
      "Search multiple keywords by separating them with spaces (each must match somewhere), and use \"double quotes\" for an exact phrase",
      "Loading messages are now themed for what we do: Sparking, Arcing, Cranking, Priming, Firing up…",
    ],
  },
  {
    version: "0.56.0",
    date: "2026-07-16",
    changes: [
      "Everything now updates instantly on screen instead of waiting for SharePoint: admin lists (Admins, EIR Roles, both Project Logs), the Operations task Project Ref and Equipment pickers, and attachment deletes all apply immediately and quietly revert if the save fails",
      "Changing an Operations task's Project Ref or Equipment now offers Undo in the confirmation toast, matching Engineering tasks",
    ],
  },
  {
    version: "0.55.0",
    date: "2026-07-15",
    changes: [
      "Mentioning someone who's never been assigned to or watched anything now adds them as a watcher — before, they'd get the mention email but the watcher add was silently skipped",
      "The @-mention dropdown now also lists every admin, so brand-new people show up in the picker at all",
      "Editing a comment now has the same @-mention picker as posting a new one, so mentions added during an edit actually notify and auto-watch that person",
    ],
  },
  {
    version: "0.54.3",
    date: "2026-07-15",
    changes: [
      "Editing a comment to add a new @-mention now adds that person as a watcher too, on tasks, EIRs, and Operations tasks alike (previously this only happened when posting a brand-new comment)",
    ],
  },
  {
    version: "0.54.2",
    date: "2026-07-15",
    changes: [
      "Operations tasks now show both the task number and the title on the list, board, and detail views (previously only one showed, hiding the other)",
    ],
  },
  {
    version: "0.54.1",
    date: "2026-07-15",
    changes: [
      "Simplify the Add admin form to just an email address — the name shown in the table is always derived from the email",
    ],
  },
  {
    version: "0.54.0",
    date: "2026-07-15",
    changes: ["Admins can now add and edit a description for each Operations project"],
  },
  {
    version: "0.53.2",
    date: "2026-07-15",
    changes: [
      "Fix Operations tasks still not showing the assigned person — the field wasn't requested from SharePoint at all",
    ],
  },
  {
    version: "0.53.1",
    date: "2026-07-15",
    changes: ["Fix Operations tasks not showing the assigned person's name"],
  },
  {
    version: "0.53.0",
    date: "2026-07-15",
    changes: [
      "Added Operations Tasks — the second department wired into ARC. Same List/Kanban/Detail flow as Engineering Tasks (comments, @-mentions, watchers, checklists, attachments), backed by the Operations Task List and Operations Projects on the Altronic_PMO site, with a single-person Assigned picker plus new Task Type, Location, and Equipment fields.",
      "Added an admin page for managing Operations Projects at /admin/operations-projects.",
      "The Dashboard's Operational Tasks card and the Departments menu's Operations group now link to the real Operations task list instead of showing \"Coming soon.\"",
    ],
  },
  {
    version: "0.52.0",
    date: "2026-07-15",
    changes: [
      "Fixed the app going blank/showing all-zero counts after sitting open a long time — a stale sign-in session is now detected automatically and signs you out to the sign-in page so a fresh sign-in brings your real data back, instead of silently rendering everything as empty.",
      "The Dashboard now shows a warning banner instead of silently showing \"0\" everywhere when part of it fails to load.",
    ],
  },
  {
    version: "0.51.1",
    date: "2026-07-14",
    changes: [
      "Fixed a new task briefly showing \"Task not found\" right after creation, before its detail page loaded — most noticeable when connected to real SharePoint rather than demo data.",
    ],
  },
  {
    version: "0.51.0",
    date: "2026-07-14",
    changes: [
      "Task and EIR descriptions now support custom checklists — click \"Turn into checklist\" while editing, or type \"- [ ] item\" / \"- [x] item\" lines yourself, and check items off directly from the detail page.",
    ],
  },
  {
    version: "0.50.3",
    date: "2026-07-14",
    changes: [
      "The User Manual TOC's scrollbar is now hidden — it still scrolls the same way, just without a visible bar cluttering the small panel.",
    ],
  },
  {
    version: "0.50.2",
    date: "2026-07-14",
    changes: [
      "The User Manual's table of contents now scrolls on its own when the section list is taller than your window, instead of relying on scrolling the whole page to reach the bottom entries.",
    ],
  },
  {
    version: "0.50.1",
    date: "2026-07-14",
    changes: [
      "\"Notify everyone again\" on an edited comment now also reaches anyone who was @-mentioned in the comment's previous version, not just people mentioned in the edited text.",
      "Documented \"Notify everyone again\" in the User Manual's notifications reference table.",
    ],
  },
  {
    version: "0.50.0",
    date: "2026-07-14",
    changes: [
      "Editing a comment on a task or EIR now shows a \"Notify everyone again\" checkbox — check it to re-email every watcher and mentioned person about the update instead of the usual silent edit.",
    ],
  },
  {
    version: "0.49.2",
    date: "2026-07-14",
    changes: [
      "Fixed clicking the Engineering Tasks or EIRs card while \"Mine\" was selected loading an empty list instead of your assigned items — your email was getting double-encoded in the link.",
    ],
  },
  {
    version: "0.49.1",
    date: "2026-07-14",
    changes: [
      "The User Manual's table of contents now lists sections in the same order they appear in the manual, instead of always putting Tasks/Engineering requests/Admin ahead of Quick Start and the Dashboard.",
    ],
  },
  {
    version: "0.49.0",
    date: "2026-07-14",
    changes: [
      "The Dashboard's Project Folders card now narrows to just the one folder tagged for the picked project, instead of always showing the whole library's folder count.",
    ],
  },
  {
    version: "0.48.2",
    date: "2026-07-14",
    changes: [
      "Fixed long project names in the Dashboard's project filter overlapping the Mine/Company toggle instead of truncating with an ellipsis. Root cause was broader than the Dashboard: the shared dropdown/select styling only loaded on pages that also happened to render the task filter bar, so any picker used elsewhere (Dashboard, task/EIR/test-sheet forms, admin pages) was missing its width and truncation styling. It's now loaded globally.",
    ],
  },
  {
    version: "0.48.1",
    date: "2026-07-14",
    changes: [
      "Fixed the Dashboard's project filter and Mine/Company toggle crowding together with no visible gap between them.",
    ],
  },
  {
    version: "0.48.0",
    date: "2026-07-14",
    changes: [
      "Added a project filter to the Dashboard, right next to Mine / Company — pick a project and every card's count and mini-bar narrows to that project in place, then carries through to the Tasks/EIRs list when you click a card.",
      "The project rollup page (opened from project chips throughout the app) now also shows EIRs and Test Sheets linked to that project, not just tasks.",
    ],
  },
  {
    version: "0.47.0",
    date: "2026-07-09",
    changes: [
      "Admins can now edit an existing project's number and name in the Engineering Project Log — hover a project and click the pencil to rename it inline. Changing the leading number automatically moves it to the matching table.",
    ],
  },
  {
    version: "0.46.0",
    date: "2026-07-09",
    changes: [
      "New Project Folders section (Engineering) — browse the General/Project Folders document library right inside ARC: navigate into project folders and their subfolders with a breadcrumb, open any file or folder in SharePoint, and upload files into the folder you're in (up to 4 MB).",
      "Added a Project Folders card to the dashboard's Engineering section and a link in the Departments menu.",
    ],
  },
  {
    version: "0.45.3",
    date: "2026-07-09",
    changes: [
      "Reworked the Engineering Project Log into a clean 2×2 quadrant of card tables: New Projects (3-digit number + initials), Legacy Projects (the 2000-series, now separate again), Engineering Items (0xxx), and Insourcing (5xxx), each with a colour dot, count, and short description. Other appears below when needed.",
    ],
  },
  {
    version: "0.45.2",
    date: "2026-07-09",
    changes: [
      "Engineering Project Log tables are now three wide on computer screens, New and Legacy projects are combined into one \"New & Legacy Projects\" table, and every table is sorted by project title descending.",
    ],
  },
  {
    version: "0.45.1",
    date: "2026-07-09",
    changes: [
      "The Engineering Project Log tables now lay out as a 2×2 grid on computer screens (one below another on smaller screens), and each table lists the highest project numbers first.",
    ],
  },
  {
    version: "0.45.0",
    date: "2026-07-09",
    changes: [
      "The Engineering Project Log now groups projects into tables by number series: New Projects (next number + engineer initials), Engineering Items (0xxx, non-product), Insourcing (5xxx), Legacy Projects (2xxx), and an Other table for anything without a leading number.",
    ],
  },
  {
    version: "0.44.2",
    date: "2026-07-08",
    changes: [
      "When creating a project fails, the error toast now shows the actual reason from SharePoint (e.g. a permissions or required-field error) instead of a generic \"please retry\", so the problem can be fixed.",
    ],
  },
  {
    version: "0.44.1",
    date: "2026-07-08",
    changes: [
      "Renamed the admin \"Project References\" page to \"Engineering Project Log\" (the master list of projects). The cross-page links from the other admin pages and the user manual were updated to match. It's the same list under the hood — the source for every Project Reference picker across tasks, EIRs, and test sheets.",
    ],
  },
  {
    version: "0.44.0",
    date: "2026-07-08",
    changes: [
      "Added a Panels department to the dashboard and the Departments menu, with Coming soon cards for the Panel Dashboard (panel-order tracking), Panel Tasks (tied to that dashboard), and Project Folders.",
    ],
  },
  {
    version: "0.43.1",
    date: "2026-07-08",
    changes: [
      "Rotating a phone to landscape no longer unlocks the Kanban board. The tablet check now uses the device's physical screen size instead of the current window width, so a phone stays on the List view in any orientation while real tablets and desktops keep Kanban.",
    ],
  },
  {
    version: "0.43.0",
    date: "2026-07-08",
    changes: [
      "Kanban is now available only on tablets larger than an iPad mini and on desktop. On phones the Kanban option is hidden and any Kanban link opens the List view instead — the board needs more width than a phone offers. (This replaces the phone-only \"Move to…\" control from the previous update.)",
    ],
  },
  {
    version: "0.42.0",
    date: "2026-07-08",
    changes: [
      "Kanban now works on phones: since drag-and-drop is disabled on touch, each card has a \"Move to…\" status dropdown so you can move work across columns right on the board — no need to open each task. Drag-and-drop is unchanged on tablet and desktop.",
    ],
  },
  {
    version: "0.41.2",
    date: "2026-07-08",
    changes: [
      "The top-nav Departments dropdown now mirrors the dashboard exactly — same departments in the same order (Engineering, Operations, Supply Chain, Customer Service / Sales) with the same items, including all the Coming soon placeholders. Longer than before, so the menu scrolls if it doesn't fit.",
    ],
  },
  {
    version: "0.41.1",
    date: "2026-07-08",
    changes: [
      "Filled in the real Coming soon cards for two departments. Supply Chain now shows Grey Market Part Requests, Supplier Issue Tracking, Supplier List, Supplier Contacts, Cost Impact Notices, and FAIT. Customer Service / Sales now shows Customer Feedback, Visit Reporting, Customers, Customer Contacts List, Special Pricing, Capacity Tracking, and Pricing Requests.",
    ],
  },
  {
    version: "0.41.0",
    date: "2026-07-08",
    changes: [
      "The dashboard is now split into department sections — Engineering, Operations, Supply Chain, and Customer Service / Sales — each with a divider heading and its own cards, so you can see the whole platform at a glance.",
      "Engineering holds the live cards (Engineering Tasks, EIRs, Test Sheets) plus Build Requests and ECNs; Operations, Supply Chain, and Customer Service / Sales show Coming soon placeholder cards for the tools each team will get.",
    ],
  },
  {
    version: "0.40.0",
    date: "2026-07-08",
    changes: [
      "Dashboard cards now count YOUR items by default — a new Mine / Company switch (top right) flips every count and status bar between your own work and the whole company's.",
      "The Tasks card is now titled Engineering Tasks, to sit alongside the coming Operational Tasks and Maintenance Tasks.",
      "Each status now has its own distinct colour in the dashboard mini-bars, so look-alike states (e.g. Backlog vs On Hold) are easy to tell apart.",
    ],
  },
  {
    version: "0.39.0",
    date: "2026-07-08",
    changes: [
      "The dashboard is now organised by work type: one card each for Tasks, EIRs, and Test Sheets, each showing its count of active items, a colour-coded status mini-bar, and a click-through to that type's page.",
      "Work types that aren't wired up yet — Build Requests, ECNs, Operational Tasks, and Maintenance Tasks — show as dimmed \"Coming soon\" placeholder cards so the shape of the platform is visible before the data exists.",
    ],
  },
  {
    version: "0.38.1",
    date: "2026-07-08",
    changes: [
      "The dashboard now shows count cards instead of item lists: Assigned to me, Watching, Created / reported, and Updated this week — each with the total and a task/EIR split. The Assigned and Created cards click through to your filtered task list. Show completed still toggles whether finished work is counted.",
    ],
  },
  {
    version: "0.38.0",
    date: "2026-07-08",
    changes: [
      "The home page is now a personal My Dashboard: it lists the tasks and EIRs you're assigned to, watching, and created or reported — plus a Recently updated feed — instead of the old engineering metric cards. Completed tasks and closed EIRs are hidden until you tick Show completed.",
      "Each dashboard row shows a Task/EIR badge and its status and links straight to the item; a compact stat row up top counts your assigned, watching, and created work.",
      "Promoting an EIR to a task now emails the EIR's watchers and reporter with a link to the new task, so followers know where the work moved.",
    ],
  },
  {
    version: "0.37.1",
    date: "2026-07-08",
    changes: [
      "The User Manual's Notifications section now documents every email scenario in one place — comments, @-mentions, status/resolution changes, and assignee add/remove/reassign — with an at-a-glance table of what triggers each email, who receives it, and the subject line.",
    ],
  },
  {
    version: "0.37.0",
    date: "2026-07-08",
    changes: [
      "Tasks and EIRs now send change alerts by email: changing a Status, an EIR's Resolution, or the assignees notifies the watchers, current assignees, and (for EIRs) the reporter — so people stay in the loop without watching the whole thread.",
      "Assignment emails are personal: the person added gets a \"You've been assigned\" note, the person removed gets a \"You've been unassigned\" note, and everyone else watching gets a short \"assignees changed\" summary of who was added or removed.",
      "Status / Resolution alerts spell out the change (\"changed from X to Y\") and who made it. You're never emailed about a change you made yourself.",
    ],
  },
  {
    version: "0.36.1",
    date: "2026-07-08",
    changes: [
      "When promoting an EIR to a task, you can now edit the task's title in the confirmation window before creating it (it still defaults to the EIR's title). The preview task number updates as you type.",
    ],
  },
  {
    version: "0.36.0",
    date: "2026-07-08",
    changes: [
      "You can now promote an EIR to a task: use the \"Promote to Task\" button at the top of the EIR, or set its Resolution to \"Promoted to Task\" — either opens a confirmation window to create a linked task, carrying over the EIR's title, description, project, watchers, and its full comment thread (each comment tagged as coming from the original EIR).",
      "Promoted tasks show a \"From EIR\" link at the top that opens the source EIR, and the EIR's Linked Task card points back at the new task.",
      "When you mark a task that came from an EIR as Complete, a prompt now asks for the final resolution. That text is added to the original EIR's Engineering Response, and the EIR is marked Resolved and Closed.",
    ],
  },
  {
    version: "0.35.5",
    date: "2026-06-16",
    changes: [
      "Fix the cross-page links (Admins, Projects admin, EIR Roles) overlapping the page description on the EIR Roles and Admins admin pages. They now sit cleanly to the right and wrap to their own row on narrow screens.",
    ],
  },
  {
    version: "0.35.4",
    date: "2026-06-09",
    changes: [
      "Non-admins who open an admin URL (/admin/...) directly are now redirected to the dashboard instead of seeing the admin page with a 'not authorised' notice. The Admin link already stays hidden for them.",
    ],
  },
  {
    version: "0.35.3",
    date: "2026-06-09",
    changes: [
      "Harden the Admins and EIR Roles lists so only admins can add, remove, or change entries — the edit actions now refuse to run for non-admins, not just hide the buttons.",
    ],
  },
  {
    version: "0.35.2",
    date: "2026-06-05",
    changes: [
      "Fix UI freezing in the Tasks list, Kanban, and EIRs list — the mention-badge feature was rescanning every comment for every visible row on each interaction. Long lists are now smooth to click and scroll.",
    ],
  },
  {
    version: "0.35.1",
    date: "2026-06-05",
    changes: [
      "Mention badges now disappear as soon as the row or card becomes visible on screen, so they clear when you scroll to them rather than requiring you to open the item.",
    ],
  },
  {
    version: "0.35.0",
    date: "2026-06-05",
    changes: [
      "Show a red 'Mentioned' badge on tasks and EIRs when you've been @-mentioned in a comment, and keep the badge highlighted until you open that item.",
    ],
  },
  {
    version: "0.34.2",
    date: "2026-06-05",
    changes: [
      "Keep the footer version badge highlighted until the user clicks it, so new release tracking stays visible after refresh.",
    ],
  },
  {
    version: "0.34.1",
    date: "2026-06-05",
    changes: [
      "Update the Departments navigation so Engineering Tasks appear first and keep Operations Tasks separate.",
    ],
  },
  {
    version: "0.34.0",
    date: "2026-06-05",
    changes: [
      "Make every User Manual section heading red so the manual is easier to scan, and publish the new app version.",
    ],
  },
  {
    version: "0.32.3",
    date: "2026-06-05",
    changes: [
      "Show a live version alert when a newer deployed ARC release is available, with a NEW badge on the footer version link and a top-page refresh banner.",
    ],
  },
  {
    version: "0.32.2",
    date: "2026-06-05",
    changes: [
      "Show a top-page banner when a newer deployed app version is available, with a Refresh button to load the latest build.",
      "Group task-specific manual sections under a Tasks heading so the company-wide app manual is easier to scan.",
    ],
  },
  {
    version: "0.32.1",
    date: "2026-06-05",
    changes: [
      "Add standalone in-app manual sections describing ECNs and Build Requests alongside Tasks, EIRs, and Test Sheets.",
    ],
  },
  {
    version: "0.32.0",
    date: "2026-06-04",
    changes: [
      "Watchers now get an email on every new comment on a task or EIR (not only when @-mentioned), so the whole thread stays in the loop. Mentioned people get the 'You were mentioned' email; other watchers get a 'New comment on…' email",
      "You're no longer emailed for your own comment, even if you're a watcher — unless you @-mention yourself",
      "@-mentioning someone still auto-adds them as a watcher",
    ],
  },
  {
    version: "0.31.1",
    date: "2026-06-04",
    changes: [
      "You can now press Tab (as well as Enter) to accept the highlighted person in the @-mention dropdown",
    ],
  },
  {
    version: "0.31.0",
    date: "2026-06-04",
    changes: [
      "Text boxes now auto-grow to fit what you type or paste instead of scrolling inside a fixed box — applies to task & EIR descriptions, the EIR Engineering Response, all comment boxes, and the test-sheet / report-issue fields",
    ],
  },
  {
    version: "0.30.1",
    date: "2026-06-04",
    changes: [
      "Notification email header now includes a one-line intro and the ARC tagline ('Every team. One ARC. Always forward.') so it's less plain",
    ],
  },
  {
    version: "0.30.0",
    date: "2026-06-04",
    changes: [
      "EIR comments now send @-mention email notifications, the same as tasks — mentioned people get an email with the EIR title, the comment, and an 'Open this EIR' button",
      "Notification email header restyled to the Cooper Red brand bar (was a near-black bar that Outlook's dark mode washed out to muddy grey); applied to both the @-mention and Report-issue emails",
      "Fixed the email's 'Open' button link dropping the /altronic-arc/ path — it now points at the correct deployed URL",
    ],
  },
  {
    version: "0.29.0",
    date: "2026-06-04",
    changes: [
      "New EIRs are now auto-numbered on submit as EIR_YYYY-#### — the next sequence for the current year — and written to the EIR No field (the calculated EIR Log No. derives from it)",
    ],
  },
  {
    version: "0.28.2",
    date: "2026-06-04",
    changes: [
      "Tidied the Part Details layout on the EIR detail page — fields now sit in an even three-column grid with uniform widths, instead of two stretched columns sized to their potential contents",
    ],
  },
  {
    version: "0.28.1",
    date: "2026-06-04",
    changes: [
      "Buyer Code dropdown now uses the official choice list (001 Patricia Scarnecchia, 002 Adele Riffle, 003 Katie Fleming, 004 Danielle Opatich, 005 Michelle Evans, 081 Panels) instead of inferring options from existing data",
    ],
  },
  {
    version: "0.28.0",
    date: "2026-06-04",
    changes: [
      "Buyer Code is now a dropdown (choice) instead of free text, on both the EIR detail and the New EIR form's Purchasing section",
      "Added Risk Part, Risk Part Level, and Technical Priority as editable choice fields on the EIR detail and the New EIR form",
      "Role gating: Risk Part, Risk Part Level, and Buyer Code are editable by the Supply Chain role; Technical Priority by the Engineer role (locked for others, like Engineering Response)",
    ],
  },
  {
    version: "0.27.2",
    date: "2026-06-04",
    changes: [
      "EIR cards now show the LTB (last-time-buy) date as a chip when one is set, so you can see it at a glance in any list/view",
    ],
  },
  {
    version: "0.27.1",
    date: "2026-06-04",
    changes: [
      "The LTB view now sorts by LTB date, soonest first, so the most urgent last-time-buys are at the top",
    ],
  },
  {
    version: "0.27.0",
    date: "2026-06-04",
    changes: [
      "Added an 'LTB' view tab to the EIRs list — shows every EIR that has an LTB (last-time-buy) date set. Shows a live count like the other view tabs",
    ],
  },
  {
    version: "0.26.2",
    date: "2026-06-04",
    changes: [
      "The RiskPart Level groups in the At Risk Parts view can now be collapsed and expanded — click a group header (chevron) to toggle it",
    ],
  },
  {
    version: "0.26.1",
    date: "2026-06-04",
    changes: [
      "The At Risk Parts view now groups EIRs by RiskPart Level (Unassigned first, then Level 1/2/3), each group with its own header and count — matching the SharePoint At Risk View layout",
    ],
  },
  {
    version: "0.26.0",
    date: "2026-06-04",
    changes: [
      "Added an 'At Risk Parts' view tab to the EIRs list — shows every EIR whose part is flagged at risk (RiskPart = Active), mirroring the SharePoint At Risk View. Shows a live count like the other view tabs",
    ],
  },
  {
    version: "0.25.2",
    date: "2026-06-04",
    changes: [
      "Fixed the EIRs list hiding closed items by default: it no longer pre-applies an 'Open' status filter, so every view (All / New / Needs Assigned) now shows EIRs of every status until you click a status pill. Click 'Open' to narrow to open items",
    ],
  },
  {
    version: "0.25.1",
    date: "2026-06-04",
    changes: [
      "Moved to the new home URL https://altronic-llc.github.io/altronic-arc/ after the repository was renamed to altronic-arc. Update any bookmarks to the old /altronic-engineering-tasks/ address",
    ],
  },
  {
    version: "0.25.0",
    date: "2026-06-04",
    changes: [
      "Rebranded to ARC — the Altronic Resource Center: a company-wide platform that brings every department's tools into one app. 'Every team. One ARC. Always forward.' Engineering is the first team aboard; more departments to follow",
      "Updated the app title, header, sign-in screen, print header, About page, User Manual, and notification emails to the ARC branding",
    ],
  },
  {
    version: "0.24.0",
    date: "2026-06-02",
    changes: [
      "Added workflow View tabs to the EIRs list: 'New' (EIRs with no project reference and no engineer assigned) and 'Needs Assigned' (a project reference is set but no engineer yet), alongside 'All'. Each tab shows a live count",
      "The selected view is saved in the URL alongside the existing status and filter selections, so a view is shareable as a link",
    ],
  },
  {
    version: "0.23.1",
    date: "2026-06-02",
    changes: [
      "Reordered the New EIR form so LTB Date now sits after the MFG P/N field (was between MFG and MFG P/N)",
    ],
  },
  {
    version: "0.23.0",
    date: "2026-06-01",
    changes: [
      "New Admin → EIR Roles page (/admin/eir-roles) where admins tag users as Engineer and/or Supply Chain. Only admins can manage the list",
      "EIR fields are now permission-gated: only Engineers can edit an EIR's Engineering Response, and only Supply Chain can edit the Buyer Code. Everyone else can still edit every other EIR field. Locked fields show a small lock icon explaining which role is needed",
      "Gating stays off until the EIR Roles list is set up in SharePoint, so nothing changes for existing users until an admin configures it",
    ],
  },
  {
    version: "0.22.8",
    date: "2026-06-01",
    changes: [
      "On an EIR, the Project Reference field now lists each selected project on its own line with a ✕ to remove it, instead of collapsing to 'First +N' — so you can see everything assigned at a glance. Click 'Add / edit' to change the selection",
      "In multi-select dropdowns, the options you've already selected now sort to the top of the list when you open it (and stay put while you toggle, so rows don't jump under your cursor)",
    ],
  },
  {
    version: "0.22.7",
    date: "2026-05-29",
    changes: [
      "Fixed the EIR detail sidebar stretching wider than its card when a Project Reference (or any field) had a long value — the panel and all its dropdowns now stay within the card and long selections truncate cleanly instead of pushing the layout out",
    ],
  },
  {
    version: "0.22.6",
    date: "2026-05-29",
    changes: [
      "Reverted the accent colour back to Cooper Red — links, primary buttons, @-mention chips, active filter pills, and other highlights return to the red used before v0.22.5, with white text on the red fills",
    ],
  },
  {
    version: "0.22.5",
    date: "2026-05-29",
    changes: [
      "The app's accent colour is now Altronic Gold instead of Cooper Red — links, primary buttons, @-mention chips, and other highlights pick up the new brand colour in both light and dark themes",
      "On the light theme the gold is deepened slightly so links stay legible against the near-white background; the dark theme uses the brighter brand gold, which already stands out on dark surfaces",
      "Primary buttons, active filter pills, and selected options now use dark text on their gold fill instead of white — much more readable on gold in both themes",
    ],
  },
  {
    version: "0.22.4",
    date: "2026-05-27",
    changes: [
      "Fixed the 'interaction_in_progress' + 'popup_window_error' cascade on first page load. The signed-in user's SharePoint LookupId is resolved by three different components on mount (DetailView, CommentComposer, Header) and each was firing its own Graph token request in parallel. MSAL only allows one interactive auth at a time, so the 2nd/3rd hit `interaction_in_progress` and the popup fallback got blocked. Concurrent callers now share a single in-flight promise per email — one Graph call instead of three, no popup fights.",
    ],
  },
  {
    version: "0.22.3",
    date: "2026-05-27",
    changes: [
      "Fixed a cosmetic but loud bug: @-mention and Report-issue sends were succeeding (the email actually went out) but the app reported them as failures in the console because Graph returns 202 Accepted with an empty body for sendMail, and our HTTP helper unconditionally called response.json(), which threw on the empty body. Empty 2xx responses now resolve cleanly to undefined",
    ],
  },
  {
    version: "0.22.2",
    date: "2026-05-22",
    changes: [
      "@-mention and Report-issue emails now go out for every user with Send-As on the shared mailbox, not just users with FullAccess. The Graph sendMail call no longer asks Exchange to save a copy to the shared mailbox's Sent Items folder (which silently required FullAccess on top of Send-As and made the call 404 for everyone without it)",
      "Trade-off: the shared mailbox no longer accumulates a copy of every notification it triggers — for an internal notification system this is arguably better (no Sent Items inbox-bloat) but if you ever want a record of what went out, recipients still have it in their inboxes",
    ],
  },
  {
    version: "0.22.1",
    date: "2026-05-22",
    changes: [
      "Graph 4xx errors in the browser console now include the access token's claims (scp, roles, aud, appid, tid, upn, exp) alongside the existing request/response dump — the only reliable way to confirm whether a missing scope is the cause of an otherwise-mysterious 404 (Graph hides missing-scope errors as 404 rather than 403). The full token is never logged; only the JWT payload claims, which aren't secret",
    ],
  },
  {
    version: "0.22.0",
    date: "2026-05-22",
    changes: [
      "Task attachments now write to BOTH places: the SharePoint list item on the task itself (so they show up inline in the SharePoint UI), and the project folder in the Documents library (so engineering artefacts stay attributable to the project, not the task)",
      "The Attachments card on each task now shows two sub-lists — 'On this task' (task-specific list-item attachments, shown first because they take priority) and 'From <project folder>' (the project-folder files). Each entry has its own open / remove controls",
      "Deletes are scoped: removing a file from 'On this task' only deletes the list-item attachment; removing from the project folder only deletes the file in SharePoint. The other copy is untouched",
      "Best-effort list-item upload: if the user's tenant hasn't admin-consented to AllSites.Manage on the Entra app, the list-item path silently no-ops and uploads still land in the project folder (so attachments never break completely)",
    ],
  },
  {
    version: "0.21.3",
    date: "2026-05-22",
    changes: [
      "Report issue button now falls back to opening a mailto: draft whenever the Graph sendMail call fails (404 ErrorItemNotFound from a misconfigured shared mailbox, 403 Forbidden, 401 SessionExpired, etc.) — previously the toast just said 'couldn't send' and the user was stuck. Now the maintainer always gets the report, even when the Exchange config is broken for the signed-in user",
      "Underlying cause if you've been seeing 404s on automation@altronic-llc.com: the signed-in user almost certainly lacks Send-As permission on the shared mailbox, or Mail.Send.Shared wasn't admin-consented on the app registration; check Exchange admin → mailbox delegation",
    ],
  },
  {
    version: "0.21.2",
    date: "2026-05-22",
    changes: [
      "About page now opens with a 'What an SPA is' primer above the System flow and Data model diagrams — explains how the app actually works (browser is the runtime, GitHub Pages serves static files, Microsoft Graph is the data backend), why this architecture was chosen over Power Apps (sub-100ms interactions, zero infra cost, no delegation limits), what it costs (first-load latency, JS expertise required, framework churn), and the mental shift required for engineers coming from server-rendered frameworks; collapsible via a 'Read primer / Hide primer' affordance so it doesn't dominate the page for people who already know the model",
    ],
  },
  {
    version: "0.21.1",
    date: "2026-05-21",
    changes: [
      "'Report issue' button now also appears on the sign-in page (top right) so users who can't log in still have a path to flag the problem",
      "When the button is pressed without a signed-in user, it opens a pre-filled draft in your default mail client (mailto:) instead of going through Graph sendMail — same destination, same captured-error attachment, you compose from your own mailbox so the maintainer knows exactly who reported it",
    ],
  },
  {
    version: "0.21.0",
    date: "2026-05-21",
    changes: [
      "New 'Report issue' button in the header (life-buoy icon) — visible on every screen; opens a modal with a description field and previews the browser console errors captured during the session, then emails the whole bundle to the app manager with you CC'd so you have a paper trail",
      "Console errors, warnings, uncaught exceptions, and unhandled promise rejections are now captured into a bounded in-memory buffer (last 100 entries) the moment the app boots — DevTools output is unaffected; the buffer clears after a successful report",
      "Report destination defaults to ray.white@altronic-llc.com but is overridable via the `VITE_APP_MANAGER_EMAIL` repo variable; sends FROM the existing shared mailbox via Graph sendMail (same path as @-mention notifications)",
    ],
  },
  {
    version: "0.20.0",
    date: "2026-05-21",
    changes: [
      "@-mentioned users on a task or EIR comment now automatically become watchers on that item — works for both lists; resolved against the existing people directory to get a real SharePoint LookupId before writing, falls through silently if the mentioned person isn't in the directory yet; toast confirms 'X is now watching this task / EIR' so the original commenter sees what happened",
      "Removing yourself from the Watchers field is the off-switch — but a fresh @-mention will re-add you, so the mentioner needs to stop pinging if they actually want you to disengage; documented this in the User Manual's mention section",
    ],
  },
  {
    version: "0.19.2",
    date: "2026-05-21",
    changes: [
      "Modified date on Task + EIR sidebars now also shows who last touched it as a small 'by Name' caption underneath — pulled from Graph's default `lastModifiedBy.user`; small and indiscrete so it doesn't compete with the rest of the sidebar",
      "User Manual got a new 'PCB checklist' section covering how the card appears on category=PCB tasks, what the 17 items are, how the done/total counter works, optimistic save + undo, and what the 'column missing' note means if a row shows up red",
    ],
  },
  {
    version: "0.19.1",
    date: "2026-05-21",
    changes: [
      "Added a 'Modified' date/time field next to 'Created' on both the Task and EIR detail sidebars — pulled from SharePoint's default lastModifiedDateTime so it's free; useful for telling at a glance when a record was last touched and for spotting stale items",
    ],
  },
  {
    version: "0.19.0",
    date: "2026-05-21",
    changes: [
      "New PCB Checklist card on tasks with category 'PCB' — mirrors the two-column layout from the original Power Apps form with 13 Yes/No checkboxes and 4 Choice radio groups; the card resolves SharePoint internal column names at runtime by display-name match (via a new `useTaskColumns` hook) so we don't have to guess at the encoded internal names, and a small `n/N` progress badge in the card header shows how many items are complete",
      "Checkbox + radio changes write through the existing `useUpdateTaskFields` mutation (toast + undo) and patch the raw-fields cache for instant optimistic feedback; if SharePoint rejects the write, the field flips back",
      "Card only renders when the task's category is 'PCB' — other categories see no change",
    ],
  },
  {
    version: "0.18.3",
    date: "2026-05-21",
    changes: [
      "Misc-folder filename prefix is no longer dropped on tasks without a parent project — the resolver now derives the prefix from (1) the parentProject title, (2) the projects catalogue if the task came in with a blank title, (3) a `LID-<n>` stub for orphaned lookupIds, and (4) the task's numbered title as a final fallback (`T15-AMP-coil-replacement_drawing.pdf`) so files are still attributable",
      "Miscellaneous folder is now matched case-insensitively (`Miscellaneous`, `Misc`, `MISC`, etc.) so a renamed folder doesn't silently kill the fallback",
      "Every task file upload now logs a one-liner to the browser console showing which folder it picked + the final filename, so future routing surprises are diagnosable from DevTools without re-deploying",
      "Added 9 unit tests pinning the misc-prefix behaviour (all four fallback layers + case-insensitive folder name) so this can't regress",
    ],
  },
  {
    version: "0.18.2",
    date: "2026-05-21",
    changes: [
      "About diagrams updated for the new attachments routing — system flow now lists the Documents library under SharePoint storage and the `projectFiles` API + `useTaskFiles` hook on the SPA tier; ER diagram adds ProjectFolder + ProjectFile entities with foreign keys to Project, and the EIR-only Attachment entity is now correctly scoped to EIR.id (the Task → Attachment link is gone)",
      "User Manual got a dedicated 'Task attachments' section walking through the project-folder routing, the Miscellaneous fallback with filename prefix, the 5-most-recent display + 'View all' link, and how comment attachments piggyback on the same path; the Comments section's Attachments sub-heading was rewritten to call out the task vs EIR difference",
      "README rewritten — frames the app as the canonical home for every internal Altronic engineering tool going forward (Tasks + EIRs + Test Sheets today, anything new should land here as a new view), documents the Project Folders attachment routing up front, and lists every env var the deploy needs",
    ],
  },
  {
    version: "0.18.1",
    date: "2026-05-21",
    changes: [
      "Task comment attachments now also route to the SharePoint Project Folder — files dropped or selected in the comment composer upload to the same folder as the Attachments card, and a clickable hyperlink to each one is inlined at the bottom of the comment HTML; the legacy in-memory blob shape stays in place for the EIR composer until EIRs migrate to project folders too",
    ],
  },
  {
    version: "0.18.0",
    date: "2026-05-21",
    changes: [
      "Task attachments now route through the Project Folders document library instead of the legacy list-item attachments — when you upload a file from a task, the app looks up the task's Project Reference, finds the matching folder under `Documents/General/Project Folders/` via the folder's Project Reference metadata, and uploads there; if no folder matches, the file goes into the shared Miscellaneous folder with the project code prefixed onto the filename so it's still findable",
      "Task Attachments card shows the 5 most-recently-modified files in the project folder with each filename as a hyperlink to SharePoint, plus a 'View all in SharePoint →' link that opens the full folder",
      "No new IT permission needed — this uses the existing Microsoft Graph `Sites.Selected` scope (the SharePoint REST `AllSites.Manage` permission I asked for last time is only required if EIRs ever migrate to this same model; EIRs continue to use the list-item attachment path until then)",
    ],
  },
  {
    version: "0.17.11",
    date: "2026-05-21",
    changes: [
      "Data model redrawn as a proper ER diagram on a single SVG canvas — tables are positioned next to one another with crow's-foot connectors running between them, the same Visio-style schema diagram the user requested; PK rows carry a red PK badge with a dashed separator below, FK rows carry a blue FK badge and a connector to the referenced table; cardinality is marked at each connector end (open circle = one, three-prong = many)",
    ],
  },
  {
    version: "0.17.10",
    date: "2026-05-21",
    changes: [
      "Added EIRs and Admins quick-links to the About page header — both jump to the SharePoint list in a new tab; the Admins link only appears for users with admin access",
      "Redrew the About page data model as a proper ER-diagram view — each entity is a table card with header (entity name + SharePoint source list), then columns listed with type and Primary-Key / Foreign-Key flags, and FK rows show the target column (`→ Project.id`, `→ Person.id[]`, etc.); array types call out multi-value relationships explicitly so the schema reads like a relational database drawing",
    ],
  },
  {
    version: "0.17.9",
    date: "2026-05-21",
    changes: [
      "Navigating from a list (Tasks, EIRs, Test Sheets, etc.) into a detail page now scrolls to the top of the new page automatically — previously the scroll position carried over from the list so the detail header was below the fold; filter / query-string changes within the same page still keep their scroll position",
    ],
  },
  {
    version: "0.17.8",
    date: "2026-05-21",
    changes: [
      "EIR Project Reference is correctly typed as a multi-value Lookup column now (matching the SharePoint type list confirmed by the user) — the read mapper extracts an array of {lookupId, title} pairs from the expanded lookup objects, and writes go through the standard `multiLookupField` helper to `ProjectReferenceLookupId` with the Collection(Edm.Int32) annotation Graph requires; this is the same shape the Tasks list's Related Projects field uses, so the 400 'value is not a valid choice' Bad Request goes away",
      "Renamed `Eir.parentProject` to `Eir.parentProjects: ProjectReference[]` to reflect that multiple projects can be selected; EirRow, EIR detail sidebar picker, EIRs filter, and dashboard EIR project scoping all updated to iterate the array (chips render one per project, filter matches if any chip is the selected project)",
    ],
  },
  {
    version: "0.17.7",
    date: "2026-05-21",
    changes: [
      "Every failed Graph request now logs the full request body + response body to the browser console (in addition to the toast) — so when a write fails we get the actual error message instead of just a 400 stack trace, which we need to diagnose the EIR Project Reference 400",
    ],
  },
  {
    version: "0.17.6",
    date: "2026-05-21",
    changes: [
      "Project Reference picker on the EIR detail page now fetches the actual configured Choice values from the SharePoint column definition (via `/lists/{id}/columns?$select=name,choice`) and uses those as the option list — this was the 400 Bad Request root cause: PATCH-ing with a value not in the column's allowed choices is rejected; if the column allows free-text entry (or until the column metadata loads) we still surface every project from the Projects list as a fallback",
    ],
  },
  {
    version: "0.17.5",
    date: "2026-05-21",
    changes: [
      "Project Reference write payload simplified — dropped the `@odata.type: Collection(Edm.String)` annotation that v0.17.4 added; for Graph v1.0 multi-choice Choice columns a plain string array is the correct shape, and the annotation can cause the value to be silently dropped",
      "EIR save errors now include the underlying Graph error message in the toast instead of a generic 'Couldn't save changes' line, so failures (especially this Project Reference one) are diagnosable from the UI without DevTools",
      "Added a one-time browser-console log of the exact PATCH body the next time the Project Reference field is written — pasted-back output will let us see what Graph actually receives if writes still don't persist",
    ],
  },
  {
    version: "0.17.4",
    date: "2026-05-21",
    changes: [
      "Project Reference writes from the EIR detail picker now send the canonical Graph multi-choice payload — added a `multiChoiceField` helper that emits the `@odata.type: Collection(Edm.String)` annotation Graph requires for multi-select Choice columns; without it some tenants silently dropped the value on save",
      "EIR Title is now editable inline on the detail page — hover the title to reveal a small edit pencil, click to enter an input, Enter saves (Escape cancels); the save is optimistic via the same useUpdateEirFields path everything else uses, with toast + undo",
      "EIR Description is now editable too — swapped the read-only BodyCard for the same EditableTextCard pattern Engineering Response and Where Used already use, with HTML rendering for display and a textarea for editing",
    ],
  },
  {
    version: "0.17.3",
    date: "2026-05-21",
    changes: [
      "EIR Reporter now resolves to a real display name even when Graph only returns the bare ReporterLookupId — added a best-effort fetch of the SharePoint User Information List during the EIR load and use it as the authoritative directory for lookupId-to-name resolution; if the directory call fails (permissions etc.) we still fall back to cross-pollination from peer EIRs and ultimately a 'User #N' placeholder, but the common case is now a proper name",
      "Added `ReporterLookupId` to the EIR $select so the bare integer is always in the response — previously only `Reporter` was requested, and on EIRs where Graph didn't expand the column the field came back missing entirely",
    ],
  },
  {
    version: "0.17.2",
    date: "2026-05-21",
    changes: [
      "EIR Reporter now renders even when Graph returns just the bare ReporterLookupId instead of the expanded person object — the mapper falls back to building a placeholder Person from the lookupId, then attachEirReferences cross-pollinates real names from any other EIR in the response where the same person did come back expanded, so the list and detail show the right name in either case",
      "Added a one-time browser-console diagnostic for the Reporter field on the first EIR — logs the value of `Reporter` (object?), `ReporterLookupId` (int?), and the resolved Person after mapping, so we can confirm which shape Graph is actually returning",
    ],
  },
  {
    version: "0.17.1",
    date: "2026-05-21",
    changes: [
      "New-EIR form is now just General Information + Purchasing Information — dropped the optional Project Reference / Task Reference / Assigned Engineers section; everything past the required fields is set from the EIR detail page after Save",
      "Renamed the header dropdown from 'Engineering Lists' to 'Engineering Requests' (the short mobile label too) — Manual updated to match",
      "Reporter now renders again on EIR detail — brought back an explicit Graph $select that asks for Reporter / AssignedEngineer / Watchers by name so the person columns come back expanded with LookupValue + Email instead of just the bare LookupId",
      "EIR Project Reference is editable from the detail sidebar again — replaced the read-only chip list with a real multi-select picker that uses Project titles from the Projects list as the allowed choices and writes the multi-choice array back to SharePoint",
    ],
  },
  {
    version: "0.17.0",
    date: "2026-05-21",
    changes: [
      "New-EIR form now covers every field from the original Power Apps form: General Information up top (Request Type, Reporter, Requested Priority, Requested Completion Date, Subject, Description) and a Purchasing Information section below (EAU, Current Stock, Current Price, MFG, LTB Date, MFG P/N, Altronic Part Number, Where Used)",
      "Required-field set on create now matches the original form: Subject, Description, Reporter, Requested Priority, Request Type — Save button stays disabled until those five are filled in",
      "Added EAU / Current Stock / Current Price / LTB Date / Buyer Code through the create API too (they were already on the Eir type but unreachable from the form), so values typed in the new sections actually persist",
      "Optional in-app extras (Project Reference, Task Reference, Assigned Engineers) live in a separate 'Optional' subsection at the bottom of the form with a hint that Project Reference writes aren't wired up to the multi-choice column yet — set the project from the detail page after creating",
    ],
  },
  {
    version: "0.16.7",
    date: "2026-05-20",
    changes: [
      "Data model on the About page now reads as a proper three-tier hierarchy — Project at the top, Task in the middle (with its 'Parent Task' self-link called out), and EIR + Test Sheet at the bottom; between each tier a labelled bar lists every SharePoint column that carries the reference and which entity each one comes from, so Project Reference and Task Reference relationships are visually obvious",
      "Shared concepts (Person, Comments, Attachments, Admin) moved below the hierarchy with a short note for each describing which entities touch it and via which field",
    ],
  },
  {
    version: "0.16.6",
    date: "2026-05-20",
    changes: [
      "Replaced the About page Mermaid diagrams with a hand-built HTML/Tailwind layout — same information laid out as tier cards (System flow) and entity cards with bulleted relationships (Data model), colour-coded with the Cooper palette and zero chance of 'syntax error in text' on the live page",
    ],
  },
  {
    version: "0.16.5",
    date: "2026-05-20",
    changes: [
      "Redesigned About page diagrams from scratch — simpler shapes, no nested parens-in-quotes (which kept choking the Mermaid 11 parser), and colour-coded so different parts of the system stand out: red for the SPA, blue for Graph / SharePoint gateways, green for SharePoint lists, purple for Entra ID, grey for demo/mailbox; data-model diagram uses the same red/blue palette to separate entities from shared concepts",
    ],
  },
  {
    version: "0.16.4",
    date: "2026-05-20",
    changes: [
      "Adding an admin no longer 400s — turned out Graph rejects the whole POST when even one field name doesn't exist (not 'silently ignored' as I'd assumed), so removed the speculative `Display_x0020_Name` write key; writes now go to the real DisplayName column only",
      "About-page Mermaid diagrams no longer render 'Syntax error in text' — the trapezoid shape combined with parentheses in the quoted label was crashing the Mermaid 11 parser; rewrote both diagrams with simpler labels (no nested parens in quoted node text)",
    ],
  },
  {
    version: "0.16.3",
    date: "2026-05-20",
    changes: [
      "About-page diagrams updated: system flow now shows the SharePoint REST audience (for attachments) and the Admins list; data-model diagram now shows Attachments and the Admin entity, plus the EIR project-reference column is annotated as multi-choice text instead of a lookup",
      "User Manual updated with a new Admin section (how the Admin link is gated, how to add/remove admins, how to reach the Project References editor) and an Attachments + Linked Task callout in the EIRs section",
    ],
  },
  {
    version: "0.16.2",
    date: "2026-05-20",
    changes: [
      "Admin add / remove failures now surface in the UI — modal stays open with a red error box, removal errors show under the table; no more silently swallowed mutations",
      "Admin table falls back to deriving a 'First Last' from the email when the Display Name field is empty, so missing names don't render as a dash",
      "Admin read/write now handles SharePoint provisioning where the column ended up as `Display_x0020_Name` instead of `DisplayName` (and other variants) — and prints a one-time browser-console diagnostic of the actual field names so we can iterate fast if the list was set up with yet another name",
    ],
  },
  {
    version: "0.16.1",
    date: "2026-05-20",
    changes: [
      "Task Reference moved out of the EIR sidebar into a 'Linked Task' card in the main column — same look and feel as the 'Child tasks' card on the task detail (title on the left, status badge on the right), with a small Edit/Add affordance for changing the reference; Power Apps URLs no longer leak into the sidebar at all",
      "Mention-style anchors in descriptions and comments no longer escape the styling rule — previously only `mailto:` anchors were caught, now any non-http link (anchor-only, missing href, javascript:, etc.) renders as plain bold text instead of loud red italic underline",
    ],
  },
  {
    version: "0.16.0",
    date: "2026-05-20",
    changes: [
      "New Admin → Admins page (/admin/admins) with a sortable table of who has admin access — admins can add or remove people directly from the UI, and anyone on the list immediately gets the Admin link in the header on their next reload",
      "Admin access is now driven by an editable SharePoint list (VITE_SP_ADMINS_LIST_ID) instead of a hardcoded array — a small bootstrap set (ray.white@…, demo.user@…) stays in the code so nobody can lock themselves out by accidentally clearing the list",
      "Toned down @-mention styling in descriptions and comments — names like 'Mark Balent' wrapped in mailto: anchors no longer render as loud red italic underlined links; they appear as plain bold text",
    ],
  },
  {
    version: "0.15.10",
    date: "2026-05-20",
    changes: [
      "EIRs promoted from the old Power Apps form had their Task Reference stored as a 200-character deep-link URL; the EIR detail page now recognises that URL, pulls the `ItemID=` query param out of it, and renders the linked task as a tidy clickable chip pointing at this app's task detail page — with a Clear button if you want to retype the reference by hand",
    ],
  },
  {
    version: "0.15.9",
    date: "2026-05-20",
    changes: [
      "EIR project references now render as chips instead of an awkwardly truncated comma string — list rows show up to 3 chips with '+N more' for any overflow (full list on hover), and the detail page shows each project on its own chip",
      "Fixed the Entra sign-in prompt that fired every time you opened a task or EIR detail page — root cause was the MSAL redirect URI being the current pathname (e.g. /task/123) which isn't registered with the app, so each silent-token refresh kicked into an interactive popup; the redirect URI is now pinned to the app's base URL",
      "Attachments section now does silent-only token acquisition for the SharePoint REST scope — if an admin hasn't granted the AllSites.Manage permission yet, the section shows a friendly notice instead of triggering an Entra popup that asks you to sign in again",
      "Removed the temporary EIR project-reference diagnostic console log",
    ],
  },
  {
    version: "0.15.8",
    date: "2026-05-20",
    changes: [
      "EIR Project Reference reader now extracts labels from ALL multi-select shapes — string arrays (Choice multi-select), ';#'-delimited strings, single strings, AND arrays of {LookupValue, ...} or {Label, TermGuid} objects (Lookup-multi and Managed-Metadata multi-select); previous version only pulled strings out of arrays and missed object shapes",
      "Added a one-time browser-console diagnostic that prints the exact type and value of ProjectReference on the first EIR — so the next disconnect (if any) is one round-trip away from being fixed",
    ],
  },
  {
    version: "0.15.7",
    date: "2026-05-20",
    changes: [
      "EIRs page now surfaces the underlying error message when the list fails to load (instead of silently showing 'No EIRs match the current filters') — so we can see exactly what Graph is rejecting",
    ],
  },
  {
    version: "0.15.6",
    date: "2026-05-20",
    changes: [
      "EIR Project Reference resolved at last — the column is a multi-select Choice field (text values), not a Lookup, so we now parse the array / `;#`-delimited string / single string Graph returns and display the chosen project name(s) joined by commas",
      "EIRs project filter now matches against the project's title text (not lookup ids), so filtering by project on the EIRs page and the dashboard scoping works again",
      "Removed the temporary yellow debug banner from the EIRs page",
    ],
  },
  {
    version: "0.15.5",
    date: "2026-05-20",
    changes: [
      "Fixed EIRs failing to load — the previous attempt to coax Graph into expanding the project lookup via $select was rejected by Graph (bare lookup column names aren't valid in $select), which 400'd the whole EIR list request; reverted to no-$select so the list loads again, and rely on the tolerant mapper from the prior release to read the bare ProjectReference value directly",
    ],
  },
  {
    version: "0.15.4",
    date: "2026-05-20",
    changes: [
      "EIR project reference reader now handles any shape SharePoint might return — plain integer, numeric string, free-text project name (like '2026-Cat Pyrometer, 133-6333'), expanded { LookupId, LookupValue } object, or managed-metadata { Label, WssId, TermGuid } — and displays whatever text/title it can extract, even when the lookup id is missing",
      "Added an inline yellow debug banner at the top of the EIRs page that auto-shows in real mode when the first EIR doesn't resolve a project — surfaces the raw field name + value + projects-list size right in the UI, so we can diagnose without DevTools",
    ],
  },
  {
    version: "0.15.3",
    date: "2026-05-20",
    changes: [
      "EIR descriptions and comments no longer render as unreadable black text on the dark theme — the rich-text editor in the original Power Apps form stamps inline color:black on every paragraph it produces, so we now strip inline style / color / bgcolor attributes during sanitise and let the theme own colour",
      "Switched EIR list fetch back to an explicit $select that asks for ProjectReferenceLookupId by name — Graph only materialises lookup ids when the suffixed column name is requested explicitly; without it, the bare ProjectReference field comes through but with no usable value",
      "Re-added a one-time browser-console diagnostic so we can verify the project lookup id is actually arriving this time",
    ],
  },
  {
    version: "0.15.2",
    date: "2026-05-20",
    changes: [
      "EIR Project Reference now actually resolves — SharePoint was returning the lookup under the bare 'ProjectReference' key (no LookupId suffix), so the previous reader and the scanner both missed it; reads now accept the bare key plus expanded { LookupId } shapes, and writes use the canonical 'ProjectReferenceLookupId' that matches the column",
      "Removed the temporary console diagnostic — we got what we needed",
    ],
  },
  {
    version: "0.15.1",
    date: "2026-05-20",
    changes: [
      "Added a one-time browser-console diagnostic that prints every field-name SharePoint returns for the first EIR — so we can see exactly what the project-reference column is called and stop guessing",
    ],
  },
  {
    version: "0.15.0",
    date: "2026-05-20",
    changes: [
      "Attachments are here: tasks and EIRs now have an Attachments card on the detail page where you can list, upload, download, and delete files attached to the SharePoint list item — needs the admin to grant the app SharePoint REST permission and set VITE_SP_SITE_URL; if it's not granted, the section shows a friendly notice instead of crashing",
      "Every loading screen now rotates through whimsical verbs (Wrangling, Coaxing, Reverse-engineering, Bamboozling…) so waiting feels less dead — same treatment for the task list, EIRs, test sheets, projects, admin, and every detail view",
      "EIR project reference now scans every field key for a project-shaped lookup id (any internal name with 'Project' and ending 'LookupId') — works regardless of how the SharePoint column was provisioned, and shows the lookup id as a fallback when the title hasn't joined yet",
    ],
  },
  {
    version: "0.14.5",
    date: "2026-05-20",
    changes: [
      "EIR Project Reference now resolves correctly — the field was being looked up under the wrong SharePoint internal name, so every EIR showed no project; reads now accept either name and writes use the canonical encoded-space form",
      "EIR Where Used moved to its own card above Part Details and now renders HTML content as formatted text instead of showing raw <p> tags — same treatment we gave Engineering Response",
    ],
  },
  {
    version: "0.14.4",
    date: "2026-05-20",
    changes: [
      "Dashboard's Mine / Company toggle is back, and it applies to whichever dataset you're looking at — flip to Company while focused on EIRs to see the team-wide EIR status breakdown, then flip back to Mine without losing your place",
    ],
  },
  {
    version: "0.14.3",
    date: "2026-05-20",
    changes: [
      "EIR list now labels the people column 'Assigned' instead of 'Engineers' so it matches what the task list calls the same thing",
      "EIR detail's Assigned picker is now a pill chooser — each assignee shows as a removable chip with an '+ Add person' expander, exactly like the task detail",
      "EIR detail's Watchers section moved to the bottom of the sidebar, mirroring the task detail layout so it's not in the way while triaging",
    ],
  },
  {
    version: "0.14.2",
    date: "2026-05-20",
    changes: [
      "Dashboard EIR card now counts EIRs assigned to you (not the team-wide open count) — and the Build Requests card is labelled to match the same 'assigned to you' framing",
      "Dashboard ECN card now shows a team-wide total rather than a personal slice",
      "Clicking the EIR card on the dashboard now pivots the status breakdown panel from Task statuses to EIR statuses — the breakdown follows whichever card you're focused on, with a ring around the active card",
      "Project filter at the top of the dashboard now scopes every card (Tasks, EIRs, ECNs, Build Requests)",
      "Removed the dated 'EIRs are mock' footer note — only ECNs and Build Requests are mock now",
    ],
  },
  {
    version: "0.14.1",
    date: "2026-05-20",
    changes: [
      "List and Kanban now dim themselves on the EIRs and Test Sheets pages — they're controls for the Tasks dataset only, so they shouldn't look as prominent when you're looking at a different list",
      "Every list (Tasks, Kanban columns, EIRs, Test Sheets) now sorts newest-first by creation date, so the freshly-added items are always at the top",
      "EIR Engineering Response now renders HTML correctly — previously, edits that came in from the original Power Apps form showed up as raw `<p>` tags; now they read as formatted text",
      "EIR detail sidebar tightened — each label now hugs its control properly, so dropdown choices no longer overlap the label above them",
      "EIR Task Reference is now a real hyperlink — when the reference matches a task in this app, an 'Open task' link appears that jumps straight to that task's detail page",
    ],
  },
  {
    version: "0.14.0",
    date: "2026-05-20",
    changes: [
      "Top nav reorganised — Dashboard / List / Kanban stay as direct links (they're all ways of looking at Tasks); EIRs and Test Sheets now live under a new 'Engineering Lists' dropdown so the nav doesn't get longer every time we add a SharePoint list",
      "EIR list rows now match the task list rows pixel-for-pixel — same three-column layout (identity on the left, project + people in the middle, last-comment preview on the right) plus comment-count and attachment indicators",
      "EIRs page has a header bar with the title and a short description, so it's obvious you're not looking at the task list",
    ],
  },
  {
    version: "0.13.0",
    date: "2026-05-20",
    changes: [
      "EIRs (Engineering Information Requests) are now a first-class part of the app — new 'EIRs' tab in the top nav with a list view (status pills + filter bar: Project, Assigned Engineer, Reporter, search), a detail page that mirrors the task detail layout (sidebar of editable fields, Part Details card, comments thread with @-mentions), and a 'New EIR' button that opens a create form",
      "Dashboard 'EIRs' card is no longer mock — it shows the real count of open EIRs (Status != Closed) and clicks through to the EIRs list scoped to your project filter",
      "Every EIR field is optimistic with toast + Undo, same as tasks — status, resolution, request type, requested priority, reporter, assigned engineers, watchers, project, task reference, requested completion date, LTB date, and all the part-detail fields (MFG, MFG P/N, Altronic Part Number, EAU, Current Stock, Current Price, Where Used, Buyer Code) plus the Engineering Response block",
      "User Manual has a new EIRs section with @-mention-friendly search keywords (ecr, temporary deviation, mfg eol, ltb, buyer code, where used, etc.) so questions like 'how do I create an EIR' or 'what is a request type' find the right place",
    ],
  },
  {
    version: "0.12.1",
    date: "2026-05-19",
    changes: [
      "User Manual now has a search box that understands natural questions — typing 'how do I mention someone' jumps to the Comments & @-mentions section. Each section has a list of keywords/synonyms so 'ping', 'tag', 'at-mention', and '@' all find the same content",
      "Matching sections are ranked best-first, the table-of-contents on the left re-orders to match, and a no-results state suggests alternative wordings",
    ],
  },
  {
    version: "0.12.0",
    date: "2026-05-19",
    changes: [
      "New User Manual page in the app — organised by task (Quick start, Dashboard, List, Kanban, Tasks, Comments, Test Sheets, Filters, Notifications, Undo, Mobile, Troubleshooting) with a sticky table of contents",
      "Link to the manual is the first item on the About page",
      "CLAUDE.md now spells out 'update the manual in the same commit' for any user-visible change, alongside the existing rule for the system diagrams",
    ],
  },
  {
    version: "0.11.4",
    date: "2026-05-19",
    changes: [
      "Mention email header simplified — solid black bar with just the 'Engineering Task System' wordmark; dropped the ALTRONIC line and the thin red accent stripe",
    ],
  },
  {
    version: "0.11.3",
    date: "2026-05-19",
    changes: [
      "Mention email theme switched to black + white with red accents — header is now black with a thin Cooper Red accent line; red is reserved for the task-callout edge and the CTA button. No image-based logo so every email client renders the same without blocked-images problems",
    ],
  },
  {
    version: "0.11.2",
    date: "2026-05-19",
    changes: [
      "@-mention emails redesigned: Cooper Red branded header with the ALTRONIC wordmark, the task title called out in its own block, the comment quoted in a card, and a proper red 'Open this task' button instead of a plain text link",
      "Body line now reads 'You were mentioned in a task by X' (was 'in a comment') so it scans cleanly at a glance",
      "Faint grey footer added: 'Do not reply to this email — it was automatically sent via the Engineering Task System'",
      "Table-based layout throughout so the email looks the same in Outlook, Gmail, Apple Mail, and mobile clients",
    ],
  },
  {
    version: "0.11.1",
    date: "2026-05-19",
    changes: [
      "Mentioning yourself now emails you — useful as a 'remind me later' that lands in your inbox. Previously self-mentions were silently filtered out",
    ],
  },
  {
    version: "0.11.0",
    date: "2026-05-19",
    changes: [
      "@-mentions in comments — start typing `@` and a picker pops up with everyone on the team (assignees + watchers across tasks + yourself). Arrow keys / Enter to pick; the chosen name becomes a styled chip in the comment",
      "Mentioning someone in a comment emails them automatically — subject 'You were mentioned in {task}', body greets them by name, quotes the comment, and includes a clickable link straight to the task. Image / file attachments on the comment ride along as email attachments",
      "Emails go out from a shared mailbox (configurable via the new VITE_SHARED_MAILBOX repo variable) using the signed-in user's Send-As permission — so recipients see a consistent 'from' address. Requires the new Mail.Send.Shared Graph scope (one-time admin consent). See CLAUDE.md for the setup steps",
      "Editing a comment only emails NEW mentions (people who weren't already pinged on the original post)",
      "Mock mode shows the email payload in the console so you can demo the flow without an Exchange mailbox configured",
    ],
  },
  {
    version: "0.10.0",
    date: "2026-05-19",
    changes: [
      "Every change you make now shows a small confirmation toast at the bottom-right of the screen — so you can see at a glance that something actually happened",
      "Most toasts include an Undo button — click it within ~7 seconds of an accidental change (status, priority, category, due date, parent task/project, related projects, assignees, watchers, watch/unwatch, comment edit, test sheet edit) and the previous value is restored both in the UI and on SharePoint",
      "Failures also surface as toasts — if a write was rejected the change rolls back automatically and a red toast tells you what happened",
      "Comment-add and task/test-sheet creation get confirmation toasts but no Undo button (SharePoint doesn't expose delete-a-comment, and recreating a deleted task would shift NumberedTitle counts)",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-05-19",
    changes: [
      "Every SharePoint write is now optimistic — status changes, priority/category/due-date edits, parent task and parent project changes, related projects, Assigned, Watchers, watch/unwatch, edit a comment, delete a task, and test-sheet field edits all update the UI the moment you click. The Graph round-trip happens in the background; if it fails, the cache rolls back to the previous state",
      "Previously only Kanban drag and adding a comment were optimistic — everywhere else, the UI waited for the server to round-trip before reflecting your change. That made detail-page edits feel laggy when SharePoint was slow",
    ],
  },
  {
    version: "0.8.2",
    date: "2026-05-19",
    changes: [
      "Dashboard rearranged so 'All Open Tasks' sits directly next to the status breakdown — the two team-level views are read together. Top row is now My Tasks + EIRs + ECNs + Build Requests; second row is All Open Tasks alongside the breakdown panel",
    ],
  },
  {
    version: "0.8.1",
    date: "2026-05-19",
    changes: [
      "Dashboard task-status breakdown now defaults to YOUR tasks (Mine), with a Mine / Company toggle in the panel header so you can flip to the full team view when you want to see how the workload is distributed",
      "Clicking a status bar deep-links to the List view respecting the current toggle — Mine → ?assigned=me, Company → ?assigned= (Anyone)",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-05-19",
    changes: [
      "New Engineering Dashboard as the landing page after sign-in — big-number cards for My Open Tasks, All Open Tasks, EIRs, ECNs, and Build Requests, plus a visual task-status breakdown panel",
      "Each dashboard card is filterable by Project Reference at the top of the page, and the task cards click through to the List view with the matching project + assignee + status filters pre-applied",
      "EIRs, ECNs, and Build Requests are mock counts for now — their SharePoint lists don't exist yet. The scaffolding is in place so wiring up real data later is a single-file swap (src/data/dashboardMockData.ts → a real hook)",
      "Header nav now has Dashboard + List as separate entries; bookmarked links to '/' show the dashboard, '/list' is the task list",
    ],
  },
  {
    version: "0.7.1",
    date: "2026-05-19",
    changes: [
      "About page diagrams simplified — system flow now collapses Views / Hooks / API into one vertical lane instead of one node per view, and the data model uses a left-to-right layout that doesn't fan as many arrows across the same lines",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-05-19",
    changes: [
      "New 'About' page in the footer — a high-level system map and data-model diagram showing how the views, hooks, API layer, Microsoft Graph, and the three SharePoint lists connect to each other",
      "Diagrams are rendered with Mermaid (lazy-loaded so the main bundle stays trim) and live as plain text inside src/views/AboutView.tsx — edit them in place when you add a structural piece",
      "CLAUDE.md now spells out 'updating the About diagrams' as part of the recipe for adding a view, hook, API module, or SharePoint list so the chart stays in sync with reality",
    ],
  },
  {
    version: "0.6.12",
    date: "2026-05-19",
    changes: [
      "NumberedTitle is back on new tasks — format T{n}-{projectRef}-{title} where n is the count of existing tasks under the chosen project + 1. Earlier we'd disabled the write thinking the column was read-only; it isn't, it was the people-field shape that was 400'ing. The list view, Kanban cards, detail page, and print view all already prefer NumberedTitle.",
      "Kanban cards now show NumberedTitle instead of the plain title (the only surface that was still showing the bare title).",
      "Internal: extracted multiPersonField/multiLookupField helpers in src/lib/graphFields.ts so every future form that writes a multi-person/multi-lookup field gets the @odata.type annotation for free — no more hand-built payloads and the same 400 trap waiting elsewhere.",
    ],
  },
  {
    version: "0.6.11",
    date: "2026-05-19",
    changes: [
      "Internal: removed the temporary createTask payload log — v0.6.9's @odata.type fix is confirmed working",
    ],
  },
  {
    version: "0.6.10",
    date: "2026-05-19",
    changes: [
      "Loading screen now rotates through whimsical verbs (Cogitating, Wrangling, Reticulating…) instead of a dry 'Loading tasks…', and explains that the first load is the slow one — subsequent loads come from cache",
      "Project Reference dropdowns now sort 0000, 0001, 0002, … 0010 (natural-numeric order) across the filter bar, the new-task form, and the test-sheet form",
      "Parent Task and Task Reference dropdowns sort the same way — T2 before T10, not the lexical T10 before T2",
    ],
  },
  {
    version: "0.6.9",
    date: "2026-05-19",
    changes: [
      "Fix (attempt 3): multi-value Assigned and Watchers writes now include the '@odata.type: Collection(Edm.Int32)' annotation alongside the integer array — the documented Graph v1.0 format. The v0.6.7 plain-array shape still got rejected; this third try is the format Microsoft actually documents",
    ],
  },
  {
    version: "0.6.8",
    date: "2026-05-19",
    changes: [
      "Internal: re-added the temporary createTask payload log — v0.6.7's fix didn't fully resolve the Graph 400, need another look at the body shape",
    ],
  },
  {
    version: "0.6.7",
    date: "2026-05-18",
    changes: [
      "Fix: creating or editing a task with people in Assigned or Watchers no longer 400s — the multi-person field write was using the old SharePoint REST shape ({ results: [123] }) which Microsoft Graph v1.0 rejects; switched to the plain array shape ([123]) it actually wants",
      "Removed the temporary debug log added in v0.6.6 — root cause identified",
    ],
  },
  {
    version: "0.6.6",
    date: "2026-05-18",
    changes: [
      "Internal: temporary console.log on task creation so we can see exactly which fields are being sent to SharePoint — diagnosing a stubborn Graph 400 on create. Will be removed once we figure out which field shape is wrong.",
    ],
  },
  {
    version: "0.6.5",
    date: "2026-05-18",
    changes: [
      "Fix: creating a task in real mode no longer 400s on the NumberedTitle field — it turns out that column is read-only / server-calculated on the live SharePoint list. The 0.6.4 attempt to write it directly was reverted. New tasks will display whatever SharePoint computes (which may be empty until the list's formula populates) and the mapper falls back to the plain Title in the meantime",
    ],
  },
  {
    version: "0.6.4",
    date: "2026-05-18",
    changes: [
      "New tasks now get an auto-generated NumberedTitle like T12-0017-Endurance run (counting under the chosen project + the project's 4-char code prefix) — previously the column was left blank in real mode so new tasks displayed as just their plain title",
      "Parent Project is now required on create — the dropdown opens to 'Select a project…' and the Create button stays disabled until you pick one",
      "Assigned and Watchers on the new/edit task form now use a searchable dropdown — same pattern as the filter bar — instead of the pill chooser",
      "Creating a task while your SharePoint identity is still resolving no longer aborts — the unresolved person is silently skipped on the wire rather than failing the whole submit",
    ],
  },
  {
    version: "0.6.3",
    date: "2026-05-18",
    changes: [
      "Apply the same 'omit empty fields on create' fix to new test sheets so submitting one in real mode doesn't fail on SharePoint's strict 400",
    ],
  },
  {
    version: "0.6.2",
    date: "2026-05-18",
    changes: [
      "Fix: creating a new task in real mode no longer fails with a Graph 400 — the API used to send null values for fields the user didn't pick (priority, category, due date, parent project) which SharePoint rejects on create; we now omit those fields instead",
    ],
  },
  {
    version: "0.6.1",
    date: "2026-05-18",
    changes: [
      "Sending a comment now feels instant — the comment appears in the thread the moment you click Send, while SharePoint catches up in the background (previously you waited 2-4 seconds for three Graph calls to round-trip)",
      "If the server rejects the comment, it's removed from the thread and an inline error appears above the composer so you can retry",
      "Removed the 'someone else just commented, send anyway?' modal — the existing background poll and 'new comments' banner handle that case non-blockingly",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-05-18",
    changes: [
      "New 'Test Sheets' tab in the top nav — see, search, create, and edit test sheets stored in the SharePoint Test Results list",
      "Each task now has a 'New Test Sheet' button on its detail page; click it to create a test sheet pre-linked to that task and its parent project",
      "Tasks that have test sheets show them as clickable pills on the task detail page",
      "Test sheets carry all 11 SharePoint columns: Title, Product, Serial Number, Purpose, Test Date, Project + Task references, Tester, Testing Steps, Results, Firmware Version",
    ],
  },
  {
    version: "0.5.2",
    date: "2026-05-18",
    changes: [
      "Filter dropdowns now have a search box at the top — type to narrow the options down instead of scrolling through every project or person",
      "Created By dropdown matches the same style as Project Reference and Assigned for consistency (was a native dropdown before)",
    ],
  },
  {
    version: "0.5.1",
    date: "2026-05-18",
    changes: [
      "Initial task load is meaningfully faster — we now only ask SharePoint for the ~15 columns the app actually uses, instead of all 200+ columns on the list",
      "Tasks and projects are fetched in parallel on first load instead of one after the other, saving another round-trip of latency",
      "Cached task list now stays 'fresh' for 2 minutes (was 30 seconds), so switching between List and Kanban or refocusing the tab doesn't trigger a refetch",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-05-18",
    changes: [
      "Project Reference and Assigned filters now accept multiple selections — pick a set of projects or a set of people and the list/board shows tasks matching any of them",
      "Status pill counts at the top of the list view now reflect what the other filters select — they answer 'of the tasks matching my filters, how many are in each status' instead of always showing the global counts",
      "Each multi-select shows an ✕ when you have selections; click it to clear that filter in one step",
    ],
  },
  {
    version: "0.4.3",
    date: "2026-05-18",
    changes: [
      "Task detail page no longer scrolls sideways when a comment or description contains a very long URL or unbroken string — long content now wraps to the column width",
      "Code blocks and tables inside comments now scroll inside themselves rather than pushing the whole page wider",
    ],
  },
  {
    version: "0.4.2",
    date: "2026-05-18",
    changes: [
      "Task detail page now shows 'Created By' in the sidebar — the person who created the task, taken from SharePoint's built-in created-by record (no extra Graph calls)",
      "Printable task view also includes Created By for documentation/audit purposes",
    ],
  },
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
