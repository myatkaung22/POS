import { useEffect, useState } from "react";
import { api } from "../api";
import { getSocket } from "../socket";
import { money, type Order } from "../types";
import { useAuth } from "../auth";
import { toast } from "../components/Toast";
import { printSlip } from "../printSlip";
import { useActionQueue } from "../actionQueue";

export function OrdersPage() {
  const { settings, can } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const { busy, run } = useActionQueue();

  async function load() {
    setOrders(await api<Order[]>("/api/orders?take=120"));
  }

  useEffect(() => {
    void load();
    const socket = getSocket();
    socket.on("order:updated", load);
    return () => {
      socket.off("order:updated", load);
    };
  }, []);

  return (
    <div className="overflow-x-auto rounded-[28px] border border-white/10 bg-ink-900">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-ink-800 text-sage-400">
          <tr>
            <th className="px-4 py-3">Order</th>
            <th>Table</th>
            <th>Type</th>
            <th>Guest</th>
            <th>Status</th>
            <th>Total</th>
            <th>When</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-t border-white/5">
              <td className="px-4 py-3 font-medium">#{o.orderNo}</td>
              <td>{o.table ? `T${o.table.number}` : "—"}</td>
              <td className="capitalize">{o.type.replace("_", " ")}</td>
              <td>{o.customerName || "—"}</td>
              <td className="capitalize">{o.status.replace("_", " ")}</td>
              <td>{money(o.total, settings.currency)}</td>
              <td className="text-cream-100/50">{new Date(o.createdAt).toLocaleString()}</td>
              <td className="pr-4">
                {can("orders") && (
                  <button
                    disabled={busy(`bill:${o.id}`)}
                    onClick={() =>
                      void run(`bill:${o.id}`, `Printing #${o.orderNo}`, async () => {
                        const data = await api<{ content: string; order?: Order; print?: { status: string } }>(
                          `/api/orders/${o.id}/bill`,
                          { method: "POST" }
                        );
                        if (data.print?.status !== "printed") {
                          void printSlip(`${o.paidAmount ? "Receipt" : "Bill"} #${o.orderNo}`, data.content);
                        }
                        toast(data.print?.status === "printed" ? "Slip printed" : "Slip ready to print");
                      })
                    }
                    className="rounded-xl bg-white/5 px-3 py-1 disabled:opacity-40"
                  >
                    {busy(`bill:${o.id}`) ? "Printing…" : "Print"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
