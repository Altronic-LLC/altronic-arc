import { ArrowDown, ArrowLeft, BookOpen, ExternalLink, Info } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { CURRENT_VERSION } from "@/data/changelog";
import { useIsAdmin } from "@/hooks/useIsAdmin";
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
      { label: "Views", hint: "Dashboard · List · Kanban · Detail · EIRs · Test Sheets · Project Folders · Admin", palette: "ui" },
      { label: "React Query hooks", hint: "useTasks · useEirs · useTestSheets · useBuildRequests · useAdmins · useEirRoles · useTaskFiles · useProjectFolders", palette: "ui" },
      { label: "API layer", hint: "src/api/tasks · eirs · testSheets · buildRequests · buildRequestItems · panelOrders · admins · eirRoles · panelRoles · projectFiles · attachments · email · errorReport · editFailureReport", palette: "ui" },
      {
        label: "Build Requests (lazy-loaded)",
        hint: "BuildRequestsView · BuildRequestDetailView — a master-detail pair: the Tracker header list + any number of parts from the Items list, joined by BuildRequestNo. Own code-split chunk.",
        palette: "ui",
      },
      {
        label: "Operations department (lazy-loaded bundle)",
        hint: "OperationsListView · OperationsKanbanView · OperationsDetailView · AdminOperationsProjectsView — useOperationsTasks — api/operationsTasks · operationsProjects · operationsEquipment. Own site (PMO), own code-split chunk; no imports from the Engineering views/hooks above.",
        palette: "ui",
      },
      {
        label: "Panels department (lazy-loaded bundle)",
        hint: "PanelOrdersView · PanelOrderDetailView · AdminPanelProjectsView · AdminPanelRolesView — usePanelOrders · usePanelRoles — api/panelOrders · panelProjects · panelRoles. Own site (ALTRONICPANELTEAM), own code-split chunk; no cross-department imports.",
        palette: "ui",
      },
    ],
  },
  {
    label: "Auth & transport",
    nodes: [
      { label: "MSAL Entra ID", hint: "Sites.Selected · Mail.Send.Shared (AllSites.Manage optional)", palette: "auth" },
      { label: "Microsoft Graph v1.0", hint: "Lists, items, drives, users, mail", palette: "gateway" },
      { label: "SharePoint REST", hint: "List-item attachments (Task, EIR, Operations Task, Panel Order) + site-user resolution — optional", palette: "gateway" },
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
      { label: "Documents library", hint: "General/Project Folders/* — task & comment files land here", palette: "list" },
      { label: "List-item attachments", hint: "SharePoint REST · per-item files on Tasks & EIRs", palette: "list" },
      { label: "Operations Task List", hint: "Altronic_PMO site — separate from Engineering's Task List", palette: "list" },
      { label: "Operations Projects", hint: "Altronic_PMO site — Operations' own parent-project reference list", palette: "list" },
      { label: "Altronic Equipment List", hint: "Altronic_PMO site — read-only reference for the Equipment picker", palette: "list" },
      { label: "Build Request Tracker", hint: "BR headers — status workflow, requestor/engineer, own comment thread", palette: "list" },
      { label: "Build Request Items", hint: "parts per BR (lookup to the Tracker) — checklists + per-part comment threads", palette: "list" },
      { label: "Panel Order Headers", hint: "ALTRONICPANELTEAM site — panel sales orders (status, SO/PO, engineer, own comment thread)", palette: "list" },
      { label: "Panel Project Reference", hint: "ALTRONICPANELTEAM site — admin-managed project reference numbers", palette: "list" },
      { label: "Panel User Roles", hint: "ALTRONICPANELTEAM site — one row per user per role (gating ships dark in v1)", palette: "list" },
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
    name: "Comment",
    source: "Concept (Communication field)",
    palette: "shared",
    x: 960, y: 380, width: 290,
    columns: [
      { name: "parentId", type: "int", kind: "fk", references: "Task / EIR / OperationsTask" },
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
    source: "Task, EIR & Operations Task list-item attachments (SP REST)",
    palette: "shared",
    x: 960, y: 540, width: 290,
    columns: [
      { name: "parentId", type: "int", kind: "fk", references: "Task / EIR / OperationsTask" },
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
    name: "AltronicEquipment",
    source: "Altronic Equipment List (Altronic_PMO site, read-only)",
    palette: "shared",
    x: 720, y: 1000, width: 260,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "title", type: "text", kind: "field" },
      { name: "serialNo", type: "text", kind: "field" },
      { name: "equipmentType", type: "choice", kind: "field" },
      { name: "department", type: "choice", kind: "field" },
      { name: "location", type: "choice", kind: "field" },
    ],
  },

  // ---- Build Requests (Engineering site) — master-detail list pair ---------
  {
    name: "BuildRequest",
    source: "Build Request Tracker (Engineering site)",
    palette: "entity",
    x: 20, y: 1370, width: 370,
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
    x: 440, y: 1370, width: 380,
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
    x: 20, y: 1830, width: 380,
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
    x: 440, y: 1830, width: 280,
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
    x: 760, y: 1830, width: 280,
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "user", type: "int", kind: "fk", references: "Person.id" },
      { name: "role", type: "choice", kind: "field" },
      { name: "note (Title)", type: "text", kind: "field" },
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
