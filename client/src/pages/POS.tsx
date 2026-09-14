import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, Minus, Plus, Printer, Send, Trash2 } from "lucide-react";
import { api } from "../api";
import { getSocket } from "../socket";
import { useAuth } from "../auth";
import { toast } from "../components/Toast";
import { useQrAlerts } from "../alerts";
import { money, DEFAULT_CURRENCY, type Category, type DiningTable, type Order, type Promotion } from "../types";
import { DishPhoto } from "../components/DishPhoto";
import { printSlip } from "../printSlip";

export function PosPage() {
  const { settings, can } = useAuth();
  const { alerts, dismiss } = useQrAlerts();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [menu, setMenu] = useState<Category[]>([]);
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [categoryId, setCategoryId] = useState<string>("all");
  const [note, setNote] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [method, setMethod] = useState("cash");
  const [tender, setTender] = useState("");
  const [discountType, setDiscountType] = useState("none");
  const [discountValue, setDiscountValue] = useState("0");
  const [promoId, setPromoId] = useState("");
  const [paid, setPaid] = useState<Order | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestAddress, setGuestAddress] = useState("");

  const tableId = params.get("table") || "";
  const type = params.get("type") || "";
  const existingId = params.get("order") || "";
  const currency = settings.currency || DEFAULT_CURRENCY;
  const offPrem = type === "takeaway" || type === "delivery" || order?.type === "takeaway" || order?.type === "delivery";

  async function loadTables() {
    setTables(await api<DiningTable[]>("/api/tables"));
  }

  async function loadBase() {
    const [t, m, p] = await Promise.all([
      api<DiningTable[]>("/api/tables"),
      api<Category[]>("/api/menu"),
      api<Promotion[]>("/api/promotions"),
    ]);
    setTables(t);
    setMenu(m);
    setPromos(p.filter((x) => x.active));
  }

  async function openOrder(id = tableId, orderType = type) {
    const created = await api<Order>("/api/orders", {
      method: "POST",
      body: JSON.stringify({ tableId: id || undefined, type: orderType || (id ? "dine_in" : "takeaway") }),
    });
    setOrder(created);
    setPaid(null);
    setDiscountType(created.discountType);
    setDiscountValue(String(created.discountValue));
    setPromoId(created.promotionId || "");
    setGuestName(created.customerName || "");
    setGuestPhone(created.customerPhone || "");
    setGuestAddress(created.deliveryAddress || "");
  }

  useEffect(() => {
    void loadBase();
  }, []);

  useEffect(() => {
    if (existingId) {
      void api<Order>(`/api/orders/${existingId}`).then((row) => {
        setOrder(row);
        setPaid(null);
        setDiscountType(row.discountType);
        setDiscountValue(String(row.discountValue));
        setPromoId(row.promotionId || "");
        setGuestName(row.customerName || "");
        setGuestPhone(row.customerPhone || "");
        setGuestAddress(row.deliveryAddress || "");
      });
      return;
    }
    if (tableId || type === "takeaway" || type === "delivery") void openOrder();
    else setOrder(null);
  }, [tableId, type, existingId]);

  useEffect(() => {
    const socket = getSocket();
    const onOrder = (next: Order) => {
      setOrder((prev) => (prev && next.id === prev.id ? next : prev));
    };
    const refresh = () => void loadTables();
    socket.on("order:updated", onOrder);
    socket.on("table:updated", refresh);
    socket.on("pos:qr-order", refresh);
    return () => {
      socket.off("order:updated", onOrder);
      socket.off("table:updated", refresh);
      socket.off("pos:qr-order", refresh);
    };
  }, []);

  const items = useMemo(() => {
    const all = menu.flatMap((c) => c.items.map((i) => ({ ...i, categoryName: c.name })));
    return categoryId === "all" ? all : all.filter((i) => i.categoryId === categoryId);
  }, [menu, categoryId]);

  const pendingGuest = order?.items.filter((i) => i.status === "pending") || [];
  const tableAlerts = alerts.filter((a) => a.tableId && a.tableId !== tableId);

  function selectTable(id: string) {
    if (!id) navigate("/pos?type=takeaway");
    else navigate(`/pos?table=${id}`);
  }

  function selectOffPrem(kind: "takeaway" | "delivery") {
    navigate(`/pos?type=${kind}`);
  }

  async function addItem(menuItemId: string) {
    if (!order || ["completed", "cancelled"].includes(order.status)) return;
    const next = await api<Order>(`/api/orders/${order.id}/items`, {
      method: "POST",
      body: JSON.stringify({ menuItemId, notes: note }),
    });
    setOrder(next);
    setNote("");
  }

  async function setQty(itemId: string, qty: number) {
    if (!order) return;
    const next = await api<Order>(`/api/orders/${order.id}/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ qty }),
    });
    setOrder(next);
  }

  async function saveGuest() {
    if (!order) return;
    const next = await api<Order>(`/api/orders/${order.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        customerName: guestName,
        customerPhone: guestPhone,
        deliveryAddress: guestAddress,
        customerNote: order.customerNote,
      }),
    });
    setOrder(next);
  }

  async function applyPricing() {
    if (!order) return;
    const next = await api<Order>(`/api/orders/${order.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        discountType,
        discountValue: Number(discountValue),
        promotionId: discountType === "promotion" ? promoId : null,
        customerNote: order.customerNote,
      }),
    });
    setOrder(next);
    toast("Pricing updated");
  }

  async function sendKitchen() {
    if (!order) return;
    if (order.type === "delivery" && !guestAddress.trim()) {
      toast("Add a delivery address first", "err");
      return;
    }
    await saveGuest();
    try {
      const data = await api<{ order: Order; print: { status: string }; content: string }>(`/api/orders/${order.id}/send-kitchen`, {
        method: "POST",
      });
      setOrder(data.order);
      alerts.filter((a) => a.orderId === order.id).forEach((a) => dismiss(a.id));
      if (data.content && data.print?.status !== "printed") {
        printSlip(`Kitchen #${data.order.orderNo}`, data.content);
      }
      toast(data.print?.status === "printed" ? "Kitchen slip printed" : "Kitchen slip ready to print", "info");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed", "err");
    }
  }

  async function printBill() {
    if (!order) return;
    try {
      const data = await api<{ order: Order; print: { status: string }; content: string }>(`/api/orders/${order.id}/bill`, {
        method: "POST",
      });
      setOrder(data.order);
      if (data.print?.status !== "printed") printSlip(`Bill #${data.order.orderNo}`, data.content);
      toast(data.print?.status === "printed" ? "Bill sent to slip printer" : "Bill slip ready to print");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Print failed", "err");
    }
  }

  async function pay() {
    if (!order) return;
    const paidAmount = method === "cash" ? Number(tender || order.total) : order.total;
    const data = await api<{ order: Order; print: { status: string }; content?: string }>(`/api/orders/${order.id}/pay`, {
      method: "POST",
      body: JSON.stringify({ paymentMethod: method, paidAmount }),
    });
    setPaid(data.order);
    setOrder(data.order);
    setPayOpen(false);
    void loadTables();
    if (data.content && data.print?.status !== "printed") {
      printSlip(`Receipt #${data.order.orderNo}`, data.content);
    }
    toast(offPrem ? "Paid · check Pickup board" : "Paid · table is free");
  }

  const table = tables.find((t) => t.id === (order?.tableId || tableId));
  const locked = !order || ["completed", "cancelled"].includes(order.status);
  const step = !order ? 0 : pendingGuest.length ? 1 : order.status === "open" ? 1 : 2;

  return (
    <div className="flex min-h-0 flex-col gap-4 lg:grid lg:h-[calc(100dvh-7.25rem)] lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
      <section className="flex min-h-0 flex-col rounded-[28px] border border-white/8 bg-ink-900">
        <div className="border-b border-white/5 p-3">
          <div className="mb-2 flex flex-col gap-1 px-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[11px] tracking-[0.16em] text-sage-400 uppercase">Tables</div>
            <div className="flex gap-3 text-[11px] text-cream-100/45">
              <span className="text-sage-400">Free</span>
              <span className="text-gold-400">Seated</span>
              <span className="text-sky-300">Guest order</span>
            </div>
          </div>
            <div className="flex gap-2 overflow-auto pb-1">
            <TableChip
              label="Takeaway"
              hint="pickup"
              active={!tableId && type === "takeaway"}
              tone="neutral"
              onClick={() => selectOffPrem("takeaway")}
            />
            <TableChip
              label="Delivery"
              hint="drop-off"
              active={!tableId && type === "delivery"}
              tone="guest"
              onClick={() => selectOffPrem("delivery")}
            />
            {tables.map((t) => {
              const open = t.orders?.[0];
              const guest = Boolean(open?.items.some((i) => i.status === "pending"));
              const tone = guest ? "guest" : t.status === "occupied" || t.status === "billing" ? "seated" : "free";
              return (
                <TableChip
                  key={t.id}
                  label={`T${t.number}`}
                  hint={guest ? "NEW" : t.status === "available" ? "free" : "seated"}
                  active={tableId === t.id}
                  tone={tone}
                  onClick={() => selectTable(t.id)}
                />
              );
            })}
          </div>
        </div>
        {tableAlerts.length > 0 && (
          <div className="flex gap-2 overflow-auto border-b border-sky-400/20 bg-sky-400/8 px-3 py-2">
            {tableAlerts.map((a) => (
              <button
                key={a.id}
                onClick={() => selectTable(a.tableId)}
                className="rounded-full bg-sky-400 px-3 py-1 text-xs font-medium text-ink-950"
              >
                Guest · T{a.tableNumber} · {a.items.reduce((n, i) => n + i.qty, 0)} items
              </button>
            ))}
          </div>
        )}
        {pendingGuest.length > 0 && order && (
          <div className="flex flex-col items-start gap-2 border-b border-sky-400/20 bg-sky-400/10 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <span className="text-sky-300">
              Guest added {pendingGuest.reduce((n, i) => n + i.qty, 0)} item{pendingGuest.length === 1 ? "" : "s"} — send to kitchen
            </span>
            <button onClick={() => void sendKitchen()} className="rounded-full bg-sky-400 px-3 py-1 text-xs font-semibold text-ink-950">
              Send now
            </button>
          </div>
        )}
        <div className="flex gap-2 overflow-auto border-b border-white/5 px-3 py-2">
          <Chip active={categoryId === "all"} onClick={() => setCategoryId("all")}>
            All
          </Chip>
          {menu.map((c) => (
            <Chip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
              {c.name}
            </Chip>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {!order && (
            <div className="mb-3 rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-cream-100/50">
              Pick a table, Takeaway, or Delivery to start a ticket.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 2xl:grid-cols-4">
            {items.map((item) => (
              <button
                key={item.id}
                disabled={!item.available || locked}
                onClick={() => void addItem(item.id)}
                className="rounded-[22px] border border-white/8 bg-ink-800 p-2.5 text-left transition hover:border-gold-400/50 hover:bg-ink-700 disabled:opacity-35"
              >
                <DishPhoto item={item} className="mb-2 aspect-[4/3] w-full rounded-2xl" />
                <div className="flex items-start justify-between gap-2 px-1">
                  <div className="min-w-0 font-medium leading-snug">{item.name}</div>
                  <span className="shrink-0 text-sm text-gold-400">{money(item.price, currency)}</span>
                </div>
                <div className="mt-0.5 line-clamp-2 px-1 text-xs text-cream-100/45">{item.description}</div>
              </button>
            ))}
          </div>
        </div>
      </section>

      <aside className="flex min-h-0 flex-col rounded-[28px] border border-white/8 bg-ink-900">
        <div className="border-b border-white/5 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] tracking-[0.16em] text-sage-400 uppercase">
                {table
                  ? `Table ${table.number} · ${table.name}`
                  : order?.type === "delivery" || type === "delivery"
                    ? "Delivery"
                    : order?.type === "takeaway" || type === "takeaway"
                      ? "Takeaway pickup"
                      : "No ticket"}
              </div>
              <div className="display text-2xl leading-none sm:text-3xl">#{order?.orderNo || "—"}</div>
            </div>
            {order && <StatusPill status={order.status} guest={pendingGuest.length > 0} />}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1 text-center text-[11px]">
            {["Add", "Kitchen", "Pay"].map((label, i) => (
              <div
                key={label}
                className={`rounded-full py-1 ${i < step ? "bg-gold-500/20 text-gold-400" : "bg-white/5 text-cream-100/35"}`}
              >
                {i + 1} {label}
              </div>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {!order?.items.length && (
            <div className="px-2 py-10 text-center text-sm text-cream-100/40">Tap dishes to build the guest check.</div>
          )}
          {offPrem && order && (
            <div className="mb-3 space-y-2 rounded-2xl bg-ink-800 p-3">
              <div className="text-[11px] tracking-[0.16em] text-sky-300 uppercase">
                {order.type === "delivery" ? "Delivery details" : "Pickup guest"}
              </div>
              <input
                className="w-full rounded-xl bg-ink-900 px-3 py-2 text-sm outline-none"
                placeholder="Guest name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onBlur={() => void saveGuest()}
              />
              <input
                className="w-full rounded-xl bg-ink-900 px-3 py-2 text-sm outline-none"
                placeholder="Phone"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                onBlur={() => void saveGuest()}
              />
              {order.type === "delivery" && (
                <textarea
                  className="w-full rounded-xl bg-ink-900 px-3 py-2 text-sm outline-none"
                  rows={2}
                  placeholder="Delivery address"
                  value={guestAddress}
                  onChange={(e) => setGuestAddress(e.target.value)}
                  onBlur={() => void saveGuest()}
                />
              )}
            </div>
          )}
          {order?.items.map((item) => (
            <div
              key={item.id}
              className={`mb-2 rounded-2xl p-3 ${item.status === "pending" ? "bg-sky-400/10 ring-1 ring-sky-400/30" : "bg-ink-800"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{item.name}</div>
                  <div className="text-xs text-cream-100/45">
                    {money(item.price, currency)}
                    {item.status === "pending" ? " · new" : ` · ${item.status}`}
                    {item.notes ? ` · ${item.notes}` : ""}
                  </div>
                </div>
                {!locked && (
                  <button onClick={() => void setQty(item.id, 0)} className="text-rose-400">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button disabled={locked} onClick={() => void setQty(item.id, item.qty - 1)} className="rounded-lg bg-white/5 p-1">
                  <Minus size={14} />
                </button>
                <span className="w-6 text-center tabular-nums">{item.qty}</span>
                <button disabled={locked} onClick={() => void setQty(item.id, item.qty + 1)} className="rounded-lg bg-white/5 p-1">
                  <Plus size={14} />
                </button>
                <span className="ml-auto text-sm tabular-nums">{money(item.price * item.qty, currency)}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-2 border-t border-white/5 p-4 text-sm">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note for the next item"
            className="w-full rounded-xl bg-ink-800 px-3 py-2 text-sm outline-none"
            disabled={locked}
          />
          <div className="grid grid-cols-2 gap-2">
            <select value={discountType} onChange={(e) => setDiscountType(e.target.value)} className="rounded-xl bg-ink-800 px-2 py-2" disabled={locked}>
              <option value="none">No discount</option>
              {can("discount") && <option value="percent">% off</option>}
              {can("discount") && <option value="fixed">฿ off</option>}
              <option value="promotion">Promotion</option>
            </select>
            {discountType === "promotion" ? (
              <select value={promoId} onChange={(e) => setPromoId(e.target.value)} className="rounded-xl bg-ink-800 px-2 py-2" disabled={locked}>
                <option value="">Select promo</option>
                {promos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                className="rounded-xl bg-ink-800 px-2 py-2"
                disabled={locked || discountType === "none"}
              />
            )}
          </div>
          <button disabled={locked} onClick={() => void applyPricing()} className="w-full rounded-xl bg-white/5 py-2 disabled:opacity-40">
            Apply discount / promo
          </button>
          <Row label="Subtotal" value={money(order?.subtotal || 0, currency)} />
          {Boolean(order?.discountAmount) && <Row label="Discount" value={`-${money(order?.discountAmount || 0, currency)}`} />}
          <Row label={`Tax ${order?.taxRate || 0}%`} value={money(order?.taxAmount || 0, currency)} />
          {Boolean(order?.serviceAmount) && <Row label="Service" value={money(order?.serviceAmount || 0, currency)} />}
          <Row label="Due" value={money(order?.total || 0, currency)} big />
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              disabled={locked || !pendingGuest.length}
              onClick={() => void sendKitchen()}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-sage-500/20 py-2.5 text-sage-400 disabled:opacity-35"
            >
              <Send size={16} /> Kitchen
            </button>
            <button disabled={!order} onClick={() => void printBill()} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white/5 py-2.5">
              <Printer size={16} /> Print bill
            </button>
            {can("checkout") && !locked && (
              <button
                disabled={!order?.items.length}
                onClick={() => {
                  if (order?.type === "delivery" && !guestAddress.trim()) {
                    toast("Add a delivery address first", "err");
                    return;
                  }
                  setPayOpen(true);
                }}
                className="col-span-2 rounded-2xl bg-gold-500 py-3 font-medium text-ink-950 disabled:opacity-40"
              >
                {offPrem ? "Checkout" : "Checkout · free table"}
              </button>
            )}
          </div>
        </div>
      </aside>

      {payOpen && order && (
        <div className="fixed inset-0 z-[60] grid place-items-end bg-black/65 p-3 sm:place-items-center sm:p-4">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-ink-900 p-5 sm:p-6">
            <div className="text-xs tracking-[0.16em] text-sage-400 uppercase">Charge & clear table</div>
            <div className="display text-3xl">{money(order.total, currency)}</div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {["cash", "card", "qr"].map((m) => (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  className={`rounded-2xl py-3 capitalize ${method === m ? "bg-gold-500 text-ink-950" : "bg-ink-800"}`}
                >
                  {m}
                </button>
              ))}
            </div>
            {method === "cash" && (
              <input
                className="mt-4 w-full rounded-2xl bg-ink-800 px-4 py-3 outline-none"
                placeholder="Cash tendered"
                value={tender}
                onChange={(e) => setTender(e.target.value)}
              />
            )}
            <div className="mt-2 text-sm text-sage-400">
              Change {money(Math.max(Number(tender || order.total) - order.total, 0), currency)}
            </div>
            <p className="mt-2 text-xs text-cream-100/45">
              {offPrem
                ? "Prints a receipt. The order stays on Pickup & delivery until collected or delivered."
                : "Prints a receipt, opens the cash drawer on cash, and sets the table back to free."}
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setPayOpen(false)} className="flex-1 rounded-2xl bg-white/5 py-3">
                Back
              </button>
              <button onClick={() => void pay()} className="flex-1 rounded-2xl bg-gold-500 py-3 font-medium text-ink-950">
                <Printer size={16} className="mr-1 inline" /> Pay
              </button>
            </div>
          </div>
        </div>
      )}

      {paid && (paid.status === "completed" || paid.status === "paid") && (
        <div className="fixed inset-0 z-[60] grid place-items-end bg-black/65 p-3 sm:place-items-center sm:p-4">
          <div className="w-full max-w-sm rounded-3xl border border-sage-400/30 bg-ink-900 p-5 text-center sm:p-6">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-sage-500/20 text-sage-400">
              <Check size={22} />
            </div>
            <div className="display mt-3 text-2xl">
              {paid.type === "takeaway" || paid.type === "delivery" ? "Paid · check Pickup" : "Paid · table free"}
            </div>
            <p className="mt-1 text-sm text-cream-100/60">
              #{paid.orderNo} · {money(paid.total, currency)}
              {paid.changeAmount ? ` · change ${money(paid.changeAmount, currency)}` : ""}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setPaid(null);
                  setOrder(null);
                  navigate(paid.type === "takeaway" || paid.type === "delivery" ? "/dispatch" : "/tables");
                }}
                className="rounded-2xl bg-white/5 py-3"
              >
                {paid.type === "takeaway" || paid.type === "delivery" ? "Pickup board" : "Floor"}
              </button>
              <button
                onClick={() => {
                  setPaid(null);
                  setOrder(null);
                  navigate("/pos");
                }}
                className="rounded-2xl bg-gold-500 py-3 text-ink-950"
              >
                New ticket
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TableChip({
  label,
  hint,
  active,
  tone,
  onClick,
}: {
  label: string;
  hint?: string;
  active: boolean;
  tone: "free" | "seated" | "guest" | "neutral";
  onClick: () => void;
}) {
  const tones = {
    free: "border-sage-400/30 text-sage-400",
    seated: "border-gold-400/40 text-gold-400",
    guest: "pulse-ring border-sky-400/50 bg-sky-400/15 text-sky-300",
    neutral: "border-white/10 text-cream-100/70",
  };
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-2xl border px-3 py-2 text-left ${tones[tone]} ${active ? "bg-white/10 ring-1 ring-gold-400/60" : ""}`}
    >
      <div className="text-sm font-medium">{label}</div>
      {hint && <div className="text-[10px] uppercase tracking-wide opacity-80">{hint}</div>}
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm whitespace-nowrap ${active ? "bg-gold-500 text-ink-950" : "bg-ink-800 text-cream-100/70"}`}
    >
      {children}
    </button>
  );
}

function Row({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className={`flex justify-between ${big ? "display text-xl text-gold-400" : "text-cream-100/65"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function StatusPill({ status, guest }: { status: string; guest: boolean }) {
  const label = guest ? "Guest order" : status === "in_kitchen" ? "In kitchen" : status === "completed" ? "Paid" : status;
  const cls = guest
    ? "bg-sky-400/15 text-sky-300"
    : status === "completed"
      ? "bg-sage-500/15 text-sage-400"
      : "bg-gold-500/15 text-gold-400";
  return <span className={`rounded-full px-2.5 py-1 text-[11px] tracking-wide uppercase ${cls}`}>{label}</span>;
}
