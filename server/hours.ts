export type HoursConfig = {
  startHour: number;
  endHour: number;
};

export type ReportPeriod = "day" | "month" | "year";

export type PeriodQuery = {
  period?: string;
  date?: string;
  month?: string;
  year?: string;
};

function clampHour(n: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(23, Math.max(0, Math.trunc(n)));
}

export function hoursFromSettings(settings: Record<string, string> = {}): HoursConfig {
  return {
    startHour: clampHour(Number(settings.dayStartHour), 14),
    endHour: clampHour(Number(settings.dayEndHour), 2),
  };
}

export function padHour(n: number) {
  return String(n).padStart(2, "0");
}

export function dateKey(year: number, month: number, day: number) {
  return `${year}-${padHour(month)}-${padHour(day)}`;
}

export function parseDateKey(value?: string | null) {
  const parts = String(value || "").split("-").map(Number);
  if (parts.length === 3 && parts.every((p) => Number.isFinite(p))) {
    return { year: parts[0], month: parts[1], day: parts[2] };
  }
  return null;
}

/** Calendar date that owns this timestamp's sales day (2 PM–2 AM wraps midnight). */
export function businessDate(when: Date, hours: HoursConfig) {
  const d = new Date(when);
  if (hours.startHour > hours.endHour && d.getHours() < hours.endHour) {
    d.setDate(d.getDate() - 1);
  }
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    key: dateKey(d.getFullYear(), d.getMonth() + 1, d.getDate()),
  };
}

export function businessDayBounds(year: number, month: number, day: number, hours: HoursConfig) {
  const start = new Date(year, month - 1, day, hours.startHour, 0, 0, 0);
  let end: Date;
  if (hours.startHour >= hours.endHour) {
    end = new Date(year, month - 1, day + 1, hours.endHour, 0, 0, 0);
  } else {
    end = new Date(year, month - 1, day, hours.endHour, 0, 0, 0);
  }
  return { start, end };
}

export function hourBuckets(start: Date, end: Date) {
  const buckets: { key: string; label: string }[] = [];
  const cursor = new Date(start);
  while (cursor < end) {
    const hour = cursor.getHours();
    buckets.push({ key: `${hour}:00`, label: `${padHour(hour)}:00` });
    cursor.setHours(cursor.getHours() + 1);
  }
  return buckets;
}

export function periodBounds(query: PeriodQuery, hours: HoursConfig, now = new Date()) {
  const period: ReportPeriod =
    query.period === "month" || query.period === "monthly" || query.period === "weekly"
      ? "month"
      : query.period === "year"
        ? "year"
        : "day";
  const biz = businessDate(now, hours);
  const year = Number(query.year) || biz.year;
  const month = Math.min(12, Math.max(1, Number(query.month) || biz.month));

  if (period === "year") {
    const start = businessDayBounds(year, 1, 1, hours).start;
    const end = businessDayBounds(year + 1, 1, 1, hours).start;
    return { period, start, end, label: String(year), hours };
  }
  if (period === "month") {
    const start = businessDayBounds(year, month, 1, hours).start;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const end = businessDayBounds(nextYear, nextMonth, 1, hours).start;
    return { period, start, end, label: `${year}-${padHour(month)}`, hours };
  }

  const parsed = parseDateKey(query.date);
  const y = parsed?.year ?? biz.year;
  const m = parsed?.month ?? biz.month;
  const day = parsed?.day ?? biz.day;
  const { start, end } = businessDayBounds(y, m, day, hours);
  return { period, start, end, label: dateKey(y, m, day), hours };
}
