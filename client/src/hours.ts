export const BUSINESS_TZ = "Asia/Bangkok";

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function hourLabel(hour: number) {
  const n = ((Number(hour) % 24) + 24) % 24;
  const suffix = n >= 12 ? "PM" : "AM";
  const h = n % 12 || 12;
  return `${h}:00 ${suffix}`;
}

function wallParts(now: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
  };
}

export function businessDateIso(now = new Date(), startHour = 14, endHour = 2) {
  const w = wallParts(now);
  if (startHour > endHour && w.hour < endHour) {
    const prev = wallParts(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    return `${prev.year}-${pad2(prev.month)}-${pad2(prev.day)}`;
  }
  return `${w.year}-${pad2(w.month)}-${pad2(w.day)}`;
}

export function businessMonthYear(now = new Date(), startHour = 14, endHour = 2) {
  const iso = businessDateIso(now, startHour, endHour);
  const [year, month] = iso.split("-").map(Number);
  return { year, month };
}
