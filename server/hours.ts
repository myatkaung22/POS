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

export type WallTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Sales day and clock windows are always Thailand time, not the server clock. */
export const BUSINESS_TZ = "Asia/Bangkok";

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

export function wallTime(when: Date, timeZone = BUSINESS_TZ): WallTime {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(when).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Wall-clock time in Asia/Bangkok → UTC Date. Independent of process timezone. */
export function fromWallTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
  timeZone = BUSINESS_TZ
) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  for (let i = 0; i < 3; i++) {
    const got = wallTime(new Date(utc), timeZone);
    const gotUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second, ms);
    const wantUtc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
    const delta = wantUtc - gotUtc;
    if (delta === 0) break;
    utc += delta;
  }
  return new Date(utc);
}

function addCalendarDays(year: number, month: number, day: number, delta: number) {
  const noon = fromWallTime(year, month, day, 12);
  const shifted = new Date(noon.getTime() + delta * 24 * 60 * 60 * 1000);
  const w = wallTime(shifted);
  return { year: w.year, month: w.month, day: w.day };
}

/** Calendar date that owns this timestamp's sales day (2 PM–2 AM wraps midnight). */
export function businessDate(when: Date, hours: HoursConfig) {
  const w = wallTime(when);
  if (hours.startHour > hours.endHour && w.hour < hours.endHour) {
    const prev = addCalendarDays(w.year, w.month, w.day, -1);
    return { ...prev, key: dateKey(prev.year, prev.month, prev.day) };
  }
  return { year: w.year, month: w.month, day: w.day, key: dateKey(w.year, w.month, w.day) };
}

export function businessDayBounds(year: number, month: number, day: number, hours: HoursConfig) {
  const start = fromWallTime(year, month, day, hours.startHour);
  let end: Date;
  if (hours.startHour >= hours.endHour) {
    const next = addCalendarDays(year, month, day, 1);
    end = fromWallTime(next.year, next.month, next.day, hours.endHour);
  } else {
    end = fromWallTime(year, month, day, hours.endHour);
  }
  return { start, end };
}

export function hourBuckets(start: Date, end: Date) {
  const buckets: { key: string; label: string }[] = [];
  const cursor = new Date(start);
  while (cursor < end) {
    const hour = wallTime(cursor).hour;
    buckets.push({ key: `${hour}:00`, label: `${padHour(hour)}:00` });
    cursor.setTime(cursor.getTime() + 60 * 60 * 1000);
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
