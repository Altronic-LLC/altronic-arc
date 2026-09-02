import type { FeatureRequest } from "@/types/task";

// =============================================================================
// Sample ARC Feature Requests for mock mode — a handful of realistic rows
// spanning all four statuses, so the status pills and the open-first sort
// both have something to show.
// =============================================================================

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

const RAY = { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 1 };
const SHEILA = { displayName: "Sheila Horn", email: "sheila.horn@altronic-llc.com", lookupId: 2 };
const JERROD = {
  displayName: "Jerrod Waldron",
  email: "jerrod.waldron@altronic-llc.com",
  lookupId: 3,
};
const KATIE = { displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com", lookupId: 4 };

export const MOCK_FEATURE_REQUESTS: FeatureRequest[] = [
  {
    id: 1,
    title: "Dark mode for the print views",
    description:
      "The printable task page and the drawing work sheet ignore the theme toggle and always render light — fine for paper, but confusing when someone previews before printing on a dark-themed laptop. Would like the preview to at least respect the toggle even if the printed page stays light.",
    department: "Engineering",
    requestedBy: JERROD,
    priority: "Low",
    status: "Pending Review",
    targetVersion: "",
    comments: [],
    watchers: [JERROD],
    hasAttachments: false,
    createdAt: daysAgo(2),
    modifiedAt: daysAgo(2),
    author: JERROD,
  },
  {
    id: 2,
    title: "Bulk status change on the EIR board",
    description:
      "When a project wraps up there are usually 8-10 EIRs that all need to move to Closed at once. Right now that's 8-10 individual drags. A multi-select on the list view with a bulk status action would save a lot of clicking.",
    department: "Engineering",
    requestedBy: SHEILA,
    priority: "Medium",
    status: "In Work",
    targetVersion: "",
    comments: [
      {
        timestamp: daysAgo(1),
        authorName: "Ray White",
        authorEmail: "ray.white@altronic-llc.com",
        bodyHtml: "<p>Picking this up — planning to add a checkbox column to the list view first.</p>",
        attachments: [],
      },
    ],
    watchers: [SHEILA, RAY],
    hasAttachments: false,
    createdAt: daysAgo(9),
    modifiedAt: daysAgo(1),
    author: SHEILA,
  },
  {
    id: 3,
    title: "Export the Open Orders customer list to Excel",
    description:
      "Would like a plain export of the managed customer list (sold-to, name, active) for a quick audit against SAP, without having to screenshot the table.",
    department: "Customer Service / Sales",
    requestedBy: KATIE,
    priority: "Low",
    status: "Completed",
    targetVersion: "v0.121.0",
    comments: [
      {
        timestamp: daysAgo(20),
        authorName: "Ray White",
        authorEmail: "ray.white@altronic-llc.com",
        bodyHtml: "<p>Added a Download CSV button next to Import. Shipped in v0.121.0.</p>",
        attachments: [],
      },
    ],
    watchers: [KATIE],
    hasAttachments: false,
    createdAt: daysAgo(35),
    modifiedAt: daysAgo(20),
    author: KATIE,
  },
  {
    id: 4,
    title: "Push notifications on new mentions",
    description:
      "It would be nice to get a phone push notification (not just email) whenever I'm @-mentioned, since email gets buried. Understand ARC has no backend/server to push from, so this might not be feasible without one — raising it anyway in case there's a PWA-only trick.",
    department: "Cross-department",
    requestedBy: RAY,
    priority: "Low",
    status: "Not Implementing",
    targetVersion: "",
    comments: [
      {
        timestamp: daysAgo(40),
        authorName: "Ray White",
        authorEmail: "ray.white@altronic-llc.com",
        bodyHtml:
          "<p>Web Push needs a backend to hold subscriptions and a server to send from — ARC is a static site with none of that. Not implementing unless that changes.</p>",
        attachments: [],
      },
    ],
    watchers: [RAY],
    hasAttachments: false,
    createdAt: daysAgo(50),
    modifiedAt: daysAgo(40),
    author: RAY,
  },
];
