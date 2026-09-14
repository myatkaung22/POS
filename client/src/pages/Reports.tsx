import { useEffect, useState, type ReactNode } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { money, DEFAULT_CURRENCY } from "../types";
import { useAuth } from "../auth";

type Report = {
  range: string;
  summary: { totalSales: number; orderCount: number; avgTicket: number; itemCount: number };
  series: { label: string; sales: number; orders: number }[];
  topItems: { name: string; qty: number; sales: number }[];
  payments: { method: string; amount: number }[];
  types: { type: string; amount: number }[];
};

export function ReportsPage() {
  const { settings } = useAuth();
  const [range, setRange] = useState<"daily" | "weekly" | "monthly">("daily");
  const [data, setData] = useState<Report | null>(null);
  const currency = settings.currency || DEFAULT_CURRENCY;

  useEffect(() => {
    void api<Report>(`/api/reports?range=${range}`).then(setData);
  }, [range]);

  if (!data) return <div>Loading reports…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["daily", "weekly", "monthly"] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`rounded-full px-4 py-1.5 capitalize ${range === r ? "bg-gold-500 text-ink-950" : "bg-ink-800"}`}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sales" value={money(data.summary.totalSales, currency)} />
        <Stat label="Orders" value={String(data.summary.orderCount)} />
        <Stat label="Avg ticket" value={money(data.summary.avgTicket, currency)} />
        <Stat label="Items sold" value={String(data.summary.itemCount)} />
      </div>
      <div className="min-w-0 rounded-[28px] border border-white/10 bg-ink-900 p-4 sm:p-5">
        <div className="display text-xl">Sales over time</div>
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
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Top items">
          {data.topItems.map((i) => (
            <div key={i.name} className="flex justify-between py-2 text-sm">
              <span>{i.name} · {i.qty}</span>
              <span className="text-gold-400">{money(i.sales, currency)}</span>
            </div>
          ))}
        </Card>
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
