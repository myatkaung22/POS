import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, downloadFile } from "../api";
import { money, DEFAULT_CURRENCY } from "../types";
import { useAuth } from "../auth";
import { toast } from "../components/Toast";
import { businessDateIso, businessMonthYear, hourLabel } from "../hours";

type Period = "day" | "month" | "year";

type CategoryReport = {
  name: string;
  qty: number;
  sales: number;
  items: { name: string; sku: string; qty: number; sales: number }[];
};

type Report = {
  period: Period;
  label: string;
  start?: string;
  end?: string;
  hours?: { startHour: number; endHour: number };
  categoryFilter: string;
  categoryOptions: string[];
  summary: { totalSales: number; orderCount: number; avgTicket: number; itemCount: number };
  series: { label: string; sales: number; orders: number }[];
  categories: CategoryReport[];
  topItems: { name: string; qty: number; sales: number }[];
  payments: { method: string; amount: number }[];
  types: { type: string; amount: number }[];
};

export function ReportsPage() {
  const { settings } = useAuth();
  const startHour = Number(settings.dayStartHour || 14);
  const endHour = Number(settings.dayEndHour || 2);
  const [period, setPeriod] = useState<Period>("day");
  const [date, setDate] = useState(() => businessDateIso(new Date(), startHour, endHour));
  const [month, setMonth] = useState(() => businessMonthYear(new Date(), startHour, endHour).month);
  const [year, setYear] = useState(() => businessMonthYear(new Date(), startHour, endHour).year);
  const [category, setCategory] = useState("");
  const [data, setData] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const currency = settings.currency || DEFAULT_CURRENCY;

  const years = useMemo(() => {
    const y = businessMonthYear().year;
    const list = [];
    for (let n = y; n >= y - 5; n--) list.push(n);
    return list;
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams({ period });
    if (period === "day") params.set("date", date);
    if (period === "month") {
      params.set("month", String(month));
      params.set("year", String(year));
    }
    if (period === "year") params.set("year", String(year));
    if (category) params.set("category", category);
    return params.toString();
  }, [period, date, month, year, category]);

  useEffect(() => {
    void api<Report>(`/api/reports?${query}`).then(setData).catch((err) => toast(err instanceof Error ? err.message : "Report failed", "err"));
  }, [query]);

  async function exportExcel() {
    setBusy(true);
    try {
      await downloadFile(`/api/reports/export.xlsx?${query}`, `4-corner-report.xlsx`);
      toast("Excel report downloaded");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Export failed", "err");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div>Loading reports…</div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-cream-100/55">
        Daily close {hourLabel(data.hours?.startHour ?? startHour)} – {hourLabel(data.hours?.endHour ?? endHour)}. Overnight
        sales before close stay on that sales day.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-2">
          {(["day", "month", "year"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setPeriod(r)}
              className={`rounded-full px-4 py-1.5 capitalize ${period === r ? "bg-gold-500 text-ink-950" : "bg-ink-800"}`}
            >
              {r}
            </button>
          ))}
        </div>
        {period === "day" && (
          <label className="text-sm">
            <span className="mb-1 block text-xs text-sage-400">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-2xl bg-ink-800 px-3 py-2" />
          </label>
        )}
        {period === "month" && (
          <>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-sage-400">Month</span>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="rounded-2xl bg-ink-800 px-3 py-2">
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {new Date(2000, i, 1).toLocaleString(undefined, { month: "long" })}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-sage-400">Year</span>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-2xl bg-ink-800 px-3 py-2">
                {years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            </label>
          </>
        )}
        {period === "year" && (
          <label className="text-sm">
            <span className="mb-1 block text-xs text-sage-400">Year</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-2xl bg-ink-800 px-3 py-2">
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          <span className="mb-1 block text-xs text-sage-400">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="max-w-[220px] rounded-2xl bg-ink-800 px-3 py-2">
            <option value="">All categories</option>
            {(data.categoryOptions || []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => void exportExcel()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-2xl bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950 disabled:opacity-50"
        >
          <Download size={16} />
          {busy ? "Exporting…" : "Export Excel"}
        </button>
        <p className="w-full text-xs text-sage-400">
          Excel includes a Summary sheet plus one sheet for each category. Choose a category to export that category only.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sales" value={money(data.summary.totalSales, currency)} />
        <Stat label="Orders" value={String(data.summary.orderCount)} />
        <Stat label="Avg ticket" value={money(data.summary.avgTicket, currency)} />
        <Stat label="Items sold" value={String(data.summary.itemCount)} />
      </div>
      <div className="min-w-0 rounded-[28px] border border-white/10 bg-ink-900 p-4 sm:p-5">
        <div className="display text-xl">Sales over time · {data.label}</div>
        <div className="mt-4 h-52 min-w-0 sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" stroke="#9fbfa8" fontSize={11} interval="preserveStartEnd" />
              <YAxis stroke="#9fbfa8" fontSize={10} width={42} tickFormatter={(v) => String(Math.round(Number(v)))} />
              <Tooltip
                contentStyle={{ background: "#16241f", border: "1px solid #2e4a40", color: "#f6f1e6" }}
                formatter={(value) => money(Number(value), currency)}
              />
              <Bar dataKey="sales" fill="#d4a84b" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="By category">
          {data.categories.length === 0 && <div className="py-4 text-sm text-cream-100/45">No category sales in this period.</div>}
          {data.categories.map((c) => (
            <button
              key={c.name}
              onClick={() => setCategory(c.name === category ? "" : c.name)}
              className={`flex w-full items-center justify-between py-2 text-left text-sm ${category === c.name ? "text-gold-400" : ""}`}
            >
              <span>
                {c.name} · {c.qty}
              </span>
              <span className="text-gold-400">{money(c.sales, currency)}</span>
            </button>
          ))}
        </Card>
        <Card title="Top items">
          {data.topItems.map((i) => (
            <div key={i.name} className="flex justify-between py-2 text-sm">
              <span>
                {i.name} · {i.qty}
              </span>
              <span className="text-gold-400">{money(i.sales, currency)}</span>
            </div>
          ))}
        </Card>
      </div>
      {data.categories.map((c) => (
        <Card key={c.name} title={c.name}>
          {c.items.map((i) => (
            <div key={i.name} className="flex justify-between py-2 text-sm">
              <span>
                {i.name} · {i.qty}
              </span>
              <span className="text-gold-400">{money(i.sales, currency)}</span>
            </div>
          ))}
        </Card>
      ))}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Payments">
          {data.payments.map((i) => (
            <div key={i.method} className="flex justify-between py-2 text-sm capitalize">
              <span>{i.method || "unknown"}</span>
              <span className="text-gold-400">{money(i.amount, currency)}</span>
            </div>
          ))}
        </Card>
        <Card title="Order type">
          {data.types.map((i) => (
            <div key={i.type} className="flex justify-between py-2 text-sm capitalize">
              <span>{i.type.replace("_", " ")}</span>
              <span className="text-gold-400">{money(i.amount, currency)}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-ink-900 p-4">
      <div className="text-xs text-sage-400">{label}</div>
      <div className="display truncate text-xl sm:text-3xl">{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-ink-900 p-5">
      <div className="display text-xl">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}
