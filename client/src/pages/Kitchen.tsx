import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { getSocket } from "../socket";
import type { Order } from "../types";
import { toast } from "../components/Toast";
import { printSlip } from "../printSlip";

export function KitchenPage() {
  const [orders, setOrders] = useState<Order[]>([]);

  async function load() {
    const rows = await api<Order[]>("/api/orders?kitchen=1");
    setOrders(rows.filter((o) => o.items.some((i) => ["sent", "preparing"].includes(i.status))));
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

  const tickets = useMemo(() => orders, [orders]);

  async function setStatus(order: Order, status: string, filter: string[]) {
    const itemIds = order.items.filter((i) => filter.includes(i.status)).map((i) => i.id);
    if (!itemIds.length) return;
    await api(`/api/orders/${order.id}/item-status`, {
      method: "POST",
      body: JSON.stringify({ itemIds, status }),
    });
    toast(status === "ready" ? "Ticket ready" : "Preparing");
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {tickets.length === 0 && (
        <div className="col-span-full rounded-[28px] border border-dashed border-white/10 p-12 text-center text-cream-100/50">
          No kitchen tickets yet. Send an order from POS.
        </div>
      )}
      {tickets.map((order) => (
        <article key={order.id} className="rounded-[28px] border border-white/8 bg-ink-900 p-4 sm:p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-sage-400">
                {order.table
                  ? `Table ${order.table.number}`
                  : order.type === "delivery"
                    ? "Delivery"
                    : order.type === "takeaway"
                      ? "Takeaway"
                      : order.type}
                {order.customerName ? ` · ${order.customerName}` : ""}
              </div>
              <div className="display text-3xl">#{order.orderNo}</div>
            </div>
            <div className="text-right text-xs text-cream-100/50">
              {new Date(order.updatedAt).toLocaleTimeString()}
            </div>
          </div>
          <ul className="mt-4 space-y-2">
            {order.items
              .filter((i) => i.status !== "cancelled" && i.status !== "pending")
              .map((item) => (
                <li key={item.id} className="flex justify-between rounded-2xl bg-ink-800 px-3 py-2">
                  <span>
                    <b>{item.qty}×</b> {item.name}
                    {item.notes && <div className="text-xs text-gold-400">{item.notes}</div>}
                  </span>
                  <span className="text-xs uppercase text-sage-400">{item.status}</span>
                </li>
              ))}
          </ul>
          {order.customerNote && <p className="mt-3 text-sm text-gold-400">Note: {order.customerNote}</p>}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button
              onClick={() => void setStatus(order, "preparing", ["sent"])}
              className="rounded-2xl bg-white/5 py-2"
            >
              Preparing
            </button>
            <button
              onClick={() => void setStatus(order, "ready", ["sent", "preparing"])}
              className="rounded-2xl bg-gold-500 py-2 text-ink-950"
            >
              Ready
            </button>
            <button
              onClick={async () => {
                try {
                  const data = await api<{ content: string; print?: { status: string } }>(
                    `/api/orders/${order.id}/print-kitchen`,
                    { method: "POST" }
                  );
                  if (data.print?.status !== "printed") printSlip(`Kitchen #${order.orderNo}`, data.content);
                  toast(data.print?.status === "printed" ? "Kitchen slip printed" : "Kitchen slip ready to print");
                } catch (err) {
                  toast(err instanceof Error ? err.message : "Print failed", "err");
                }
              }}
              className="rounded-2xl bg-white/5 py-2"
            >
              Print
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
