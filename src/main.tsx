import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import "./styles/globals.css";

// React Query client. Defaults are tuned for this app's read-heavy access
// pattern — we cache lists for 30 seconds, refetch on window focus is off
// because the SharePoint data doesn't change that often.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// In production we deploy to /altronic-engineering-tasks/ on GitHub Pages,
// so React Router needs a matching basename. In dev it's the root.
const basename =
  import.meta.env.MODE === "production" ? "/altronic-engineering-tasks" : "/";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={basename}>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </AuthProvider>
  </React.StrictMode>,
);
