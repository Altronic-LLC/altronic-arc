import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ToastContainer } from "@/components/Toast";
import { UpdateAvailableBanner } from "@/components/UpdateAvailableBanner";
import { RequireAdmin } from "@/components/RequireAdmin";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListView } from "@/views/ListView";
import { DashboardView } from "@/views/DashboardView";
import { KanbanView } from "@/views/KanbanView";
import { DetailView } from "@/views/DetailView";
import { PrintTaskView } from "@/views/PrintTaskView";
import { ProjectView } from "@/views/ProjectView";
import { ProjectFoldersView } from "@/views/ProjectFoldersView";
import { AdminProjectsView } from "@/views/AdminProjectsView";
import { AdminAdminsView } from "@/views/AdminAdminsView";
import { AdminEirRolesView } from "@/views/AdminEirRolesView";
import { TestSheetsView } from "@/views/TestSheetsView";
import { TestSheetDetailView } from "@/views/TestSheetDetailView";
import { EirsView } from "@/views/EirsView";
import { WhereAmIView } from "@/views/WhereAmIView";
import { EcnsView } from "@/views/EcnsView";
import { FaitsView } from "@/views/FaitsView";
import { FaitDetailView } from "@/views/FaitDetailView";
import { EcnDetailView } from "@/views/EcnDetailView";
import { VisitReportsView } from "@/views/VisitReportsView";
import { GrayMarketRequestsView } from "@/views/GrayMarketRequestsView";
import { GrayMarketRequestDetailView } from "@/views/GrayMarketRequestDetailView";
import { VisitReportsCalendarView } from "@/views/VisitReportsCalendarView";
import { VisitReportDetailView } from "@/views/VisitReportDetailView";
import { EirKanbanView } from "@/views/EirKanbanView";
import { EirDetailView } from "@/views/EirDetailView";
import { DigitalQcView } from "@/views/DigitalQcView";
import { IgnitionQcView } from "@/views/IgnitionQcView";
import { PottingSampleLogView } from "@/views/PottingSampleLogView";
import { PottingLimitsView } from "@/views/PottingLimitsView";
import { PsrNotificationView } from "@/views/PsrNotificationView";
import { AboutView } from "@/views/AboutView";
import { ManualView } from "@/views/ManualView";
import { useMentionScanner } from "@/hooks/useUnseenMentions";

// Operations is the first non-Engineering department — its views are code-
// split into their own lazy-loaded chunk (rather than eagerly bundled with
// everything else) per CLAUDE.md's "each department is a lazy-loaded route
// bundle" rule. No Operations file imports anything Engineering-specific;
// only the shared layer (components/hooks/lib) is imported by both.
const OperationsListView = lazy(() =>
  import("@/views/OperationsListView").then((m) => ({
    default: m.OperationsListView,
  })),
);
const OperationsKanbanView = lazy(() =>
  import("@/views/OperationsKanbanView").then((m) => ({
    default: m.OperationsKanbanView,
  })),
);
const OperationsDetailView = lazy(() =>
  import("@/views/OperationsDetailView").then((m) => ({
    default: m.OperationsDetailView,
  })),
);
const AdminOperationsProjectsView = lazy(() =>
  import("@/views/AdminOperationsProjectsView").then((m) => ({
    default: m.AdminOperationsProjectsView,
  })),
);
// Open Orders Report Tool — the Sales bundle. Pulls in ExcelJS (~950KB) only
// when someone actually generates or parses a workbook, via a dynamic import
// inside useOpenOrdersReports, so it never reaches the main chunk.
const OpenOrdersView = lazy(() =>
  import("@/views/OpenOrdersView").then((m) => ({ default: m.OpenOrdersView })),
);
const OpenOrdersCustomersView = lazy(() =>
  import("@/views/OpenOrdersCustomersView").then((m) => ({
    default: m.OpenOrdersCustomersView,
  })),
);
const AdminNotificationRecipientsView = lazy(() =>
  import("@/views/AdminNotificationRecipientsView").then((m) => ({
    default: m.AdminNotificationRecipientsView,
  })),
);
const CustomerNotesView = lazy(() =>
  import("@/views/CustomerNotesView").then((m) => ({ default: m.CustomerNotesView })),
);
const CustomerNoteDetailView = lazy(() =>
  import("@/views/CustomerNoteDetailView").then((m) => ({
    default: m.CustomerNoteDetailView,
  })),
);
const SuppliersView = lazy(() =>
  import("@/views/SuppliersView").then((m) => ({ default: m.SuppliersView })),
);
const SupplierDetailView = lazy(() =>
  import("@/views/SupplierDetailView").then((m) => ({ default: m.SupplierDetailView })),
);
const SupplierContactRedirect = lazy(() =>
  import("@/views/SupplierContactRedirect").then((m) => ({
    default: m.SupplierContactRedirect,
  })),
);
const SupplierIssueRedirect = lazy(() =>
  import("@/views/SupplierIssueRedirect").then((m) => ({ default: m.SupplierIssueRedirect })),
);
const AdminOpenOrdersRolesView = lazy(() =>
  import("@/views/AdminOpenOrdersRolesView").then((m) => ({
    default: m.AdminOpenOrdersRolesView,
  })),
);
// Teradyne — the board-test log, part of the Operations bundle. Its reference
// lists (Employees / Products / Remarks) all share one view, keyed by :kind.
const TeradyneLogView = lazy(() =>
  import("@/views/TeradyneLogView").then((m) => ({
    default: m.TeradyneLogView,
  })),
);
const TeradyneRefListView = lazy(() =>
  import("@/views/TeradyneRefListView").then((m) => ({
    default: m.TeradyneRefListView,
  })),
);

