import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { BellRing, X } from "lucide-react";
import { getSocket } from "./socket";
import { money, type Order } from "./types";

export type QrAlert = {
  id: string;
  orderId: string;
  orderNo: number;
  tableId: string;
  tableNumber: number;
  tableName: string;
  total: number;
  currency: string;
  note?: string;
  items: { qty: number; name: string; notes?: string; diner?: string }[];
  order?: Order;
};

type AlertsState = {
  alerts: QrAlert[];
  current: QrAlert | null;
  dismiss: (id: string) => void;
  dismissCurrent: () => void;
};

const AlertsContext = createContext<AlertsState | null>(null);

function playChime() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    const beep = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.12, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    };
    beep(880, 0, 0.16);
    beep(1174, 0.18, 0.22);
  } catch {
    /* ignore autoplay limits */
  }
}

export function QrAlertProvider({ children }: { children: ReactNode }) {
  const [alerts, setAlerts] = useState<QrAlert[]>([]);
  const [current, setCurrent] = useState<QrAlert | null>(null);

  useEffect(() => {
    const socket = getSocket();
    const onQr = (payload: QrAlert) => {
      const alert: QrAlert = { ...payload, id: `${payload.orderId}-${Date.now()}` };
      setAlerts((prev) => [alert, ...prev].slice(0, 12));
      setCurrent(alert);
      playChime();
    };
    socket.on("pos:qr-order", onQr);
    return () => {
      socket.off("pos:qr-order", onQr);
    };
  }, []);

  const value = useMemo<AlertsState>(
    () => ({
      alerts,
      current,
      dismiss(id) {
        setAlerts((prev) => prev.filter((a) => a.id !== id));
        setCurrent((prev) => (prev?.id === id ? null : prev));
      },
      dismissCurrent() {
        setCurrent(null);
      },
    }),
    [alerts, current]
  );

  return createElement(AlertsContext.Provider, { value }, children);
}

export function useQrAlerts() {
  const ctx = useContext(AlertsContext);
  if (!ctx) throw new Error("QrAlertProvider missing");
  return ctx;
}

export function QrAlertHost() {
  const { current, dismissCurrent } = useQrAlerts();
  const navigate = useNavigate();
  if (!current) return null;

  return (
    <div className="fixed inset-x-0 top-3 z-[70] flex justify-center px-3 sm:top-4 sm:px-4">
      <div className="alert-pop w-full max-w-lg rounded-3xl border border-sky-300/40 bg-ink-900/95 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-400/20 text-sky-300">
            <BellRing size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold tracking-[0.18em] text-sky-300 uppercase">Guest QR order</div>
            <div className="display text-2xl">
              Table {current.tableNumber}
              <span className="ml-2 text-base text-cream-100/50">#{current.orderNo}</span>
            </div>
            <ul className="mt-2 space-y-1 text-sm text-cream-50">
              {current.items.map((item, i) => (
                <li key={i}>
                  <span className="text-gold-400">{item.qty}×</span> {item.name}
                  {item.notes ? <span className="text-cream-100/50"> · {item.notes}</span> : null}
                  {item.diner ? <span className="text-sky-300"> · {item.diner}</span> : null}
                </li>
              ))}
            </ul>
            <div className="mt-2 text-sm text-gold-400">{money(current.total, current.currency)}</div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  dismissCurrent();
                  navigate(`/pos?table=${current.tableId}`);
                }}
                className="rounded-2xl bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950"
              >
                Open on POS
              </button>
              <button onClick={dismissCurrent} className="rounded-2xl bg-white/5 px-4 py-2 text-sm">
                Later
              </button>
            </div>
          </div>
          <button onClick={dismissCurrent} className="rounded-full p-1 text-cream-100/50 hover:bg-white/5">
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
