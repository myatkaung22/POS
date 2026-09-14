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
  status: string;
  kitchenPrinted: boolean;
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
  paymentMethod: string;
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

export function money(n: number, currency = DEFAULT_CURRENCY) {
  const amount = Number(n || 0);
  const formatted = amount.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const raw = (currency || DEFAULT_CURRENCY).trim();
  const symbol = raw === "$" || raw === "USD" || raw.toLowerCase() === "baht" || raw === "THB" ? "฿" : raw;
  return `${symbol}${formatted}`;
}

export function can(role: string | undefined, permission: string, matrix: Record<string, string[]>) {
  if (!role) return false;
  return (matrix[permission] || []).includes(role);
}
