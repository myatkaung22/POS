export type Role = "admin" | "manager" | "cashier" | "waiter" | "kitchen";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: Role | string;
};

export type MenuItem = {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  emoji: string;
  sku: string;
  available: boolean;
  kitchenPrint: boolean;
  sortOrder: number;
  imageUrl?: string;
};

export type Category = {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
  items: MenuItem[];
};

export type DiningTable = {
  id: string;
  number: number;
  name: string;
  seats: number;
  qrToken: string;
  status: string;
  posX: number;
  posY: number;
  active: boolean;
  orders?: Order[];
};

export type Promotion = {
  id: string;
  name: string;
  type: string;
  value: number;
  minOrder: number;
  scope?: string;
  targets?: string;
  active: boolean;
  startDate?: string | null;
  endDate?: string | null;
};

export type OrderItem = {
  id: string;
  orderId: string;
  menuItemId?: string | null;
  name: string;
  price: number;
  qty: number;
  notes: string;
  diner?: string;
  status: string;
  kitchenPrinted: boolean;
};

export function dinerLabel(name?: string | null) {
  const label = String(name || "").trim();
  return label || "Shared";
}

export function groupByDiner<T extends { diner?: string; qty: number; price: number; status?: string }>(items: T[]) {
  const buckets = new Map<string, { label: string; items: T[]; subtotal: number }>();
  for (const item of items) {
    if (item.status === "cancelled") continue;
    const label = dinerLabel(item.diner);
    const key = label.toLowerCase();
    const bucket = buckets.get(key) || { label, items: [], subtotal: 0 };
    bucket.items.push(item);
    bucket.subtotal += item.qty * item.price;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => {
    if (a.label === "Shared") return 1;
    if (b.label === "Shared") return -1;
    return a.label.localeCompare(b.label);
  });
}

function moneyAmount(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

export type PersonBill<T> = {
  label: string;
  items: T[];
  subtotal: number;
  discount: number;
  tax: number;
  service: number;
  total: number;
};

export function personBills<T extends { diner?: string; qty: number; price: number; status?: string }>(
  items: T[],
  order: {
    subtotal?: number;
    discountAmount?: number;
    taxAmount?: number;
    serviceAmount?: number;
    total?: number;
  }
): PersonBill<T>[] {
  const groups = groupByDiner(items);
  const itemSum = groups.reduce((sum, group) => sum + group.subtotal, 0);
  const base = itemSum > 0 ? itemSum : Number(order.subtotal || 0) || 1;
  const parts = groups.map((group) => {
    const ratio = group.subtotal / base;
    const discount = moneyAmount(Number(order.discountAmount || 0) * ratio);
    const tax = moneyAmount(Number(order.taxAmount || 0) * ratio);
    const service = moneyAmount(Number(order.serviceAmount || 0) * ratio);
    return {
      label: group.label,
      items: group.items,
      subtotal: moneyAmount(group.subtotal),
      discount,
      tax,
      service,
      total: moneyAmount(group.subtotal - discount + tax + service),
    };
  });
  const drift = moneyAmount(Number(order.total || 0) - parts.reduce((sum, part) => sum + part.total, 0));
  if (parts.length && drift !== 0) parts[parts.length - 1].total = moneyAmount(parts[parts.length - 1].total + drift);
  return parts;
}

export type OrderPayment = {
  id?: string;
  method: string;
  amount: number;
};

export type Order = {
  id: string;
  orderNo: number;
  tableId?: string | null;
  table?: DiningTable | null;
  type: string;
  status: string;
  waiter?: AuthUser | null;
  cashier?: AuthUser | null;
  customerNote: string;
  discountType: string;
  discountValue: number;
  promotionId?: string | null;
  promotion?: Promotion | null;
  taxRate: number;
  serviceRate: number;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  serviceAmount: number;
  total: number;
  paidAmount: number;
  changeAmount: number;
  roundAmount?: number;
  paymentMethod: string;
  payments?: OrderPayment[];
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  fulfillment?: string;
  items: OrderItem[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
};

export type InboxMessage = {
  id: string;
  type: string;
  title: string;
  body: string;
  meta: string;
  read: boolean;
  createdAt: string;
};

export type Printer = {
  id: string;
  name: string;
  type: string;
  connection: string;
  host: string;
  port: number;
  paperWidth: number;
  cashDrawerEnabled: boolean;
  active: boolean;
};

export type PrintJob = {
  id: string;
  printerId?: string | null;
  type: string;
  title: string;
  content: string;
  status: string;
  error: string;
  createdAt: string;
};

export type SettingsMap = Record<string, string>;

export const DEFAULT_CURRENCY = "฿";

export function money(n: number, currency = DEFAULT_CURRENCY, decimals = 2) {
  const amount = Number(n || 0);
  const places = Math.min(2, Math.max(0, Number.isFinite(Number(decimals)) ? Math.round(Number(decimals)) : 2));
  const formatted = amount.toLocaleString("th-TH", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
  const raw = (currency || DEFAULT_CURRENCY).trim();
  const symbol = raw === "$" || raw === "USD" || raw.toLowerCase() === "baht" || raw === "THB" ? "฿" : raw;
  return `${symbol}${formatted}`;
}

export function can(role: string | undefined, permission: string, matrix: Record<string, string[]>) {
  if (!role) return false;
  return (matrix[permission] || []).includes(role);
}
