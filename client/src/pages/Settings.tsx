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
  const [systemPrinters, setSystemPrinters] = useState<{ name: string; portName: string; driverName: string }[]>([]);
  const [usbName, setUsbName] = useState("");
  const [ethernetHost, setEthernetHost] = useState("");
  const [ethernetFound, setEthernetFound] = useState<{ host: string; port: number }[]>([]);
  const [discovering, setDiscovering] = useState(false);

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
    try {
      const sys = await api<{ printers: { name: string; portName: string; driverName: string }[] }>("/api/printers/system");
      setSystemPrinters(sys.printers || []);
      setUsbName((current) => current || sys.printers?.[0]?.name || "");
    } catch {
      setSystemPrinters([]);
    }
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
            <div className="display text-xl">Ethernet (no USB)</div>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-cream-100/70">
              <li>Plug the Ethernet cable into the same router as this POS PC (Wi‑Fi is fine on the PC).</li>
              <li>Power the printer on. USB can stay unplugged.</li>
              <li>Find the printer IP, or tap Scan network. Self-test: hold FEED while switching power on — the slip often prints the IP.</li>
              <li>Save, then Test print.</li>
            </ol>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                value={ethernetHost}
                onChange={(e) => setEthernetHost(e.target.value)}
                placeholder="Printer IP e.g. 192.168.1.87"
                className="min-w-[180px] flex-1 rounded-2xl bg-ink-800 px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={discovering}
                onClick={async () => {
                  setDiscovering(true);
                  try {
                    const data = await api<{ printers: { host: string; port: number }[] }>("/api/printers/discover");
                    setEthernetFound(data.printers || []);
                    if (data.printers?.[0]) setEthernetHost(data.printers[0].host);
                    toast(data.printers?.length ? `Found ${data.printers.length} printer(s)` : "No Ethernet printer found on port 9100", data.printers?.length ? "ok" : "info");
                  } catch (err) {
                    toast(err instanceof Error ? err.message : "Scan failed", "err");
                  } finally {
                    setDiscovering(false);
                  }
                }}
                className="rounded-2xl bg-white/5 px-4 py-2 text-sm"
              >
                {discovering ? "Scanning…" : "Scan network"}
              </button>
              <button
                type="button"
                disabled={!ethernetHost.trim()}
                onClick={async () => {
                  try {
                    await api("/api/printers/network-setup", {
                      method: "POST",
                      body: JSON.stringify({ host: ethernetHost.trim(), port: 9100, paperWidth: 32 }),
                    });
                    toast("Ethernet printer set for kitchen and invoices");
                    void load();
                  } catch (err) {
                    toast(err instanceof Error ? err.message : "Could not save printer", "err");
                  }
                }}
                className="rounded-2xl bg-gold-500 px-4 py-2 text-sm text-ink-950 disabled:opacity-40"
              >
                Use Ethernet for kitchen + invoices
              </button>
            </div>
            {ethernetFound.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {ethernetFound.map((p) => (
                  <button
                    key={p.host}
                    type="button"
                    onClick={() => setEthernetHost(p.host)}
                    className={`rounded-full px-3 py-1 text-xs ${ethernetHost === p.host ? "bg-gold-500 text-ink-950" : "bg-white/5"}`}
                  >
                    {p.host}:{p.port}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-cream-100/50">
              Do not plug the Ethernet cable into the PC’s Ethernet port unless you set static IPs. Use the router so
              the printer gets an address on 192.168.1.x like this POS (currently on Wi‑Fi). Port is 9100. USB is
              optional once Ethernet works.
            </p>
            <div className="display mt-5 text-xl">USB slip printer</div>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-cream-100/70">
              <li>Plug in power and turn the front switch on.</li>
              <li>Connect the USB cable to this POS computer.</li>
              <li>Wait until Windows lists the printer (often POS-80, USB, or Xprinter).</li>
              <li>Choose it below and save — it will print kitchen tickets and invoices.</li>
            </ol>
            <select
              value={usbName}
              onChange={(e) => setUsbName(e.target.value)}
              className="mt-3 w-full rounded-2xl bg-ink-800 px-3 py-2 text-sm"
            >
              <option value="">{systemPrinters.length ? "Choose Windows printer" : "No Windows printers found"}</option>
              {systemPrinters.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {p.portName ? ` · ${p.portName}` : ""}
                </option>
              ))}
            </select>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!usbName}
                onClick={async () => {
                  try {
                    await api("/api/printers/usb-setup", {
                      method: "POST",
                      body: JSON.stringify({ windowsName: usbName }),
                    });
                    toast("USB printer set for kitchen and invoices");
                    void load();
                  } catch (err) {
                    toast(err instanceof Error ? err.message : "Could not save printer", "err");
                  }
                }}
                className="rounded-2xl bg-gold-500 px-4 py-2 text-sm text-ink-950 disabled:opacity-40"
              >
                Use for kitchen + invoices
              </button>
              <button type="button" onClick={() => void load()} className="rounded-2xl bg-white/5 px-4 py-2 text-sm">
                Refresh list
              </button>
            </div>
            <p className="mt-3 text-xs text-cream-100/50">
              Your unit is a POS-58 (58mm). After it shows in the list, choose it and tap Use for kitchen + invoices,
              then Test print. If the list is empty, power the printer on and tap Refresh list.
            </p>
            {printers.map((p) => (
              <PrinterCard key={p.id} printer={p} systemPrinters={systemPrinters} onSaved={() => void load()} />
            ))}
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

function PrinterCard({
  printer,
  systemPrinters,
  onSaved,
}: {
  printer: Printer;
  systemPrinters: { name: string; portName: string; driverName: string }[];
  onSaved: () => void;
}) {
  const [connection, setConnection] = useState(printer.connection);
  const [host, setHost] = useState(printer.host);
  const [port, setPort] = useState(String(printer.port || 9100));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setConnection(printer.connection);
    setHost(printer.host);
    setPort(String(printer.port || 9100));
  }, [printer.connection, printer.host, printer.port]);

  return (
    <div className="mt-4 rounded-2xl bg-ink-800 p-4 text-sm">
      <div className="display text-lg">{printer.name}</div>
      <div className="text-cream-100/50">
        {printer.type === "kitchen" ? "Kitchen tickets" : "Bills / receipts"} · {printer.connection}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <select value={connection} onChange={(e) => setConnection(e.target.value)} className="rounded-xl bg-ink-900 px-3 py-2">
          <option value="usb">USB / Windows</option>
          <option value="network">Network (9100)</option>
        </select>
        {connection === "usb" ? (
          <select value={host} onChange={(e) => setHost(e.target.value)} className="rounded-xl bg-ink-900 px-3 py-2">
            <option value="">Windows printer</option>
            {systemPrinters.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
            {host && !systemPrinters.some((p) => p.name === host) && <option value={host}>{host}</option>}
          </select>
        ) : (
          <>
            <input value={host} onChange={(e) => setHost(e.target.value)} className="rounded-xl bg-ink-900 px-3 py-2" placeholder="IP address" />
            <input value={port} onChange={(e) => setPort(e.target.value)} className="rounded-xl bg-ink-900 px-3 py-2 sm:col-span-2" placeholder="Port" />
          </>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/api/printers/${printer.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  connection,
                  host,
                  port: Number(port || 0),
                  active: true,
                }),
              });
              toast("Printer saved");
              onSaved();
            } catch (err) {
              toast(err instanceof Error ? err.message : "Save failed", "err");
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-xl bg-white/5 px-3 py-1"
        >
          Save
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              const r = await api<{ status: string }>(`/api/printers/${printer.id}/test`, { method: "POST" });
              toast(r.status === "printed" ? "Test slip printed" : `Test ${r.status}`, r.status === "printed" ? "ok" : "info");
              onSaved();
            } catch (err) {
              toast(err instanceof Error ? err.message : "Test failed", "err");
            }
          }}
          className="rounded-xl bg-gold-500 px-3 py-1 text-ink-950"
        >
          Test print
        </button>
      </div>
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
