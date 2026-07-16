import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ToastContainer } from "@/components/Toast";
import { UpdateAvailableBanner } from "@/components/UpdateAvailableBanner";
import { RequireAdmin } from "@/components/RequireAdmin";
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
import { EirDetailView } from "@/views/EirDetailView";
import { AboutView } from "@/views/AboutView";
import { ManualView } from "@/views/ManualView";
import { useMentionScanner } from "@/hooks/useUnseenMentions";

// Operations is the first non-Engineering department — its views are code-
// split into their own lazy-loaded chunk (rather than eagerly bundled with
// everything else) per CLAUDE.md's "each department is a lazy-loaded route
// bundle" rule. No Operations file imports anything Engineering-specific;
// only the shared layer (components/hooks/lib) is imported by both.
const OperationsListView = lazy(() =>
  import("@/views/OperationsListView").then((m) => ({ default: m.OperationsListView })),
);
const OperationsKanbanView = lazy(() =>
  import("@/views/OperationsKanbanView").then((m) => ({ default: m.OperationsKanbanView })),
);
const OperationsDetailView = lazy(() =>
  import("@/views/OperationsDetailView").then((m) => ({ default: m.OperationsDetailView })),
);
const AdminOperationsProjectsView = lazy(() =>
  import("@/views/AdminOperationsProjectsView").then((m) => ({
    default: m.AdminOperationsProjectsView,
  })),
);

// Build Requests — Engineering's master-detail feature (header + parts).
// Lazy-loaded like the Operations bundle to keep the main chunk lean.
const BuildRequestsView = lazy(() =>
  import("@/views/BuildRequestsView").then((m) => ({ default: m.BuildRequestsView })),
);
const BuildRequestDetailView = lazy(() =>
  import("@/views/BuildRequestDetailView").then((m) => ({ default: m.BuildRequestDetailView })),
);
const BuildRequestItemRedirect = lazy(() =>
  import("@/views/BuildRequestItemRedirect").then((m) => ({
    default: m.BuildRequestItemRedirect,
  })),
);
const PrintBuildRequestItemView = lazy(() =>
  import("@/views/PrintBuildRequestItemView").then((m) => ({
    default: m.PrintBuildRequestItemView,
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
          <Route path="/admin" element={<Navigate to="/admin/admins" replace />} />
          <Route path="/test-sheets" element={<TestSheetsView />} />
          <Route path="/test-sheet/:id" element={<TestSheetDetailView />} />
          <Route path="/eirs" element={<EirsView />} />
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
          <Route path="/about" element={<AboutView />} />
          <Route path="/manual" element={<ManualView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {!isPrintRoute && <Footer />}
      {!isPrintRoute && <ToastContainer />}
    </div>
  );
}
