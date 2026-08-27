import type { QuickLink } from "@/types/task";

// =============================================================================
// Demo-mode fixtures for Quick Links — admin-managed external-link buttons
// shown above each Dashboard department's cards. `order` is per-department,
// ascending, matching how the admin screen and the Dashboard both sort.
// =============================================================================

export const MOCK_QUICK_LINKS: QuickLink[] = [
  {
    id: 1,
    label: "Engineering SharePoint",
    url: "https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering",
    department: "Engineering",
    order: 1,
  },
  {
    id: 2,
    label: "CAD Vault",
    url: "https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering/CAD",
    department: "Engineering",
    order: 2,
  },
  {
    id: 3,
    label: "Panel Team SharePoint",
    url: "https://coopermachineryservices.sharepoint.com/sites/ALTRONICPANELTEAM",
    department: "Panels",
    order: 1,
  },
  {
    id: 4,
    label: "Supplier Onboarding (Medius)",
    url: "https://app.medius.com/cooperservices",
    department: "Supply Chain",
    order: 1,
  },
];
