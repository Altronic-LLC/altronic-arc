import { useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  Info,
  RefreshCw,
  Users,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CURRENT_VERSION } from "@/data/changelog";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { DIRECTORY_KEY, useDirectoryDiagnostics } from "@/hooks/useDirectory";
import { grantDirectoryAccess } from "@/api/directory";
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
      { label: "Views", hint: "Dashboard · List · Kanban · Detail · EIRs · Test Sheets · Project Folders · CSA Listings · Drawing File Logs · Digital QC · Ignition QC · Coil Defect Log · Potting Sample Log · Visit Reports (list + calendar) · QC Time Tracking · Panel QC Issue Tracker · Open Orders Report · Gray Market Requests · Where Am I? · ECNs · FAITs · ARC Feature Requests · Drawing Work Sheet (print) · Admin (incl. Quick Links)", palette: "ui" },
      { label: "React Query hooks", hint: "useTasks · useEirs · useTestSheets · useBuildRequests · useCsaListings · useDrawingLogs · useDigitalQc · useIgnitionQc · useCoilsQc · usePottingSampleLog · useVisitReports · useQcTimeTracking · usePanelQcIssues · useOpenOrdersReports · useOpenOrdersCustomers · useGrayMarketRequests · useWhereAmI · useEcns · useFaits · useCustomerNotes · useCustomerContacts · useSpecialPricing · useCapacity · useSuppliers · useSupplierContacts · useSupplierIssues · useCostImpactNotices · useFeatureRequests · useAdmins · useEirRoles · useQuickLinks · useTaskFiles · useProjectFolders", palette: "ui" },
      { label: "API layer", hint: "src/api/tasks · eirs · testSheets · buildRequests · buildRequestItems · csaListings · drawingLogs · digitalQc · ignitionQc · coilsQc · pottingSampleLog · visitReports · panelQcIssues · openOrdersFiles · openOrdersCustomers · openOrdersRoles · grayMarketRequests · whereAmI · ecns · faits · customerNotes · customerContacts · specialPricing · capacity · suppliers · supplierContacts · supplierIssues · costImpactNotices · featureRequests · autoWatch · panelOrders · panelTasks · admins · eirRoles · panelRoles · quickLinks · directory · siteUsers · projectFiles · attachments · email · errorReport · editFailureReport", palette: "ui" },
      {
        label: "Open Orders Report (lazy-loaded)",
        hint: "OpenOrdersView · OpenOrdersCustomersView — reads a raw SAP extract in the browser and writes a branded master dashboard plus one workbook per managed customer into SharePoint. ExcelJS (~950KB) is dynamically imported on first use so it never lands in the main chunk.",
        palette: "ui",
      },
      {
        label: "Build Requests (lazy-loaded)",
        hint: "BuildRequestsView · BuildRequestDetailView — a master-detail pair: the Tracker header list + any number of parts from the Items list, joined by BuildRequestNo. Own code-split chunk.",
        palette: "ui",
      },
      {
        label: "Operations department (lazy-loaded bundle)",
        hint: "OperationsListView · OperationsKanbanView · OperationsDetailView · AdminOperationsProjectsView · TeradyneLogView · TeradyneRefListView — useOperationsTasks · useTeradyne — api/operationsTasks · operationsProjects · operationsEquipment · teradyneLog · teradyneRefs. Own site (PMO), own code-split chunk; no imports from the Engineering views/hooks above. The CMMS below is part of this same bundle.",
        palette: "ui",
      },
      {
        label: "Maintenance / CMMS (Operations, lazy-loaded)",
        hint: "MaintenanceListView · MaintenanceBoardView · MaintenanceCalendarView · MaintenanceDashboardView · PmLibraryView · AssetDetailView · MaintenanceAssetsView (the asset register — inside the module at /operations/maintenance/assets, NOT under /admin, but locked to maintenance admins) · MaintenanceReferenceListsView (Departments & Locations — inside the module at /operations/maintenance/reference-lists, NOT under /admin, locked to maintenance admins; moved out of /admin/* on 2026-09-01 so a maintenance admin who isn't also an app-wide ARC admin can reach it) · MaintenanceDetailView · AdminMaintenanceRolesView — useMaintenanceTasks · useScheduledMaintenance · useEquipment · useMaintenanceFilters · useMaintenanceRoles · useMaintenanceReferenceLists — api/maintenanceTasks · scheduledMaintenance · operationsEquipment · maintenanceRoles · maintenanceReferenceLists (one parametrised module over Maintenance Departments and Maintenance Locations) — lib/maintenanceSchedule (the recurrence projection engine — the date path AND the run-hours meter path, which answers due / not due / CAN'T TELL rather than a bare boolean, because a missing or stale hourmeter reading means a PM that can never come due) · maintenanceCalendar · maintenanceMetrics · maintenanceFilters · maintenanceRoles (the two-level tech / admin gates, which replaced the old assignee-only completion rule; manageAssetsGate now covers all three of the asset register, departments and locations, asked in each view AND inside every mutationFn) · assetRegister (the register's gap rule, filters and diffed write payload) · maintenanceReferences (picker options, grouping keys and the duplicate hint) · workOrderNumber. Same PMO site and same bundle as the Operations tasks it sits beside. The work-order detail route is /operations/maintenance-task/:id — a top-level path, NOT a child of /operations/maintenance, because it is the segment lib/appUrl.ts hands to every notification email.",
        palette: "ui",
      },
      {
        label: "Supply Chain department",
        hint: "GrayMarketRequestsView · GrayMarketRequestDetailView — useGrayMarketRequests — api/grayMarketRequests. The list lives on the PMO site (where it has always been), but the feature is Supply Chain's: it appears under Supply Chain only.",
        palette: "ui",
      },
      {
        label: "Cost Impact Notices (lazy-loaded)",
        hint: "CostImpactNoticesView · CostImpactNoticeDetailView — useCostImpactNotices — api/costImpactNotices. List lives on the ALTRONICSALESTEAM site (Sales), same pattern as Gray Market Requests on PMO: the feature is Supply Chain's, the list just isn't on a Supply Chain site.",
        palette: "ui",
      },
      {
        label: "SRM Tool (lazy-loaded)",
        hint: "SuppliersView · SupplierDetailView · SupplierContactRedirect · SupplierIssueRedirect — useSuppliers · useSupplierContacts · useSupplierIssues — api/suppliers · supplierContacts · supplierIssues. Own site (PMO). Suppliers List is the anchor; Contacts and Issue Tracker render as expandable inline cards on a supplier's own page, the same pattern Build Request Items use, because both need their own comment thread, watchers and attachments.",
        palette: "ui",
      },
      {
        label: "Customer Service / Sales department",
        hint: "VisitReportsView · VisitReportsCalendarView · VisitReportDetailView — useVisitReports · useVisitReportFilters — api/visitReports. Own site (ALTRONICSALESTEAM). List and calendar are two views of one filtered set (lib/visitReportFilters). Sales-only: no other department reads it, and it imports nothing from another department.",
        palette: "ui",
      },
      {
        label: "CRM Tool (lazy-loaded)",
        hint: "CustomerNotesView · CustomerNoteDetailView — useCustomerNotes · useCustomerContacts · useSpecialPricing · useCapacity — api/customerNotes · customerContacts · specialPricing · capacity. Own site (salesOrderEntry, the ALTRONICSALESTEAM/OrderEntry subsite). Customer Notes is the anchor; Contacts, Special Pricing and Capacity are shown on a customer's own detail page rather than as top-level screens.",
        palette: "ui",
      },
      {
        label: "Panels department (lazy-loaded bundle)",
        hint: "PanelOrdersView · PanelOrderDetailView · PanelTasksView · PanelTaskDetailView · QcTimeTrackingView · PanelQcIssuesView · AdminPanelProjectsView · AdminPanelRolesView — usePanelOrders · usePanelTasks · useQcTimeTracking · usePanelQcIssues · usePanelRoles — api/panelOrders · panelTasks · panelProjects · panelRoles · qcTimeTracking · panelQcIssues. All Panel features use ALTRONICPANELTEAM. Own code-split chunk; no cross-department imports.",
        palette: "ui",
      },
    ],
  },
  {
    label: "Auth & transport",
    nodes: [
      { label: "MSAL Entra ID", hint: "Sites.Selected · Mail.Send.Shared · User.ReadBasic.All (tenant directory, optional) · AllSites.Manage (optional)", palette: "auth" },
      { label: "Microsoft Graph v1.0", hint: "Lists, items, drives, users, mail", palette: "gateway" },
      { label: "SharePoint REST", hint: "List-item attachments (Task, EIR, Operations Task, Maintenance work order, Equipment asset, Panel Order, Visit Report, Gray Market Request, Cost Impact Notice) + site-user resolution — optional", palette: "gateway" },
      { label: "Mock store", hint: "in-memory + localStorage (demo mode)", palette: "mock" },
      { label: "Shared mailbox", hint: "@-mention + change notifications, and edit-failure recovery emails", palette: "mock" },
    ],
  },
  {
    label: "SharePoint storage",
    nodes: [
      { label: "Project Task List", palette: "list" },
      { label: "Projects", palette: "list" },
      { label: "Test Results", palette: "list" },
      { label: "EIRs", palette: "list" },
      { label: "Admins", palette: "list" },
      { label: "EIR Roles", hint: "engineer / supply-chain field permissions", palette: "list" },
      { label: "Quick Links", hint: "Engineering site — admin-managed external-link buttons shown above each Dashboard department's cards; Department is a code-level enum (DASHBOARD_DEPARTMENTS) matched to the Dashboard's own section titles, and SortOrder is admin-set per department", palette: "list" },
      { label: "CSA Listings", hint: "Engineering site — CSA certification files; Title is the File Number, admin-only writes", palette: "list" },
      { label: "Digital QC product-family lists (18)", hint: "Engineering site — one list per product family; shared defect-log fields, with Pyrometer monthly EndSN tracking", palette: "list" },
      { label: "Ignition QC product-family lists (36)", hint: "Engineering site — one list per product family; same shared defect-log fields as Digital QC", palette: "list" },
      { label: "QCCoils", hint: "Engineering site — coil production defect log; named defects are number columns and OtherFaultTable stores selected Other defects with their counts and comments as JSON", palette: "list" },
      { label: "CoilPN / CoilOtherFaultList", hint: "Engineering site — editable reference lists for the Coil Defect Log part-number and Other-defect pickers", palette: "list" },
      { label: "CAD / CCC / CEC Drawings", hint: "Engineering site — drawing registers; a 16-slot change log across 48 CH_* columns", palette: "list" },
      { label: "Engineering Sketches", hint: "Engineering site — sketch register; own columns, no change log", palette: "list" },
      { label: "Documents library", hint: "General/Project Folders/* — task & comment files land here", palette: "list" },
      { label: "List-item attachments", hint: "SharePoint REST · per-item files on Tasks, EIRs, CSA Listings and more", palette: "list" },
      { label: "Operations Task List", hint: "Altronic_PMO site — separate from Engineering's Task List. Carries a Maintenance Task Reference column: set when a task has been promoted to a CMMS work order, and non-empty means it can't be promoted again", palette: "list" },
      { label: "Operations Projects", hint: "Altronic_PMO site — Operations' own parent-project reference list", palette: "list" },
      { label: "Altronic Equipment List", hint: "Altronic_PMO site — the plant's asset register, 378+ rows. Started life as a read-only name picker for Operations tasks; the CMMS reads and edits the whole record (nameplate, criticality, asset status, department/location lookups, ParentAsset self-lookup, warranty, hourmeter reading, responsible tech) and hangs each machine's manuals off it as attachments. ARC can create a new row (added 2026-09-01) — still no delete; a retired machine is Asset Status = Retired, since work orders and PM schedules point at the row", palette: "list" },
      { label: "Altronic Maintenance Tasks", hint: "Altronic_PMO site — CMMS work orders. Three single lookups (Equipment, Scheduled Maintenance, Operations Task) and three single person columns, all of which Graph returns as bare lookupIds. Due Status is read and shown but NEVER written: a Power Automate flow owns it", palette: "list" },
      { label: "Maintenance Roles", hint: "Altronic_PMO site — who may close out a work order, log a PM, and own the PM schedules and asset register. Title is an email and Roles carries two level tags (tech / admin), the EIR Roles shape with its own namespace. Roles is a CHOICE column whose single-vs-multi shape is unconfirmed, so api/maintenanceRoles.ts parses every shape Graph could return (CSV string, string array, bare string) and negotiates the write shape rather than depending on one. It has NO default list id: setting VITE_SP_MAINTENANCE_ROLES_LIST_ID is what switches gating on, so until it is set everyone signed in keeps what they can do today", palette: "list" },
      { label: "Maintenance Departments / Maintenance Locations", hint: "Altronic_PMO site — the two admin-managed reference lists behind every Department and Location field in the CMMS. They REPLACED choice columns on 2026-08-28: a choice column's allowed values live in the column definition, so adding one needed site-manage rights ARC has never had, while adding a lookup value is a list-item write Sites.Selected already allows. Title / Active / Note, managed at /operations/maintenance/reference-lists by a maintenance admin (moved out of /admin/* on 2026-09-01). No delete — a value hundreds of rows point at is retired, not removed. The Equipment List still carries its old Department / Location choice columns as a rollback path and reads them as a fallback; the two work-order lists never had them, and selecting one there 400s the whole read", palette: "list" },
      { label: "Scheduled Maintenance", hint: "Altronic_PMO site — the recurring PM rules the calendar projects from. Fixed, Floating or Hourmeter basis, an interval + unit, grace and lead days. Hourmeter is due at a run-hours READING rather than a date (LastCompletedHours / NextDueHours, against the asset's CurrentMachineHours) and reaches the calendar only on the day the reading passes the target — grace and lead days are in DAYS and do not apply to it. No Communication column by design (a schedule is a rule; the conversation belongs on the work order it made) and no delete — a schedule is retired by clearing Active", palette: "list" },
      { label: "Teradyne Log", hint: "Altronic_PMO site — board test failures; Title is app-derived from Product + Defective Parts", palette: "list" },
      { label: "Teradyne Employees / Products / Remarks", hint: "Altronic_PMO site — the log's three lookup lists, editable in-app by any signed-in user", palette: "list" },
      { label: "Coil-PottingSampleLog", hint: "Altronic_PMO site — operator-entered potting samples (Date, Volume, Weight)", palette: "list" },
      { label: "Coil-PottingLimit", hint: "Altronic_PMO site — two rows (Lower/Upper Spec Limit), editable by any signed-in user", palette: "list" },
      { label: "Coil PSR Notification List", hint: "Altronic_PMO site — email list for out-of-limit alerts, editable by any signed-in user", palette: "list" },
      { label: "Build Request Tracker", hint: "BR headers — status workflow, requestor/engineer, own comment thread", palette: "list" },
      { label: "Build Request Items", hint: "parts per BR (lookup to the Tracker) — checklists + per-part comment threads", palette: "list" },
      { label: "Panel Order Headers", hint: "ALTRONICPANELTEAM site — panel sales orders (status, SO/PO, engineer, own comment thread)", palette: "list" },
      { label: "Panel Tasks", hint: "ALTRONICPANELTEAM site — panel team tasks (drawings, SOOs, quotes, admin), own comment thread", palette: "list" },
      { label: "Panel Project Reference", hint: "ALTRONICPANELTEAM site — admin-managed project reference numbers (orders + tasks share it)", palette: "list" },
      { label: "Panel User Roles", hint: "ALTRONICPANELTEAM site — one row per user per role (gating ships dark in v1)", palette: "list" },
      { label: "QC Time Tracking", hint: "ALTRONICPANELTEAM site — hours QC spent per project; a simple log, no role gating, no delete, PerformedByPeople is multi-person", palette: "list" },
      { label: "PANEL COMPONENT FAILURES / PANEL COMPONENT DEFECTS", hint: "ALTRONICPANELTEAM site — Panel QC Issue Tracker issue log plus its editable defect-category reference list; both are available to signed-in users", palette: "list" },
      { label: "Where am I?", hint: "Engineering site — the team's out-of-office calendar. Two columns (Title, Date) and no end date, so a week away is a row per day; dates are stored at 06:00Z (US Central midnight)", palette: "list" },
      { label: "FAIT", hint: "Engineering site (a Supply Chain feature) — First Article Inspection Tests. 51 workflow columns spanning inspection and three sign-offs; Communication and Watchers were added for ARC in Aug 2026, Project Reference and attachments already existed", palette: "list" },
      { label: "ECN NEW", hint: "Engineering site — Engineering Change Notices. Every workflow column is named field_2 … field_12, so src/lib/ecnFields.ts is the only place their meaning exists; no Watchers and no requester column, so comments reach the submitter (Graph createdBy) and anyone mentioned", palette: "list" },
      { label: "Gray Market Request", hint: "Altronic_PMO site — parts bought outside normal distribution; Title is the Altronic assembly no, Log No. is calculated from LogNo.Raw, and the list carries its own Communication + Watchers columns", palette: "list" },
      { label: "Open Orders Report Customers", hint: "ALTRONICSALESTEAM site — who gets an individual open-orders workbook each week. Title is the sold-to account number; CustomerName is the customer-facing name the FILE is named from, because SAP truncates its own at 30 characters", palette: "list" },
      { label: "Open Orders Roles", hint: "ALTRONICSALESTEAM site — same shape as EIR Roles; Title is an email and Roles is a CSV, today just \"report manager\". Gating is off until the list id is configured, so nobody is locked out before an admin populates it", palette: "list" },
      { label: "Visit Reports", hint: "ALTRONICSALESTEAM site — regional managers' customer visits; Title is the Customer Name, City0/State0 carry the trailing zero, Month/Year/Day are calculated", palette: "list" },
      { label: "Customer Notes", hint: "salesOrderEntry site (OrderEntry subsite) — the CRM tool's anchor list; Group is a single choice, CustomerType is multi; Communication has no Watchers column, so comments reach @-mentioned people only", palette: "list" },
      { label: "Customer Contacts", hint: "salesOrderEntry site — one row per person at a customer; Customer is a single lookup into Customer Notes", palette: "list" },
      { label: "Special Pricing", hint: "salesOrderEntry site — pricing notes tied to a customer via the same Customer lookup", palette: "list" },
      { label: "Capacity", hint: "salesOrderEntry site — per-part weekly production capacity commitments tied to a customer", palette: "list" },
      { label: "Suppliers List", hint: "Altronic_PMO site — the SRM tool's anchor list, 531 rows; CoreCompetency is a multi choice, Status is single; QualityPeformance (typo, no r) is labelled \"Logistical Performance\" and QualityPerformance (correct spelling) is \"Quality Performance\"", palette: "list" },
      { label: "Supplier Contact List", hint: "Altronic_PMO site — one row per person at a supplier, 566 rows; Title/FirstName/LastName are blank on every row seen so far — a contact is identified by email; Communication and Watchers were added for ARC on 2026-08-26", palette: "list" },
      { label: "Supplier Issue Tracker", hint: "Altronic_PMO site — near-empty (1 row at discovery); Status and Severity are UNCONFIGURED placeholder choices (\"Choice 1/2/3\") — update the consts once Supply Chain sets real values", palette: "list" },
      { label: "Cost Impact Portal", hint: "ALTRONICSALESTEAM site (a Supply Chain feature) — a purchased part's cost changed. Original Cost/New Cost are TEXT columns; Delta Cost is a genuine SharePoint calculated column despite that; no Watchers, so comments reach the submitter (createdBy) and anyone mentioned, same as ECNs", palette: "list" },
      { label: "ARC Feature Requests", hint: "Engineering site — a place for any signed-in user to request a new ARC feature or change, separate from Report Issue. RequestedBy is a single-person column (Graph returns a bare RequestedByLookupId, resolved via the site directory), auto-filled to the submitter on create and never re-picked. No default list id — the screen reports itself as not configured until the setup script has run", palette: "list" },
    ],
  },
];

