import { getSettingsMap } from "./db.ts";
import { formatMoney } from "./currency.ts";
import { buildReport, type BuiltReport } from "./reports.ts";

export type AskMessage = { role: "user" | "assistant"; content: string };

type CompactPeriod = {
  label: string;
  totalSales: number;
  orderCount: number;
  avgTicket: number;
  itemCount: number;
  topItems: { name: string; qty: number; sales: number }[];
  categories: { name: string; qty: number; sales: number }[];
  payments: { method: string; amount: number }[];
  types: { type: string; amount: number }[];
};

export type AskFacts = {
  restaurant: string;
  currency: string;
  today: CompactPeriod;
  yesterday: CompactPeriod;
  month: CompactPeriod;
  year: CompactPeriod;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function isoDay(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function compact(report: BuiltReport): CompactPeriod {
  return {
    label: report.label,
    totalSales: report.summary.totalSales,
    orderCount: report.summary.orderCount,
    avgTicket: report.summary.avgTicket,
    itemCount: report.summary.itemCount,
    topItems: report.topItems.slice(0, 5),
    categories: report.categories.slice(0, 8).map((c) => ({ name: c.name, qty: c.qty, sales: c.sales })),
    payments: report.payments,
    types: report.types,
  };
}

export async function loadAskFacts(): Promise<AskFacts> {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const settings = await getSettingsMap();
  const [today, yday, month, year] = await Promise.all([
    buildReport({ period: "day", date: isoDay(now) }),
    buildReport({ period: "day", date: isoDay(yesterday) }),
    buildReport({ period: "month", month: String(now.getMonth() + 1), year: String(now.getFullYear()) }),
    buildReport({ period: "year", year: String(now.getFullYear()) }),
  ]);
  return {
    restaurant: settings.restaurantName || "4 Corner Bar & Restaurant",
    currency: settings.currency || "฿",
    today: compact(today),
    yesterday: compact(yday),
    month: compact(month),
    year: compact(year),
  };
}

function money(n: number, currency: string) {
  return formatMoney(n, currency);
}

function ordersLabel(n: number) {
  return `${n} paid order${n === 1 ? "" : "s"}`;
}

function pickPeriod(q: string, facts: AskFacts): { key: keyof Pick<AskFacts, "today" | "yesterday" | "month" | "year">; period: CompactPeriod; title: string } {
  if (/\byesterday\b|เมื่อวาน/.test(q)) return { key: "yesterday", period: facts.yesterday, title: `yesterday (${facts.yesterday.label})` };
  if (/\bthis\s+year\b|\byear\b|ปีนี้/.test(q) && !/\btoday\b|วันนี้/.test(q)) return { key: "year", period: facts.year, title: `this year (${facts.year.label})` };
  if (/\bthis\s+month\b|\bmonthly\b|เดือนนี้/.test(q)) return { key: "month", period: facts.month, title: `this month (${facts.month.label})` };
  return { key: "today", period: facts.today, title: `today (${facts.today.label})` };
}

function lineItems(rows: { name: string; qty: number; sales: number }[], currency: string, limit = 5) {
  if (!rows.length) return "none yet";
  return rows
    .slice(0, limit)
    .map((r) => `${r.name} (${r.qty} · ${money(r.sales, currency)})`)
    .join("; ");
}

export function answerFromFacts(question: string, facts: AskFacts): string {
  const q = question.toLowerCase().trim();
  const { period, title } = pickPeriod(q, facts);
  const c = facts.currency;

  const wantsOrders = /\border|ticket|cover|บิล|ออเดอร์/.test(q) && !/\bsale|sales|revenue|ยอด/.test(q);
  const wantsTop = /\btop|best|best[- ]?sell|popular|ขายดี/.test(q);
  const wantsCategory = /\bcategor/.test(q) || facts.today.categories.some((cat) => cat.name && q.includes(cat.name.toLowerCase()));
  const wantsAvg = /\baverage|avg\b|ticket/.test(q);
  const wantsPay = /\bpay|cash|card|qr|prompt/.test(q);
  const namedCategory = [...facts.today.categories, ...facts.month.categories].find((cat) => cat.name && q.includes(cat.name.toLowerCase()));

  if (namedCategory && wantsCategory) {
    const row = period.categories.find((cat) => cat.name === namedCategory.name);
    if (row) {
      return `${namedCategory.name} ${title}: ${money(row.sales, c)} from ${row.qty} item${row.qty === 1 ? "" : "s"}.`;
    }
  }

  if (wantsTop) {
    const top = wantsCategory ? period.categories : period.topItems;
    const kind = wantsCategory ? "categories" : "items";
    return `Top ${kind} ${title}: ${lineItems(top, c)}. Total sales ${money(period.totalSales, c)} from ${ordersLabel(period.orderCount)}.`;
  }

  if (wantsAvg) {
    return `Average ticket ${title} is ${money(period.avgTicket, c)} across ${ordersLabel(period.orderCount)} (${money(period.totalSales, c)} total).`;
  }

  if (wantsPay) {
    const pays = period.payments.map((p) => `${p.method || "unknown"} ${money(p.amount, c)}`).join(", ") || "none yet";
    return `Payments ${title}: ${pays}.`;
  }

  if (wantsOrders) {
    return `${ordersLabel(period.orderCount)} ${title}, ${period.itemCount} items, ${money(period.totalSales, c)} in sales.`;
  }

  if (/\bsale|sales|revenue|takings|total|today|tonight|month|year|ยอด|วันนี้|เดือน|เท่าไหร่|เท่าไร/.test(q)) {
    return `Total sales ${title}: ${money(period.totalSales, c)} · ${ordersLabel(period.orderCount)} · avg ticket ${money(period.avgTicket, c)}. Top item: ${period.topItems[0] ? `${period.topItems[0].name} ${money(period.topItems[0].sales, c)}` : "none yet"}.`;
  }

  return `I can answer sales questions from this POS. Try “today total sale”, “this month sales”, or “top selling items”. ${title} is ${money(period.totalSales, c)} from ${ordersLabel(period.orderCount)}.`;
}

type HostedResult = { answer: string; source: string } | null;

async function hostedChat(url: string, apiKey: string | undefined, model: string, question: string, facts: AskFacts, history: AskMessage[]): Promise<HostedResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 350,
      referrer: "omnimind-pos",
      messages: [
        {
          role: "system",
          content: `You are OmniMind, the POS assistant for ${facts.restaurant}. Answer only from this JSON. Use ${facts.currency} amounts. Be short. If the question is not about these numbers, say you only answer sales questions.\n${JSON.stringify(facts)}`,
        },
        ...history.slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 800) })),
        { role: "user", content: question.slice(0, 500) },
      ],
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`hosted ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("empty hosted answer");
  return { answer, source: url };
}

function isHostError(text: string) {
  return /api key|budget|rate limit|quota|unauthorized|raise the key/i.test(text);
}

export async function answerQuestion(question: string, history: AskMessage[] = []): Promise<{ answer: string; source: "groq" | "pollinations" | "local" }> {
  const q = question.trim();
  if (!q) throw Object.assign(new Error("Ask a question"), { status: 400 });
  const facts = await loadAskFacts();
  const local = answerFromFacts(q, facts);

  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (groqKey) {
    try {
      const hosted = await hostedChat(
        "https://api.groq.com/openai/v1/chat/completions",
        groqKey,
        process.env.GROQ_MODEL || "llama-3.1-8b-instant",
        q,
        facts,
        history
      );
      if (hosted && !isHostError(hosted.answer)) return { answer: hosted.answer, source: "groq" };
    } catch {
      /* local totals stay the source of truth */
    }
  }

  if (process.env.ASK_FREE_HOST === "1") {
    try {
      const hosted = await hostedChat(
        process.env.ASK_API_URL || "https://text.pollinations.ai/openai",
        process.env.ASK_API_KEY,
        process.env.ASK_MODEL || "openai",
        q,
        facts,
        history
      );
      if (hosted && !isHostError(hosted.answer)) return { answer: hosted.answer, source: "pollinations" };
    } catch {
      /* ignore */
    }
  }

  return { answer: local, source: "local" };
}