// Build Requests — Engineering's master-detail feature (header + parts).
// Lazy-loaded like the Operations bundle to keep the main chunk lean.
const BuildRequestsView = lazy(() =>
  import("@/views/BuildRequestsView").then((m) => ({
    default: m.BuildRequestsView,
  })),
);
const BuildRequestDetailView = lazy(() =>
  import("@/views/BuildRequestDetailView").then((m) => ({
    default: m.BuildRequestDetailView,
  })),
);
const BuildRequestItemRedirect = lazy(() =>
  import("@/views/BuildRequestItemRedirect").then((m) => ({
    default: m.BuildRequestItemRedirect,
  })),
);
// Drawing File Logs — Engineering's four drawing registers behind one screen.
const DrawingLogsView = lazy(() =>
  import("@/views/DrawingLogsView").then((m) => ({
    default: m.DrawingLogsView,
  })),
);
// CSA Listings — Engineering's certification register. Lazy like the other
// Engineering extras so it stays out of the main chunk.
const CsaListingsView = lazy(() =>
  import("@/views/CsaListingsView").then((m) => ({
    default: m.CsaListingsView,
  })),
);
const PrintBuildRequestItemView = lazy(() =>
  import("@/views/PrintBuildRequestItemView").then((m) => ({
    default: m.PrintBuildRequestItemView,
  })),
);
const PrintDrawingSheetView = lazy(() =>
  import("@/views/PrintDrawingSheetView").then((m) => ({
    default: m.PrintDrawingSheetView,
  })),
);

// Panels — the panel production team's department bundle (ALTRONICPANELTEAM
// site). Code-split like Operations; no cross-department imports.
const PanelOrdersView = lazy(() =>
  import("@/views/PanelOrdersView").then((m) => ({
    default: m.PanelOrdersView,
  })),
);
const PanelOrderDetailView = lazy(() =>
  import("@/views/PanelOrderDetailView").then((m) => ({
    default: m.PanelOrderDetailView,
  })),
);
const AdminPanelProjectsView = lazy(() =>
  import("@/views/AdminPanelProjectsView").then((m) => ({
    default: m.AdminPanelProjectsView,
  })),
);
const AdminPanelRolesView = lazy(() =>
  import("@/views/AdminPanelRolesView").then((m) => ({
    default: m.AdminPanelRolesView,
  })),
);
const PanelTasksView = lazy(() =>
  import("@/views/PanelTasksView").then((m) => ({ default: m.PanelTasksView })),
);
const PanelTaskDetailView = lazy(() =>
  import("@/views/PanelTaskDetailView").then((m) => ({
    default: m.PanelTaskDetailView,
  })),
);