// =============================================================================
// Data model — drawn as a real ER diagram on a single SVG canvas.
// Each table is positioned by hand on a 1280x880 canvas, with crow's-foot
// connectors drawn between FK columns and their targets (one-end on the
// PK side, many-end on the FK side).
//
// To add a column or relationship: bump the row count in SCHEMA_TABLES,
// adjust the table's `y` if it pushes neighbours, and add a row to
// CONNECTIONS. The renderer computes port positions from row index.
// =============================================================================

type ColumnKind = "pk" | "field" | "fk";

interface SchemaColumn {
  name: string;
  type: string;
  kind: ColumnKind;
  /** Where this FK points, e.g. "Project.id" or "Person.id[]". */
  references?: string;
}

interface SchemaTable {
  name: string;
  /** SharePoint list display name (or "Concept" for shared/derived ones). */
  source: string;
  palette: PaletteKey;
  columns: SchemaColumn[];
  /** Top-left x position on the ER canvas. */
  x: number;
  /** Top-left y position on the ER canvas. */
  y: number;
  /** Card width. */
  width: number;
}

// ----- ER canvas geometry --------------------------------------------------
const HEADER_HEIGHT = 50;
const ROW_HEIGHT = 22;

/** Compute the table's total rendered height. */
function tableHeight(t: SchemaTable): number {
  return HEADER_HEIGHT + t.columns.length * ROW_HEIGHT + 6;
}

/** Y coordinate of a column's center (used for connection endpoints). */
function rowCenterY(t: SchemaTable, columnName: string): number {
  const idx = t.columns.findIndex((c) => c.name === columnName);
  return t.y + HEADER_HEIGHT + idx * ROW_HEIGHT + ROW_HEIGHT / 2;
}

