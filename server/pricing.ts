export type PricingInput = {
  items: { price: number; qty: number; status?: string; menuItemId?: string | null; categoryId?: string | null }[];
  taxRate: number;
  serviceRate: number;
  discountType: string;
  discountValue: number;
  promotion?: {
    type: string;
    value: number;
    minOrder: number;
    active: boolean;
    scope?: string | null;
    targets?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
  } | null;
};

export type PricingResult = {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  serviceAmount: number;
  total: number;
  roundAmount: number;
};

function money(n: number) {
  return Math.round(n * 100) / 100;
}

export function billDecimals(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 2;
  return Math.min(2, Math.max(0, Math.round(n)));
}

export function roundToDecimals(n: number, decimals: number) {
  const places = billDecimals(decimals);
  const factor = 10 ** places;
  return Math.round((Number(n) || 0) * factor) / factor;
}

/** Half-up to whole currency units: 10.50 → 11, 10.49 → 10. */
export function roundBillTotal(n: number) {
  return Math.round(Number(n) || 0);
}

export function withBillRounding(pricing: Omit<PricingResult, "roundAmount">, _decimals?: number): PricingResult {
  const raw = money(pricing.total);
  const total = roundBillTotal(raw);
  return { ...pricing, total, roundAmount: money(total - raw) };
}

export type PersonShare<T> = {
  label: string;
  items: T[];
  subtotal: number;
  total: number;
};

export function personShares<T extends { diner?: string; qty: number; price: number; status?: string }>(
  items: T[],
  order: {
    subtotal?: number;
    discountAmount?: number;
    taxAmount?: number;
    serviceAmount?: number;
    total?: number;
  }
): PersonShare<T>[] {
  const buckets = new Map<string, { label: string; items: T[]; subtotal: number }>();
  for (const item of items) {
    if (item.status === "cancelled") continue;
    const label = String(item.diner || "").trim() || "Shared";
    const key = label.toLowerCase();
    const bucket = buckets.get(key) || { label, items: [], subtotal: 0 };
    bucket.items.push(item);
    bucket.subtotal += item.qty * item.price;
    buckets.set(key, bucket);
  }
  const groups = [...buckets.values()].sort((a, b) => {
    if (a.label === "Shared") return 1;
    if (b.label === "Shared") return -1;
    return a.label.localeCompare(b.label);
  });
  const itemSum = groups.reduce((sum, group) => sum + group.subtotal, 0);
  const base = itemSum > 0 ? itemSum : Number(order.subtotal || 0) || 1;
  const parts = groups.map((group) => {
    const ratio = group.subtotal / base;
    const discount = money(Number(order.discountAmount || 0) * ratio);
    const tax = money(Number(order.taxAmount || 0) * ratio);
    const service = money(Number(order.serviceAmount || 0) * ratio);
    return {
      label: group.label,
      items: group.items,
      subtotal: money(group.subtotal),
      total: money(group.subtotal - discount + tax + service),
    };
  });
  const drift = money(Number(order.total || 0) - parts.reduce((sum, part) => sum + part.total, 0));
  if (parts.length && drift !== 0) parts[parts.length - 1].total = money(parts[parts.length - 1].total + drift);
  return parts;
}

function parseTargets(raw?: string | null) {
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function eligibleSubtotal(
  items: PricingInput["items"],
  promo: NonNullable<PricingInput["promotion"]>
) {
  const live = items.filter((i) => i.status !== "cancelled");
  const scope = String(promo.scope || "order");
  const targets = new Set(parseTargets(promo.targets));
  if (scope === "item" && targets.size) {
    return money(
      live.filter((i) => i.menuItemId && targets.has(String(i.menuItemId))).reduce((s, i) => s + i.price * i.qty, 0)
    );
  }
  if (scope === "category" && targets.size) {
    return money(
      live.filter((i) => i.categoryId && targets.has(String(i.categoryId))).reduce((s, i) => s + i.price * i.qty, 0)
    );
  }
  return money(live.reduce((s, i) => s + i.price * i.qty, 0));
}

export function calcPricing(input: PricingInput): PricingResult {
  const live = input.items.filter((i) => i.status !== "cancelled");
  const subtotal = money(live.reduce((sum, i) => sum + i.price * i.qty, 0));

  let discountAmount = 0;
  const now = new Date();
  const promo = input.promotion;
  const promoOk =
    promo &&
    promo.active &&
    (!promo.startDate || promo.startDate <= now) &&
    (!promo.endDate || promo.endDate >= now);

  if (input.discountType === "promotion" && promoOk && promo) {
    const base = eligibleSubtotal(input.items, promo);
    if (base >= (promo.minOrder || 0)) {
      discountAmount = promo.type === "percent" ? base * (promo.value / 100) : Math.min(promo.value, base);
    }
  } else if (input.discountType === "percent") {
    discountAmount = subtotal * (input.discountValue / 100);
  } else if (input.discountType === "fixed") {
    discountAmount = input.discountValue;
  }

  discountAmount = money(Math.min(Math.max(discountAmount, 0), subtotal));
  const taxable = money(Math.max(subtotal - discountAmount, 0));
  const taxAmount = money(taxable * ((input.taxRate || 0) / 100));
  const serviceAmount = money(taxable * ((input.serviceRate || 0) / 100));
  const total = money(taxable + taxAmount + serviceAmount);

  return { subtotal, discountAmount, taxAmount, serviceAmount, total, roundAmount: 0 };
}
