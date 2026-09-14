import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../auth";

export function Guard({ permission }: { permission?: string }) {
  const { user, loading, can } = useAuth();
  if (loading) {
    return <div className="grid min-h-screen place-items-center text-sage-400">Loading POS…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (permission && !can(permission)) return <Navigate to="/" replace />;
  return <Outlet />;
}