const SCHEMA_TABLES: SchemaTable[] = [
  {
    name: "Project",
    source: "Projects list",
    palette: "entity",
    x: 530, y: 20, width: 240,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title", type: "text", kind: "field" },
    ],
  },
  {
    name: "Person",
    source: "Concept (User Info list)",
    palette: "shared",
    x: 960, y: 20, width: 290,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "displayName", type: "text", kind: "field" },
      { name: "email", type: "text", kind: "field" },
    ],
  },
  {
    name: "Task",
    source: "Project Task List",
    palette: "entity",
    x: 20, y: 220, width: 360,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title", type: "text", kind: "field" },
      { name: "numberedTitle", type: "text", kind: "field" },
      { name: "status", type: "choice", kind: "field" },
      { name: "priority", type: "choice", kind: "field" },
      { name: "category", type: "choice", kind: "field" },
      { name: "dueDate", type: "datetime", kind: "field" },
      { name: "parentProjectId", type: "int", kind: "fk", references: "Project.id" },
      { name: "parentTaskId", type: "int", kind: "fk", references: "Task.id" },
      { name: "relatedProjects", type: "int[]", kind: "fk", references: "Project.id" },
      { name: "assigned", type: "int[]", kind: "fk", references: "Person.id" },
      { name: "watchers", type: "int[]", kind: "fk", references: "Person.id" },
      { name: "eirReference", type: "hyperlink", kind: "fk", references: "EIR.id" },
    ],
  },
  {
    name: "EIR",
    source: "Engineering Information Request",
    palette: "entity",
    x: 410, y: 220, width: 420,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "eirNo", type: "text", kind: "field" },
      { name: "title", type: "text", kind: "field" },
      { name: "requestType", type: "choice", kind: "field" },
      { name: "status", type: "choice", kind: "field" },
      { name: "resolution", type: "choice", kind: "field" },
      { name: "requestedPriority", type: "choice", kind: "field" },
      { name: "projectReferences", type: "int[]", kind: "fk", references: "Project.id" },
      { name: "taskReference", type: "text", kind: "field" },
      { name: "reporter", type: "int", kind: "fk", references: "Person.id" },
      { name: "assignedEngineers", type: "int[]", kind: "fk", references: "Person.id" },
      { name: "watchers", type: "int[]", kind: "fk", references: "Person.id" },
    ],
  },
  {
    name: "Admin",
    source: "Admins list",
    palette: "entity",
    x: 960, y: 240, width: 290,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "email", type: "text", kind: "fk", references: "Person.email" },
      { name: "displayName", type: "text", kind: "field" },
    ],
  },
  {
    name: "EirRole",
    source: "EIR Roles list",
    palette: "entity",
    x: 960, y: 660, width: 290,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "email", type: "text", kind: "fk", references: "Person.email" },
      { name: "displayName", type: "text", kind: "field" },
      { name: "roles", type: "csv", kind: "field" },
    ],
  },
  {
    // The CMMS permission list. Deliberately the same shape as EirRole — one
    // row per person, keyed by email, carrying a CSV of tags — with its own
    // tag namespace (tech / admin) and its own site (PMO, with the work orders
    // it gates rather than Engineering).
    name: "MaintenanceRole",
    source: "Maintenance Roles list (Altronic_PMO site)",
    palette: "entity",
    x: 960, y: 820, width: 290,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "email", type: "text", kind: "fk", references: "Person.email" },
      { name: "displayName", type: "text", kind: "field" },
      { name: "roles", type: "csv", kind: "field" },
    ],
  },
  {
    name: "Comment",
    source: "Concept (Communication field)",
    palette: "shared",
    x: 960, y: 380, width: 290,
    columns: [
      { name: "parentId", type: "int", kind: "fk", references: "Task / EIR / OperationsTask / MaintenanceTask" },
      { name: "timestamp", type: "datetime", kind: "field" },
      { name: "authorName", type: "text", kind: "field" },
      { name: "bodyHtml", type: "text", kind: "field" },
    ],
  },
  {
    name: "TestSheet",
    source: "Test Results",
    palette: "entity",
    x: 20, y: 566, width: 360,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title", type: "text", kind: "field" },
      { name: "product", type: "text", kind: "field" },
      { name: "serialNumber", type: "text", kind: "field" },
      { name: "parentProjectId", type: "int", kind: "fk", references: "Project.id" },
      { name: "parentTaskId", type: "int", kind: "fk", references: "Task.id" },
      { name: "tester", type: "int", kind: "fk", references: "Person.id" },
    ],
  },
  {
    name: "Attachment",
    source: "List-item attachments across entities (SP REST)",
    palette: "shared",
    x: 960, y: 540, width: 290,
    columns: [
      { name: "parentId", type: "int", kind: "fk", references: "Task / EIR / CsaListing / …" },
      { name: "fileName", type: "text", kind: "field" },
      { name: "serverRelativeUrl", type: "text", kind: "field" },
    ],
  },
  {
    name: "ProjectFolder",
    source: "Documents / General / Project Folders",
    palette: "shared",
    x: 410, y: 540, width: 420,
    columns: [
      { name: "id", type: "driveItemId", kind: "pk" },
      { name: "name", type: "text", kind: "field" },
      { name: "webUrl", type: "text", kind: "field" },
      { name: "projectReference", type: "int", kind: "fk", references: "Project.id" },
    ],
  },
  {
    name: "ProjectFile",
    source: "Files inside a ProjectFolder",
    palette: "shared",
    x: 20, y: 792, width: 360,
    columns: [
      { name: "id", type: "driveItemId", kind: "pk" },
      { name: "folderId", type: "driveItemId", kind: "fk", references: "ProjectFolder.id" },
      { name: "name", type: "text", kind: "field" },
      { name: "webUrl", type: "text", kind: "field" },
      { name: "lastModified", type: "datetime", kind: "field" },
    ],
  },
  // ---- Operations department (Altronic_PMO site) — own cluster below
  // everything else. Independent of the Engineering tables above: no
  // shared Project/Person rows (Operations has its own Projects list, and
  // its Person values come from the same tenant directory but aren't tied
  // to the Engineering-site User Info list this diagram's `Person` concept
  // represents).
  {
    name: "OperationsTask",
    source: "Operations Task List (Altronic_PMO site)",
    palette: "entity",
    x: 20, y: 1000, width: 380,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title", type: "text", kind: "field" },
      { name: "taskNumber", type: "text", kind: "field" },
      { name: "status", type: "choice", kind: "field" },
      { name: "priority", type: "choice", kind: "field" },
      { name: "taskType", type: "choice", kind: "field" },
      { name: "location", type: "choice", kind: "field" },
      { name: "dueDate", type: "datetime", kind: "field" },
      { name: "parentProjectId", type: "int", kind: "fk", references: "OperationsProject.id" },
      { name: "equipmentId", type: "int", kind: "fk", references: "AltronicEquipment.id" },
      { name: "assigned", type: "int", kind: "fk", references: "Person.id" },
      { name: "watchers", type: "int[]", kind: "fk", references: "Person.id" },
      { name: "maintenanceTaskRef", type: "int", kind: "fk", references: "MaintenanceTask.id" },
    ],
  },
  {
    name: "OperationsProject",
    source: "Operations Projects (Altronic_PMO site)",
    palette: "entity",
    x: 430, y: 1000, width: 260,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "projectNumber", type: "text", kind: "field" },
      { name: "title", type: "text", kind: "field" },
      { name: "projectRef", type: "text", kind: "field" },
      { name: "description", type: "text", kind: "field" },
    ],
  },
  {
    // The asset register the CMMS module is built on. It used to be a
    // name-only picker for an Operations task; `listEquipment()` now reads the
    // whole record, and MaintenanceAssetsView edits it.
    //
    // Still NO create and NO delete in ARC: an asset row exists because the
    // plant bought a machine, and deleting one orphans every work order and PM
    // schedule pointing at it — retiring is `assetStatus = "Retired"`. Every
    // write is gated by `manageAssetsGate`, in the view AND inside each
    // `mutationFn`.
    name: "AltronicEquipment",
    source: "Altronic Equipment List (Altronic_PMO site) — 378 assets",
    palette: "shared",
    x: 720, y: 1000, width: 300,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title", type: "text", kind: "field" },
      { name: "description", type: "text", kind: "field" },
      { name: "serialNo", type: "text", kind: "field" },
      { name: "manufacturer", type: "text", kind: "field" },
      { name: "modelNumber", type: "text", kind: "field" },
      { name: "equipmentType", type: "choice", kind: "field" },
      // Choice columns until 2026-08-28, single LOOKUPS since. The old choice
      // columns still exist on THIS list only, as a rollback path and as the
      // fallback for a row the migration couldn't place.
      { name: "departmentRef", type: "int", kind: "fk", references: "MaintenanceDepartment.id" },
      { name: "locationRef", type: "int", kind: "fk", references: "MaintenanceLocation.id" },
      { name: "criticality", type: "choice", kind: "field" },
      { name: "assetStatus", type: "choice", kind: "field" },
      { name: "parentAsset", type: "int", kind: "fk", references: "AltronicEquipment.id" },
      { name: "installDate", type: "datetime", kind: "field" },
      { name: "warrantyExpiry", type: "datetime", kind: "field" },
      { name: "responsibleTech", type: "int", kind: "fk", references: "Person.id" },
      // Added with the CMMS, mapped only when the asset register screen
      // landed. currentMachineHours is what a meter-based PM counts against,
      // so a null one is a PM that can never come due — which is why the
      // register surfaces the blanks rather than styling round them.
      { name: "assetTag", type: "text", kind: "field" },
      { name: "currentMachineHours", type: "number", kind: "field" },
      { name: "hasAttachments", type: "bool", kind: "field" },
    ],
  },
  {
    // CMMS work orders. Three single lookups (equipment, schedule, Operations
    // task) and three SINGLE person columns, all of which come back off Graph
    // as bare lookupIds — see lib/maintenanceTaskMapper.ts.
    //
    // `dueStatus` is listed because the column is real and shown in ARC, but a
    // Power Automate flow owns it: every write path strips it.
    name: "MaintenanceTask",
    source: "Altronic Maintenance Tasks (Altronic_PMO site)",
    palette: "entity",
    // Moved up 60px when DepartmentRef / LocationRef were added, so the two
    // extra rows don't crowd BuildRequest below it.
    x: 20, y: 1400, width: 380,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "woNumber", type: "text", kind: "field" },
      { name: "title", type: "text", kind: "field" },
      { name: "description", type: "text", kind: "field" },
      { name: "status", type: "choice", kind: "field" },
      { name: "priority", type: "choice", kind: "field" },
      { name: "category", type: "choice", kind: "field" },
      { name: "taskType (derived)", type: "choice", kind: "field" },
      { name: "dueStatus (flow-owned)", type: "choice", kind: "field" },
      { name: "startDate", type: "datetime", kind: "field" },
      { name: "dueDate", type: "datetime", kind: "field" },
      { name: "completedDate", type: "datetime", kind: "field" },
      { name: "equipmentId", type: "int", kind: "fk", references: "AltronicEquipment.id" },
      { name: "scheduleRef", type: "int", kind: "fk", references: "ScheduledMaintenance.id" },
      { name: "operationsTaskRef", type: "int", kind: "fk", references: "OperationsTask.id" },
      // The work order's OWN department and location, not an echo of the
      // asset's. Single lookups since 2026-08-28; this list never had the old
      // choice columns, so there is no fallback to read here.
      { name: "departmentRef", type: "int", kind: "fk", references: "MaintenanceDepartment.id" },
      { name: "locationRef", type: "int", kind: "fk", references: "MaintenanceLocation.id" },
      { name: "assigned", type: "int", kind: "fk", references: "Person.id" },
      { name: "reportedBy", type: "int", kind: "fk", references: "Person.id" },
      { name: "completedBy", type: "int", kind: "fk", references: "Person.id" },
      { name: "watchers", type: "int[]", kind: "fk", references: "Person.id" },
      { name: "techNotes", type: "text", kind: "field" },
      { name: "failureCause", type: "text", kind: "field" },
      { name: "resolution", type: "text", kind: "field" },
      { name: "partsUsed", type: "text", kind: "field" },
      { name: "laborHours", type: "number", kind: "field" },
      { name: "downtimeHours", type: "number", kind: "field" },
      { name: "comments (Communication)", type: "text", kind: "field" },
      { name: "hasAttachments", type: "bool", kind: "field" },
    ],
  },
  {
    // The recurring PM rules. A schedule is a RULE, not a record of work: it
    // has no Communication column and never gets one — the conversation
    // belongs on the work order the rule produced. It is retired (Active =
    // false), never deleted, so every work order it ever made still points at
    // something real.
    name: "ScheduledMaintenance",
    source: "Scheduled Maintenance (Altronic_PMO site)",
    palette: "entity",
    x: 440, y: 1400, width: 340,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title", type: "text", kind: "field" },
      { name: "instructions", type: "text", kind: "field" },
      { name: "category", type: "choice", kind: "field" },
      { name: "priority", type: "choice", kind: "field" },
      { name: "equipmentId", type: "int", kind: "fk", references: "AltronicEquipment.id" },
      { name: "departmentRef", type: "int", kind: "fk", references: "MaintenanceDepartment.id" },
      { name: "locationRef", type: "int", kind: "fk", references: "MaintenanceLocation.id" },
      { name: "frequencyInterval", type: "number", kind: "field" },
      { name: "frequencyUnit", type: "choice", kind: "field" },
      { name: "scheduleBasis", type: "choice", kind: "field" },
      { name: "firstDueDate", type: "datetime", kind: "field" },
      { name: "nextDueDate", type: "datetime", kind: "field" },
      { name: "lastCompleted", type: "datetime", kind: "field" },
      // The HOURMETER pair — a run-hours schedule is due at a READING, not on a
      // date. `nextDueHours` is app-owned exactly the way `nextDueDate` is, and
      // null on both means "never recorded", which is NOT zero.
      { name: "lastCompletedHours", type: "number", kind: "field" },
      { name: "nextDueHours", type: "number", kind: "field" },
      { name: "assignedTo", type: "int", kind: "fk", references: "Person.id" },
      { name: "lastCompletedBy", type: "int", kind: "fk", references: "Person.id" },
      { name: "watchers", type: "int[]", kind: "fk", references: "Person.id" },
      { name: "timeNeeded", type: "number", kind: "field" },
      { name: "graceDays", type: "number", kind: "field" },
      { name: "leadTimeDays", type: "number", kind: "field" },
      { name: "active", type: "bool", kind: "field" },
      { name: "requiresShutdown", type: "bool", kind: "field" },
      { name: "lotoRequired", type: "bool", kind: "field" },
    ],
  },

  // ---- Build Requests (Engineering site) — master-detail list pair ---------
  {
    // The two admin-managed CMMS reference lists. Structurally identical —
    // Title, Active, Note — which is why ONE parametrised api module covers
    // both, and why the admin screen is one screen with two tabs.
    //
    // They REPLACED choice columns on 2026-08-28. A choice column's allowed
    // values live in the column DEFINITION, so adding a department was a
    // column PATCH needing site-manage rights ARC has never had; adding a
    // lookup value is adding a LIST ITEM, which Sites.Selected already
    // allows. There is no delete: a value hundreds of rows point at is
    // RETIRED (Active = false), which takes it out of every picker while
    // every record already using it keeps showing it.
    name: "MaintenanceDepartment",
    source: "Maintenance Departments (Altronic_PMO site) — 9 values",
    palette: "shared",
    x: 820, y: 1600, width: 320,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title", type: "text", kind: "field" },
      { name: "active", type: "bool", kind: "field" },
      { name: "note", type: "text", kind: "field" },
    ],
  },
  {
    // Same shape, and the messier of the two: 64 values including a literal
    // "-", "Q.C." beside "QC", and "HARNESS DEPARMENT" beside "HARNESS
    // DEPARTMENT". The admin screen FLAGS near-duplicates and never merges
    // them — which of a pair survives is a judgement about real rows.
    name: "MaintenanceLocation",
    source: "Maintenance Locations (Altronic_PMO site) — 64 values",
    palette: "shared",
    x: 820, y: 1780, width: 320,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title", type: "text", kind: "field" },
      { name: "active", type: "bool", kind: "field" },
      { name: "note", type: "text", kind: "field" },
    ],
  },
  {
    name: "BuildRequest",
    source: "Build Request Tracker (Engineering site)",
    palette: "entity",
    x: 20, y: 2170, width: 370,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "brNo", type: "text", kind: "field" },
      { name: "title", type: "text", kind: "field" },
      { name: "product", type: "text", kind: "field" },
      { name: "status", type: "choice", kind: "field" },
      { name: "brType", type: "choice", kind: "field" },
      { name: "blockedReason", type: "choice", kind: "field" },
      { name: "requiredLeadTime", type: "choice", kind: "field" },
      { name: "quotedShipDate", type: "datetime", kind: "field" },
      { name: "requestor", type: "int", kind: "fk", references: "Person.id" },
      { name: "engineerAssigned", type: "int", kind: "fk", references: "Person.id" },
      { name: "watchers", type: "int[]", kind: "fk", references: "Person.id" },
      { name: "projectReference", type: "int[]", kind: "fk", references: "Project.id" },
      { name: "taskReference", type: "int", kind: "fk", references: "Task.id" },
      { name: "communication", type: "text", kind: "field" },
    ],
  },
  {
    name: "BuildRequestItem",
    source: "Build Request Items (Engineering site)",
    palette: "entity",
    x: 440, y: 2170, width: 380,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "partNumber", type: "text", kind: "field" },
      { name: "buildRequestId", type: "int", kind: "fk", references: "BuildRequest.id" },
      { name: "partDesc", type: "text", kind: "field" },
      { name: "drawingNo / drawingRev", type: "text", kind: "field" },
      { name: "qty", type: "number", kind: "field" },
      { name: "woNo", type: "text", kind: "field" },
      { name: "partType", type: "choice", kind: "field" },
      { name: "partStatus", type: "choice", kind: "field" },
      { name: "disposition", type: "choice", kind: "field" },
      { name: "assembly / operations / testing", type: "choice[]", kind: "field" },
      { name: "checklist (17 booleans)", type: "bool", kind: "field" },
      { name: "projectReference", type: "int", kind: "fk", references: "Project.id" },
      { name: "taskRef", type: "int", kind: "fk", references: "Task.id" },
      { name: "watchers", type: "int[]", kind: "fk", references: "Person.id" },
      { name: "communication", type: "text", kind: "field" },
    ],
  },

  // ---- Panels department (ALTRONICPANELTEAM site) — own cluster ------------
  {
    name: "PanelOrder",
    source: "Panel Order Headers (ALTRONICPANELTEAM site)",
    palette: "entity",
    x: 20, y: 2630, width: 380,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title", type: "text", kind: "field" },
      { name: "status", type: "choice", kind: "field" },
      { name: "salesOrder", type: "text", kind: "field" },
      { name: "purchaseOrder", type: "text", kind: "field" },
      { name: "customerReference", type: "text", kind: "field" },
      { name: "customer", type: "choice", kind: "field" },
      { name: "customerContactEmail", type: "text", kind: "field" },
      { name: "orderNotes", type: "text", kind: "field" },
      { name: "projectReference", type: "int", kind: "fk", references: "PanelProject.id" },
      { name: "engineerAssigned", type: "int", kind: "fk", references: "Person.id" },
      { name: "watchers", type: "int[]", kind: "fk", references: "Person.id" },
      { name: "communication", type: "text", kind: "field" },
    ],
  },
  {
    name: "PanelProject",
    source: "Panel Project Reference (ALTRONICPANELTEAM site)",
    palette: "entity",
    x: 440, y: 2630, width: 280,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title (ref no)", type: "text", kind: "field" },
      { name: "projectType", type: "choice", kind: "field" },
      { name: "description", type: "text", kind: "field" },
      { name: "dwgNo", type: "text", kind: "field" },
      { name: "customer", type: "choice", kind: "field" },
      { name: "department", type: "choice", kind: "field" },
    ],
  },
  {
    name: "PanelUserRole",
    source: "Panel User Roles (ALTRONICPANELTEAM site)",
    palette: "entity",
    x: 760, y: 2630, width: 280,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "user", type: "int", kind: "fk", references: "Person.id" },
      { name: "role", type: "choice", kind: "field" },
      { name: "note (Title)", type: "text", kind: "field" },
    ],
  },
  {
    name: "PanelTask",
    source: "Panel Tasks (ALTRONICPANELTEAM site)",
    palette: "entity",
    x: 760, y: 2830, width: 300,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title", type: "text", kind: "field" },
      { name: "status", type: "choice", kind: "field" },
      { name: "taskType", type: "choice", kind: "field" },
      { name: "projectReference", type: "int", kind: "fk", references: "PanelProject.id" },
      { name: "assigned", type: "int", kind: "fk", references: "Person.id" },
      { name: "description", type: "text", kind: "field" },
      { name: "watchers", type: "int[]", kind: "fk", references: "Person.id" },
    ],
  },

  // ---- CSA Listings (Engineering) -----------------------------------------
  // Standalone: no lookups, no people fields. Attachments hang off it (the
  // certificate PDFs), which is the only relationship it has.
  {
    name: "CsaListing",
    source: "CSA Listings (Engineering site)",
    palette: "entity",
    x: 1080, y: 3130, width: 300,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "fileNumber (Title)", type: "text", kind: "field" },
      { name: "product", type: "text", kind: "field" },
      { name: "alsoCover", type: "note", kind: "field" },
      { name: "partNoIncluded", type: "note", kind: "field" },
      { name: "history", type: "note", kind: "field" },
      { name: "dateCertified", type: "date", kind: "field" },
      { name: "csaId (legacy)", type: "number", kind: "field" },
    ],
  },

  // ---- Drawing File Logs (Engineering) ------------------------------------
  // Three of the four lists share this shape. The change log is NOT a table of
  // its own: it's 16 fixed (date, ECN, rev) slots inside the same row, which the
  // mapper folds into an array. Modelled here as one column so the diagram
  // reflects the storage rather than the shape the app presents.
  {
    name: "DrawingLogEntry",
    source: "CAD / CCC / CEC Drawings (Engineering site)",
    palette: "entity",
    x: 1080, y: 3420, width: 320,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title (drawing no.)", type: "text", kind: "field" },
      { name: "partNo / descr", type: "text", kind: "field" },
      { name: "dateStarted / dateRevised", type: "date", kind: "field" },
      { name: "size / revNo", type: "text", kind: "field" },
      { name: "changes[16] (CH_DAT/ECN/REV)", type: "text", kind: "field" },
      { name: "legacyId (CCC_ID/CEC_ID)", type: "number", kind: "field" },
    ],
  },
  {
    name: "SketchLogEntry",
    source: "Engineering Sketches (Engineering site)",
    palette: "entity",
    x: 1080, y: 3660, width: 320,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title", type: "text", kind: "field" },
      { name: "sketchNumber (SK_Num)", type: "number", kind: "field" },
      { name: "dateStarted / dateRevised", type: "date", kind: "field" },
      { name: "size / vCode / ventura", type: "text", kind: "field" },
      { name: "legacyId (SK_ID)", type: "number", kind: "field" },
    ],
  },

  // ---- Digital QC (Engineering site) --------------------------------------
  // One list per product family, represented as one shared shape here. The
  // application resolves each list's actual SharePoint internal column names.
  {
    name: "DigitalQc",
    source: "18 Digital QC product-family lists (Engineering site)",
    palette: "entity",
    x: 440, y: 3420, width: 500,
    columns: [
      { name: "id", type: "text", kind: "pk" },
      { name: "workOrder / dateTested / operator", type: "text / date", kind: "field" },
      { name: "oldNumber / SAPNumber", type: "text", kind: "field" },
      { name: "startSN / endSN", type: "text", kind: "field" },
      { name: "quantityTested / quantityRejected", type: "number", kind: "field" },
      { name: "defect counters", type: "number", kind: "field" },
      { name: "toRP", type: "0 | 1", kind: "field" },
      { name: "other", type: "number", kind: "field" },
      { name: "comments", type: "multiline text", kind: "field" },
      { name: "Pyrometer monthly EndSN", type: "derived", kind: "field" },
    ],
  },
  {
    name: "IgnitionQc",
    source: "36 Ignition QC product-family lists (Engineering site)",
    palette: "entity",
    x: 990, y: 3420, width: 480,
    columns: [
      { name: "id", type: "text", kind: "pk" },
      { name: "workOrder / dateTested / operator", type: "text / date", kind: "field" },
      { name: "oldNumber / SAPNumber", type: "text", kind: "field" },
      { name: "quantityTested / quantityRejected", type: "number", kind: "field" },
      { name: "defect counters", type: "number", kind: "field" },
      { name: "toRP", type: "0 | 1", kind: "field" },
      { name: "other", type: "number", kind: "field" },
      { name: "comments", type: "multiline text", kind: "field" },
    ],
  },

  // ---- Teradyne (Operations, Altronic_PMO site) — own cluster -------------
  // Note how this cluster references NO Person table: the log records who ran
  // a test from its own Employees list (shop-floor people with clock numbers,
  // not ARC sign-ins), which is why it has its own employee entity.
  {
    name: "TeradyneLogEntry",
    source: "Teradyne Log (Altronic_PMO site)",
    palette: "entity",
    x: 20, y: 3130, width: 380,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title (derived)", type: "text", kind: "field" },
      { name: "enterDate", type: "date", kind: "field" },
      { name: "product", type: "int", kind: "fk", references: "TeradyneProduct.id" },
      { name: "employee1", type: "int", kind: "fk", references: "TeradyneEmployee.id" },
      { name: "employee2", type: "int", kind: "fk", references: "TeradyneEmployee.id" },
      { name: "remark", type: "int", kind: "fk", references: "TeradyneRemark.id" },
      { name: "employee1Clock / employee2Clock", type: "number", kind: "field" },
      { name: "defectiveParts", type: "text", kind: "field" },
      { name: "numberOfBoards", type: "number", kind: "field" },
      { name: "boardsTested", type: "number", kind: "field" },
      { name: "failuresPerBoard", type: "number", kind: "field" },
      { name: "sapNumber", type: "text", kind: "field" },
      { name: "altronicPartNumber", type: "text", kind: "field" },
      { name: "operatorNotes", type: "text", kind: "field" },
    ],
  },
  {
    name: "TeradyneProduct",
    source: "Teradyne Products (Altronic_PMO site)",
    palette: "entity",
    x: 440, y: 3130, width: 270,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title (Product)", type: "text", kind: "field" },
      { name: "testOnStation", type: "text", kind: "field" },
      { name: "idProd (legacy)", type: "number", kind: "field" },
    ],
  },
  {
    name: "TeradyneEmployee",
    source: "Teradyne Employees (Altronic_PMO site)",
    palette: "entity",
    x: 750, y: 3130, width: 290,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title (derived name)", type: "text", kind: "field" },
      { name: "firstName / lastName", type: "text", kind: "field" },
      { name: "clockNum", type: "number", kind: "field" },
      { name: "workCenter", type: "text", kind: "field" },
      { name: "idEmp (legacy)", type: "number", kind: "field" },
    ],
  },
  {
    name: "TeradyneRemark",
    source: "Teradyne Remarks (Altronic_PMO site)",
    palette: "entity",
    x: 440, y: 3270, width: 270,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title", type: "text", kind: "field" },
      { name: "idRem (remark no.)", type: "number", kind: "field" },
    ],
  },

  // ---- Coils — Potting Sample Log (Altronic_PMO site) — no FKs between them
  {
    name: "PottingSampleEntry",
    source: "Coil-PottingSampleLog (Altronic_PMO site)",
    palette: "entity",
    x: 20, y: 3760, width: 280,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "date", type: "datetime", kind: "field" },
      { name: "volume", type: "number", kind: "field" },
      { name: "weight", type: "number", kind: "field" },
    ],
  },
  {
    name: "PottingLimits",
    source: "Coil-PottingLimit (Altronic_PMO site)",
    palette: "entity",
    x: 330, y: 3760, width: 280,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title (Lower/Upper Spec Limit)", type: "text", kind: "field" },
      { name: "limit", type: "number", kind: "field" },
    ],
  },
  {
    name: "PsrNotificationPerson",
    source: "Coil PSR Notification List (Altronic_PMO site)",
    palette: "entity",
    x: 640, y: 3760, width: 300,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "displayName (Title)", type: "text", kind: "field" },
      { name: "email", type: "text", kind: "field" },
    ],
  },
  {
    // Thirty-odd workflow columns live in `values`, keyed by the descriptors in
    // lib/grayMarketFields.ts — listing them all here would swamp the diagram.
    name: "GrayMarketRequest",
    source: "Gray Market Request (Altronic_PMO site)",
    palette: "entity",
    x: 400, y: 3930, width: 340,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title (assembly no)", type: "text", kind: "field" },
      { name: "logNo (LogNo.Raw)", type: "text", kind: "field" },
      { name: "status", type: "choice", kind: "field" },
      { name: "requestDate (TodaysDate)", type: "date", kind: "field" },
      { name: "dateCompleted", type: "date", kind: "field" },
      { name: "testingRequired", type: "choice", kind: "field" },
      { name: "requestor", type: "person", kind: "field" },
      { name: "partsLocation", type: "person", kind: "field" },
      { name: "watchers", type: "person[]", kind: "field" },
      { name: "comments (Communication)", type: "text", kind: "field" },
      { name: "values (30 columns)", type: "text", kind: "field" },
    ],
  },
  {
    // The workflow columns live in `values`, keyed by the descriptors in
    // lib/ecnFields.ts — on this list they're all named field_2 … field_12,
    // so their real names would tell a reader nothing anyway.
    //
    // No watchers and no requester: `submittedBy` is Graph's item-level
    // createdBy, which is why it's drawn as a field rather than an FK to
    // Person — there's no lookup column behind it.
    name: "ECN",
    source: "ECN NEW (Engineering site)",
    palette: "entity",
    x: 790, y: 3930, width: 330,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "logNo (field_2)", type: "text", kind: "field" },
      { name: "title (part / assembly)", type: "text", kind: "field" },
      { name: "submittedBy (createdBy)", type: "person", kind: "field" },
      { name: "comments (Communication)", type: "text", kind: "field" },
      { name: "hasAttachments", type: "bool", kind: "field" },
      { name: "values (9 field_N columns)", type: "text", kind: "field" },
    ],
  },
  {
    // A standalone entity — no lookups in or out. The customer is a name
    // typed into Title, not a row in a Customers list. The CRM tool's
    // CustomerNote below is a SEPARATE list Sales also owns.
    name: "VisitReport",
    source: "Visit Reports (ALTRONICSALESTEAM site)",
    palette: "entity",
    x: 20, y: 3930, width: 330,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "customerName (Title)", type: "text", kind: "field" },
      { name: "rmName", type: "choice", kind: "field" },
      { name: "reasonForVisit", type: "choice", kind: "field" },
      { name: "visitSummary", type: "text", kind: "field" },
      { name: "actionItems", type: "text", kind: "field" },
      { name: "visitDate", type: "date", kind: "field" },
      { name: "customerStatus", type: "choice", kind: "field" },
      { name: "product", type: "text", kind: "field" },
      { name: "city (City0)", type: "text", kind: "field" },
      { name: "state (State0)", type: "choice", kind: "field" },
      { name: "hasAttachments", type: "bool", kind: "field" },
    ],
  },
  {
    // The CRM tool's anchor — Contacts, SpecialPricingEntry and
    // CapacityEntry each carry a lookup back to a row here (salesOrderEntry
    // site, the ALTRONICSALESTEAM/OrderEntry subsite).
    name: "CustomerNote",
    source: "Customer Notes (salesOrderEntry site)",
    palette: "entity",
    x: 20, y: 4280, width: 300,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "customerName (Title)", type: "text", kind: "field" },
      { name: "oldCustomerNumber", type: "text", kind: "field" },
      { name: "sapCustomerNumber", type: "text", kind: "field" },
      { name: "generalNotes", type: "text", kind: "field" },
      { name: "complianceNotes", type: "text", kind: "field" },
      { name: "group", type: "choice", kind: "field" },
      { name: "customerTypes", type: "choice[]", kind: "field" },
      { name: "csr", type: "int[]", kind: "fk", references: "Person.id" },
      { name: "kam", type: "int", kind: "fk", references: "Person.id" },
      { name: "comments (Communication)", type: "text", kind: "field" },
      { name: "hasAttachments", type: "bool", kind: "field" },
    ],
  },
  {
    name: "CustomerContact",
    source: "Customer Contacts (salesOrderEntry site)",
    palette: "entity",
    x: 350, y: 4280, width: 270,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "name (Title)", type: "text", kind: "field" },
      { name: "customerId", type: "int", kind: "fk", references: "CustomerNote.id" },
      { name: "email", type: "text", kind: "field" },
      { name: "phoneNumber", type: "text", kind: "field" },
      { name: "jobTitle", type: "text", kind: "field" },
      { name: "contactNotes", type: "text", kind: "field" },
    ],
  },
  {
    name: "SpecialPricingEntry",
    source: "Special Pricing (salesOrderEntry site)",
    palette: "entity",
    x: 650, y: 4280, width: 260,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title (Title)", type: "text", kind: "field" },
      { name: "customerId", type: "int", kind: "fk", references: "CustomerNote.id" },
      { name: "pricingNotes", type: "text", kind: "field" },
      { name: "aiPartNumber", type: "text", kind: "field" },
    ],
  },
  {
    name: "CapacityEntry",
    source: "Capacity (salesOrderEntry site)",
    palette: "entity",
    x: 940, y: 4280, width: 280,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "partNumber (Title)", type: "text", kind: "field" },
      { name: "customerId", type: "int", kind: "fk", references: "CustomerNote.id" },
      { name: "description", type: "text", kind: "field" },
      { name: "weeklyMax", type: "number", kind: "field" },
      { name: "notes", type: "text", kind: "field" },
      { name: "customerPartNumber (CustomerP/N)", type: "text", kind: "field" },
    ],
  },
  {
    // The SRM tool's anchor — SupplierContact and SupplierIssue each carry a
    // lookup back to a row here (BPReference, on the PMO site).
    name: "Supplier",
    source: "Suppliers List (Altronic_PMO site)",
    palette: "entity",
    x: 20, y: 4630, width: 310,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title (Title)", type: "text", kind: "field" },
      { name: "companyName", type: "text", kind: "field" },
      { name: "businessPartnerNumber", type: "text", kind: "field" },
      { name: "address", type: "text", kind: "field" },
      { name: "website", type: "text", kind: "field" },
      { name: "supplierScore", type: "text", kind: "field" },
      { name: "coreCompetencies", type: "choice[]", kind: "field" },
      { name: "status", type: "choice", kind: "field" },
      { name: "notes", type: "text", kind: "field" },
      { name: "assignedBuyer", type: "int", kind: "fk", references: "Person.id" },
      { name: "supplierIdentifier", type: "text", kind: "field" },
      { name: "watchers", type: "int[]", kind: "fk", references: "Person.id" },
      { name: "pointOfContactId", type: "int", kind: "fk", references: "SupplierContact.id" },
      { name: "allDeliveries", type: "number", kind: "field" },
      { name: "supplierPerformanceRate", type: "number", kind: "field" },
      { name: "logisticalPerformance (QualityPeformance)", type: "number", kind: "field" },
      { name: "qualityPerformance (QualityPerformance)", type: "number", kind: "field" },
    ],
  },
  {
    name: "SupplierContact",
    source: "Supplier Contact List (Altronic_PMO site)",
    palette: "entity",
    x: 360, y: 4630, width: 280,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "name (Title)", type: "text", kind: "field" },
      { name: "firstName", type: "text", kind: "field" },
      { name: "lastName", type: "text", kind: "field" },
      { name: "supplierId (BPReference)", type: "int", kind: "fk", references: "Supplier.id" },
      { name: "email", type: "text", kind: "field" },
      { name: "phone", type: "text", kind: "field" },
      { name: "status", type: "choice", kind: "field" },
      { name: "contactNotes", type: "text", kind: "field" },
      { name: "watchers", type: "int[]", kind: "fk", references: "Person.id" },
    ],
  },
  {
    name: "SupplierIssue",
    source: "Supplier Issue Tracker (Altronic_PMO site)",
    palette: "entity",
    x: 670, y: 4630, width: 280,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title (Title)", type: "text", kind: "field" },
      { name: "supplierId (BPReference)", type: "int", kind: "fk", references: "Supplier.id" },
      { name: "description", type: "text", kind: "field" },
      { name: "status", type: "choice", kind: "field" },
      { name: "resolution", type: "text", kind: "field" },
      { name: "severity", type: "choice", kind: "field" },
      { name: "watchers", type: "int[]", kind: "fk", references: "Person.id" },
    ],
  },
  {
    // A standalone entity — no lookups in or out. No Watchers column, so
    // (same as ECN) `submittedBy` is Graph's item-level createdBy rather
    // than an FK to Person. `deltaCost` is a genuine SharePoint calculated
    // column even though originalCost/newCost are TEXT, not Currency.
    name: "CostImpactNotice",
    source: "Cost Impact Portal (ALTRONICSALESTEAM site)",
    palette: "entity",
    x: 20, y: 5120, width: 340,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title (part)", type: "text", kind: "field" },
      { name: "supplier", type: "text", kind: "field" },
      { name: "sapNumber", type: "text", kind: "field" },
      { name: "oldPartNumber", type: "text", kind: "field" },
      { name: "mpn", type: "text", kind: "field" },
      { name: "originalCost", type: "text", kind: "field" },
      { name: "newCost", type: "text", kind: "field" },
      { name: "deltaCost (calculated)", type: "number", kind: "field" },
      { name: "timeOfImpact", type: "choice", kind: "field" },
      { name: "usedOnPanels", type: "choice", kind: "field" },
      { name: "whereUsed", type: "text", kind: "field" },
      { name: "eau", type: "text", kind: "field" },
      { name: "bpReference", type: "text", kind: "field" },
      { name: "notes (Comments)", type: "text", kind: "field" },
      { name: "submittedBy (createdBy)", type: "person", kind: "field" },
      { name: "comments (Communication)", type: "text", kind: "field" },
      { name: "hasAttachments", type: "bool", kind: "field" },
    ],
  },
  {
    // Standalone — `department` is a code-level enum (DASHBOARD_DEPARTMENTS)
    // matched against the Dashboard's own section titles, not a SharePoint
    // lookup, so there's no FK to draw. Order is per-department, admin-set.
    name: "QuickLink",
    source: "Quick Links list",
    palette: "entity",
    x: 20, y: 5590, width: 300,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "label", type: "text", kind: "field" },
      { name: "url", type: "text", kind: "field" },
      { name: "department", type: "choice", kind: "field" },
      { name: "order", type: "int", kind: "field" },
    ],
  },
  {
    // CoilPN and CoilOtherFaultList are app-managed picker sources, not
    // SharePoint lookup columns, so their usage is intentionally not an FK.
    name: "CoilDefectLogEntry",
    source: "QCCoils (Engineering site)",
    palette: "entity",
    x: 20, y: 5800, width: 390,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "coilPartNumber (Title)", type: "text", kind: "field" },
      { name: "date", type: "date", kind: "field" },
      { name: "failed", type: "number", kind: "field" },
      { name: "named defect counters", type: "number", kind: "field" },
      { name: "otherFaultTable", type: "JSON[]", kind: "field" },
      { name: "otherFault.defect / count / comment", type: "text / number / text", kind: "field" },
    ],
  },
  {
    name: "CoilPartNumber",
    source: "CoilPN (Engineering site)",
    palette: "entity",
    x: 440, y: 5800, width: 270,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title (part number)", type: "text", kind: "field" },
    ],
  },
  {
    name: "CoilOtherFault",
    source: "CoilOtherFaultList (Engineering site)",
    palette: "entity",
    x: 740, y: 5800, width: 290,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title (defect)", type: "text", kind: "field" },
    ],
  },
  {
    // A standalone entity — no lookups in or out. Same shape as VisitReport
    // above: a simple log on its own site, added 2026-09-01.
    name: "QcTimeEntry",
    source: "QC Time Tracking (ALTRONICPANELTEAM site)",
    palette: "entity",
    x: 20, y: 6100, width: 320,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "project (Title)", type: "text", kind: "field" },
      { name: "week", type: "number", kind: "field" },
      { name: "dateIntoQc", type: "date", kind: "field" },
      { name: "dateStarted", type: "date", kind: "field" },
      { name: "sapNo", type: "text", kind: "field" },
      { name: "serialNo", type: "text", kind: "field" },
      { name: "performedBy (multi-person)", type: "person[]", kind: "field" },
      { name: "performedByRaw", type: "text", kind: "field" },
      { name: "hoursRaw", type: "text", kind: "field" },
      { name: "effortType", type: "choice", kind: "field" },
      { name: "notes", type: "text", kind: "field" },
    ],
  },
  {
    name: "FeatureRequest",
    source: "ARC Feature Requests (Engineering site)",
    palette: "entity",
    x: 20, y: 6400, width: 340,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title", type: "text", kind: "field" },
      { name: "description", type: "text", kind: "field" },
      { name: "department", type: "choice", kind: "field" },
      { name: "requestedBy", type: "int", kind: "fk", references: "Person.id" },
      { name: "priority", type: "choice", kind: "field" },
      { name: "status", type: "choice", kind: "field" },
      { name: "targetVersion", type: "text", kind: "field" },
      { name: "watchers", type: "int[]", kind: "fk", references: "Person.id" },
    ],
  },
  {
    name: "PanelQcIssue",
    source: "PANEL COMPONENT FAILURES (ALTRONICPANELTEAM site)",
    palette: "entity",
    x: 380, y: 6100, width: 360,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "panelSerialNumber", type: "text", kind: "field" },
      { name: "date", type: "date", kind: "field" },
      { name: "partNumber / description", type: "text", kind: "field" },
      { name: "serialReferenceNote", type: "text", kind: "field" },
      { name: "defectCategory", type: "text", kind: "fk", references: "PanelQcDefect.name" },
      { name: "comments / correctiveAction", type: "text", kind: "field" },
      { name: "production fields", type: "text", kind: "field" },
    ],
  },
  {
    name: "PanelQcDefect",
    source: "PANEL COMPONENT DEFECTS (ALTRONICPANELTEAM site)",
    palette: "entity",
    x: 760, y: 6100, width: 300,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "name (Title)", type: "text", kind: "field" },
    ],
  },
];

