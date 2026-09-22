import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  Bike,
  ChefHat,
  ClipboardList,
  LayoutGrid,
  LogOut,
  Settings2,
  Table2,
  Timer,
  UtensilsCrossed,
  BarChart3,
  Sparkles,
  Banknote,
} from "lucide-react";
import { useAuth } from "../auth";
import { useEffect, useState } from "react";
import { getSocket } from "../socket";
import type { InboxMessage } from "../types";
import { api } from "../api";
import { toast } from "./Toast";
import { QrAlertHost, useQrAlerts } from "../alerts";
import { runAction } from "../actionQueue";

const links = [
  { to: "/tables", label: "Floor", icon: Table2, perm: "tables" },
  { to: "/pos", label: "POS", icon: UtensilsCrossed, perm: "pos" },
  { to: "/dispatch", label: "Pickup", icon: Bike, perm: "dispatch" },
  { to: "/kitchen", label: "Kitchen", icon: ChefHat, perm: "kitchen" },
  { to: "/orders", label: "Orders", icon: ClipboardList, perm: "orders" },
  { to: "/menu", label: "Menu", icon: LayoutGrid, perm: "menu" },
  { to: "/inbox", label: "Inbox", icon: Bell, perm: "inbox" },
  { to: "/reports", label: "Reports", icon: BarChart3, perm: "reports" },
  { to: "/clock", label: "Clock", icon: Timer, perm: "clock" },
  { to: "/ask", label: "Ask (Beta)", icon: Sparkles, perm: "reports" },
  { to: "/settings", label: "Settings", icon: Settings2, perm: "settings" },
];

