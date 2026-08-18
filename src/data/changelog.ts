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
    version: "0.97.1",
    date: "2026-08-18",
    changes: [
      "Visit dates now match the SharePoint list — every visit was showing a day early",
      "Fixed the white boxes in the New/Edit forms on Visit Reports, EIRs and Test Sheets — those fields had never been styled and ignored the dark theme",
      "Editing a visit report now saves only what you changed, so correcting a typo on an older report no longer fails because of a regional manager who has since left",
      "The Visit Reports table shows 500 rows before it truncates, and says clearly when there are more rather than looking like entries are missing",
    ],
  },
  {
    version: "0.97.0",
    date: "2026-08-18",
    changes: [
      "Customer Service / Sales joins ARC with Visit Reports — the regional managers' record of customer visits, reading and writing the same SharePoint list the team already uses",
      "File a visit with New Visit Report: customer, RM, reason, date, customer status and summary, plus action items, product, city and state",
      "Everything edits in place on the report page, and photos or quotes can be dragged onto its Attachments card",
      "Filter by RM, year, reason or customer status and search every field at once — a filtered view can be shared as a link",
      "The RM picker lists the current managers plus anyone already on an existing report, so older reports keep whoever actually filed them",
      "Visit reports can't be deleted from ARC — a report is a record of something that happened, so correcting one is an edit",
    ],
  },
  {
    version: "0.96.1",
    date: "2026-08-18",
    changes: [
      "You can now search people fields by first name AND surname — Assigned, Assigned Engineer, Reporter, Requestor, Watchers and Created By all kept finding nothing as soon as you typed a space",
      "The words match in any order, so \"jerrod w\" and \"waldron jerrod\" find the same person, and typing an email address finds them too",
      "@-mentions accept a full name as well: typing a space after the first name no longer closes the picker",
      "admin.first.last accounts are no longer listed in people fields — they don't receive email, so anything assigned to one went nowhere",
    ],
  },
  {
    version: "0.96.0",
    date: "2026-08-18",
    changes: [
      "You now automatically watch anything you create — tasks, EIRs, Operations tasks, panel orders, panel tasks, build requests and their parts — so you hear about comments and changes on your own work",
      "Assigning something to someone adds them as a watcher too, on the create form and on every later reassignment",
      "Being unassigned no longer stops you watching — use Unwatch when you want off a thread",
      "Comment threads now read in the order they were actually posted; comments from people in other time zones were being shuffled in among the rest",
      "Comment times are shown in your own local time whoever wrote them",
    ],
  },
  {
    version: "0.95.0",
    date: "2026-08-18",
    changes: [
      "EIR text now keeps its formatting when you save — paragraphs and line breaks were being collapsed into one run-on block",
      "You can bold, italicise, underline and make bulleted or numbered lists in an EIR's Description, Engineering Response and Where Used, with Ctrl+B / Ctrl+I / Ctrl+U",
      "Pasting from Word or Outlook into those fields keeps the formatting but drops the source's fonts and colours, so nothing lands unreadable on the dark theme",
      "A Description holding a checklist still uses the plain editor — checklist lines are text by design",
      "Drag files straight onto the Attachments card on a task or EIR — it highlights while you drag, and takes several files at once",
      "Picking multiple files with the Add file button now attaches all of them instead of just the first",
    ],
  },
  {
    version: "0.94.2",
    date: "2026-08-18",
    changes: [
      "Related Projects is now a searchable dropdown instead of a list of pills — open it and type to find the project rather than reading through every one",
      "This applies both on the task form and in the task detail sidebar, where the projects on the task stay above it as chips that open the project",
      "You can now take a project OFF a task from the detail sidebar — untick it in the dropdown; before this the sidebar could only add",
      "The New/Edit Task form shows each related project as a chip with its own ✕, and leaves the task's parent project out of the list",
    ],
  },
  {
    version: "0.94.1",
    date: "2026-08-18",
    changes: [
      "The User Manual now covers Quality Control — how the Digital QC and Ignition QC Defect Logs work, picking a product family, adding and editing entries, filtering and sorting, and the Pyrometer serial tiles",
      "The User Manual now covers the Coils department's Potting Sample Log, including the out-of-limit alert email and the Spec Limits / PSR Notification List screens",
      "The manual's Quick start and Dashboard sections now list every department that's live, instead of showing Panels, Operations, Coils, and Quality Control as coming soon",
      "Fixed the \"new version of ARC is available\" banner showing an older version number than the footer",
    ],
  },
  {
    version: "0.94.0",
    date: "2026-08-17",
    changes: [
      "Added the Coils department's Potting Sample Log — operators log a sample's date, volume, and weight, with today's date and a volume of 125 filled in by default",
      "A saved sample outside the spec limits automatically emails the Coil PSR Notification List with the entry's values and the current limits",
      "Any signed-in user can edit the Lower/Upper Spec Limit and manage the PSR Notification List from a \"Manage lists\" menu on the Potting Sample Log page, same as Teradyne's reference lists",
    ],
  },
  {
    version: "0.93.2",
    date: "2026-08-17",
    changes: [
      "Added the Ignition QC Defect Log, with 36 product families each backed by their own live SharePoint list",
      "Ignition QC has the same add/edit form, all-fields filter, sortable columns, and hoverable Comments icon as Digital QC",
      "Ignition QC entries resolve each SharePoint list's actual column names before loading or saving",
      "The About page now documents the Ignition QC view, hook, API, and 36 SharePoint lists",
      "The Ignition QC Defect Log card on the Dashboard now links to the real page instead of showing \"Coming soon\"",
      "Digital QC and Ignition QC now show the product-family buttons full width first; picking one opens that family's table and a \"Change product family\" button brings the buttons back",
    ],
  },
  {
    version: "0.93.1",
    date: "2026-08-14",
    changes: [
      "Digital QC now has a live product-family selector with family-specific records and a form for adding defect entries",
      "Digital QC forms now include Comments, StartSN, EndSN, To RP, and Other, with numeric fields defaulting to 0",
      "Digital QC entries resolve each SharePoint list's actual column names before loading or saving",
      "Digital QC lists can now be filtered across all fields and sorted by any data column",
      "Comments now appear as a hoverable icon in the list and as a larger multiline field at the bottom of the form",
      "The Physical Damage label is corrected in the form while preserving the existing SharePoint column name",
      "The QC department now includes a working Digital QC page backed by live SharePoint product-family lists",
      "Pyrometer now shows the latest EndSN used this calendar month for each tracked Old Material number",
      "The About page now documents the Digital QC views, hook, API, 18 SharePoint lists, and shared data shape",
    ],
  },
  {
    version: "0.91.1",
    date: "2026-08-14",
    changes: [
      "Fixed the Assigned filter finding none of your tasks — your sign-in spells your address with capitals while SharePoint stores it lowercase, and the two weren't being treated as the same person",
      "This also fixes the list opening empty on \"Assigned to me\", and the same problem on the Created By filter and the Operations task list",
      "Someone assigned under two spellings of their name is now one entry in the dropdown that finds all of their tasks",
      "Filter links shared before this fix still work",
    ],
  },
  {
    version: "0.91.0",
    date: "2026-08-14",
    changes: [
      "Every date in the app is now picked from a calendar instead of typed — click the field, click the day",
      "This ends the save errors when entering a date: a typed date briefly looked like the year 0002 while you were still typing it, and that was being sent to SharePoint",
      "Dates now read as \"May 1, 2026\" rather than 2026-05-01, with Today and Clear shortcuts and arrow-key navigation",
    ],
  },
  {
    version: "0.90.0",
    date: "2026-08-14",
    changes: [
      "Fixed tasks refusing to save with \"Invalid request\" whenever a label was picked — creating or editing a labelled task works again",
      "A task now takes one label instead of several, which is all the SharePoint list has ever been able to store; picking a label replaces the current one",
      "Existing tasks keep the label they already have",
    ],
  },
  {
    version: "0.89.3",
    date: "2026-08-14",
    changes: [
      "Fixed \"Couldn't save changes — reverted. Graph 404 Not Found\" when typing a date: the field saved after the first digit of the year, sending a year like 0002 that SharePoint can't store",
      "Date fields now wait for a real year before saving, so you can type the whole date without an error",
      "Every date field in the app now refuses years before 1900 or after 2999 instead of accepting a typo",
    ],
  },
  {
    version: "0.89.2",
    date: "2026-08-14",
    changes: [
      "An EIR's LTB Date is now a Supply Chain field once the EIR is submitted — anyone can still enter one on the New EIR form, but only Supply Chain can change it afterwards",
      "The locked field shows a padlock and says who can edit it, instead of just refusing to change",
      "The EIR Roles admin page now lists LTB Date among what the Supply Chain role unlocks",
    ],
  },
  {
    version: "0.89.1",
    date: "2026-08-14",
    changes: [
      "A task's Assigned field is now a dropdown with a search box — type a few letters to find someone instead of scanning a wall of names",
      "Watchers changed the same way on tasks, EIRs, build requests, build request parts, panel orders and panel tasks, so every people field in the app now works alike",
      "The people already picked stay visible as chips you can remove one at a time",
      "Anyone already on an item still appears in the list even if they've since dropped out of the staff directory",
    ],
  },
  
  {
    version: "0.89.0",
    date: "2026-08-11",
    changes: [
      "Admin → EIR Roles: adding someone is now a search over people already in the system — pick a name and their email fills itself in, instead of typing an address that has to match exactly",
      "Someone already on the roles list is no longer offered a second time, which used to create a duplicate row whose roles silently did nothing",
      "If the staff directory can't be loaded, the page says so and still lets an admin enter an email by hand rather than leaving them stuck",
      "The EIR Roles page now spells out what each role unlocks — Engineer covers Engineering Response and Technical Priority, Supply Chain covers Buyer Code, Risk Part and Risk Part Level — and states plainly that every other EIR field stays open to everyone",
      "EIR Roles is now linked from the Panel Projects admin page too, so it's reachable from every page in the Admin Center",
    ],
  },
  {
    version: "0.88.2",
    date: "2026-08-11",
    changes: [
      "An EIR's Assigned engineers is now a dropdown with a search box — type a few letters to find someone instead of hunting through every name in the company",
      "The people already assigned stay visible as chips you can remove individually, and anyone currently assigned still appears in the list even if they've since left the staff directory",
    ],
  },
  {
    version: "0.88.1",
    date: "2026-08-11",
    changes: [
      "Naming a pasted screenshot now handles a name pasted in from somewhere else: a line break or tab inside it reads as a space, so \"pump curve.png\" comes out as you'd expect instead of \"pumpcurve.png\"",
      "Stray invisible characters in a typed name are dropped silently rather than leaving a stray dash in the filename",
      "Internal: the filename module no longer stores those invisible characters in its own source, which had made the file unreadable to code review",
    ],
  },
  {
    version: "0.88.0",
    date: "2026-08-11",
    changes: [
      "Uploads now go up to 250 MB instead of 4 MB — a big drawing, a photo set or a short video attaches like any other file; anything over about 4 MB is sent in chunks, so it just takes longer rather than being refused",
      "Paste a screenshot straight into a comment with Ctrl+V — take it with Win+Shift+S and paste",
      "Pasting a screenshot now asks you to name it before it attaches, instead of silently filing it away as screenshot-date-time.png; Cancel discards the paste instead of attaching it",
      "The named screenshot uploads to the task's SharePoint project folder like any other attachment, not as a picture pasted into the comment itself",
      "Ctrl+V also works in the Attachments card — click the card first so it has focus, then paste",
      "Naming a file the same as one already in the project folder no longer overwrites it — it's saved as name (2).ext instead",
      "Copying cells from Excel or text from Word still pastes as text, not as a picture of it",
      "A failed large upload no longer leaves a half-written file behind, and a dropped chunk is retried before the upload gives up",
    ],
  },
  {
    version: "0.87.0",
    date: "2026-08-11",
    changes: [
      "Comments now email whoever the item is assigned to as well as its watchers, whether or not anyone was @-mentioned — an update on a task, EIR, Operations task, build request, panel order or panel task no longer reaches only the people tagged in it",
      "The email says why it arrived: mentioned, assigned to you, or watching",
      "Build request parts don't have an Assigned field, so comments on a part still go to its watchers and anyone mentioned",
    ],
  },
  {
    version: "0.86.0",
    date: "2026-08-03",
    changes: [
      "Saving a task edit now closes the form straight away instead of waiting on SharePoint \u2014 the change was already showing on the page behind it",
      "Checking or unchecking a box by editing the description text now records your name and the time, the same as clicking the checkbox does; a timestamp left over from an earlier click no longer contradicts the box beside it",
      "Saving a task you didn't change no longer rewrites its due date, which was a wasted write on every save and could shift the date a day",
    ],
  },
  {
    version: "0.85.0",
    date: "2026-08-03",
    changes: [
      "If you don't have permission to send notification email, posting a comment now tells you so and names who wasn't notified, instead of looking like it worked \u2014 the message says to ask IT for Send As on the notifications mailbox",
      "The same message appears when a change alert can't be sent, and an ordinary send failure (a network blip, a bad address) is reported separately so it isn't mistaken for a permissions problem",
      "Either way the comment or change is still saved \u2014 the message says so, so nothing gets retyped",
    ],
  },
  {
    version: "0.84.0",
    date: "2026-08-03",
    changes: [
      "Selecting text in a form no longer closes the window and loses what you typed \u2014 dragging past the edge of a dialog to highlight (backwards or forwards) used to be read as clicking outside it",
      "Indent a checklist line with Tab to make it a sub-task of the item above it; Shift+Tab outdents, and the parent shows how many of its sub-tasks are done",
      "Filters now survive switching between List and Kanban, in both directions and for Operations tasks too \u2014 the Assigned filter no longer snaps back to just your own tasks",
      "The @-mention list reaches everyone who matches instead of stopping at six, scrolls with the arrow keys, and says when there are more matches to narrow down; the comment edit box got the same fix",
      "Task edits show up immediately and the save no longer waits on one round-trip per changed field; a failed write rolls back and tells you",
      "Single-select dropdowns no longer show checkboxes, which promised you could tick several",
      "The Report Issue description box grows as you type, and its window scrolls instead of pushing Send off-screen",
      "Report Issue now sends every captured console error rather than trimming the list, and shows them in full instead of cut off",
    ],
  },
  {
    version: "0.83.0",
    date: "2026-08-03",
    changes: [
      "Every dropdown in every form now has a search box — Status, Priority, Category, Parent Project, Parent Task, EIR request type and buyer code, Operations task type and location, Panel task type, Build Request type, lead time, sample phase, part type and disposition, and the project picker when promoting an EIR",
      "Type to filter instead of scrolling: picking a project out of a long list no longer means hunting through it",
      "Fields that must always hold a value (a task Status, an EIR request type) no longer offer a way to empty them by mistake",
    ],
  },
  {
    version: "0.82.3",
    date: "2026-07-30",
    changes: [
      "Cleaner top half on the Drawing Work Sheet: the underline is gone from any field that already has a value, and stays only on the fields you fill in by hand",
    ],
  },
  {
    version: "0.82.2",
    date: "2026-07-30",
    changes: [
      "Bigger type on the Drawing Work Sheet's top three sections, using up the extra height the blank lines didn't need — the change history keeps its smaller type so its columns still fit",
      "More space above each of the sheet's three section rules, so it sits better on the page",
    ],
  },
  {
    version: "0.82.1",
    date: "2026-07-30",
    changes: [
      "The print dialog for a Drawing Work Sheet now opens as soon as the sheet is ready instead of after a fixed pause",
      "A drawing with a long change log no longer pushes the panel past the screen: the header stays put — so the Work Sheet button is always reachable — and the change log scrolls inside it",
      "Delete and Edit details stay pinned at the bottom of the panel for the same reason",
    ],
  },
  {
    version: "0.82.0",
    date: "2026-07-30",
    changes: [
      "New Work Sheet button on a CAD drawing prints the Drawing Work Sheet (FORM #E006) on 8.5 × 11, filled in from the register and ready to accompany the drawing",
      "The printed sheet includes what the old form left off — the Entered By and By initials, and the second half of the change history (revisions 9–16); all sixteen slots print, numbered",
      "Prototype / Preliminary / Production, the checked-approved, entered-in-system and to-mylar dates, and the whole Print Distribution block print as blank ruled lines to complete by hand",
    ],
  },
  {
    version: "0.81.2",
    date: "2026-07-30",
    changes: [
      "Dropped the \"Entry name (built automatically)\" box from the Teradyne entry form — it only repeated the product and defective parts you'd just entered; the name is still built for you when you save",
    ],
  },
  {
    version: "0.81.1",
    date: "2026-07-30",
    changes: [
      "The Teradyne clock-number list now shows just the numbers — the name appeared twice, once in each box, and the Employee field beside it already says who it is",
    ],
  },
  {
    version: "0.81.0",
    date: "2026-07-30",
    changes: [
      "On a Teradyne log entry you can now pick the clock number as well as the name, and each fills the other in — pick a person and their number appears, pick a number and their name appears",
      "Clock numbers read as \"#Clock · Name\" in their own list, so you can find someone by number without knowing the spelling of their name",
      "Clearing either the name or the clock number clears both, since they're two ways of naming the same person",
    ],
  },
  {
    version: "0.80.1",
    date: "2026-07-30",
    changes: [
      "Signing back in after a timeout now works on the first try — one password prompt puts the whole page back, instead of leaving a row of red \"couldn't load\" errors that had to be cleared with repeated Retry clicks",
      "When your sign-in expires you now get the sign-in screen, which says what happened and that nothing has been lost, rather than the app half-loaded behind a warning banner",
      "Sign-in problems are explained in plain words instead of the raw Microsoft error text",
    ],
  },
  {
    version: "0.80.0",
    date: "2026-07-30",
    changes: [
      "Change-log entries on a drawing can now be corrected, not just added — hover a row and use the pencil; clearing all three values empties that slot and frees it for reuse",
      "CAD drawings now carry By, Entered By and Software, which work like drop-downs built from the values already in use while still letting you type a new one — a new value becomes a choice for everyone once saved",
      "Removed the New Drawing field from the add and edit forms for CAD drawings; existing values still show on the drawing's panel",
      "A task's project reference now shows read-only directly under the task title, so which project a task belongs to no longer needs hunting for",
    ],
  },
  {
    version: "0.79.0",
    date: "2026-07-29",
    changes: [
      "Anyone can now correct a Teradyne log entry, not just admins — deleting one is still admin-only, since an edit leaves a corrected record where a delete leaves nothing",
      "You can find yourself in the Employee box by typing either your name or your clock number; each person now reads as \"Name · #Clock · Work centre\"",
    ],
  },
  {
    version: "0.78.0",
    date: "2026-07-29",
    changes: [
      "Fixed the CAD Drawings tab showing empty rows — CAD stores its drawing title, CAD number, dates and size under different column names from the other registers, and the app was looking for the wrong ones",
      "Each register now shows its own columns: CAD has a drawing number and a separate CAD number, completed and drawing dates; CCC and CEC keep part number and description; Sketches keeps its sketch number and Ventura reference",
      "Recording a change updates whichever revision and date columns that particular register uses",
      "Searching a register now covers every field it actually has, including its ECNs",
    ],
  },
  {
    version: "0.77.0",
    date: "2026-07-29",
    changes: [
      "The Dashboard's Drawing File Logs and Teradyne Log cards now describe what they hold instead of showing a count — neither is \"open work\", so a running total said little",
      "The Dashboard loads faster as a result: it no longer pulls the drawing and Teradyne registers just to put a number on a card",
    ],
  },
  {
    version: "0.76.1",
    date: "2026-07-29",
    changes: [
      "CAD Drawings now appears as the fourth tab on Drawing File Logs",
    ],
  },
  {
    version: "0.76.0",
    date: "2026-07-29",
    changes: [
      "New under Engineering: Drawing File Logs — CCC Drawings, CEC Drawings and Engineering Sketches as tabs on one screen, with CAD Drawings to follow",
      "Click any drawing for its full record and its change log — the revisions and ECNs that SharePoint keeps spread across 48 columns, shown as a readable table",
      "Search finds a drawing by its ECN as well as by number, part number or description, so you can ask which drawing a change notice affected",
      "Admins can add drawings, edit details, and record a change — which also updates the drawing's current revision",
      "Recording a change is refused, with an explanation, once a drawing's sixteen change slots are used, rather than overwriting the oldest entry",
      "Engineering Sketches is shown with its own columns and no change log, because the list genuinely doesn't have one",
    ],
  },
  {
    version: "0.75.1",
    date: "2026-07-29",
    changes: [
      "Adding, editing and deleting a CSA listing is now blocked for non-admins at the point of saving as well as in the UI, so the restriction holds however the app grows",
    ],
  },
  {
    version: "0.75.0",
    date: "2026-07-29",
    changes: [
      "New under Engineering: CSA Listings — the register of Altronic's CSA certification files, with the products and part numbers each file covers, when it was certified, and its history",
      "Certificates and supporting documents attach to a listing",
      "One search box covers everything including the long fields, so you can find a file by a part number listed inside it — not just by file number or product",
      "Adding, editing and deleting listings is limited to admins, since these are compliance records; reading and searching are open to everyone",
      "A CSA Listings card on the Dashboard shows how many files are on record",
    ],
  },
  {
    version: "0.74.0",
    date: "2026-07-28",
    changes: [
      "Admins can now pull up a past year on the Teradyne Log (five years back) — so an entry made in late December can still be corrected in January instead of disappearing on the 1st",
      "While a past year is showing, the page says so and offers a one-click way back to the current year; new entries are still logged against today's date",
      "Everyone else continues to see the current year only",
    ],
  },
  {
    version: "0.73.0",
    date: "2026-07-28",
    changes: [
      "Removed the year picker from the Teradyne Log — it shows the current year, and the header says so; older entries are read in SharePoint where the reporting lives",
    ],
  },
  {
    version: "0.72.2",
    date: "2026-07-28",
    changes: [
      "Removed the \"loading the slow way\" notice from the Teradyne Log — the entries shown were always the year you picked, so it flagged a fault where there wasn't one",
      "The log stops re-trying a filter SharePoint has already refused, saving a wasted request on every load",
    ],
  },
  {
    version: "0.72.1",
    date: "2026-07-28",
    changes: [
      "Fixed the Teradyne Log loading every row instead of just the chosen year — the date filter sent to SharePoint was malformed, so it was being rejected",
      "The \"loading the slow way\" notice no longer blames a missing column index (wrong below 5,000 rows) — it now shows exactly what SharePoint said, so the real cause is visible",
    ],
  },
  {
    version: "0.72.0",
    date: "2026-07-28",
    changes: [
      "The Teradyne Log now opens on the current year instead of loading every entry — with the legacy history imported the list runs past 16,000 rows, and pulling all of it made the page slow for no benefit",
      "Added a Year picker: any of the last five years, or All years when you really need the archive. The year is part of the link, so a shared URL opens on the same year",
      "The Dashboard's Teradyne card now counts entries logged this year (it used to say \"last 30 days\", which would have quietly undercounted each January)",
      "Reference lists still check every year before letting you delete a product, employee or remark — so a row used only by legacy entries can't be removed",
      "If SharePoint can't filter the log by year, the app says so and names the fix instead of just being slow",
    ],
  },
  {
    version: "0.71.0",
    date: "2026-07-28",
    changes: [
      "Editing and deleting Teradyne log entries is now limited to admins — anyone signed in can still add an entry",
      "Non-admins no longer see an Actions column on the log, with a note under the table explaining who to ask when something needs correcting",
      "Operator notes now show in the table under Defective Parts, so everyone can read them without opening an entry",
    ],
  },
  {
    version: "0.70.0",
    date: "2026-07-28",
    changes: [
      "\"Old SAP Number\" on a Teradyne log entry is now \"Altronic Part Number\"",
      "The log table gives the SAP number and the Altronic part number their own columns, instead of showing whichever one was filled in under a single \"SAP\" heading",
      "Searching the log still matches both numbers, and the manual finds the field under either its old or new name",
    ],
  },
  {
    version: "0.69.1",
    date: "2026-07-28",
    changes: [
      "The Dashboard's Teradyne Log card no longer shows an empty status bar reading \"Nothing active right now\" — the log is a record of what happened, not open work with statuses",
    ],
  },
  {
    version: "0.69.0",
    date: "2026-07-28",
    changes: [
      "Clock numbers on a Teradyne log entry are now view-only — they fill in from the employee you pick and are maintained in one place, under Manage lists → Employees",
      "If a picked employee has no clock number, the entry now says so instead of showing an empty box",
      "Teradyne Remarks now show their remark number, and you enter one when adding a remark",
      "A remark's number can be corrected later with the pencil, and remarks without a number are clearly marked",
    ],
  },
  {
    version: "0.68.2",
    date: "2026-07-28",
    changes: [
      "Clearer wording when a Teradyne log entry is missing its product — the message no longer just repeats the dropdown's own \"Pick a product\" text",
    ],
  },
  {
    version: "0.68.1",
    date: "2026-07-28",
    changes: [
      "Teradyne Log now handles its real size (~1,470 entries and growing): the table shows the newest 200 matching entries with a \"Show all\" button underneath, so searching and filtering stay quick",
      "Filters, the entry count and the board totals still cover the whole log — only the rows drawn on screen are limited",
      "The log loads in fewer round trips from SharePoint",
    ],
  },
  {
    version: "0.68.0",
    date: "2026-07-28",
    changes: [
      "New under Operations: the Teradyne Log — board test failures off the Teradyne / Spea stations, as a filterable table with a form for adding and editing entries",
      "Filter the log by Product, Remark or Employee, or search across everything including SAP numbers and operator notes; the filters live in the URL so you can share exactly what you're looking at",
      "An entry's name is built for you as \"Product - Defective Parts\" and previewed as you type, so it can never drift from the fields it's made of",
      "Picking an employee fills in their clock number automatically, and you can still override it",
      "New \"Manage lists\" menu on the Teradyne Log for editing its three lookup lists — Employees, Products and Remarks — with no admin rights needed",
      "Each lookup row shows how many log entries use it, and rows still in use can't be deleted, so past entries can't be broken by tidying up",
      "A Teradyne Log card on the Dashboard shows how many entries were logged in the last 30 days",
    ],
  },
  {
    version: "0.67.1",
    date: "2026-07-28",
    changes: [
      "Fixed the \"session expired\" screen that could block sign-in: a stale session no longer takes over the whole page or signs you out — the app just loads",
      "If a request does find your Microsoft sign-in has gone stale, you now get a banner at the top instead, with a \"Sign in again\" button that reloads the page's data in place (and a × to dismiss it)",
      "Attachment and site-user calls that SharePoint rejects no longer make the whole app claim your session expired — they show the existing \"attachments unavailable\" notice on their own",
      "A freshly completed sign-in no longer briefly reports itself as expired",
    ],
  },
  {
    version: "0.67.0",
    date: "2026-07-23",
    changes: [
      "You can now edit your own older / imported comments across every area (Engineering, EIRs, Operations, Build Requests, Panels) — the Edit pencil now recognizes a comment as yours by your name as well as your email, so comments carried over from the previous system are editable too",
    ],
  },
  {
    version: "0.66.0",
    date: "2026-07-20",
    changes: [
      "The About page now shows a live \"Staff directory\" status — how many people the assign / @-mention pickers loaded from the company directory, or the exact reason it couldn't — so a \"can't see certain people\" problem is no longer invisible",
      "Added a \"Retry / grant access\" button there that re-requests directory access without a full sign-out: it recovers a session that predates the permission, and pops the Microsoft consent prompt if User.ReadBasic.All still needs admin approval",
      "If the directory ever comes back empty, the app now retries it shortly after instead of caching the empty result for hours, so the pickers recover on their own once access is fixed",
    ],
  },
  {
    version: "0.65.1",
    date: "2026-07-20",
    changes: [
      "The assign / @-mention people list now draws from the whole company directory (all Entra users, external guests excluded) instead of a specific group — simpler and always current",
    ],
  },
  {
    version: "0.65.0",
    date: "2026-07-20",
    changes: [
      "You can now assign or @-mention anyone at Altronic — the person pickers and mention dropdown list the whole staff directory, not just people already on an item",
      "Picking someone the app has never seen wires up their SharePoint access automatically the first time you assign or mention them, so it just works",
      "Until IT enables the staff directory, the pickers safely fall back to people already known to the app — nothing breaks in the meantime",
    ],
  },
  {
    version: "0.64.1",
    date: "2026-07-17",
    changes: [
      "Detail pages now show which section you're in at the top — a labelled chip (Engineering Tasks, EIRs, Build Requests, Panel Orders, Panel Tasks, Operational Tasks, Test Sheets) next to the Back button, and clicking it jumps straight to that section's list",
    ],
  },
  {
    version: "0.64.0",
    date: "2026-07-17",
    changes: [
      "New Panel Tasks feature in the Panels department — track drawings, SOOs, quotes, and admin work from the new Panels menu entry and Dashboard card",
      "Each panel task has a status (Pending/In Process/On Hold/Complete), a task type, an assignee, a project reference, watchers, attachments, comments with @-mentions, and a Description that supports checklists",
      "Status pills (Open = not Complete), project/assignee/search filters, and a 'mine' view from the Dashboard card (your tasks = assignee or watcher)",
      "Status changes, assignee changes, comments, and checklist toggles on panel tasks send the same email alerts as everywhere else",
    ],
  },
  {
    version: "0.63.0",
    date: "2026-07-17",
    changes: [
      "If a change you make ever fails to save to SharePoint, ARC now emails you a copy of exactly what you entered plus the reason it failed — so your work is never silently lost, even when a save can't go through",
      "The recovery email includes the specific fields or comment text you typed and plain-language guidance on what to do next",
    ],
  },
  {
    version: "0.62.1",
    date: "2026-07-17",
    changes: [
      "Saves and loads now automatically wait out SharePoint throttling and brief network blips — the app retries in the background (honoring SharePoint's requested wait time) instead of failing and reverting your edit",
      "Creates and emails never auto-retry after a network drop, so a hiccup can't double-post an item or double-send a notification",
    ],
  },
  {
    version: "0.62.0",
    date: "2026-07-17",
    changes: [
      "New Panels department: Panel Orders — track panel sales orders (status, sales/purchase order numbers, customer, engineer, watchers) from the new Panels menu and Dashboard card",
      "Panel order detail page with inline editing, comments with @-mentions, file attachments, and Order Notes that support checklists (who/when stamps + email alerts included)",
      "Status pills (Open = not Shipped), project/engineer/search filters, and a 'mine' view from the Dashboard card (your orders = engineer or watcher)",
      "Two new admin pages: Panel Projects (/admin/panel-projects) manages the project reference numbers orders pick from; Panel User Roles (/admin/panel-roles) tags panel team members with roles for future field-level permissions",
      "Status changes, engineer changes, comments, and checklist toggles on panel orders send the same email alerts as other departments",
    ],
  },
  {
    version: "0.61.1",
    date: "2026-07-17",
    changes: [
      "@-mentioning someone now shows them in the watchers list immediately — no more waiting on the SharePoint save and list refresh (applies to tasks, Operations tasks, EIRs, and build requests + parts)",
    ],
  },
  {
    version: "0.61.0",
    date: "2026-07-17",
    changes: [
      "Checking or unchecking a Description checklist box now emails the item's watchers and assigned people — the email names the item and whether it was checked (✓) or unchecked (✗)",
      "Works on Engineering tasks, Operations tasks, and EIRs; as always, you're never emailed for your own action",
    ],
  },
  {
    version: "0.60.1",
    date: "2026-07-17",
    changes: [
      "Checking a checklist box is now instant — no confirmation pop-up; your name and the time are still recorded next to the item",
      "Unchecking a checklist box now asks \"Are you sure?\" and records who unchecked it and when (✗ stamp), instead of silently clearing the record",
    ],
  },
  {
    version: "0.60.0",
    date: "2026-07-17",
    changes: [
      "Checking a Description checklist box now records who checked it and when, shown in small print next to the item (works on Engineering tasks, Operations tasks, and EIRs)",
      "Checklist boxes now ask \"Are you sure?\" before checking or unchecking, so an accidental click doesn't record a false check or wipe an existing record",
    ],
  },
  {
    version: "0.59.4",
    date: "2026-07-17",
    changes: [
      "User Manual now fully documents build request notifications — part comments going to the part's own watchers, Engineer Assigned and Part Status alerts, the requestor's role as a recipient, and which edits deliberately stay quiet",
    ],
  },
  {
    version: "0.59.3",
    date: "2026-07-16",
    changes: [
      "Fix the Build Request detail sidebar spilling its fields outside the card when a project chip was long (same latent fix applied to the Task and Operations detail sidebars)",
    ],
  },
  {
    version: "0.59.2",
    date: "2026-07-16",
    changes: [
      "When you don't have access to another team's SharePoint site, the Dashboard now shows a friendly note in that team's section (naming the site to request access to) instead of a scary red error — and reassures you the rest of ARC still works",
    ],
  },
  {
    version: "0.59.1",
    date: "2026-07-16",
    changes: [
      "Fix the part print dialog opening before the page finished loading (it was snapshotting the loading screen)",
    ],
  },
  {
    version: "0.59.0",
    date: "2026-07-16",
    changes: [
      "Lead Free (RoHS) build requests now show a green Lead Free flag on the list and detail pages",
      "Each build request part has a Print part button — a printer-friendly page for the production floor with quantities, drawings, WO No, process selections, checklist state, and a large Lead Free warning banner when applicable",
      "Removed the Product field from the build request header — parts already carry the product details",
    ],
  },
  {
    version: "0.58.1",
    date: "2026-07-16",
    changes: [
      "You now always appear in the people filter dropdowns (Assigned, Engineer, Requestor, Created By) on every list, even before you're on any item — so a Dashboard \"Mine\" click-through visibly shows who it's filtered to",
      "Clicking the Build Requests card in Mine scope now shows a clear \"Showing your build requests\" banner with a Show-all button, and correctly matches the card's count (requests you made OR are the engineer on)",
    ],
  },
  {
    version: "0.58.0",
    date: "2026-07-16",
    changes: [
      "New: Build Requests — the full workflow from the old Power Apps dashboard, now in ARC (Engineering menu → Build Requests, plus a Dashboard card)",
      "Each request gets an auto-assigned BR number and carries status, type, lead time, requestor, engineer, and customer info, with any number of parts underneath",
      "Parts expand in place to edit everything inline — WO No, Part Status, Assembly/Operations/Testing — with the PCB data-package checklist on PCB parts and the harness checklist on Harness parts",
      "Comments work at two levels: on the request and on each individual part, each with @-mentions, watchers, emails, and attachments — part mentions email a link that opens the request with that part expanded",
      "Searching a part number finds its build request, and old comments migrated from Power Apps keep their @-mentions working",
    ],
  },
  {
    version: "0.57.2",
    date: "2026-07-16",
    changes: [
      "The Dashboard's load-error banner now names exactly which data source failed (and why), with a Retry button that refetches just the failed ones — no more full-page refresh guessing",
    ],
  },
  {
    version: "0.57.1",
    date: "2026-07-16",
    changes: [
      'Rewrite the search box placeholder in plain language ("Search anything — add words to narrow")',
    ],
  },
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