// ----- Connections (FK → target). Cardinality at each end: "one" | "many" --
interface Connection {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  fromCard: "one" | "many";
  toCard: "one" | "many";
}

const CONNECTIONS: Connection[] = [
  // Task → Project, Person
  { fromTable: "Task", fromColumn: "parentProjectId", toTable: "Project", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "Task", fromColumn: "relatedProjects", toTable: "Project", toColumn: "id", fromCard: "many", toCard: "many" },
  { fromTable: "Task", fromColumn: "assigned", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "many" },
  { fromTable: "Task", fromColumn: "watchers", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "many" },
  // Task → EIR (a promoted task links back to its source EIR, one-to-one)
  { fromTable: "Task", fromColumn: "eirReference", toTable: "EIR", toColumn: "id", fromCard: "one", toCard: "one" },
  // EIR → Project, Person
  { fromTable: "EIR", fromColumn: "projectReferences", toTable: "Project", toColumn: "id", fromCard: "many", toCard: "many" },
  { fromTable: "EIR", fromColumn: "reporter", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "EIR", fromColumn: "assignedEngineers", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "many" },
  { fromTable: "EIR", fromColumn: "watchers", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "many" },
  // TestSheet → Project, Task, Person
  { fromTable: "TestSheet", fromColumn: "parentProjectId", toTable: "Project", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "TestSheet", fromColumn: "parentTaskId", toTable: "Task", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "TestSheet", fromColumn: "tester", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "one" },
  // Admin → Person
  { fromTable: "Admin", fromColumn: "email", toTable: "Person", toColumn: "email", fromCard: "one", toCard: "one" },
  // EirRole → Person
  { fromTable: "EirRole", fromColumn: "email", toTable: "Person", toColumn: "email", fromCard: "one", toCard: "one" },
  { fromTable: "MaintenanceRole", fromColumn: "email", toTable: "Person", toColumn: "email", fromCard: "one", toCard: "one" },
  // Comment → Task & EIR
  { fromTable: "Comment", fromColumn: "parentId", toTable: "Task", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "Comment", fromColumn: "parentId", toTable: "EIR", toColumn: "id", fromCard: "many", toCard: "one" },
  // List-item attachments — both Tasks and EIRs. Tasks ALSO mirror uploads
  // into a ProjectFolder/ProjectFile pair (see below) so the same file is
  // attributable to both the task and the project.
  { fromTable: "Attachment", fromColumn: "parentId", toTable: "Task", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "Attachment", fromColumn: "parentId", toTable: "EIR", toColumn: "id", fromCard: "many", toCard: "one" },
  // ProjectFolder routing: every Project has one folder, every folder
  // holds many files. Tasks discover their folder by project lookupId.
  { fromTable: "ProjectFolder", fromColumn: "projectReference", toTable: "Project", toColumn: "id", fromCard: "one", toCard: "one" },
  { fromTable: "ProjectFile", fromColumn: "folderId", toTable: "ProjectFolder", toColumn: "id", fromCard: "many", toCard: "one" },
  // Operations Task List — its own Project/Equipment lookups, not Engineering's.
  { fromTable: "OperationsTask", fromColumn: "parentProjectId", toTable: "OperationsProject", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "OperationsTask", fromColumn: "equipmentId", toTable: "AltronicEquipment", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "OperationsTask", fromColumn: "assigned", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "OperationsTask", fromColumn: "watchers", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "many" },
  { fromTable: "Comment", fromColumn: "parentId", toTable: "OperationsTask", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "Attachment", fromColumn: "parentId", toTable: "OperationsTask", toColumn: "id", fromCard: "many", toCard: "one" },
  // CMMS — the maintenance module, on the same PMO site. Equipment stops being
  // a name-only picker here and becomes the hub: both CMMS lists point at it,
  // and it points at itself (ParentAsset, a sub-assembly's parent — drawn as an
  // fk column but not as a connector, same as Task.parentTaskId).
  //
  // The Operations Task List and the work orders reference EACH OTHER: a
  // promoted task keeps MaintenanceTaskReference, and the work order it made
  // keeps OperationsTaskReference. One-to-one in both directions — a task is
  // promoted at most once.
  { fromTable: "AltronicEquipment", fromColumn: "responsibleTech", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "MaintenanceTask", fromColumn: "equipmentId", toTable: "AltronicEquipment", toColumn: "id", fromCard: "many", toCard: "one" },
  // Department and Location were CHOICE columns until 2026-08-28. As lookups,
  // the shop can add a value itself (a list-item write, which Sites.Selected
  // allows) instead of needing a column change nobody has rights for — and a
  // rename carries every record pointing at it.
  { fromTable: "AltronicEquipment", fromColumn: "departmentRef", toTable: "MaintenanceDepartment", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "AltronicEquipment", fromColumn: "locationRef", toTable: "MaintenanceLocation", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "MaintenanceTask", fromColumn: "departmentRef", toTable: "MaintenanceDepartment", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "MaintenanceTask", fromColumn: "locationRef", toTable: "MaintenanceLocation", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "ScheduledMaintenance", fromColumn: "departmentRef", toTable: "MaintenanceDepartment", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "ScheduledMaintenance", fromColumn: "locationRef", toTable: "MaintenanceLocation", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "MaintenanceTask", fromColumn: "scheduleRef", toTable: "ScheduledMaintenance", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "MaintenanceTask", fromColumn: "operationsTaskRef", toTable: "OperationsTask", toColumn: "id", fromCard: "one", toCard: "one" },
  { fromTable: "OperationsTask", fromColumn: "maintenanceTaskRef", toTable: "MaintenanceTask", toColumn: "id", fromCard: "one", toCard: "one" },
  { fromTable: "MaintenanceTask", fromColumn: "assigned", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "MaintenanceTask", fromColumn: "reportedBy", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "MaintenanceTask", fromColumn: "completedBy", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "MaintenanceTask", fromColumn: "watchers", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "many" },
  { fromTable: "Comment", fromColumn: "parentId", toTable: "MaintenanceTask", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "Attachment", fromColumn: "parentId", toTable: "MaintenanceTask", toColumn: "id", fromCard: "many", toCard: "one" },
  // The asset's own manuals, wiring diagrams and nameplate photos — hung off
  // the machine rather than off whichever work order last needed them.
  { fromTable: "Attachment", fromColumn: "parentId", toTable: "AltronicEquipment", toColumn: "id", fromCard: "many", toCard: "one" },
  // Scheduled Maintenance has no Communication column, so no Comment row here.
  //
  // Nor is there a relationship row for the hourmeter: a run-hours schedule
  // reads its asset's CurrentMachineHours through the equipmentId lookup it
  // already has, so the meter path adds no new edge to this diagram — only the
  // two number columns above.
  { fromTable: "ScheduledMaintenance", fromColumn: "equipmentId", toTable: "AltronicEquipment", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "ScheduledMaintenance", fromColumn: "assignedTo", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "ScheduledMaintenance", fromColumn: "lastCompletedBy", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "ScheduledMaintenance", fromColumn: "watchers", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "many" },
  // Build Requests — master-detail pair on the Engineering site. Items join
  // to their header via BuildRequestNoLookupId; both levels have their own
  // Communication thread + Watchers.
  { fromTable: "BuildRequestItem", fromColumn: "buildRequestId", toTable: "BuildRequest", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "BuildRequest", fromColumn: "projectReference", toTable: "Project", toColumn: "id", fromCard: "many", toCard: "many" },
  { fromTable: "BuildRequest", fromColumn: "taskReference", toTable: "Task", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "BuildRequest", fromColumn: "requestor", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "BuildRequest", fromColumn: "engineerAssigned", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "BuildRequestItem", fromColumn: "projectReference", toTable: "Project", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "BuildRequestItem", fromColumn: "taskRef", toTable: "Task", toColumn: "id", fromCard: "many", toCard: "one" },
  // Panels — own site + own project reference list; person/comment/attachment
  // relationships mirror the Operations pattern.
  { fromTable: "PanelOrder", fromColumn: "projectReference", toTable: "PanelProject", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "PanelOrder", fromColumn: "engineerAssigned", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "PanelOrder", fromColumn: "watchers", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "many" },
  { fromTable: "PanelUserRole", fromColumn: "user", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "Comment", fromColumn: "parentId", toTable: "PanelOrder", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "Attachment", fromColumn: "parentId", toTable: "PanelOrder", toColumn: "id", fromCard: "many", toCard: "one" },
  // Panel Tasks — same site + shared Panel Project Reference list.
  { fromTable: "PanelTask", fromColumn: "projectReference", toTable: "PanelProject", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "PanelTask", fromColumn: "assigned", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "PanelTask", fromColumn: "watchers", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "many" },
  { fromTable: "Comment", fromColumn: "parentId", toTable: "PanelTask", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "Attachment", fromColumn: "parentId", toTable: "PanelTask", toColumn: "id", fromCard: "many", toCard: "one" },
  // Teradyne — four lists on the PMO site, all single-value lookups pointing
  // INTO the three reference lists. No Comment/Attachment rows: the log has no
  // Communication column and takes no files. Employee 1 and Employee 2 are two
  // separate columns aimed at the same list, not one multi-value lookup.
  { fromTable: "TeradyneLogEntry", fromColumn: "product", toTable: "TeradyneProduct", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "TeradyneLogEntry", fromColumn: "employee1", toTable: "TeradyneEmployee", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "TeradyneLogEntry", fromColumn: "employee2", toTable: "TeradyneEmployee", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "TeradyneLogEntry", fromColumn: "remark", toTable: "TeradyneRemark", toColumn: "id", fromCard: "many", toCard: "one" },
  // CSA Listings — certificates attach to the list item; no other relationships.
  { fromTable: "Attachment", fromColumn: "parentId", toTable: "CsaListing", toColumn: "id", fromCard: "many", toCard: "one" },
  // CRM tool — CustomerNote is the hub; the other three all point INTO it.
  { fromTable: "CustomerNote", fromColumn: "csr", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "many" },
  { fromTable: "CustomerNote", fromColumn: "kam", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "CustomerContact", fromColumn: "customerId", toTable: "CustomerNote", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "SpecialPricingEntry", fromColumn: "customerId", toTable: "CustomerNote", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "CapacityEntry", fromColumn: "customerId", toTable: "CustomerNote", toColumn: "id", fromCard: "many", toCard: "one" },
  // SRM tool — Supplier is the hub; SupplierContact and SupplierIssue point INTO it,
  // and Supplier points back at SupplierContact for its one Point of Contact.
  { fromTable: "Supplier", fromColumn: "assignedBuyer", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "Supplier", fromColumn: "watchers", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "many" },
  { fromTable: "Supplier", fromColumn: "pointOfContactId", toTable: "SupplierContact", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "SupplierContact", fromColumn: "supplierId (BPReference)", toTable: "Supplier", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "SupplierContact", fromColumn: "watchers", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "many" },
  { fromTable: "SupplierIssue", fromColumn: "supplierId (BPReference)", toTable: "Supplier", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "SupplierIssue", fromColumn: "watchers", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "many" },
  // ARC Feature Requests — RequestedBy is single-person, auto-filled on
  // create and never re-picked; Watchers starts as just the requester.
  { fromTable: "FeatureRequest", fromColumn: "requestedBy", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "FeatureRequest", fromColumn: "watchers", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "many" },
  { fromTable: "PanelQcIssue", fromColumn: "defectCategory", toTable: "PanelQcDefect", toColumn: "name", fromCard: "many", toCard: "one" },
];

