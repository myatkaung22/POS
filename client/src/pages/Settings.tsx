import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { toast } from "../components/Toast";
import type { Printer, PrintJob, Promotion, AuthUser } from "../types";

export function SettingsPage() {
  const { settings, refresh, can } = useAuth();
  const [form, setForm] = useState(settings);
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [tab, setTab] = useState("restaurant");

  useEffect(() => setForm(settings), [settings]);

  async function load() {
    const [p, pr, u] = await Promise.all([
      api<Promotion[]>("/api/promotions"),
      api<{ printers: Printer[]; jobs: PrintJob[] }>("/api/printers"),
      can("users") ? api<AuthUser[]>("/api/users") : Promise.resolve([]),
    ]);
    setPromos(p);
    setPrinters(pr.printers);
    setJobs(pr.jobs);
    setUsers(u);
  }

  useEffect(() => {
    void load();
  }, []);

  const field = (id: string, label: string) => (
    <label className="block text-sm">
      <span className="text-sage-400">{label}</span>
      <input
        className="mt-1 w-full rounded-2xl bg-ink-800 px-3 py-2"
        value={form[id] || ""}
        onChange={(e) => setForm({ ...form, [id]: e.target.value })}
      />
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {["restaurant", "pricing", "promotions", "printers", ...(can("users") ? ["users"] : [])].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 capitalize ${tab === t ? "bg-gold-500 text-ink-950" : "bg-ink-800"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "restaurant" && (
        <Card>
          <div className="grid gap-3 md:grid-cols-2">
            {field("restaurantName", "Restaurant name")}
            {field("phone", "Phone")}
            {field("address", "Address")}
            {field("currency", "Currency symbol (฿)")}
            {field("publicUrl", "Public URL for QR (LAN address phones can open)")}
            {field("footerNote", "Receipt footer")}
          </div>
          <Save
            onClick={async () => {
              await api("/api/settings", { method: "PUT", body: JSON.stringify(form) });
              await refresh();
              toast("Settings saved");
            }}
          />
        </Card>
      )}
      {tab === "pricing" && (
        <Card>
          <p className="mb-3 text-sm text-cream-100/60">
            Tax and service apply to (subtotal − discount). Promotions can replace a custom discount on a ticket.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {field("taxRate", "Tax %")}
            {field("serviceRate", "Service charge %")}
          </div>
          <Save
            onClick={async () => {
              await api("/api/settings", { method: "PUT", body: JSON.stringify(form) });
              await refresh();
              toast("Pricing defaults saved");
            }}
          />
        </Card>
      )}
      {tab === "promotions" && (
        <Card>
          <PromoForm
            onCreate={async (body) => {
              await api("/api/promotions", { method: "POST", body: JSON.stringify(body) });
              void load();
            }}
          />
          <div className="mt-4 divide-y divide-white/5">
            {promos.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-cream-100/50">
                    {p.type} {p.value} · min {p.minOrder} · {p.active ? "active" : "off"}
                  </div>
                </div>
                <button
                  onClick={async () => {
                    await api(`/api/promotions/${p.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ active: !p.active }),
                    });
                    void load();
                  }}
                  className="rounded-xl bg-white/5 px-3 py-1"
                >
                  Toggle
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}
      {tab === "printers" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            {printers.map((p) => (
              <div key={p.id} className="mb-4 rounded-2xl bg-ink-800 p-4 text-sm">
                <div className="display text-lg">{p.name}</div>
                <div className="text-cream-100/50">
                  {p.type} · {p.host}:{p.port} · drawer {p.cashDrawerEnabled ? "yes" : "no"}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={async () => {
                      const r = await api<{ status: string; job: PrintJob }>(`/api/printers/${p.id}/test`, {
                        method: "POST",
                      });
                      toast(`Test ${r.status}`);
                      void load();
                    }}
                    className="rounded-xl bg-gold-500 px-3 py-1 text-ink-950"
                  >
                    Test print
                  </button>
                  {p.type === "receipt" && (
                    <button
                      onClick={async () => {
                        const r = await api<{ status: string }>("/api/printers/drawer", { method: "POST" });
                        toast(`Drawer ${r.status}`);
                        void load();
                      }}
                      className="rounded-xl bg-white/5 px-3 py-1"
                    >
                      Kick drawer
                    </button>
                  )}
                </div>
              </div>
            ))}
            <p className="text-xs text-cream-100/50">
              Bills, receipts, and kitchen tickets print as 80mm slip format. Point kitchen and receipt printers at
              ESC/POS Ethernet devices (port 9100). USB slip printers can use the browser print dialog (choose POS-80 /
              80mm). A cash drawer should be plugged into the receipt printer RJ11 port. If a network printer is
              offline, the slip still opens for printing and is stored in the print log.
            </p>
          </Card>
          <Card>
            <div className="display text-xl">Print log</div>
            <div className="mt-3 max-h-[520px] space-y-3 overflow-auto">
              {jobs.map((j) => (
                <pre key={j.id} className="whitespace-pre-wrap rounded-2xl bg-ink-800 p-3 text-xs">
                  <div className="mb-1 text-gold-400">
                    {j.title} · {j.status}
                    {j.error ? ` · ${j.error}` : ""}
                  </div>
                  {j.content}
                </pre>
              ))}
            </div>
          </Card>
        </div>
      )}
      {tab === "users" && (
        <Card>
          <UserForm
            onCreate={async (body) => {
              await api("/api/users", { method: "POST", body: JSON.stringify(body) });
              toast("User created");
              void load();
            }}
          />
          <div className="mt-4 divide-y divide-white/5">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <div className="font-medium">{u.name}</div>
                  <div className="text-cream-100/50">
                    {u.email} · {u.role}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-[28px] border border-white/10 bg-ink-900 p-5">{children}</div>;
}

function Save({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="mt-4 rounded-2xl bg-gold-500 px-5 py-2 text-ink-950">
      Save
    </button>
  );
}

function PromoForm({ onCreate }: { onCreate: (body: object) => Promise<void> }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("percent");
  const [value, setValue] = useState("10");
  const [minOrder, setMinOrder] = useState("0");
  return (
    <div className="grid gap-2 md:grid-cols-5">
      <input className="rounded-2xl bg-ink-800 px-3 py-2 md:col-span-2" placeholder="Promo name" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="rounded-2xl bg-ink-800 px-3 py-2" value={type} onChange={(e) => setType(e.target.value)}>
        <option value="percent">Percent</option>
        <option value="fixed">Fixed</option>
      </select>
      <input className="rounded-2xl bg-ink-800 px-3 py-2" value={value} onChange={(e) => setValue(e.target.value)} />
      <button
        onClick={() => void onCreate({ name, type, value: Number(value), minOrder: Number(minOrder) })}
        className="rounded-2xl bg-gold-500 text-ink-950"
      >
        Add
      </button>
      <input className="rounded-2xl bg-ink-800 px-3 py-2 md:col-span-5" placeholder="Minimum order (฿)" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
    </div>
  );
}

function UserForm({ onCreate }: { onCreate: (body: object) => Promise<void> }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("pass123");
  const [role, setRole] = useState("waiter");
  const [pin, setPin] = useState("");
  return (
    <div className="grid gap-2 md:grid-cols-5">
      <input className="rounded-2xl bg-ink-800 px-3 py-2" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="rounded-2xl bg-ink-800 px-3 py-2" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="rounded-2xl bg-ink-800 px-3 py-2" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <select className="rounded-2xl bg-ink-800 px-3 py-2" value={role} onChange={(e) => setRole(e.target.value)}>
        {["admin", "manager", "cashier", "waiter", "kitchen"].map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      <button
        onClick={() => void onCreate({ name, email, password, role, pin })}
        className="rounded-2xl bg-gold-500 text-ink-950"
      >
        Add staff
      </button>
      <input className="rounded-2xl bg-ink-800 px-3 py-2 md:col-span-5" placeholder="Optional PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
    </div>
  );
}
