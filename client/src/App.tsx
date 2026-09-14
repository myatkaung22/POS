import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { ToastHost } from "./components/Toast";
import { Layout } from "./components/Layout";
import { Guard } from "./components/Guard";
import { QrAlertProvider } from "./alerts";
import { LoginPage } from "./pages/Login";
import { TablesPage } from "./pages/Tables";
import { PosPage } from "./pages/POS";
import { KitchenPage } from "./pages/Kitchen";
import { MenuPage } from "./pages/Menu";
import { InboxPage } from "./pages/Inbox";
import { ReportsPage } from "./pages/Reports";
import { AskPage } from "./pages/Ask";
import { OrdersPage } from "./pages/Orders";
import { SettingsPage } from "./pages/Settings";
import { QRMenuPage } from "./pages/QRMenu";
import { DispatchPage } from "./pages/Dispatch";

function HomeRedirect() {
  const { user, can } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "kitchen") return <Navigate to="/kitchen" replace />;
  if (can("tables")) return <Navigate to="/tables" replace />;
  if (can("pos")) return <Navigate to="/pos" replace />;
  return <Navigate to="/kitchen" replace />;
}

function Perm({ permission }: { permission: string }) {
  const { can } = useAuth();
  if (!can(permission)) return <Navigate to="/" replace />;
  return <Outlet />;
}

function StaffShell() {
  return (
    <QrAlertProvider>
      <Layout />
    </QrAlertProvider>
  );
}

export function App() {
  return (
    <AuthProvider>
      <ToastHost>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/qr/:token" element={<QRMenuPage />} />
            <Route element={<Guard />}>
              <Route element={<StaffShell />}>
                <Route path="/" element={<HomeRedirect />} />
                <Route element={<Perm permission="tables" />}>
                  <Route path="/tables" element={<TablesPage />} />
                </Route>
                <Route element={<Perm permission="pos" />}>
                  <Route path="/pos" element={<PosPage />} />
                </Route>
                <Route element={<Perm permission="dispatch" />}>
                  <Route path="/dispatch" element={<DispatchPage />} />
                </Route>
                <Route element={<Perm permission="kitchen" />}>
                  <Route path="/kitchen" element={<KitchenPage />} />
                </Route>
                <Route element={<Perm permission="menu" />}>
                  <Route path="/menu" element={<MenuPage />} />
                </Route>
                <Route element={<Perm permission="inbox" />}>
                  <Route path="/inbox" element={<InboxPage />} />
                </Route>
                <Route element={<Perm permission="reports" />}>
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route path="/ask" element={<AskPage />} />
                </Route>
                <Route element={<Perm permission="orders" />}>
                  <Route path="/orders" element={<OrdersPage />} />
                </Route>
                <Route element={<Perm permission="settings" />}>
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastHost>
    </AuthProvider>
  );
}
