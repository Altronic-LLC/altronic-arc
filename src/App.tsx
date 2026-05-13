import { Routes, Route, Navigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ListView } from "@/views/ListView";
import { KanbanView } from "@/views/KanbanView";
import { DetailView } from "@/views/DetailView";

export function App() {
  return (
    <div className="flex min-h-full flex-col bg-bg">
      <Header />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<ListView />} />
          <Route path="/list" element={<Navigate to="/" replace />} />
          <Route path="/kanban" element={<KanbanView />} />
          <Route path="/task/:id" element={<DetailView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