export function Layout() {
  const { user, settings, can, logout, unreadInbox, setUnread } = useAuth();
  const { alerts } = useQrAlerts();
  const navigate = useNavigate();
  const location = useLocation();
  const [clock, setClock] = useState(() => new Date());
  const [shift, setShift] = useState<{ id: string; clockIn: string } | null>(null);
  const qrWaiting = alerts.length;
  const nav = links.filter((l) => can(l.perm));

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    void api<{ shift: { id: string; clockIn: string } | null }>("/api/time/me")
      .then((data) => setShift(data.shift))
      .catch(() => setShift(null));
  }, [user?.id]);

  useEffect(() => {
    const socket = getSocket();
    const onInbox = (msg: InboxMessage) => {
      if (location.pathname !== "/inbox") setUnread((n) => n + 1);
      if (msg.type === "qr_order" && location.pathname !== "/pos") {
        /* chime + banner handled by QrAlertHost */
      }
    };
    socket.on("inbox:new", onInbox);
    return () => {
      socket.off("inbox:new", onInbox);
    };
  }, [location.pathname, setUnread]);

  return (
    <div className="flex min-h-dvh bg-ink-950 text-cream-50 md:flex-row">
      <QrAlertHost />
      <aside className="hidden w-56 shrink-0 flex-col border-r border-white/5 bg-black md:flex">
        <div className="px-4 py-4">
          <img src="/logo.png" alt="4 Corner" className="h-10 w-auto object-contain" />
          <div className="mt-2 text-[10px] font-semibold tracking-[0.18em] text-white/40 uppercase">OmniMind POS</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2">
          {nav.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition ${
                  isActive ? "bg-gold-500/15 text-gold-400" : "text-cream-100/70 hover:bg-white/5"
                }`
              }
            >
              <l.icon size={18} />
              <span>{l.label}</span>
              {l.to === "/inbox" && unreadInbox > 0 && (
                <span className="ml-auto rounded-full bg-rose-400 px-2 text-[11px] text-ink-950">{unreadInbox}</span>
              )}
              {l.to === "/pos" && qrWaiting > 0 && (
                <span className="ml-auto rounded-full bg-sky-400 px-2 text-[11px] text-ink-950">{qrWaiting}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => {
            logout();
            navigate("/login");
          }}
          className="m-3 flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-cream-100/60 hover:bg-white/5"
        >
          <LogOut size={18} />
          Sign out
        </button>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-2.5 sm:px-5 sm:py-3">
          <div className="min-w-0 md:hidden">
            <img src="/logo.png" alt="4 Corner" className="h-8 w-auto object-contain" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[11px] tracking-wide text-sage-400 sm:text-xs">
              {settings.restaurantName || "4 Corner Bar & Restaurant"}
            </div>
            <div className="display truncate text-lg leading-tight sm:text-xl">{headerTitle(location.pathname)}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-sm sm:gap-3">
            {qrWaiting > 0 && (
              <button
                onClick={() => navigate("/pos")}
                className="pulse-ring rounded-full bg-sky-400/15 px-2 py-1 text-[11px] text-sky-300 sm:px-3 sm:py-1.5 sm:text-sm"
              >
                {qrWaiting}
              </button>
            )}
            <div className="hidden text-right lg:block">
              <div className="tabular-nums text-cream-50">{clock.toLocaleTimeString()}</div>
              <div className="text-xs text-cream-100/45">{clock.toLocaleDateString()}</div>
            </div>
            {can("drawer") && (
              <button
                type="button"
                onClick={() =>
                  void runAction("drawer-kick", "Opening drawer", async () => {
                    const r = await api<{ status?: string }>("/api/printers/drawer", { method: "POST" });
                    toast(r.status === "printed" ? "Drawer opened" : "Drawer kick sent", r.status === "printed" ? "ok" : "info");
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-2xl border border-white/10 px-2 py-1.5 text-[11px] text-cream-100/80 hover:bg-white/5 sm:px-3 sm:text-sm"
              >
                <Banknote size={16} />
                <span className="hidden sm:inline">Drawer</span>
              </button>
            )}
            {can("clock") && (
              <button
                onClick={async () => {
                  try {
                    if (shift) {
                      await api("/api/time/clock-out", { method: "POST", body: "{}" });
                      setShift(null);
                      toast("Clocked out");
                    } else {
                      const data = await api<{ shift: { id: string; clockIn: string } }>("/api/time/clock-in", {
                        method: "POST",
                        body: "{}",
                      });
                      setShift(data.shift);
                      toast("Clocked in");
                    }
                  } catch (err) {
                    toast(err instanceof Error ? err.message : "Clock failed", "err");
                  }
                }}
                className={`rounded-2xl px-2 py-1.5 text-[11px] sm:px-3 sm:text-sm ${
                  shift ? "bg-sage-500/20 text-sage-400" : "border border-white/10 text-cream-100/70"
                }`}
              >
                {shift ? "Clock out" : "Clock in"}
              </button>
            )}
            <div className="max-w-[38vw] rounded-2xl border border-white/10 bg-ink-800 px-2 py-1.5 sm:max-w-none sm:px-3 sm:py-2">
              <div className="truncate text-xs leading-tight sm:text-sm">{user?.name}</div>
              <div className="text-[10px] tracking-[0.16em] text-gold-400 uppercase">{user?.role}</div>
            </div>
            <button
              onClick={() => {
                logout();
                navigate("/login");
              }}
              className="rounded-2xl border border-white/10 p-2 text-cream-100/60 md:hidden"
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-3 pb-24 sm:p-4 md:p-5 md:pb-5">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black/95 px-1 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur md:hidden">
        <div className="flex gap-0.5 overflow-x-auto">
          {nav.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `relative flex min-w-[4.25rem] flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[10px] ${
                  isActive ? "text-gold-400" : "text-cream-100/55"
                }`
              }
            >
              <l.icon size={18} />
              {l.label}
              {l.to === "/inbox" && unreadInbox > 0 && (
                <span className="absolute top-1 right-2 h-1.5 w-1.5 rounded-full bg-rose-400" />
              )}
              {l.to === "/pos" && qrWaiting > 0 && (
                <span className="absolute top-1 right-2 h-1.5 w-1.5 rounded-full bg-sky-400" />
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

function headerTitle(path: string) {
  if (path.startsWith("/pos")) return "Service";
  if (path.startsWith("/tables")) return "Floor";
  if (path.startsWith("/dispatch")) return "Pickup & delivery";
  if (path.startsWith("/kitchen")) return "Kitchen";
  if (path.startsWith("/menu")) return "Menu";
  if (path.startsWith("/inbox")) return "Inbox";
  if (path.startsWith("/reports")) return "Reports";
  if (path.startsWith("/ask")) return "Ask (Beta)";
  if (path.startsWith("/orders")) return "History";
  if (path.startsWith("/clock")) return "Clock";
  if (path.startsWith("/settings")) return "Settings";
  return "POS";
}