export function App() {
  // The print route is intentionally chrome-less so the saved PDF doesn't
  // include the app header/footer. Match any /…/print path.
  const location = useLocation();
  const isPrintRoute = location.pathname.endsWith("/print");

  // Reset the window scroll on every route change. Without this, going
  // from a long list (Tasks/EIRs scrolled halfway down) into a detail
  // page lands the user at the same Y offset on the new page — which is
  // jarring because the detail header isn't visible. Re-running on
  // pathname change keeps query-string updates (filter changes) from
  // jumping the user back to the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Single subscription point for the @-mention badge state. Owning the
  // scan here keeps each row's `useIsMentioned` cheap — rows just read a
  // boolean from the shared store and no longer trigger the scan effect.
  useMentionScanner();

  return (
    <div className="flex min-h-full flex-col bg-bg">
      {!isPrintRoute && <Header />}
      {!isPrintRoute && <UpdateAvailableBanner />}
      <main className="flex-1">
        {/* The app's only error boundary. A render error used to blank the whole
            page until a manual refresh — including navigating away, since the
            crash takes the router with it. Keyed on the path so moving
            elsewhere clears it. */}
        <RouteErrorBoundary resetKey={location.pathname}>
          <Routes>
            <Route path="/" element={<DashboardView />} />
            <Route path="/list" element={<ListView />} />
            <Route path="/kanban" element={<KanbanView />} />
            <Route path="/task/:id" element={<DetailView />} />
            <Route path="/task/:id/print" element={<PrintTaskView />} />
            <Route path="/project/:id" element={<ProjectView />} />
            <Route path="/project-folders" element={<ProjectFoldersView />} />
            <Route
              path="/admin/projects"
              element={
                <RequireAdmin>
                  <AdminProjectsView />
                </RequireAdmin>
              }
            />
            <Route
              path="/admin/admins"
              element={
                <RequireAdmin>
                  <AdminAdminsView />
                </RequireAdmin>
              }
            />
            <Route
              path="/admin/eir-roles"
              element={
                <RequireAdmin>
                  <AdminEirRolesView />
                </RequireAdmin>
              }
            />
            <Route
              path="/admin/operations-projects"
              element={
                <RequireAdmin>
                  <Suspense fallback={<LoadingTasks noun="the admin page" />}>
                    <AdminOperationsProjectsView />
                  </Suspense>
                </RequireAdmin>
              }
            />
            <Route
              path="/admin"
              element={<Navigate to="/admin/admins" replace />}
            />
            <Route path="/test-sheets" element={<TestSheetsView />} />
            <Route path="/test-sheet/:id" element={<TestSheetDetailView />} />
            <Route path="/digital-qc" element={<DigitalQcView />} />
            <Route path="/ignition-qc" element={<IgnitionQcView />} />
            <Route
              path="/coils/potting-sample-log"
              element={<PottingSampleLogView />}
            />
            <Route
              path="/coils/potting-limits"
              element={<PottingLimitsView />}
            />
            <Route
              path="/coils/psr-notifications"
              element={<PsrNotificationView />}
            />
            <Route path="/supply-chain/faits" element={<FaitsView />} />
            <Route path="/supply-chain/fait/:id" element={<FaitDetailView />} />
            <Route
              path="/supply-chain/gray-market-requests"
              element={<GrayMarketRequestsView />}
            />
            <Route
              path="/supply-chain/suppliers"
              element={
                <Suspense fallback={<LoadingTasks noun="the suppliers" />}>
                  <SuppliersView />
                </Suspense>
              }
            />
            <Route
              path="/supply-chain/supplier/:id"
              element={
                <Suspense fallback={<LoadingTasks noun="the supplier" />}>
                  <SupplierDetailView />
                </Suspense>
              }
            />
            <Route
              path="/supply-chain/supplier-contact/:contactId"
              element={
                <Suspense fallback={<LoadingTasks noun="this contact" />}>
                  <SupplierContactRedirect />
                </Suspense>
              }
            />
            <Route
              path="/supply-chain/supplier-issue/:issueId"
              element={
                <Suspense fallback={<LoadingTasks noun="this issue" />}>
                  <SupplierIssueRedirect />
                </Suspense>
              }
            />
            <Route
              path="/supply-chain/gray-market-request/:id"
              element={<GrayMarketRequestDetailView />}
            />
            <Route
              path="/sales/open-orders"
              element={
                <Suspense
                  fallback={<LoadingTasks noun="the open orders reports" />}
                >
                  <OpenOrdersView />
                </Suspense>
              }
            />
            <Route
              path="/sales/open-orders/customers"
              element={
                <Suspense fallback={<LoadingTasks noun="the customer list" />}>
                  <OpenOrdersCustomersView />
                </Suspense>
              }
            />
            <Route
              path="/admin/notification-recipients"
              element={
                <RequireAdmin>
                  <Suspense fallback={<LoadingTasks noun="the recipient lists" />}>
                    <AdminNotificationRecipientsView />
                  </Suspense>
                </RequireAdmin>
              }
            />
            <Route
              path="/admin/open-orders-roles"
              element={
                <RequireAdmin>
                  <Suspense fallback={<LoadingTasks noun="the roles page" />}>
                    <AdminOpenOrdersRolesView />
                  </Suspense>
                </RequireAdmin>
              }
            />
            <Route
              path="/sales/customers"
              element={
                <Suspense fallback={<LoadingTasks noun="the customers" />}>
                  <CustomerNotesView />
                </Suspense>
              }
            />
            <Route
              path="/sales/customers/:id"
              element={
                <Suspense fallback={<LoadingTasks noun="the customer" />}>
                  <CustomerNoteDetailView />
                </Suspense>
              }
            />
            <Route path="/sales/visit-reports" element={<VisitReportsView />} />
            <Route
              path="/sales/visit-reports/calendar"
              element={<VisitReportsCalendarView />}
            />
            <Route
              path="/sales/visit-report/:id"
              element={<VisitReportDetailView />}
            />
            <Route path="/engineering/where-am-i" element={<WhereAmIView />} />
            <Route path="/engineering/ecns" element={<EcnsView />} />
            <Route path="/engineering/ecn/:id" element={<EcnDetailView />} />
            <Route path="/eirs" element={<EirsView />} />
            <Route path="/eirs/kanban" element={<EirKanbanView />} />
            <Route path="/eir/:id" element={<EirDetailView />} />
            <Route
              path="/operations/tasks"
              element={
                <Suspense fallback={<LoadingTasks />}>
                  <OperationsListView />
                </Suspense>
              }
            />
            <Route
              path="/operations/tasks/kanban"
              element={
                <Suspense fallback={<LoadingTasks noun="the board" />}>
                  <OperationsKanbanView />
                </Suspense>
              }
            />
            <Route
              path="/operations/task/:id"
              element={
                <Suspense fallback={<LoadingTasks noun="this task" />}>
                  <OperationsDetailView />
                </Suspense>
              }
            />
            <Route
              path="/drawing-logs"
              element={
                <Suspense fallback={<LoadingTasks noun="the drawing logs" />}>
                  <DrawingLogsView />
                </Suspense>
              }
            />
            {/* Chrome-less: the path ends in /print, which hides the header and
              footer (and skips the auth gate, since the tab is opened from an
              already-signed-in one). */}
            <Route
              path="/drawing-logs/:kind/:id/print"
              element={
                <Suspense fallback={<LoadingTasks noun="this drawing" />}>
                  <PrintDrawingSheetView />
                </Suspense>
              }
            />
            <Route
              path="/csa-listings"
              element={
                <Suspense fallback={<LoadingTasks noun="CSA listings" />}>
                  <CsaListingsView />
                </Suspense>
              }
            />
            <Route
              path="/operations/teradyne"
              element={
                <Suspense fallback={<LoadingTasks noun="the Teradyne log" />}>
                  <TeradyneLogView />
                </Suspense>
              }
            />
            <Route
              path="/operations/teradyne/:kind"
              element={
                <Suspense fallback={<LoadingTasks noun="the list" />}>
                  <TeradyneRefListView />
                </Suspense>
              }
            />
            <Route
              path="/build-requests"
              element={
                <Suspense fallback={<LoadingTasks noun="build requests" />}>
                  <BuildRequestsView />
                </Suspense>
              }
            />
            <Route
              path="/build-request/:id"
              element={
                <Suspense fallback={<LoadingTasks noun="this build request" />}>
                  <BuildRequestDetailView />
                </Suspense>
              }
            />
            <Route
              path="/build-request-item/:itemId"
              element={
                <Suspense fallback={<LoadingTasks noun="this part" />}>
                  <BuildRequestItemRedirect />
                </Suspense>
              }
            />
            <Route
              path="/build-request-item/:itemId/print"
              element={
                <Suspense fallback={<LoadingTasks noun="this part" />}>
                  <PrintBuildRequestItemView />
                </Suspense>
              }
            />
            <Route
              path="/panels/orders"
              element={
                <Suspense fallback={<LoadingTasks noun="panel orders" />}>
                  <PanelOrdersView />
                </Suspense>
              }
            />
            <Route
              path="/panels/order/:id"
              element={
                <Suspense fallback={<LoadingTasks noun="this panel order" />}>
                  <PanelOrderDetailView />
                </Suspense>
              }
            />
            <Route
              path="/panels/tasks"
              element={
                <Suspense fallback={<LoadingTasks noun="panel tasks" />}>
                  <PanelTasksView />
                </Suspense>
              }
            />
            <Route
              path="/panels/task/:id"
              element={
                <Suspense fallback={<LoadingTasks noun="this panel task" />}>
                  <PanelTaskDetailView />
                </Suspense>
              }
            />
            <Route
              path="/admin/panel-projects"
              element={
                <RequireAdmin>
                  <Suspense fallback={<LoadingTasks noun="the admin page" />}>
                    <AdminPanelProjectsView />
                  </Suspense>
                </RequireAdmin>
              }
            />
            <Route
              path="/admin/panel-roles"
              element={
                <RequireAdmin>
                  <Suspense fallback={<LoadingTasks noun="the admin page" />}>
                    <AdminPanelRolesView />
                  </Suspense>
                </RequireAdmin>
              }
            />
            <Route path="/about" element={<AboutView />} />
            <Route path="/manual" element={<ManualView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </RouteErrorBoundary>
      </main>
      {!isPrintRoute && <Footer />}
      {!isPrintRoute && <ToastContainer />}
    </div>
  );
}
