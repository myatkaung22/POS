export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function hourLabel(hour: number) {
  const n = ((Number(hour) % 24) + 24) % 24;
  const suffix = n >= 12 ? "PM" : "AM";
  const h = n % 12 || 12;
  return `${h}:00 ${suffix}`;
}

export function businessDateIso(now = new Date(), startHour = 14, endHour = 2) {
  const d = new Date(now);
  if (startHour > endHour && d.getHours() < endHour) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