export function AboutView() {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();

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
          <strong>ARC — the Altronic Resource Center</strong> — is a
          company-wide platform that brings every department's tools and
          processes into one app behind a single sign-in.{" "}
          <em>Every team. One ARC. Always forward.</em> Engineering is the
          first team aboard (task tracker, kanban board, EIR log, test-sheet
          log), with more departments to follow. It runs as a static React SPA
          on GitHub Pages, signs you in through Microsoft Entra ID, and
          reads/writes SharePoint lists via Microsoft Graph (plus the
          SharePoint REST API for list-item attachments).
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
          <a
            href="https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering/Lists/EIREngineering%20Information%20Request/AllItems.aspx"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-fg-muted hover:border-fg-muted hover:text-fg"
          >
            <ExternalLink className="h-3 w-3" /> EIRs
          </a>
          {isAdmin && (
            <a
              href="https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering/Lists/Admins/AllItems.aspx"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-fg-muted hover:border-fg-muted hover:text-fg"
            >
              <ExternalLink className="h-3 w-3" /> Admins
            </a>
          )}
          <Link
            to="/"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-fg-muted hover:border-fg-muted hover:text-fg"
          >
            Back to tasks
          </Link>
        </div>
      </div>

      <DirectoryStatusSection />

      <Section
        title="What an SPA is"
        description="Using ARC as an example — a primer for anyone used to server-rendered apps like Power Apps."
      >
        <SpaPrimer />
      </Section>

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
        description="ER diagram of the SharePoint schema. Each table is one entity (a list, or a derived concept). PK rows are flagged in red; FK rows are flagged blue. Connectors show foreign-key relationships with crow's-foot cardinality at each end (○ = one, ⋖ = many). The diagram is wide — scroll horizontally on small screens."
      >
        <ErDiagram />
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

// =============================================================================
// Staff-directory status — makes the (otherwise silent) tenant-directory read
// visible, and offers a one-click recovery. This is where you look when
// someone reports "I can't see / @-mention certain people": either the
// directory loaded (count shown) or it didn't (reason shown + a Retry button
// that re-requests access and surfaces a missing admin consent).
// =============================================================================

function StatusLine({
  tone,
  icon,
  children,
}: {
  tone: "ok" | "error";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm",
        tone === "ok"
          ? "border-cooper-green/40 bg-cooper-green/10 text-fg"
          : "border-cooper-red/40 bg-cooper-red/10 text-fg",
      )}
    >
      <span className={tone === "ok" ? "text-cooper-green" : "text-cooper-red"}>{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function DirectoryStatusSection() {
  const diag = useDirectoryDiagnostics(true);
  const qc = useQueryClient();
  const [granting, setGranting] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);

  const probe = diag.data;

  async function handleGrant() {
    setGranting(true);
    setGrantError(null);
    try {
      await grantDirectoryAccess();
      // New token now carries the scope — refresh both the pickers' directory
      // and this card's probe so the fix is visible immediately.
      await qc.invalidateQueries({ queryKey: DIRECTORY_KEY });
      await diag.refetch();
    } catch (err) {
      const msg =
        err && typeof err === "object" && "errorMessage" in err
          ? String((err as { errorMessage?: string }).errorMessage ?? "").split("\n")[0]
          : "";
      setGrantError(msg || "Sign-in was cancelled or blocked.");
    } finally {
      setGranting(false);
    }
  }

  return (
    <Section
      title="Staff directory (assignment & @-mentions)"
      description="Powers who you can pick to assign or @-mention. It reads the company directory from Microsoft Graph under a separate permission (User.ReadBasic.All). When it can't, the pickers quietly fall back to only people already on an item — which looks like 'certain people are missing.'"
    >
      <div className="space-y-3">
        {diag.isLoading ? (
          <p className="text-sm text-fg-muted">Checking directory access…</p>
        ) : probe?.mock ? (
          <StatusLine tone="ok" icon={<Users className="h-4 w-4" />}>
            Demo mode — {probe.count} sample people.
          </StatusLine>
        ) : probe?.ok ? (
          <StatusLine tone="ok" icon={<CheckCircle2 className="h-4 w-4" />}>
            Connected — {probe.count.toLocaleString()} people loaded from the company directory.
          </StatusLine>
        ) : (
          <>
            <StatusLine tone="error" icon={<AlertTriangle className="h-4 w-4" />}>
              Couldn't read the directory
              {probe?.error ? (
                <>
                  {" — "}
                  <span className="font-mono text-xs">{probe.error}</span>
                </>
              ) : null}
              .
            </StatusLine>
            <p className="text-xs leading-relaxed text-fg-muted">
              Most often this means your signed-in session predates the permission being
              granted, or{" "}
              <code className="rounded bg-bg px-1 py-0.5">User.ReadBasic.All</code> hasn't been
              admin-consented on the <strong>Engineering Task System</strong> app registration
              yet. Click below to re-request access — if a Microsoft prompt appears asking to
              “read all users’ basic profiles,” the consent hasn't been granted (an admin can
              approve it right there; otherwise send it to IT).
            </p>
          </>
        )}

        {!probe?.mock && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleGrant}
              disabled={granting}
              className="inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-60"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", granting && "animate-spin")} />
              {granting ? "Requesting…" : "Retry / grant access"}
            </button>
            {grantError && <span className="text-xs text-cooper-red">{grantError}</span>}
          </div>
        )}
      </div>
    </Section>
  );
}

