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
