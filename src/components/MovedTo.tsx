import { Navigate, useLocation } from "react-router-dom";

/**
 * A route that moved: redirect to its new path, KEEPING the query string — a
 * bookmarked or shared filtered view (?year=2024&part=12) must land filtered.
 * A bare <Navigate> drops it.
 */
export function MovedTo({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}
