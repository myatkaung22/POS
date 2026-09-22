import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Bike, ShoppingBag } from "lucide-react";
import { api } from "../api";
import { getSocket } from "../socket";
import { money, DEFAULT_CURRENCY, type Order } from "../types";
import { useAuth } from "../auth";
import { toast } from "../components/Toast";

function lane(order: Order) {
  if (order.fulfillment === "out") return "out";
  if (order.fulfillment === "ready") return "ready";
  return "kitchen";
}

export function DispatchPage() {
  const { settings, can } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [tab, setTab] = useState<"takeaway" | "delivery">("takeaway");
  const currency = settings.currency || DEFAULT_CURRENCY;

  async function load() {
    setOrders(await api<Order[]>("/api/orders?dispatch=1"));
  }

  useEffect(() => {
    void load();
    const socket = getSocket();
    socket.on("order:updated", load);
    socket.on("kitchen:ticket", load);
    return () => {
      socket.off("order:updated", load);
      socket.off("kitchen:ticket", load);
    };
  }, []);

  const rows = orders.filter((o) => o.type === tab);
  const kitchen = rows.filter((o) => lane(o) === "kitchen");
  const ready = rows.filter((o) => lane(o) === "ready");
  const out = rows.filter((o) => lane(o) === "out");

  async function fulfill(id: string, fulfillment: string) {
    await api(`/api/orders/${id}/fulfill`, {
      method: "POST",
      body: JSON.stringify({ fulfillment }),
    });
    toast(fulfillment === "done" ? "Order closed" : "Updated");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => setTab("takeaway")}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm ${tab === "takeaway" ? "bg-gold-500 text-ink-950" : "bg-ink-800"}`}
          >
            <ShoppingBag size={16} /> Pickup {orders.filter((o) => o.type === "takeaway").length}
          </button>
          <button
            onClick={() => setTab("delivery")}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm ${tab === "delivery" ? "bg-gold-500 text-ink-950" : "bg-ink-800"}`}
          >
            <Bike size={16} /> Delivery {orders.filter((o) => o.type === "delivery").length}
          </button>
        </div>
        {can("pos") && (
          <div className="flex gap-2">
            <button onClick={() => navigate("/pos?type=takeaway")} className="rounded-2xl bg-white/5 px-4 py-2 text-sm">
              New pickup
            </button>
            <button onClick={() => navigate("/pos?type=delivery")} className="rounded-2xl bg-gold-500 px-4 py-2 text-sm text-ink-950">
              New delivery
            </button>
          </div>
        )}
      </div>

      <div className={`grid gap-4 ${tab === "delivery" ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
        <Column title={tab === "takeaway" ? "In kitchen" : "Kitchen"} hint="Sent, still cooking" orders={kitchen} currency={currency} empty="Nothing in the kitchen">
          {(order) => (
            <button onClick={() => navigate(`/pos?order=${order.id}&type=${order.type}`)} className="rounded-xl bg-white/5 px-3 py-1.5 text-xs">
              Open ticket
            </button>
          )}
        </Column>
        <Column
          title={tab === "takeaway" ? "Ready for pickup" : "Ready to send"}
          hint={tab === "takeaway" ? "Hand to the guest" : "Bagged and waiting"}
          orders={ready}
          currency={currency}
          empty="No ready orders"
        >
          {(order) => (
            <div className="flex flex-wrap gap-2">
              {tab === "delivery" && (
                <button onClick={() => void fulfill(order.id, "out")} className="rounded-xl bg-sky-400 px-3 py-1.5 text-xs font-medium text-ink-950">
                  Out for delivery
                </button>
              )}
              {tab === "takeaway" && (
                <button onClick={() => void fulfill(order.id, "done")} className="rounded-xl bg-gold-500 px-3 py-1.5 text-xs font-medium text-ink-950">
                  Collected
                </button>
              )}
              <button onClick={() => navigate(`/pos?order=${order.id}&type=${order.type}`)} className="rounded-xl bg-white/5 px-3 py-1.5 text-xs">
                POS
              </button>
            </div>
          )}
        </Column>
        {tab === "delivery" && (
          <Column title="Out for delivery" hint="On the road" orders={out} currency={currency} empty="No drivers out">
            {(order) => (
              <button onClick={() => void fulfill(order.id, "done")} className="rounded-xl bg-gold-500 px-3 py-1.5 text-xs font-medium text-ink-950">
                Delivered
              </button>
            )}
          </Column>
        )}
      </div>
    </div>
  );
}

function Column({
  title,
  hint,
  orders,
  currency,
  empty,
  children,
}: {
  title: string;
  hint: string;
  orders: Order[];
  currency: string;
  empty: string;
  children: (order: Order) => ReactNode;
}) {
  const sorted = useMemo(
    () => [...orders].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [orders]
  );
  return (
    <section className="rounded-[28px] border border-white/8 bg-ink-900 p-4">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="display text-2xl">{title}</div>
          <div className="text-xs text-cream-100/45">{hint}</div>
        </div>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs">{sorted.length}</span>
      </div>
      <div className="mt-4 space-y-3">
        {sorted.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 px-3 py-8 text-center text-sm text-cream-100/40">{empty}</div>}
        {sorted.map((order) => (
          <article key={order.id} className="rounded-2xl bg-ink-800 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="display text-xl leading-none">#{order.orderNo}</div>
                <div className="mt-1 text-sm">{order.customerName || "Walk-up guest"}</div>
                {order.customerPhone && <div className="text-xs text-cream-100/50">{order.customerPhone}</div>}
              </div>
              <div className="text-right">
                <div className="text-sm text-gold-400">{money(order.total, currency)}</div>
                <div className="text-[11px] uppercase tracking-wide text-sage-400">
                  {order.paidAmount ? "Paid" : "Unpaid"}
                </div>
              </div>
            </div>
            {order.deliveryAddress && <p className="mt-2 text-xs text-sky-300">{order.deliveryAddress}</p>}
            <ul className="mt-2 space-y-1 text-sm">
              {order.items
                .filter((i) => i.status !== "cancelled")
                .map((item) => (
                  <li key={item.id} className="flex justify-between gap-2">
                    <span>
                      {item.qty}× {item.name}
                      {item.diner ? ` · ${item.diner}` : ""}
                    </span>
                    <span className="text-[11px] uppercase text-cream-100/40">{item.status}</span>
                  </li>
                ))}
            </ul>
            {order.customerNote && <p className="mt-2 text-xs text-gold-400">{order.customerNote}</p>}
            <div className="mt-3">{children(order)}</div>
          </article>
        ))}
      </div>
    </section>
  );
}
