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
  /** `ProductionTest`, labelled "Testing Required". Required by the list. */
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
