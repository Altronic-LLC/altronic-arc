import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ToastContainer } from "@/components/Toast";
import { ListView } from "@/views/ListView";
import { DashboardView } from "@/views/DashboardView";
import { KanbanView } from "@/views/KanbanView";
import { DetailView } from "@/views/DetailView";
import { PrintTaskView } from "@/views/PrintTaskView";
import { ProjectView } from "@/views/ProjectView";
import { AdminProjectsView } from "@/views/AdminProjectsView";
import { TestSheetsView } from "@/views/TestSheetsView";
import { TestSheetDetailView } from "@/views/TestSheetDetailView";
import { EirsView } from "@/views/EirsView";
import { EirDetailView } from "@/views/EirDetailView";
import { AboutView } from "@/views/AboutView";
import { ManualView } from "@/views/ManualView";

export function App() {
  // The print route is intentionally chrome-less so the saved PDF doesn't
  // include the app header/footer. Match any /…/print path.
  const location = useLocation();
  const isPrintRoute = location.pathname.endsWith("/print");

  return (
    <div className="flex min-h-full flex-col bg-bg">
      {!isPrintRoute && <Header />}
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<DashboardView />} />
          <Route path="/list" element={<ListView />} />
          <Route path="/kanban" element={<KanbanView />} />
          <Route path="/task/:id" element={<DetailView />} />
          <Route path="/task/:id/print" element={<PrintTaskView />} />
          <Route path="/project/:id" element={<ProjectView />} />
          <Route path="/admin/projects" element={<AdminProjectsView />} />
          <Route path="/test-sheets" element={<TestSheetsView />} />
          <Route path="/test-sheet/:id" element={<TestSheetDetailView />} />
          <Route path="/eirs" element={<EirsView />} />
          <Route path="/eir/:id" element={<EirDetailView />} />
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