// =============================================================================
// SPA primer — long-form explanation of what a Single Page Application is and
// why the Altronic app was built as one. Lives above the diagrams because the
// diagrams assume you already know the SPA model. Collapsed by default via
// <details> so it doesn't dominate the page for people who already get it.
// =============================================================================
function SpaPrimer() {
  return (
    <details className="group" open>
      <summary className="cursor-pointer select-none rounded-md border border-border bg-bg px-3 py-2 text-xs font-medium text-fg-muted hover:text-fg group-open:mb-4">
        <span className="group-open:hidden">Read primer</span>
        <span className="hidden group-open:inline">Hide primer</span>
      </summary>
      <div className="space-y-4 text-sm leading-relaxed text-fg">
        <p>
          A Single Page Application loads one HTML document on first visit,
          then runs entirely in the browser. Subsequent navigation and
          interactions are handled by JavaScript locally rather than by
          requesting new pages from a server. The browser becomes the
          application runtime. The server becomes a data API.
        </p>
        <p>
          This is fundamentally different from the traditional
          request-response model used by Power Apps, classic ASP.NET, PHP,
          Rails, and similar frameworks, where every click round-trips
          through a server that renders HTML and sends it back.
        </p>

        <PrimerHeading>How the Altronic app works</PrimerHeading>
        <p>When a user visits the app:</p>
        <ol className="list-decimal space-y-1 pl-6 text-fg-muted">
          <li>The browser requests the URL from GitHub Pages</li>
          <li>
            GitHub Pages returns a ~1 KB HTML shell plus references to a
            JavaScript bundle (~125 KB gzipped) and a CSS file
          </li>
          <li>
            The browser downloads and executes the JavaScript, which
            constructs the entire UI in the empty root div
          </li>
          <li>
            The JavaScript authenticates the user against Entra ID via MSAL
            using OAuth 2.0 PKCE flow
          </li>
          <li>
            Once authenticated, the JavaScript calls Microsoft Graph directly
            to fetch task data from SharePoint
          </li>
          <li>The UI renders against that data</li>
        </ol>
        <p>
          From this point forward, the browser does not request HTML from
          any server. When the user clicks between List view, Kanban view,
          and task detail pages, the URL updates via the History API, the
          JavaScript swaps in the relevant component, and the screen
          updates instantly with no network call. When the user edits a
          task, the JavaScript makes a single PATCH request to Microsoft
          Graph and updates local state. The user sees the change
          immediately while the network request completes in the background.
        </p>

        <PrimerHeading>Three independent systems</PrimerHeading>
        <p>The Altronic app has three completely independent participants:</p>
        <ul className="space-y-2 pl-1 text-fg-muted">
          <li>
            <strong className="text-fg">GitHub Pages</strong> hosts the
            static files. It serves the HTML, CSS, and JavaScript on first
            visit and is never involved again. It never sees SharePoint
            data, never sees user credentials, and could not access either
            even if asked.
          </li>
          <li>
            <strong className="text-fg">The user's browser</strong> is
            where the application actually runs. After the initial
            download, it talks directly to Microsoft Graph using the
            user's auth token. The browser holds all the application
            state, all the rendering logic, and all the business logic for
            the UI.
          </li>
          <li>
            <strong className="text-fg">Microsoft Graph and SharePoint</strong>{" "}
            are the data backend. The browser reads and writes here,
            authenticated as the user. Microsoft enforces all permissions.
            We didn't build any of this.
          </li>
        </ul>
        <p>
          The user's identity is what ties them together. Their browser
          downloads our code from GitHub, then uses their Microsoft
          credentials to access their own SharePoint data.
        </p>

        <PrimerHeading>Why this was the right architecture for this app</PrimerHeading>
        <ul className="space-y-2 pl-1 text-fg-muted">
          <li>
            <strong className="text-fg">Performance after first load.</strong>{" "}
            Every interaction is local. Filtering the task list, switching
            from List to Kanban, opening the detail view, applying a sort —
            these all happen in memory with no network round-trip. Power
            Apps round-trips through Microsoft's servers for nearly every
            interaction. That's the latency difference users feel.
          </li>
          <li>
            <strong className="text-fg">Deployment simplicity.</strong> Just
            static files on a CDN. No application server to run, patch,
            scale, or pay for. GitHub Pages costs nothing. Microsoft Graph
            is included in the existing M365 license. Total infrastructure
            cost for the app: zero additional dollars.
          </li>
          <li>
            <strong className="text-fg">Architectural decoupling.</strong>{" "}
            The frontend and backend are independent. We can rewrite the
            frontend without touching SharePoint. If Microsoft replaces
            Graph with something else, we'd swap the data layer without
            changing the UI. With Power Apps, the frontend and backend are
            entangled in a proprietary platform.
          </li>
          <li>
            <strong className="text-fg">No delegation limits.</strong> Power
            Apps' 2,000-record limit doesn't exist here. Microsoft Graph
            handles pagination natively and we walk through it transparently.
            Users see the complete dataset, always.
          </li>
          <li>
            <strong className="text-fg">Modern interactivity.</strong>{" "}
            Drag-and-drop Kanban, optimistic UI updates, smooth modal
            transitions, mobile-responsive layouts. All standard SPA
            patterns that would be either impossible or painful in Power Apps.
          </li>
        </ul>

        <PrimerHeading>What this costs</PrimerHeading>
        <ul className="space-y-2 pl-1 text-fg-muted">
          <li>
            <strong className="text-fg">First-load latency.</strong> The
            user waits 500–1500&nbsp;ms on a fresh visit while the
            JavaScript downloads and executes. After that, navigation is
            instant. Power Apps has its own first-load cost (downloading
            the Power Apps runtime, which is ~10&nbsp;MB), so we're
            actually faster on first load too, but it's worth understanding
            the trade-off exists.
          </li>
          <li>
            <strong className="text-fg">JavaScript expertise required.</strong>{" "}
            Maintaining the app requires real frontend skills. Power Apps
            can be modified by anyone with the platform license. The SPA
            can be modified by anyone who understands React and TypeScript,
            which is a smaller pool but a more capable one.
          </li>
          <li>
            <strong className="text-fg">Framework evolution.</strong> SPA
            frameworks change faster than backend ones. We're using React 18
            and modern patterns in 2026. In five years we may need to
            migrate to whatever's current. This is a real maintenance
            commitment.
          </li>
        </ul>

        <PrimerHeading>The mental shift for someone coming from server-rendered apps</PrimerHeading>
        <p>
          The biggest conceptual change is that the server doesn't render
          anything. There are no view templates, no controllers returning
          HTML, no MVC pattern in the traditional sense. The server
          (Microsoft Graph) only returns JSON. The browser owns the
          entire UI.
        </p>
        <p>
          If you've worked in XAML, SwiftUI, or any other declarative UI
          framework, React will feel familiar — you describe what the UI
          should look like given current state, and the framework handles
          updating the DOM. If you're coming from imperative DOM
          manipulation or server-side templating, the model takes a few
          days to internalise, but the productivity gain is significant
          once it clicks.
        </p>
        <p>
          For an internal platform with the interactivity needs of
          ARC, the SPA architecture is the
          right call. We get sub-100&nbsp;ms interactions, zero
          infrastructure cost, full control over UX, and a stack we can
          evolve over time. The trade-offs that hurt SPAs (SEO, first-load
          on slow networks, framework churn) are non-issues for our use
          case.
        </p>
      </div>
    </details>
  );
}

function PrimerHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-2 font-display text-sm font-semibold text-fg sm:text-base">
      {children}
    </h3>
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
/**
 * ER diagram drawn as a single SVG canvas. Tables are positioned by hand
 * in SCHEMA_TABLES; connectors come from CONNECTIONS. Crow's-foot markers
 * (`one` = open circle, `many` = three-prong) carry cardinality at each
 * end. Lines route as a simple right-angle: source → midpoint → target.
 */
function ErDiagram() {
  // Compute canvas dimensions from the table footprints.
  const maxX = Math.max(...SCHEMA_TABLES.map((t) => t.x + t.width)) + 30;
  const maxY = Math.max(...SCHEMA_TABLES.map((t) => t.y + tableHeight(t))) + 30;
  const byName = Object.fromEntries(SCHEMA_TABLES.map((t) => [t.name, t]));

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-bg p-3">
      <svg
        viewBox={`0 0 ${maxX} ${maxY}`}
        width={maxX}
        height={maxY}
        style={{ minWidth: "100%", maxWidth: `${maxX}px` }}
        role="img"
        aria-label="Entity-relationship diagram for ARC (Altronic Resource Center)"
      >
        <defs>
          {/* "many" crow's-foot — three lines fanning from the table edge. */}
          <marker
            id="er-many"
            markerWidth="14"
            markerHeight="14"
            refX="13"
            refY="7"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path
              d="M 13,7 L 2,0 M 13,7 L 2,7 M 13,7 L 2,14"
              stroke="rgb(var(--fg-muted))"
              strokeWidth="1.4"
              fill="none"
            />
          </marker>
          {/* "one" — open circle just outside the table edge. */}
          <marker
            id="er-one"
            markerWidth="14"
            markerHeight="14"
            refX="13"
            refY="7"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <circle
              cx="6"
              cy="7"
              r="3"
              stroke="rgb(var(--fg-muted))"
              strokeWidth="1.4"
              fill="rgb(var(--bg))"
            />
            <line
              x1="9"
              y1="7"
              x2="13"
              y2="7"
              stroke="rgb(var(--fg-muted))"
              strokeWidth="1.4"
            />
          </marker>
        </defs>

        {/* Connectors first so they sit behind the table cards. */}
        {CONNECTIONS.map((c, i) => (
          <ConnectionPath key={i} c={c} byName={byName} />
        ))}

        {/* Tables on top. */}
        {SCHEMA_TABLES.map((t) => (
          <SchemaTableSvg key={t.name} table={t} />
        ))}
      </svg>
    </div>
  );
}

