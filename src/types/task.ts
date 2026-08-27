// =============================================================================
// Domain types — modelled directly on the SharePoint columns we discovered
// during PowerShell exploration. Field names match the SharePoint internal
// `name` (not the displayName) because that's what Graph returns under
// `item.fields`.
// =============================================================================

/** All allowed Status values, in the order they should appear on the Kanban board. */
export const STATUSES = [
  "BACKLOG",
  "SELECTED FOR DEVELOPMENT",
  "In Progress",
  "On Hold",
  "Blocked",
  "Complete",
] as const;

export type Status = (typeof STATUSES)[number];

export const PRIORITIES = ["Low", "Medium", "High"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CATEGORIES = [
  "Software",
  "Hardware",
  "UI",
  "Drawing",
  "Documentation",
  "Field Trial",
  "Build Request",
  "Product Certification",
  "Label Change",
  "PCB",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const LABELS = [
  "bug",
  "documentation",
  "duplicate",
  "enhancement",
  "good first issue",
  "help wanted",
  "invalid",
  "question",
  "wontfix",
] as const;
export type Label = (typeof LABELS)[number];

/** A person reference, as stored in the `Assigned` / `Watchers` person fields. */
export interface Person {
  displayName: string;
  email?: string;
  /** SharePoint user lookup ID (used when writing back). */
  lookupId?: number;
}

/** One parsed comment from the `Communication` field. */
export interface Comment {
  /** Date the comment was created. */
  timestamp: Date;
  /** Author's display name. */
  authorName: string;
  /** Author's email (used for @-mention rendering and avatars later). */
  authorEmail: string;
  /** HTML body as authored. Render through a sanitizer before injecting. */
  bodyHtml: string;
  /** Attachments captured with the comment. Empty array if none. */
  attachments?: CommentAttachment[];
}

/**
 * A file or image attached to a comment.
 *
 * In demo/mock mode these live in memory only — `objectUrl` is a blob URL
 * from URL.createObjectURL(). When real mode is wired up, attachments will
 * be uploaded to a SharePoint document library with rules to be defined
 * later; at that point we'll add a `sharepointUrl` field and the upload
 * step will go through src/api/attachments.ts.
 */
export interface CommentAttachment {
  /** Stable id within the comment (used as a React key). */
  id: string;
  /** Original filename as the user uploaded it. */
  filename: string;
  /** MIME type from the File object (e.g. "image/png"). */
  contentType: string;
  /** File size in bytes. */
  sizeBytes: number;
  /** Blob URL for previewing during the session. Revoke when no longer needed. */
  objectUrl?: string;
}

/** A parent project reference, resolved from the lookup. */
export interface ProjectReference {
  lookupId: number;
  title: string; // e.g. "0000-Engineering Apps"
  /** Free-text project description. Only populated for lists that have one (e.g. Operations Projects' ProjectDescription column) — undefined elsewhere. */
  description?: string;
}

/**
 * The Dashboard's department sections, in the order they're rendered.
 * Shared between `DashboardView`'s `SECTION_TITLES` and the Quick Links
 * feature — a link is tagged with one of these, and the admin table groups
 * by it. Kept as ONE array so the two never drift into naming a department
 * differently.
 */
export const DASHBOARD_DEPARTMENTS = [
  "Engineering",
  "Panels",
  "Operations",
  "Coils",
  "Quality Control",
  "Supply Chain",
  "Customer Service / Sales",
] as const;

export type DashboardDepartment = (typeof DASHBOARD_DEPARTMENTS)[number];

/**
 * Row in the Quick Links SharePoint list — an admin-managed external link
 * shown as a button above a department's cards on the Dashboard. `order` is
 * an admin-set integer, unique only within a department, ascending; a tie
 * (e.g. two rows created before ordering existed) breaks on `id` so the
 * sort is always total. `id` is the SP list item id.
 */
export interface QuickLink {
  id: number;
  label: string;
  url: string;
  department: DashboardDepartment;
  order: number;
}

/**
 * Row in the Admins SharePoint list. Drives header-visibility and admin-
 * page access. `id` is the SP list item id (used for delete).
 */
export interface AdminEntry {
  id: number;
  email: string;
  displayName: string;
  /** Optional note like "Engineering Manager" — purely cosmetic. */
  note: string;
}

/**
 * EIR role tags. These gate which fields a user may edit on an EIR:
 *   - "engineer"     → may edit the Engineering Response field
 *   - "supply chain" → may edit the Buyer Code field
 * A user can hold both. The field→role map lives in EirDetailView.
 */
export const EIR_ROLES = ["engineer", "supply chain"] as const;
export type EirRole = (typeof EIR_ROLES)[number];

/**
 * Row in the EIR Roles SharePoint list (admin-managed). One entry per user,
 * keyed by email, carrying the set of role tags. `id` is the SP list item id
 * (used for update/delete).
 */
export interface EirRoleEntry {
  id: number;
  email: string;
  displayName: string;
  roles: EirRole[];
  /** Optional note — purely cosmetic. */
  note: string;
}

/**
 * A bare reference to another task — just the bits we need to render a
 * pill/link without re-fetching the full task. Used for parent and child
 * task references.
 */
export interface TaskRef {
  id: number;
  numberedTitle: string;
  status: Status;
}

/**
 * Value of the task's `EIRReference` column — a SharePoint **Hyperlink**
 * field. When a task is promoted from an EIR, `url` points at that EIR's
 * detail page in ARC and `label` is the EIR number (shown as the link
 * text). Graph reads/writes hyperlink columns as `{ Url, Description }`;
 * this is the normalised domain shape (see `parseHyperlinkField` in
 * `taskMapper.ts` and the write path in `createTask`).
 */
export interface TaskEirReference {
  /** Absolute URL to the source EIR's detail page. */
  url: string;
  /** Display text — the EIR number, e.g. "EIR_2025-0001". */
  label: string;
}

/** The fully-shaped task we work with in the UI. */
export interface Task {
  /** SharePoint list item ID (numeric, used in API paths). */
  id: number;
  /** Auto-generated public-facing identifier, e.g. "T115-0000-Title". */
  numberedTitle: string;
  /** Plain title (no prefix). */
  title: string;
  /** Long-form description (HTML or plain text). */
  description: string;
  status: Status;
  priority: Priority | null;
  category: Category | null;
  labels: Label[];
  dueDate: Date | null;
  createdAt: Date;
  modifiedAt: Date;
  /** Author lookup ID; resolved to a Person if we have the directory. */
  authorLookupId: number;
  /**
   * The person who created the task, resolved from the list item's
   * `createdBy.user` (Graph returns this by default — no extra request
   * needed). Null if the response didn't include it (older mock items
   * pre-dating this field, or odd Graph responses).
   */
  author: Person | null;
  /**
   * Person who last modified this record. Resolved from Graph's default
   * `lastModifiedBy.user` (displayName + email), same way `author`
   * resolves from `createdBy.user`. Optional so old mocks / fixtures
   * built before this field landed still type-check.
   */
  editor?: Person | null;
  /** Editor lookup ID. */
  editorLookupId: number;
  /** Parent project — null if not set. */
  parentProject: ProjectReference | null;
  /** Other related projects (multi-value lookup). Empty array if none. */
  relatedProjects: ProjectReference[];
  /** Parent task — null if this task is top-level. */
  parentTask: TaskRef | null;
  /**
   * Child tasks (derived — not stored on the task itself; computed by
   * scanning other tasks whose parent points at this one).
   */
  childTasks: TaskRef[];
  /** People the task is assigned to. */
  assigned: Person[];
  /** People watching for updates. */
  watchers: Person[];
  /**
   * Software revision string — free-text field used for tracking which
   * firmware / app version a task targets. The SharePoint internal field
   * name needs to be verified; the mapper assumes `SoftwareRevision`.
   */
  softwareRevision: string;
  /**
   * Source EIR link, when this task was promoted from an EIR (the
   * `EIRReference` Hyperlink column). Null for tasks created directly.
   * Its presence is what ties a task back to an EIR — used to prompt for
   * a final resolution on completion and to write that back to the EIR's
   * Engineering Response. See `TaskEirReference`.
   */
  eirReference: TaskEirReference | null;
  /** Parsed comments, newest first. */
  comments: Comment[];
  /** Whether the item has SharePoint attachments. */
  hasAttachments: boolean;
  /**
   * Raw SharePoint `fields` bag from Graph. Kept around so feature-specific
   * UI (e.g. the PCB checklist on category=PCB tasks) can read columns
   * the typed mapper doesn't surface, without forcing every new
   * conditional field through the type definition.
   */
  rawFields?: Record<string, unknown>;
}

// =============================================================================
// Test Results list — separate SharePoint list, see
// https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering/Lists/Test%20Results
//
// Linked to tasks via the Task Reference lookup field; one task may have
// zero or many test sheets. Both Project Reference and Task Reference
// point to the same lists the rest of the app uses, so creating a test
// sheet from a task is a matter of writing two LookupIds.
// =============================================================================

/** A bare reference to a parent task — just the bits needed to render a link. */
export interface TaskReferenceLite {
  id: number;
  numberedTitle: string;
}

/** A single test sheet from the Test Results list. */
export interface TestSheet {
  id: number;
  title: string;
  product: string;
  serialNumber: string;
  purpose: string;
  results: string;
  testDate: Date | null;
  /** Parent project lookup (resolved to title when projects list is loaded). */
  parentProject: ProjectReference | null;
  /** Parent task lookup. */
  parentTask: TaskReferenceLite | null;
  /** Single-person field. */
  tester: Person | null;
  testingSteps: string;
  firmwareVersion: string;
  createdAt: Date;
  modifiedAt: Date;
  author: Person | null;
}

export interface TestSheetItemFields {
  Title?: string;
  Product?: string;
  SerialNumber?: string;
  Purpose?: string;
  Results?: string;
  TestDate?: string;
  ProjectReferenceLookupId?: string | number;
  TaskReferenceLookupId?: string | number;
  Tester?: unknown;
  TestingSteps?: string;
  FirmwareVersion?: string;
  [key: string]: unknown;
}

// =============================================================================
// EIR (Engineering Information Request) list — separate SharePoint list:
// https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering/Lists/EIREngineering%20Information%20Request
//
// Acts a lot like a task: has a Title, Description, status workflow, a
// pipe-delimited Communication field for comments, lookups to a Project,
// and people fields (single Reporter + multi Assigned Engineers + multi
// Watchers). Adds part-detail fields (MFG, P/N, EAU, etc.) that tasks
// don't have.
// =============================================================================

export const EIR_STATUSES = [
  "Under Review",
  "EIR Not Accepted",
  "Response Accepted",
  "Response Not Accepted",
  "Closed",
] as const;
export type EirStatus = (typeof EIR_STATUSES)[number];

export const EIR_RESOLUTIONS = [
  "Pending",
  "Resolved",
  "EIR Not Approved",
  "Promoted to Task",
] as const;
export type EirResolution = (typeof EIR_RESOLUTIONS)[number];

export const EIR_REQUEST_TYPES = ["EIR", "ECR", "Temporary Deviation"] as const;
export type EirRequestType = (typeof EIR_REQUEST_TYPES)[number];

export const EIR_REQUESTED_PRIORITIES = ["High", "Medium", "Low"] as const;
export type EirRequestedPriority = (typeof EIR_REQUESTED_PRIORITIES)[number];

export const EIR_RISK_LEVELS = ["Level 1", "Level 2", "Level 3"] as const;
export type EirRiskLevel = (typeof EIR_RISK_LEVELS)[number];

export const EIR_RISK_PARTS = ["Active", "InActive"] as const;
export type EirRiskPart = (typeof EIR_RISK_PARTS)[number];

export const EIR_MEETING_RELEVANTS = ["Yes", "No"] as const;
export type EirMeetingRelevant = (typeof EIR_MEETING_RELEVANTS)[number];

/** Buyer Code choice column on the EIR list (code - buyer name). */
export const EIR_BUYER_CODES = [
  "001 - Patricia Scarnecchia",
  "002 - Adele Riffle",
  "003 - Katie Fleming",
  "004 - Danielle Opatich",
  "005 - Michelle Evans",
  "081 - Panels",
] as const;
export type EirBuyerCode = (typeof EIR_BUYER_CODES)[number];

/** A single EIR row from the Engineering Information Request list. */
export interface Eir {
  id: number;
  /** "EIR No" — the human-readable identifier like EIR-1234. */
  eirNo: string;
  title: string;
  description: string;
  requestType: EirRequestType | null;
  status: EirStatus;
  resolution: EirResolution;
  requestedPriority: EirRequestedPriority | null;

  reporter: Person | null;
  assignedEngineers: Person[];
  watchers: Person[];
  /**
   * Project Reference is a multi-value Lookup column on the EIR list —
   * same shape as the Tasks list's "Related Projects" (also called
   * `ProjectReference` there). Stored as an array of project lookups;
   * may be empty if no project was selected.
   */
  parentProjects: ProjectReference[];
  /** Free-text reference to a task (e.g. the NumberedTitle or item id). */
  taskReference: string;

  engineeringResponse: string;

  // Part details
  whereUsed: string;
  eau: string;
  currentStock: string;
  mfg: string;
  mfgPartNumber: string;
  currentPrice: string;
  altronicPartNumber: string;

  // Dates
  requestedCompletionDate: Date | null;
  ltbDate: Date | null;
  priorityDate: Date | null;

  // Priority + risk classification (mostly procurement-side)
  priorityNumber: number | null;
  priorityCount: number | null;
  technicalPriority: EirRiskLevel | null;
  riskPart: EirRiskPart | null;
  riskPartLevel: EirRiskLevel | null;

  // Misc
  eirMeetingRelevant: EirMeetingRelevant | null;
  buyerCode: string;
  taskPromotedFlag: boolean;

  // Audit + comments
  createdAt: Date;
  modifiedAt: Date;
  author: Person | null;
  /**
   * Person who last modified this EIR (Graph `lastModifiedBy.user`).
   * Optional to match the Task type — older mocks / fixtures can omit
   * it without a type error.
   */
  editor?: Person | null;
  comments: Comment[];
  hasAttachments: boolean;
}

/** Raw EIR field bag as returned by Graph under `item.fields`. */
export interface EirItemFields {
  Title?: string;
  EIRNo?: string;
  Description?: string;
  ProjectReferenceLookupId?: string | number;
  Priority?: string; // the "Requested Priority" choice column (took the Priority name)
  Reporter?: unknown;
  Resolution?: string;
  AssignedEngineer?: unknown;
  Status?: string;
  EngineeringResponse?: string;
  WhereUsed?: string;
  EAU?: string;
  CurrentStock?: string;
  Watchers?: unknown;
  MFG?: string;
  MFGP_x002f_N?: string;
  Communication?: string;
  Current_x0020_Price?: string;
  Altronic_x0020_Part_x0020_Number?: string;
  /** Display name "Requested Completion Date" — internal name is truncated at 32 chars. */
  Requested_x0020_Completion_x0020?: string;
  /** Numeric Priority (renamed `Priority0` because the choice column above won the original name). */
  Priority0?: number | string;
  PriorityDate?: string;
  PriorityCount?: number | string;
  EngResUsers?: string;
  RiskPart?: string;
  RiskPartLevel?: string;
  TechnicalPriority?: string;
  LTBDate?: string;
  RequestType?: string;
  TaskReference?: string;
  TaskPromotedFlag?: boolean;
  EIRMeetingRelevant?: string;
  BuyerCode?: string;
  Attachments?: boolean;
  [key: string]: unknown;
}

// =============================================================================
// Operations Task List — separate SharePoint site (Altronic_PMO), separate
// list from Engineering's Task List:
// https://coopermachineryservices.sharepoint.com/sites/Altronic_PMO/Lists/Operations%20Task%20List
//
// Structurally similar to a Task (Title, Description, Status, a comment
// thread in the same Communication format, Due Date, Watchers) but: Assigned
// is SINGLE-person (not multi), there's no parent/child task hierarchy, and
// it has two fields Engineering tasks don't — Location (shop-floor area) and
// a lookup to the Altronic Equipment List. Its own project reference list
// (Operations Projects) is separate from Engineering's Project Overview list,
// but resolves to the same `ProjectReference` shape used everywhere else.
// =============================================================================

export const OPERATIONS_STATUSES = ["Backlog", "WIP", "On Hold", "Complete", "Canceled"] as const;
export type OperationsStatus = (typeof OPERATIONS_STATUSES)[number];

/** "Priority Request" choice column — "Med" (not "Medium") is the actual SharePoint choice value. */
export const OPERATIONS_PRIORITIES = ["Low", "Med", "High"] as const;
export type OperationsPriority = (typeof OPERATIONS_PRIORITIES)[number];

/** "Task Type" choice column — this list's Category-equivalent. */
export const OPERATIONS_TASK_TYPES = [
  "NEW Equipment",
  "Administrative",
  "Existing Equipment",
  "Programming",
  "Plant Relayout",
  "Quality Data Review",
  "Test Engineering",
  "Fixtures",
  "Packaging",
  "Documentation",
  "Routers/COGS",
  "Process Improvement",
  "Logistics",
] as const;
export type OperationsTaskType = (typeof OPERATIONS_TASK_TYPES)[number];

/** "Location" choice column — shop-floor area. No Engineering Task equivalent. */
export const OPERATIONS_LOCATIONS = [
  "Office/Admin",
  "SMT",
  "Through Hole",
  "Conformal Coating",
  "Final Assy",
  "QC",
  "Harness",
  "Coils",
  "Shipping",
  "Repair",
  "Receiving",
  "PCB Sub",
  "Warehouse",
  "Machine Shop",
  "Panels",
] as const;
export type OperationsLocation = (typeof OPERATIONS_LOCATIONS)[number];

/** A single task from the Operations Task List. */
export interface OperationsTask {
  id: number;
  /** App-owned identifier, e.g. "Task 0002-4" — this list's NumberedTitle-equivalent (the `TaskNumber` column). */
  taskNumber: string;
  title: string;
  /** Long-form description (the `TaskDescription` column) — HTML or plain text, same as a Task's Description. */
  description: string;
  status: OperationsStatus;
  priority: OperationsPriority | null;
  taskType: OperationsTaskType | null;
  location: OperationsLocation | null;
  dueDate: Date | null;
  createdAt: Date;
  modifiedAt: Date;
  authorLookupId: number;
  author: Person | null;
  editorLookupId: number;
  editor?: Person | null;
  /** Single person — the `Assigned` column disallows multiple values, unlike a Task's. */
  assigned: Person | null;
  watchers: Person[];
  /** Lookup into the Operations Projects list (a different list from Engineering's Project Overview). */
  parentProject: ProjectReference | null;
  /** Lookup into the Altronic Equipment List — read-only reference, no admin management in ARC. */
  equipment: ProjectReference | null;
  /** Parsed from the `Communication` field — identical pipe-delimited format to a Task's comments. */
  comments: Comment[];
  hasAttachments: boolean;
  rawFields?: Record<string, unknown>;
}

/** Raw Operations Task field bag as returned by Graph under `item.fields`. */
export interface OperationsTaskItemFields {
  Title?: string;
  TaskDescription?: string;
  Status?: string;
  PriorityRequest?: string;
  TaskType?: string;
  Location?: string;
  DueDate?: string;
  Created?: string;
  Modified?: string;
  AuthorLookupId?: string | number;
  EditorLookupId?: string | number;
  /** Single-person field — Graph returns the same `{LookupId, LookupValue, Email}` shape as a multi-person entry, just not wrapped in an array. */
  Assigned?: unknown;
  Watchers?: unknown;
  ProjectRefLookupId?: string | number;
  ProjectRef?: unknown;
  AltronicEquipmentLookupId?: string | number;
  AltronicEquipment?: unknown;
  Communication?: string;
  TaskNumber?: string;
  Attachments?: boolean;
  [key: string]: unknown;
}

// =============================================================================
// Build Requests — TWO SharePoint lists on the Engineering site forming a
// master-detail pair:
//   - Build Request Tracker: the header (BR No, status workflow, requestor,
//     engineer, customer info, its own Communication thread).
//   - Build Request Items: any number of parts per request, joined via the
//     `BuildRequestNo` lookup (items carry `BuildRequestNoLookupId` = the
//     header's item id). Each item has its OWN Communication thread, own
//     Watchers, Part-Type-dependent boolean checklists, and multi-choice
//     Assembly / Operations / Testing columns.
// =============================================================================

export const BUILD_REQUEST_STATUSES = [
  "Submitted",
  "In-process",
  "Blocked",
  "Complete",
  "Information Needed",
  "On Hold",
] as const;
export type BuildRequestStatus = (typeof BUILD_REQUEST_STATUSES)[number];

export const BUILD_REQUEST_TYPES = [
  "Prototype",
  "Standard",
  "Sample (A-D)",
  "Modification",
  "NPI",
  "Component Obsolescence",
  "Design Update Testing (ECN)",
] as const;
export type BuildRequestType = (typeof BUILD_REQUEST_TYPES)[number];

export const BUILD_REQUEST_BLOCKED_REASONS = [
  "Engineering Feedback",
  "Part Shortage",
  "Costing",
  "Sales Feedback",
  "Manufacturing",
] as const;
export type BuildRequestBlockedReason = (typeof BUILD_REQUEST_BLOCKED_REASONS)[number];

export const BUILD_REQUEST_LEAD_TIMES = ["STD Lead Time", "Rush", "Ship Date"] as const;
export type BuildRequestLeadTime = (typeof BUILD_REQUEST_LEAD_TIMES)[number];

export const BUILD_REQUEST_SAMPLE_PHASES = ["A", "B", "C", "D"] as const;
export type BuildRequestSamplePhase = (typeof BUILD_REQUEST_SAMPLE_PHASES)[number];

export const BUILD_REQUEST_PART_TYPES = [
  "Product",
  "PCB",
  "Harness",
  "Machining",
  "Panel",
] as const;
export type BuildRequestPartType = (typeof BUILD_REQUEST_PART_TYPES)[number];

export const BUILD_REQUEST_PART_STATUSES = [
  "Review Checklist",
  "Information Needed",
  "Ready for Production",
  "On Hold",
] as const;
export type BuildRequestPartStatus = (typeof BUILD_REQUEST_PART_STATUSES)[number];

export const BUILD_REQUEST_DISPOSITIONS = ["For Stock", "For Requestor"] as const;
export type BuildRequestDisposition = (typeof BUILD_REQUEST_DISPOSITIONS)[number];

/** Multi-choice columns on Build Request Items — Graph returns arrays; write plain string arrays. */
export const BUILD_REQUEST_ASSEMBLY_OPTIONS = [
  "PCB Assy / Sub-Assy",
  "PCB Final Assy",
  "Final Assy",
  "Harness Assy",
  "Coil Assy",
] as const;

export const BUILD_REQUEST_OPERATIONS_OPTIONS = [
  "Programming",
  "Conformal Coating",
  "Machining",
  "Create Work Instruction",
  "Create BOO",
  "Create Packaging",
  "Export Classification",
] as const;

export const BUILD_REQUEST_TESTING_OPTIONS = [
  "AOI",
  "X-RAY",
  "In Circuit",
  "Intermediate",
  "HI-POT",
  "Coil",
  "Final",
  "Visual",
  "Safe Power-Up",
  "PPAP/ Source Release",
] as const;

/** A header row from the Build Request Tracker list. */
export interface BuildRequest {
  id: number;
  /** "BR No." — app-generated `BR_YYYY-####` (the `BRNo_x002e_` column). */
  brNo: string;
  /** "Product or Project Name" (the Title column). */
  title: string;
  product: string;
  status: BuildRequestStatus;
  brType: BuildRequestType | null;
  blockedReason: BuildRequestBlockedReason | null;
  requiredLeadTime: BuildRequestLeadTime | null;
  quotedShipDate: Date | null;
  samplePhase: BuildRequestSamplePhase | null;
  /** Single-person columns — Graph returns bare LookupIds; names resolved via the site user list. */
  requestor: Person | null;
  engineerAssigned: Person | null;
  customerName: string;
  customerPO: string;
  /** The "Lead Free" (RoHS) boolean. */
  leadFree: boolean;
  watchers: Person[];
  /** Multi-value lookup into the Projects list (same shape as EIR's parentProjects). */
  parentProjects: ProjectReference[];
  /** Single lookup into the Task List (Task Reference) — bare id; title resolved from the tasks cache. */
  taskReferenceLookupId: number | null;
  createdAt: Date;
  modifiedAt: Date;
  author: Person | null;
  editor?: Person | null;
  /** Parsed from the `Communication` field — identical pipe format to tasks/EIRs. */
  comments: Comment[];
  hasAttachments: boolean;
  rawFields?: Record<string, unknown>;
}

/** A part row from the Build Request Items list. */
export interface BuildRequestItem {
  id: number;
  /** "Part Number" (the Title column). */
  partNumber: string;
  /** The parent header's list-item id (`BuildRequestNoLookupId`). */
  buildRequestLookupId: number;
  projectRef: ProjectReference | null;
  partDesc: string;
  drawingNo: string;
  drawingRev: string;
  qty: number | null;
  /** "WO No." — filled in by manufacturing once a work order exists. */
  woNo: string;
  specialInstructions: string;
  testPlan: string;
  opSummary: string;
  serialNos: string;
  /** Free-text on the list (mixed formats in live data), so kept as text. */
  revisionDate: string;
  partType: BuildRequestPartType | null;
  partStatus: BuildRequestPartStatus | null;
  disposition: BuildRequestDisposition | null;
  assembly: string[];
  operations: string[];
  testing: string[];
  /**
   * The boolean checklist columns, keyed by SharePoint internal name.
   * Which keys are shown in the UI depends on partType — see
   * lib/buildRequestChecklist.ts (PCB → 14 fields, Harness → 3).
   */
  checklist: Record<string, boolean>;
  /** Single lookup into the Task List (Task Ref). */
  taskRefLookupId: number | null;
  watchers: Person[];
  createdAt: Date;
  modifiedAt: Date;
  author: Person | null;
  editor?: Person | null;
  /** This item's OWN comment thread — separate from the header's. */
  comments: Comment[];
  hasAttachments: boolean;
  rawFields?: Record<string, unknown>;
}

// =============================================================================
// Panels department — three lists on the ALTRONICPANELTEAM site:
//   - Panel Order Headers: one item per panel sales order (the main entity).
//     Header-only — no line-items list. Has its own Communication thread,
//     Watchers, a single-person Engineer Assigned, and a single lookup into
//     the Panel Project Reference list.
//   - Panel Project Reference: admin-managed; Title = the project reference
//     number (numbering scheme TBD), plus type/description/DWG/customer/dept.
//   - Panel User Roles: admin-managed; one row = one User + one Role choice.
//     Multiple roles per user = multiple rows. Rights mapping lives in
//     lib/panelRoles.ts; NO fields are gated in v1 (infra ships dark).
// =============================================================================

export const PANEL_ORDER_STATUSES = [
  "Submitted",
  "In Engineering",
  "In Production",
  "Testing",
  "Shipped",
  "On Hold",
] as const;
export type PanelOrderStatus = (typeof PANEL_ORDER_STATUSES)[number];

export const PANEL_PROJECT_TYPES = [
  "PRD-Production Order",
  "FS-Field Support",
  "IS-Internal Support",
  "DEV-Product Development",
  "PRG-Programming",
  "MSC-Misc",
] as const;
export type PanelProjectType = (typeof PANEL_PROJECT_TYPES)[number];

export const PANEL_PROJECT_DEPARTMENTS = ["Sales", "Engineering", "Operations"] as const;
export type PanelProjectDepartment = (typeof PANEL_PROJECT_DEPARTMENTS)[number];

/** The Panel User Roles list's `Role` choice values (as configured in SharePoint). */
export const PANEL_ROLE_CHOICES = [
  "Super User",
  "Manager",
  "Tech",
  "Engineer",
  "Admin",
  "Viewer",
] as const;
export type PanelRole = (typeof PANEL_ROLE_CHOICES)[number];

/** A panel sales order from the Panel Order Headers list. */
export interface PanelOrder {
  id: number;
  title: string;
  status: PanelOrderStatus;
  /** Single lookup into the Panel Project Reference list. */
  projectRef: ProjectReference | null;
  salesOrder: string;
  purchaseOrder: string;
  customerReference: string;
  /** Choice column — values discovered at runtime (mirrors the reference list's customer choices). */
  customer: string;
  customerContactEmail: string;
  /** Long-form notes — supports `- [ ]` Description checklists like a Task's Description. */
  orderNotes: string;
  /** Single person — Graph returns only the bare EngineerAssignedLookupId; names resolve via panel site users. */
  engineerAssigned: Person | null;
  watchers: Person[];
  /** Parsed from the `Communication` field — identical pipe format to tasks/EIRs. */
  comments: Comment[];
  hasAttachments: boolean;
  createdAt: Date;
  modifiedAt: Date;
  author: Person | null;
  editor?: Person | null;
  rawFields?: Record<string, unknown>;
}

/** A row from the Panel Project Reference list (admin-managed). */
export interface PanelProject {
  id: number;
  /** The project reference number — the list's Title column. */
  title: string;
  projectType: PanelProjectType | null;
  description: string;
  dwgNo: string;
  customer: string;
  department: PanelProjectDepartment | null;
}

/**
 * Row in the Panel User Roles SharePoint list (admin-managed). One row per
 * user PER role — a user holding two roles appears twice. `id` is the SP
 * list item id (used for update/delete).
 */
export interface PanelRoleEntry {
  id: number;
  user: Person | null;
  role: PanelRole | null;
  /** The Title column — free-text note/label. */
  note: string;
}

export const PANEL_TASK_STATUSES = ["Pending", "In Process", "On Hold", "Complete"] as const;
export type PanelTaskStatus = (typeof PANEL_TASK_STATUSES)[number];

export const PANEL_TASK_TYPES = ["Drawings", "SOO", "Quote", "Administrative"] as const;
export type PanelTaskType = (typeof PANEL_TASK_TYPES)[number];

/**
 * A task from the Panel Tasks list (ALTRONICPANELTEAM site). Structurally a
 * lighter panel order: single-person Assigned, a single lookup into the same
 * Panel Project Reference list, a Description that supports checklists, its
 * own Communication comment thread, and Watchers. No sales-order fields.
 */
export interface PanelTask {
  id: number;
  title: string;
  status: PanelTaskStatus;
  taskType: PanelTaskType | null;
  /** Single lookup into the Panel Project Reference list (shared with panel orders). */
  projectRef: ProjectReference | null;
  /** Single person — Graph returns only the bare AssignedLookupId; resolved via panel site users. */
  assigned: Person | null;
  /** Long-form description — supports `- [ ]` checklists like a task Description. */
  description: string;
  watchers: Person[];
  comments: Comment[];
  hasAttachments: boolean;
  createdAt: Date;
  modifiedAt: Date;
  author: Person | null;
  editor?: Person | null;
  rawFields?: Record<string, unknown>;
}

// =============================================================================
// Drawing File Logs — Engineering's drawing registers, on the Engineering site.
// Four lists behind one screen: CAD, CCC and CEC Drawings plus Engineering
// Sketches.
//
// Two shapes, not one:
//
//  - The DRAWING logs (CAD / CCC / CEC) share a column set: `Title` is the
//    drawing number (SharePoint displays it as "CAD_DWG"), plus part number,
//    description, sizes, dates and a revision — and a CHANGE LOG spread across
//    48 columns: CH_DAT01…16, CH_ECN01…16, CH_REV01…16. Sixteen fixed slots,
//    each a (date, ECN, revision) triple. `drawingLogMapper.ts` folds them into
//    a `changes` array so nothing else has to know about the numbering.
//  - SKETCHES has no change log at all, and carries its own fields instead
//    (SK_Num, V_CODE, VENTURA).
//
// One type covers both, with the log's `kind` saying which fields mean anything.
// =============================================================================

export const DRAWING_LOG_KINDS = ["cad", "ccc", "cec", "sketches"] as const;
export type DrawingLogKind = (typeof DRAWING_LOG_KINDS)[number];

/** One entry in a drawing's change log — one CH_DAT/CH_ECN/CH_REV triple. */
export interface DrawingChange {
  /** 1-based slot number, i.e. which CH_*nn* columns this came from. */
  slot: number;
  date: Date | null;
  /** Engineering Change Notice reference. */
  ecn: string;
  /** Revision this change produced. */
  rev: string;
}

/** A single field's value. Dates stay Dates so formatting and sorting are honest. */
export type DrawingFieldValue = string | number | Date | null;

/**
 * One row of a drawing register.
 *
 * The per-register columns live in `values`, keyed by the descriptors in
 * `src/lib/drawingLogFields.ts`, because the four lists share almost no columns
 * — see the note in that file. `changes` is modelled properly rather than as
 * values, since the 16-slot change log is the one structure the registers do
 * share and it needs its own handling.
 */
export interface DrawingLogEntry {
  id: number;
  kind: DrawingLogKind;
  values: Record<string, DrawingFieldValue>;
  changes: DrawingChange[];
  createdAt: Date;
  modifiedAt: Date;
}

/** Editable values for a create/update, keyed the same way as `values`. */
export type DrawingLogInput = Record<string, DrawingFieldValue>;

/** A new change-log entry, appended to the next free slot. */
export interface DrawingChangeInput {
  date: Date | null;
  ecn: string;
  rev: string;
}

// =============================================================================
// CSA Listings — Engineering's CSA product-certification register, on the
// Engineering site.
//
// One quirk worth knowing: the list's `Title` column is repurposed as the
// **File Number** (the CSA file identifier), so nothing here is called "title".
// The three long fields are SharePoint multi-line ("Note") columns.
// =============================================================================

export interface CsaListing {
  id: number;
  /** CSA file number. Stored in the list's `Title` column. */
  fileNumber: string;
  product: string;
  /** Multi-line: other products/models the same file covers. */
  alsoCover: string;
  /** Multi-line: part numbers included under the listing. */
  partNoIncluded: string;
  /** Multi-line: running notes on the listing's history. */
  history: string;
  dateCertified: Date | null;
  /**
   * Legacy id from the original data (`CSA_ID`). Read and displayed, never
   * written — same arrangement as Teradyne's IDEmp / IDProd.
   */
  csaId: number | null;
  /** Whether the list item has files attached (certificate PDFs and the like). */
  hasAttachments: boolean;
  createdAt: Date;
  modifiedAt: Date;
}

/** Everything a create/update of a CSA listing needs. */
export interface CsaListingInput {
  fileNumber: string;
  product: string;
  alsoCover: string;
  partNoIncluded: string;
  history: string;
  dateCertified: Date | null;
}

// =============================================================================
// Teradyne — the PCB test log run by Operations, on the PMO site. Four lists:
// "Teradyne Log" (the entity) plus three reference lists it looks up against
// (Employees, Products, Remarks), all editable in-app.
//
// Two things about this data are load-bearing and easy to get wrong:
//
//  1. Graph returns single-value lookups under `<Field>LookupId` ONLY — there
//     is no `LookupValue` in the `expand=fields` payload. Every display name
//     has to be joined client-side against the reference lists, which is why
//     `listTeradyneLog()` fetches all four lists and hands back entries whose
//     lookups are already resolved to `TeradyneRef`.
//  2. `Title` on both the log and the Employees list is DERIVED. The app owns
//     the format (see buildTeradyneLogTitle / buildTeradyneEmployeeTitle in
//     src/lib/teradyneMapper.ts) and writes it on every create/update, the
//     same way it owns `NumberedTitle` on Engineering tasks.
// =============================================================================

/** A resolved single-value lookup — the target item's SP id plus its Title. */
export interface TeradyneRef {
  lookupId: number;
  title: string;
}

/** One row of the Teradyne Log, with its four lookups already resolved. */
export interface TeradyneLogEntry {
  id: number;
  /** App-derived: "{Product} - {Defective Parts}". Not user-editable. */
  title: string;
  enterDate: Date | null;
  product: TeradyneRef | null;
  employee1: TeradyneRef | null;
  employee2: TeradyneRef | null;
  remark: TeradyneRef | null;
  /** Denormalised copy of the picked employee's ClockNum, as the source data does it. */
  employee1Clock: number | null;
  employee2Clock: number | null;
  defectiveParts: string;
  numberOfBoards: number | null;
  boardsTested: number | null;
  failuresPerBoard: number | null;
  sapNumber: string;
  /**
   * The Altronic part number. Stored in the SharePoint column still named
   * `OldSAPNumber` — the column predates the rename and renaming it in
   * SharePoint would break the existing views and any report pointing at it,
   * so the mapping lives in teradyneMapper.ts instead.
   */
  altronicPartNumber: string;
  operatorNotes: string;
  createdAt: Date;
  modifiedAt: Date;
}

/** Everything a create/update of a log entry needs. `title` is computed, never passed. */
export interface TeradyneLogInput {
  enterDate: Date | null;
  productLookupId: number | null;
  employee1LookupId: number | null;
  employee2LookupId: number | null;
  remarkLookupId: number | null;
  employee1Clock: number | null;
  employee2Clock: number | null;
  defectiveParts: string;
  numberOfBoards: number | null;
  boardsTested: number | null;
  failuresPerBoard: number | null;
  sapNumber: string;
  altronicPartNumber: string;
  operatorNotes: string;
}

/** Row in "Teradyne Employees". Title is derived from first + last name. */
export interface TeradyneEmployee {
  lookupId: number;
  title: string;
  firstName: string;
  lastName: string;
  clockNum: number | null;
  workCenter: string;
  /** Legacy id carried over from the imported source data. Read-only here. */
  idEmp: number | null;
}

/** Row in "Teradyne Products". The Title column displays as "Product". */
export interface TeradyneProduct {
  lookupId: number;
  title: string;
  testOnStation: string;
  /** Legacy id carried over from the imported source data. Read-only here. */
  idProd: number | null;
}

/** Row in "Teradyne Remarks" — a canned defect description. */
export interface TeradyneRemark {
  lookupId: number;
  title: string;
  /**
   * The remark's number — the code operators know a remark by. Unlike the
   * Employees/Products legacy ids, this one IS user-maintained: it's set when
   * adding a remark and editable afterwards.
   */
  idRem: number | null;
}

/** Which of the three reference lists a generic ref operation is targeting. */
export const TERADYNE_REF_KINDS = ["employees", "products", "remarks"] as const;
export type TeradyneRefKind = (typeof TERADYNE_REF_KINDS)[number];

/** Union of the three reference row shapes. */
export type TeradyneRefRow = TeradyneEmployee | TeradyneProduct | TeradyneRemark;

/**
 * Editable payload for a reference row. Which keys matter depends on the kind:
 * employees use firstName/lastName/clockNum/workCenter (title is derived from
 * the names), products use title + testOnStation, remarks use title + idRem.
 *
 * `IDEmp` and `IDProd` are deliberately NOT writable — they belong to the
 * original import and new rows leave them blank. `IDRem` is the exception: the
 * remark number is a code operators use, so they set and edit it here.
 */
export interface TeradyneRefInput {
  title: string;
  firstName?: string;
  lastName?: string;
  clockNum?: number | null;
  workCenter?: string;
  testOnStation?: string;
  /** Remarks only — the remark's number. */
  idRem?: number | null;
}

// =============================================================================
// Microsoft Graph response shapes — only the fields we touch
// =============================================================================

export interface GraphListItem {
  id: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  /**
   * Graph returns createdBy / lastModifiedBy by default on every list item
   * as identitySet objects. We capture `user` (displayName, email) because
   * the SharePoint `AuthorLookupId` is just an integer and resolving names
   * from it would otherwise require an extra User Information List call.
   */
  createdBy?: { user?: { displayName?: string; email?: string; id?: string } };
  lastModifiedBy?: { user?: { displayName?: string; email?: string; id?: string } };
  fields: GraphItemFields;
}

export interface GraphItemFields {
  id?: string;
  Title?: string;
  NumberedTitle?: string;
  Description?: string;
  Status?: string;
  Priority?: string;
  Category?: string;
  Labels?: string;
  DueDate?: string;
  Created?: string;
  Modified?: string;
  AuthorLookupId?: string | number;
  EditorLookupId?: string | number;
  Parent_x0020_Project_x0020_ReferLookupId?: string | number;
  /**
   * Multi-value related-projects lookup. SharePoint returns multi-value
   * lookup fields as an array of { LookupId, LookupValue } objects under
   * `<FieldName>` (not `<FieldName>LookupId`). The field's actual internal
   * name needs to be verified — `ProjectReference` is the best guess from
   * our PowerShell exploration (it came back as `{}`, which is the empty
   * state for a multi-value lookup). Run the column-discovery query in
   * CLAUDE.md against the task list to confirm.
   */
  ProjectReference?: unknown;
  /**
   * Parent task lookup. Internal field name TBD — common patterns are
   * `ParentTaskLookupId` or `Parent_x0020_Task_x0020_ReferLookupId`. Run
   * column discovery to confirm. The mapper falls back gracefully when
   * the field is absent so the app keeps working until we know the name.
   */
  ParentTaskLookupId?: string | number;
  /**
   * Software revision text field. Internal name assumed `SoftwareRevision`;
   * verify against the actual SharePoint column. Free-text in the Power App.
   */
  SoftwareRevision?: string;
  /**
   * `EIRReference` Hyperlink column. Graph returns hyperlink fields as
   * `{ Url, Description }` (or occasionally a bare string). Parsed by
   * `parseHyperlinkField` in taskMapper.ts.
   */
  EIRReference?: unknown;
  Attachments?: boolean;
  Communication?: string;
  /** Person-or-group fields are returned as hashtables/objects. Shape varies. */
  Assigned?: unknown;
  Watchers?: unknown;
  /** Anything else SharePoint hands us — we don't enumerate all 200 columns. */
  [key: string]: unknown;
}

export interface GraphListResponse<T> {
  value: T[];
  "@odata.nextLink"?: string;
}

// =============================================================================
// Visit Reports — Customer Service / Sales, on the ALTRONICSALESTEAM site.
//
// A regional manager's record of a customer visit. Schema discovered live
// 2026-08-18 (scripts/visit-reports-schema.json). Three things about this list
// are load-bearing:
//
//  1. **`Title` is the Customer Name.** Same repurposing as CSA Listings —
//     there is no "title" in the domain type.
//  2. **`City0` / `State0` carry the trailing zero.** A City/State column
//     existed before and was replaced; SharePoint kept the old internal names
//     out of the way by suffixing the new ones. Writing `City` saves nothing.
//  3. **Month / Year / Day / Cal Title are CALCULATED** off Visit Date and are
//     read-only. The app never writes them — it derives what it needs from
//     `visitDate` instead.
// =============================================================================

export interface VisitReport {
  id: number;
  /** Customer visited. Stored in the list's `Title` column. */
  customerName: string;
  /** Regional manager who made the visit (`RMName` choice). */
  rmName: string;
  reasonForVisit: string;
  /** Multi-line: what happened on the visit. Required by the list. */
  visitSummary: string;
  /** Multi-line: what needs doing next. Optional. */
  actionItems: string;
  /** Date-only column — read and written in UTC terms (see lib/spDates.ts). */
  visitDate: Date | null;
  customerStatus: string;
  /** Free text: the product(s) the visit was about. */
  product: string;
  city: string;
  /** US state name, spelled out ("Ohio") — `State0` choice column. */
  state: string;
  hasAttachments: boolean;
  createdAt: Date;
  modifiedAt: Date;
}

/** Everything a create/update of a visit report needs. */
export interface VisitReportInput {
  customerName: string;
  rmName: string;
  reasonForVisit: string;
  visitSummary: string;
  actionItems: string;
  visitDate: Date | null;
  customerStatus: string;
  product: string;
  city: string;
  state: string;
}

/**
 * The `ReasonForVisit` choices, mirrored from the live column.
 *
 * As everywhere else in this file, these are a copy of the SharePoint choice
 * list — update both if the column changes.
 */
export const VISIT_REASONS = [
  "Home Office",
  "General Visit",
  "Site Visit",
  "Sales Call",
  "Training",
] as const;

/** The `CustomerStatus` choices. Drives the status pills and the row chip. */
export const VISIT_CUSTOMER_STATUSES = [
  "Satisfied",
  "Needs Attention",
  "Issue",
  "Quote Request",
  "Potential New Customer",
  "N/A",
] as const;

/**
 * The `RMName` choices as the column currently defines them.
 *
 * The stored data does NOT stay inside this list — reports going back to 2022
 * carry managers who have since left ("Neal Keeton"), and the same person
 * appears under two spellings ("Paul McHenry" / "Paul Mchenry"). So this is
 * the list of people to OFFER, not the list of values to expect: the picker
 * folds in whatever the data actually holds (see rmNameOptions in
 * lib/visitReportMapper.ts) rather than hiding an old report behind a
 * placeholder.
 */
export const VISIT_RM_NAMES = [
  "Curtis Ward",
  "Mike Porter",
  "Michael Young",
  "Paul McHenry",
  "Wes Wagner",
  "Chad Tucker",
  "Gregg Grubbs",
] as const;

/** The `State0` choices — the 50 US states, spelled out. */
export const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
  "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
  "Washington", "West Virginia", "Wisconsin", "Wyoming",
] as const;

// =============================================================================
// Gray Market Requests — Supply Chain, on the Altronic_PMO site.
//
// A part bought outside normal distribution, tracked from the request through
// purchasing, engineering test, inspection and production sign-off. Schema
// discovered live 2026-08-19 (scripts/gray-market-request-schema.json).
//
// The thirty-odd workflow columns live in `values`, keyed by the domain keys in
// `src/lib/grayMarketFields.ts` — see the note there for why the columns are
// data rather than thirty properties (and for the internal names that lie).
// Only the fields needing their own handling are named here.
// =============================================================================

export interface GrayMarketRequest {
  id: number;
  /** `Title` — the Altronic assembly number the part is used on. */
  title: string;
  /**
   * `LogNo_x002e_Raw`, e.g. "GMR_2026-004". SharePoint's calculated
   * "Log No." column derives from it, so the app only ever writes the raw one
   * — same arrangement as the EIR's EIRNo / EIR Log No.
   */
  logNo: string;
  /** `RequestStatus` — Open | Complete. */
  status: string;
  /** `TodaysDate`, the date the request was raised. Required by the list. */
  requestDate: Date | null;
  dateCompleted: Date | null;
  /** `ProductionTest`, labelled "Testing Required". Blank until it is decided. */
  testingRequired: string;
  requestor: Person | null;
  /** `Parts_x0020_Location` — a PERSON column, whatever its name suggests. */
  partsLocation: Person | null;
  watchers: Person[];
  comments: Comment[];
  hasAttachments: boolean;
  /** Every other column, keyed by the descriptor keys in grayMarketFields.ts. */
  values: Record<string, string>;
  createdAt: Date;
  modifiedAt: Date;
}

/** Everything a create needs. Edits go field-by-field from the detail page. */
export interface GrayMarketRequestInput {
  title: string;
  status: string;
  requestDate: Date | null;
  testingRequired: string;
  requestor: Person | null;
  values: Record<string, string>;
}

// =============================================================================
// "Where am I?" — Engineering's out-of-office calendar, on the Engineering site.
//
// The whole entity is a line of text and a day: `Title` carries both the person
// and the reason as free text ("Sarah - half day vacation", "GaryK Keystone
// AM"), and `Date` is a required date-only column.
//
// There is NO end date on the list, so an absence spanning several days is
// several rows. The add form can create them in one go, but the data model is
// one row per day and nothing here pretends otherwise.
// =============================================================================

export interface WhereAmIEntry {
  id: number;
  /** Free text — usually who, and what they're doing. */
  title: string;
  /** Date-only. Null only if the required column is somehow empty. */
  date: Date | null;
  createdAt: Date;
  modifiedAt: Date;
}

// =============================================================================
// ECNs (Engineering Change Notices) — Engineering, on the Altronic_Engineering
// site. The record of a change to a released product: what changed, which
// assemblies and serial numbers it touches, what happens to stock on hand, and
// whether the drawings have caught up.
//
// Every workflow column on this list is named `field_2` … `field_12`, so they
// live in `values`, keyed by the domain keys in `src/lib/ecnFields.ts`. That
// file is the ONLY place the field_N → meaning mapping exists.
//
// Two absences shape the feature:
//
//  - **No Watchers column.** ECN comments notify the submitter and anyone
//    @-mentioned, and nobody else (Ray, 2026-08-19). There is no watch button
//    because there is nowhere to store a watch.
//  - **No requester column.** `submittedBy` comes from Graph's `createdBy`,
//    which for the 1,809 migrated rows is whoever ran the migration rather
//    than the engineer who raised the original ECN.
// =============================================================================

export interface Ecn {
  id: number;
  /** `Title` — the part or assembly the change is against. */
  title: string;
  /**
   * `field_2`, labelled "Log#". Free text. In practice it reads `YY####`
   * (e.g. "260059"), with an `R#` suffix on a revision of an earlier notice
   * ("260059R1") — but the app does NOT generate or enforce it (Ray,
   * 2026-08-19): the number comes from the ECN paperwork, and a revision has
   * to keep the number of the notice it revises.
   */
  logNo: string;
  /**
   * `ProjectReferenceLookupId` — a SINGLE lookup into the Projects list, added
   * to the list on 2026-08-19. Held as a lookupId with an empty title, like
   * a task's `parentProject`; the title is resolved against the loaded
   * Projects list by whatever renders it.
   */
  parentProject: ProjectReference | null;
  /**
   * Graph's `createdBy` — there is no requester column on the list. For rows
   * that came in with the migration this is the migration account, not the
   * original author.
   */
  submittedBy: Person | null;
  comments: Comment[];
  hasAttachments: boolean;
  /** Every workflow column, keyed by the descriptor keys in ecnFields.ts. */
  values: Record<string, string>;
  createdAt: Date;
  modifiedAt: Date;
}

/** Everything a create needs. Edits go field-by-field from the detail page. */
export interface EcnInput {
  title: string;
  /** Projects-list lookupId, or null for an ECN not tied to one. */
  projectLookupId: number | null;
  /** Typed by whoever raises the ECN — see the note on `Ecn.logNo`. */
  logNo: string;
  values: Record<string, string>;
}

// =============================================================================
// FAITs (First Article Inspection Tests) — Supply Chain, on the Altronic
// Engineering site.
//
// A new or changed part arrives from a supplier, quality inspects it, and SQE,
// Engineering and the KAM each sign off. Fifty-one workflow columns live in
// `values`, keyed by the descriptors in `src/lib/faitFields.ts`.
//
// Two things about the data as it stands (schema captured 2026-08-20):
//
//  - **`Title` is empty on every existing row.** Rows are identified in
//    practice by SAP Part Number + Description + Drawing Number, so that's
//    what the list leads with.
//  - **The three lookups are unused so far.** Project Reference, EIR Reference
//    and Test Document Reference all exist on the list and are blank on the 36
//    rows that predate ARC.
// =============================================================================

export interface Fait {
  id: number;
  /** `Title` — present on the list but empty on every row so far. */
  title: string;
  /** `Status` — Open → …with SQE/ENG/KAM → Closed. */
  status: string;
  /** Single lookup into the Projects list. */
  parentProject: ProjectReference | null;
  /** Single lookup into the EIRs list. */
  eirLookupId: number | null;
  /** Single lookup into the Test Results list. */
  testDocumentLookupId: number | null;
  initiator: Person | null;
  assignedEngineer: Person | null;
  kam: Person | null;
  watchers: Person[];
  comments: Comment[];
  hasAttachments: boolean;
  /** Every workflow column, keyed by the descriptor keys in faitFields.ts. */
  values: Record<string, string>;
  createdAt: Date;
  modifiedAt: Date;
}

/** Everything a create needs. Edits go card-by-card from the detail page. */
export interface FaitInput {
  title: string;
  status: string;
  projectLookupId: number | null;
  values: Record<string, string>;
}

// =============================================================================
// Open Orders Report Tool (Customer Service / Sales)
//
// A weekly job: somebody exports the open-orders report out of SAP, uploads the
// raw workbook to ARC, and ARC builds ONE branded master dashboard plus ONE
// workbook per customer on the managed account list — the files the regional
// managers send out.
//
// The raw extract is SAP's, so its column headers are whatever SAP calls them
// that week; `openOrdersFields.ts` owns the header→field mapping and this type
// is what everything downstream sees. Nothing outside the parser should touch a
// raw header string.
// =============================================================================

/**
 * Open Orders role tags — the same mechanism as EIR_ROLES ("treat like the eir
 * permissions", Ray, 2026-08-24), with its own tag namespace.
 *
 *   "report manager" → may edit the customer list and run the weekly
 *                      generation.
 *
 * Everyone else signed in can read and download the reports, which is what
 * most of Sales needs. As with the EIR roles this is UI-level gating only; the
 * real boundary is the SharePoint permission on the list and the folder.
 */
export const OPEN_ORDERS_ROLES = ["report manager"] as const;
export type OpenOrdersRole = (typeof OPEN_ORDERS_ROLES)[number];

/** Row in the Open Orders Roles list. Same shape as EirRoleEntry. */
export interface OpenOrdersRoleEntry {
  id: number;
  email: string;
  displayName: string;
  roles: OpenOrdersRole[];
  note: string;
}

/**
 * One open order line, after parsing. Money is in `currency` units.
 *
 * Field names are ARC's; the SAP header each one comes from is in
 * `openOrdersFields.ts`. Verified against a live extract (2,031 rows,
 * 2026-08-21) — see the notes there for the columns that don't say what
 * they mean.
 */
export interface OpenOrderLine {
  /** `Customer` — sold-to account number, the key the customer list matches. */
  soldTo: string;
  /** `Customer Name` — SAP TRUNCATES this at 30 characters. */
  customerName: string;
  salesOrder: string;
  /** `Item (SD)` — line number, kept as text ("110", "1400"). */
  lineNo: string;
  material: string;
  /** `AI Part Number` — the Altronic number customers order by. */
  altronicPartNumber: string;
  description: string;
  /** `Sales Document Type` — ZTA / repair / ZKL in the live extract. */
  orderType: string;
  /** `Repair order` — the repair order number, set only on repair lines. */
  repairOrder: string;
  orderQty: number;
  /** Derived: order qty − open qty. The extract has no shipped column. */
  shippedQty: number;
  openQty: number;
  unitPrice: number;
  /** `Open Order Value` — openQty × unitPrice, which the extract ties out to. */
  openValue: number;
  /** `Net Value` — the extract's own line total. Carried so the reports can
   * reproduce the raw layout column for column. */
  netValue: number;
  /** Money is per line: an extract can mix USD and EUR, so never sum blindly. */
  currency: string;
  /** `Customer Reference` — their PO. */
  customerPo: string;
  /** `Created On` — when the order was raised. */
  orderDate: Date | null;
  /** `Customer required date` — what they asked for. */
  requestedDate: Date | null;
  /** `Ship Date` — OUR promise, and what every aging calculation keys off. */
  promiseDate: Date | null;
  /** `Ship-to Party` — may differ from sold-to. */
  shipTo: string;
  salesOffice: string;
  /** `Delivery Status` — A / B in the live extract. */
  status: string;
  /** `Delivery Block` — blank throughout the live extract, kept for when it isn't. */
  deliveryBlock: string;
  /** `Reason for rejection` — likewise blank so far. */
  rejectionReason: string;
  /**
   * `Comments` — customer-safe, and shown in the customer workbooks.
   *
   * Text only. In the live extract 147 of 166 comments are DATES rather than
   * prose (see `commentDate`), so this holds just the 19 that are words.
   */
  comments: string;
  /**
   * The `Comments` cell when it holds a DATE — a revised expected ship date.
   *
   * Whoever maintains this report types a date into Comments when the promised
   * one has moved: 147 of the 166 comments in the live extract are dates, and
   * the prose ones say the same thing in words ("Shipping in September. Exact
   * date is pending when the tooling is received"). Kept as a real date so it
   * sorts and filters as one in Excel instead of arriving as text.
   */
  commentDate: Date | null;
  mrpController: string;
  createdBy: string;
  /**
   * Cell values for columns THIS week's extract carries that ARC doesn't map
   * to a typed field above — keyed by the column's index in that file's
   * header row. SAP's column set changes week to week (a field added,
   * dropped, or renamed), and the reports mirror the raw file's layout
   * exactly, so an unrecognised column still has to make it into the sheet
   * verbatim rather than being silently dropped. Never read for aging,
   * repairs, or any other calculation — those all go through the typed
   * fields above, resolved by alias regardless of the file's exact wording.
   * See `layoutFromColumns` in `lib/openOrdersFields.ts`.
   */
  raw?: Record<number, unknown>;
}

/** Aging buckets, by promise date against the run date. Past due leads. */
export const OPEN_ORDER_AGING_BUCKETS = [
  "Past due",
  "0–30 days",
  "31–60 days",
  "61–90 days",
  "90+ days",
  "No promise date",
] as const;

export type OpenOrderAgingBucket = (typeof OPEN_ORDER_AGING_BUCKETS)[number];

/** Count + value for one aging bucket. */
export interface OpenOrderAgingRow {
  bucket: OpenOrderAgingBucket;
  lines: number;
  openQty: number;
  openValue: number;
}

/** The numbers on a dashboard or a customer Summary tab. */
export interface OpenOrderMetrics {
  lines: number;
  openQty: number;
  openValue: number;
  pastDueLines: number;
  /**
   * Past due with REPAIR orders excluded — what the reports lead with.
   *
   * A repair is unpriced and on its own workflow, so counting them made the
   * headline read worse than the parts backlog is (Ray, 2026-08-25).
   * `pastDueLines` above is still every late line, for anything that wants it.
   */
  pastDueStandardLines: number;
  pastDueValue: number;
  /** Repairs (ZS1) split out, since they're reported in their own table. */
  repairLines: number;
  repairValue: number;
  aging: OpenOrderAgingRow[];
  /** Soonest promise date still open, or null when nothing is dated. */
  nextPromiseDate: Date | null;
  orders: number;
  /**
   * Value per currency, biggest first.
   *
   * An extract CAN mix currencies (the live one carries two EUR lines among
   * 2,029 USD), and adding them produces a number that is simply wrong. So
   * `openValue` is the arithmetic total for convenience, and anything that
   * shows money to a person reads this instead whenever `currencies` has more
   * than one entry.
   */
  byCurrency: Array<{ currency: string; openValue: number; pastDueValue: number }>;
  /** Every currency present, so a caller can tell whether a total is safe. */
  currencies: string[];
  /**
   * Lines carrying no price at all.
   *
   * Every repair line in the live extract is unpriced, so "repairs = $0" is
   * the data rather than a bug — but it has to be SAID, or the split reads as
   * broken.
   */
  unpricedLines: number;
}

/** One customer's slice of the report. */
export interface OpenOrderCustomerReport {
  soldTo: string;
  customerName: string;
  metrics: OpenOrderMetrics;
  /** Everything that isn't a repair, promise date ascending. */
  standardLines: OpenOrderLine[];
  /** ZS1 / Repairs, promise date ascending — their own table on the tab. */
  repairLines: OpenOrderLine[];
}

/**
 * A customer on the managed list — who gets an individual workbook each week.
 *
 * The account number is the join key onto the extract; the name is what the
 * file is named after, so it's the customer-facing spelling rather than SAP's.
 */
export interface OpenOrderCustomerAccount {
  id: number;
  /** `Title` — the sold-to account number. */
  accountNumber: string;
  /** Customer-facing name, used for the workbook filename. */
  customerName: string;
  /** Off the weekly run without deleting the row. */
  active: boolean;
  notes: string;
}

/** Everything a create/edit on the customer list needs. */
export interface OpenOrderCustomerAccountInput {
  accountNumber: string;
  customerName: string;
  active: boolean;
  notes: string;
}

// =============================================================================
// CRM Tool (Customer Service / Sales, salesOrderEntry site)
//
// Four lists, all sharing one customer record: "Customer Notes" is the
// anchor — Contacts, Special Pricing and Capacity each carry a lookup back to
// it, so the app is customer-first: open a customer, see everything that
// points at them. Discovered live 2026-08-26 — see CLAUDE.md for the
// per-list column notes (truncated internal names, single vs multi choice).
// =============================================================================

/** `Group` on Customer Notes — a SINGLE choice, unlike CustomerType below. */
export const CUSTOMER_GROUPS = [
  "Arrow",
  "CAT",
  "CES",
  "Cummins",
  "Jenbacher",
  "Other",
  "Palmero",
  "Perkins",
  "Rolls-Royce",
  "Wartsila",
  "Waukesha",
] as const;
export type CustomerGroup = (typeof CUSTOMER_GROUPS)[number];

/** `CustomerType` on Customer Notes — a MULTI choice (Graph returns an array). */
export const CUSTOMER_TYPES = ["OEM", "AM", "IC", "Packager", "GTI", "Panels"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

/**
 * "Customer Notes" — the anchor record for the CRM tool.
 *
 * `Communication` has no Watchers column behind it: a comment here reaches
 * only whoever is @-mentioned, the same rule ECNs use (see
 * `customerNoteCommentRecipients` in lib/mentions.ts). `GeneralNotes` and
 * `ComplianceNotes` hold rich HTML in practice even though Graph reports
 * their column type as plain text — see CLAUDE.md.
 */
export interface CustomerNote {
  id: number;
  /** `Title` — the customer's name. */
  customerName: string;
  oldCustomerNumber: string;
  sapCustomerNumber: string;
  generalNotes: string;
  complianceNotes: string;
  group: CustomerGroup | null;
  customerTypes: CustomerType[];
  /** Multi-person. */
  csr: Person[];
  /** Single-person. */
  kam: Person | null;
  comments: Comment[];
  hasAttachments: boolean;
  createdAt: Date;
  modifiedAt: Date;
}

export interface CustomerNoteInput {
  customerName: string;
  oldCustomerNumber: string;
  sapCustomerNumber: string;
  group: CustomerGroup | null;
  customerTypes: CustomerType[];
  csr: Person[];
  kam: Person | null;
}

/** "Customer Contacts" — one row per person at a customer. */
export interface CustomerContact {
  id: number;
  /** `Title` — the contact's name. */
  name: string;
  /** `Customer` lookup, into Customer Notes. */
  customerId: number | null;
  email: string;
  phoneNumber: string;
  jobTitle: string;
  contactNotes: string;
}

export interface CustomerContactInput {
  name: string;
  customerId: number;
  email: string;
  phoneNumber: string;
  jobTitle: string;
  contactNotes: string;
}

/** "Special Pricing" — a pricing note or agreement tied to a customer. */
export interface SpecialPricingEntry {
  id: number;
  /** `Title` — a part number or a short description, whatever the row was named. */
  title: string;
  /** `Customer` lookup, into Customer Notes. */
  customerId: number | null;
  pricingNotes: string;
  aiPartNumber: string;
}

export interface SpecialPricingInput {
  title: string;
  customerId: number;
  pricingNotes: string;
  aiPartNumber: string;
}

/** "Capacity" — a per-part weekly production capacity commitment to a customer. */
export interface CapacityEntry {
  id: number;
  /** `Title` — the Altronic part number. */
  partNumber: string;
  /** `Customer` lookup, into Customer Notes. */
  customerId: number | null;
  description: string;
  weeklyMax: number | null;
  notes: string;
  /** `CustomerP/N` — the customer's own part number. */
  customerPartNumber: string;
}

export interface CapacityInput {
  partNumber: string;
  customerId: number;
  description: string;
  weeklyMax: number | null;
  notes: string;
  customerPartNumber: string;
}

// =============================================================================
// SRM Tool (Supply Chain, Altronic_PMO site)
//
// Three lists, all sharing one supplier record: "Suppliers List" is the
// anchor — Supplier Contacts and Supplier Issue Tracker each carry a lookup
// back to it (the `BPReference` column, named for the Business Partner
// Number, on both). Discovered live 2026-08-26 — see CLAUDE.md for the
// per-list column notes (the QualityPeformance/QualityPerformance typo trap,
// the two unconfigured placeholder choice columns).
// =============================================================================

export const SUPPLIER_STATUSES = ["Active", "Phase Out", "Archive", "Indirect"] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

/** `CoreCompetency` — a MULTI choice (Graph returns an array). ~59 real options. */
export const SUPPLIER_CORE_COMPETENCIES = [
  "Assembly",
  "Cable & Wire",
  "Capacitors",
  "Casting / Aluminum",
  "Casting / Steel Chemical Connectors",
  "Chemical",
  "Choke",
  "Circuit Protection - Fuse",
  "Conduit",
  "Connectors",
  "Control system",
  "Diodes",
  "Displays",
  "Engineering Services",
  "Ferrite",
  "Forging Part",
  "Forming Part",
  "Hardware",
  "Hose / Fitting",
  "Hydraulic Unit",
  "IC",
  "Inductor",
  "Injection Molding",
  "Isolator",
  "Labels",
  "Logistics / Handling",
  "Lubricants / Chemicals",
  "Machined Parts",
  "Magnetics - Transformers",
  "Mecatronic",
  "Miscellaneous auxiliary materials",
  "Miscellaneous Components",
  "Miscellaneous Hardware",
  "Monitoring / Sensors",
  "Moulding Die",
  "Nut",
  "Office Material",
  "Output Switches",
  "PCB/PCBA",
  "Perishable Tool",
  "PM Material (Mat group to be to revised)",
  "Profile",
  "Regulators",
  "Repair- and Spare parts",
  "Resistor",
  "Seals and Gaskets",
  "Sockets",
  "Software",
  "Spark Plugs",
  "Spring",
  "Stamping Part",
  "Standardized part",
  "Supplier Tools",
  "Switches",
  "System Unit",
  "Terminal",
  "Tools and tool parts according drawing",
  "Transducers",
  "Transistors",
] as const;
export type SupplierCoreCompetency = (typeof SUPPLIER_CORE_COMPETENCIES)[number];

/**
 * "Suppliers List" — the SRM tool's anchor record.
 *
 * `logisticalPerformance` and `qualityPerformance` are a naming trap: the
 * SharePoint column labelled "Logistical Performance" is internally
 * `QualityPeformance` (missing the second R), and the one labelled
 * "Quality Performance" is `QualityPerformance` (correctly spelled). Getting
 * this backwards silently writes the wrong number to the wrong card.
 */
/**
 * `Logo` — a modern SharePoint "Image" column. It stores no binary itself;
 * the value is JSON metadata pointing at a reserved (hidden) attachment on
 * the same item, named `fileName` here. `SupplierLogo` resolves that
 * attachment's actual download URL — see `lib/supplierMapper.ts`.
 */
export interface SupplierLogoRef {
  fileName: string;
  originalImageName: string;
}

export interface Supplier {
  id: number;
  /** `Title` — "{BusinessPartnerNumber}-{CompanyName}", SharePoint's own display convention. */
  title: string;
  companyName: string;
  businessPartnerNumber: string;
  address: string;
  website: string;
  /** `SupplierScore` — a TEXT column despite the name; values seen are small integers as strings. */
  supplierScore: string;
  coreCompetencies: SupplierCoreCompetency[];
  status: SupplierStatus | null;
  notes: string;
  assignedBuyer: Person | null;
  supplierIdentifier: string;
  watchers: Person[];
  /** Single lookup into Supplier Contacts — the one person to go to first. */
  pointOfContactId: number | null;
  allDeliveries: number | null;
  supplierPerformanceRate: number | null;
  logisticalPerformance: number | null;
  qualityPerformance: number | null;
  /** `Logo` — null when the supplier has none. See `SupplierLogoRef`. */
  logo: SupplierLogoRef | null;
  comments: Comment[];
  hasAttachments: boolean;
  createdAt: Date;
  modifiedAt: Date;
}

export interface SupplierInput {
  companyName: string;
  businessPartnerNumber: string;
  address: string;
  website: string;
  status: SupplierStatus | null;
  assignedBuyer: Person | null;
  watchers: Person[];
}

export const SUPPLIER_CONTACT_STATUSES = ["Active", "Not Active"] as const;
export type SupplierContactStatus = (typeof SUPPLIER_CONTACT_STATUSES)[number];

/**
 * "Supplier Contact List" — one row per person at a supplier. `Title`,
 * `FirstName` and `LastName` are empty on every row seen live (566 rows) —
 * every contact so far is identified by email alone. `supplierContactLabel`
 * falls back through name → email → a numbered placeholder, the same shape
 * as `faitLabel`.
 */
export interface SupplierContact {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  /** `BPReference` lookup, into Suppliers List. */
  supplierId: number | null;
  email: string;
  phone: string;
  status: SupplierContactStatus | null;
  contactNotes: string;
  comments: Comment[];
  watchers: Person[];
  hasAttachments: boolean;
  createdAt: Date;
  modifiedAt: Date;
}

export interface SupplierContactInput {
  name: string;
  firstName: string;
  lastName: string;
  supplierId: number;
  email: string;
  phone: string;
  status: SupplierContactStatus | null;
  contactNotes: string;
  watchers: Person[];
}

/**
 * "Supplier Issue Tracker" — `Status` and `Severity` are UNCONFIGURED
 * placeholder choice columns in the live list ("Choice 1" / "Choice 2" /
 * "Choice 3") as of 2026-08-26 — nobody has set real values in SharePoint
 * yet. These consts mirror whatever the list currently holds; update BOTH
 * places the day Supply Chain configures real options (see CLAUDE.md).
 */
export const SUPPLIER_ISSUE_STATUSES = ["Choice 1", "Choice 2", "Choice 3"] as const;
export type SupplierIssueStatus = (typeof SUPPLIER_ISSUE_STATUSES)[number];
export const SUPPLIER_ISSUE_SEVERITIES = ["Choice 1", "Choice 2", "Choice 3"] as const;
export type SupplierIssueSeverity = (typeof SUPPLIER_ISSUE_SEVERITIES)[number];

export interface SupplierIssue {
  id: number;
  title: string;
  /** `BPReference` lookup, into Suppliers List. */
  supplierId: number | null;
  description: string;
  status: SupplierIssueStatus | null;
  resolution: string;
  severity: SupplierIssueSeverity | null;
  comments: Comment[];
  watchers: Person[];
  hasAttachments: boolean;
  createdAt: Date;
  modifiedAt: Date;
}

export interface SupplierIssueInput {
  title: string;
  supplierId: number;
  description: string;
  status: SupplierIssueStatus | null;
  severity: SupplierIssueSeverity | null;
  watchers: Person[];
}

// =============================================================================
// Cost Impact Notices — Supply Chain, on the "Cost Impact Portal" list on the
// ALTRONICSALESTEAM site (SITES.salesTeam) — the same "Supply Chain feature,
// Sales-site list" arrangement as Gray Market Requests living on PMO: that's
// where the list has always been, and the Sales Team grant already covers it.
// Schema discovered live 2026-08-27 (scripts/cost-impact-portal-schema.json).
//
// Supply Chain raises one of these to tell Sales/Engineering/Purchasing that a
// purchased part's cost has gone up (or down): the old price, the new price,
// the delta, and how soon the change bites. There's no Watchers column, so —
// same call as ECNs and Customer Notes — the comment thread notifies only
// whoever is @-mentioned, and a fixed intake list is emailed on every create
// (see `lib/costImpactAlerts.ts`) so nobody has to be watching the list to
// hear about a new one.
// =============================================================================

/** The `TimeofImpact` choices — required on every notice. */
export const COST_IMPACT_TIMES = [
  "Immediate",
  "Near Future (<6 mo)",
  "Future (6+ mo)",
] as const;
export type CostImpactTime = (typeof COST_IMPACT_TIMES)[number];

export interface CostImpactNotice {
  id: number;
  /** `Title` — the part's description, e.g. "DATA LOGGING MODULE". */
  title: string;
  supplier: string;
  sapNumber: string;
  oldPartNumber: string;
  mpn: string;
  /**
   * `OriginalCost` / `NewCost` — SharePoint TEXT columns holding a decimal
   * string ("604.50"), not a Currency column. Kept as strings so a value
   * round-trips exactly as typed; render with the app's own currency
   * formatting rather than assuming a parsed number is safe to re-display.
   */
  originalCost: string;
  newCost: string;
  /**
   * `Delta_x0020_Cost` — a SharePoint CALCULATED column
   * (`=[New Cost]-[Original Cost]`), read-only. Parsed to a number here
   * since SharePoint already did the subtraction; null if it hasn't
   * computed yet (a brand-new item) or came back unparseable.
   */
  deltaCost: number | null;
  timeOfImpact: CostImpactTime | null;
  /** `Panels` — Yes / No / not set. Whether the part is used on a panel build. */
  usedOnPanels: "Yes" | "No" | null;
  /** `WhereUsed` — Enhanced rich text (HTML), the same as EIR/Gray Market's field of the same name. Required. */
  whereUsed: string;
  eau: string;
  bpReference: string;
  /**
   * `Comments` — a free-text notes column, distinct from the `Communication`
   * comment thread below. SharePoint's own label for it really is "Comments";
   * ARC calls it `notes` in the domain to keep it apart from `comments`
   * (the thread) everywhere else in this codebase.
   */
  notes: string;
  /** `Year_x0020_Issued` — calculated (`=CONCATENATE(YEAR(Created))`), read-only. */
  yearIssued: string;
  /** Item-level `createdBy` — the list has no requester column of its own, same as ECNs. */
  submittedBy: Person | null;
  comments: Comment[];
  hasAttachments: boolean;
  createdAt: Date;
  modifiedAt: Date;
}

export interface CostImpactNoticeInput {
  title: string;
  supplier: string;
  sapNumber: string;
  oldPartNumber: string;
  mpn: string;
  originalCost: string;
  newCost: string;
  timeOfImpact: CostImpactTime | null;
  usedOnPanels: "Yes" | "No" | null;
  whereUsed: string;
  eau: string;
  bpReference: string;
  notes: string;
}