function ConnectionPath({
  c,
  byName,
}: {
  c: Connection;
  byName: Record<string, SchemaTable>;
}) {
  const from = byName[c.fromTable];
  const to = byName[c.toTable];
  if (!from || !to) return null;

  // Pick the port side (left / right of each table) based on which
  // direction the connector is travelling.
  const fromRight = from.x + from.width / 2 < to.x + to.width / 2;
  const srcX = fromRight ? from.x + from.width : from.x;
  const tgtX = fromRight ? to.x : to.x + to.width;
  const srcY = rowCenterY(from, c.fromColumn);
  const tgtY = rowCenterY(to, c.toColumn);

  // Right-angle path with the bend in the midline between the two
  // tables. A small offset away from each table edge keeps the markers
  // from clipping the table border.
  const midX = (srcX + tgtX) / 2;
  const d = `M ${srcX} ${srcY} L ${midX} ${srcY} L ${midX} ${tgtY} L ${tgtX} ${tgtY}`;

  return (
    <path
      d={d}
      stroke="rgb(var(--fg-muted))"
      strokeWidth="1.2"
      fill="none"
      markerStart={`url(#er-${c.fromCard})`}
      markerEnd={`url(#er-${c.toCard})`}
    />
  );
}

function SchemaTableSvg({ table }: { table: SchemaTable }) {
  const h = tableHeight(table);
  const isEntity = table.palette === "entity";
  const headerFill = isEntity ? "#CB2C30" : "#1C60AC";

  // Index of the last PK row so we can draw the dashed separator after it.
  const lastPkIdx = table.columns.findIndex((c) => c.kind !== "pk") - 1;

  return (
    <g>
      {/* Outer border */}
      <rect
        x={table.x}
        y={table.y}
        width={table.width}
        height={h}
        rx="6"
        ry="6"
        fill="rgb(var(--surface))"
        stroke="rgb(var(--border))"
      />

      {/* Header band */}
      <path
        d={`M ${table.x} ${table.y + HEADER_HEIGHT}
            L ${table.x} ${table.y + 6}
            Q ${table.x} ${table.y} ${table.x + 6} ${table.y}
            L ${table.x + table.width - 6} ${table.y}
            Q ${table.x + table.width} ${table.y} ${table.x + table.width} ${table.y + 6}
            L ${table.x + table.width} ${table.y + HEADER_HEIGHT} Z`}
        fill={headerFill}
      />
      <text
        x={table.x + table.width / 2}
        y={table.y + 22}
        fontSize="14"
        fontWeight="700"
        fill="#fff"
        textAnchor="middle"
      >
        {table.name}
      </text>
      <text
        x={table.x + table.width / 2}
        y={table.y + 40}
        fontSize="10"
        fill="rgba(255,255,255,0.85)"
        textAnchor="middle"
      >
        {table.source}
      </text>

      {/* Rows */}
      {table.columns.map((col, i) => {
        const rowY = table.y + HEADER_HEIGHT + i * ROW_HEIGHT;
        return (
          <g key={col.name}>
            {/* PK badge */}
            {col.kind === "pk" && (
              <>
                <rect
                  x={table.x + 8}
                  y={rowY + 4}
                  width={26}
                  height={14}
                  rx="3"
                  fill="#CB2C30"
                />
                <text
                  x={table.x + 21}
                  y={rowY + 14}
                  fontSize="9"
                  fontWeight="700"
                  fill="#fff"
                  textAnchor="middle"
                >
                  PK
                </text>
              </>
            )}
            {col.kind === "fk" && (
              <>
                <rect
                  x={table.x + 8}
                  y={rowY + 4}
                  width={26}
                  height={14}
                  rx="3"
                  fill="#1C60AC"
                />
                <text
                  x={table.x + 21}
                  y={rowY + 14}
                  fontSize="9"
                  fontWeight="700"
                  fill="#fff"
                  textAnchor="middle"
                >
                  FK
                </text>
              </>
            )}
            <text
              x={table.x + 42}
              y={rowY + 15}
              fontSize="11"
              fill="rgb(var(--fg))"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {col.name}
            </text>
            <text
              x={table.x + table.width - 8}
              y={rowY + 15}
              fontSize="10"
              fill="rgb(var(--fg-muted))"
              textAnchor="end"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {col.type}
            </text>
          </g>
        );
      })}

      {/* Dashed separator under the PK rows (Visio convention). */}
      {lastPkIdx >= 0 && (
        <line
          x1={table.x + 8}
          y1={table.y + HEADER_HEIGHT + (lastPkIdx + 1) * ROW_HEIGHT - 1}
          x2={table.x + table.width - 8}
          y2={table.y + HEADER_HEIGHT + (lastPkIdx + 1) * ROW_HEIGHT - 1}
          stroke="rgb(var(--border))"
          strokeDasharray="2 3"
        />
      )}
    </g>
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
