import ExcelJS from "exceljs";
import { prisma } from "./db.ts";

export type ReportPeriod = "day" | "month" | "year";

export type ReportQuery = {
  period?: string;
  date?: string;
  month?: string;
  year?: string;
  category?: string;
};

export type CategoryReport = {
  name: string;
  qty: number;
  sales: number;
  items: { name: string; sku: string; qty: number; sales: number }[];
};

export type BuiltReport = {
  period: ReportPeriod;
  label: string;
  start: Date;
  end: Date;
  categoryFilter: string;
  categoryOptions: string[];
  summary: { totalSales: number; orderCount: number; avgTicket: number; itemCount: number };
  series: { label: string; sales: number; orders: number }[];
  categories: CategoryReport[];
  topItems: { name: string; qty: number; sales: number }[];
  payments: { method: string; amount: number }[];
  types: { type: string; amount: number }[];
  orders: {
    orderNo: number;
    when: string;
    type: string;
    table: string;
    payment: string;
    guest: string;
    total: number;
  }[];
};

function money(n: number) {
  return Math.round(n * 100) / 100;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function periodBounds(query: ReportQuery) {
  const now = new Date();
  const period: ReportPeriod =
    query.period === "month" || query.period === "monthly" || query.period === "weekly"
      ? "month"
      : query.period === "year"
        ? "year"
        : "day";
  const year = Number(query.year) || now.getFullYear();
  const month = Math.min(12, Math.max(1, Number(query.month) || now.getMonth() + 1));

  if (period === "year") {
    return {
      period,
      start: new Date(year, 0, 1, 0, 0, 0, 0),
      end: new Date(year + 1, 0, 1, 0, 0, 0, 0),
      label: String(year),
    };
  }
  if (period === "month") {
    return {
      period,
      start: new Date(year, month - 1, 1, 0, 0, 0, 0),
      end: new Date(year, month, 1, 0, 0, 0, 0),
      label: `${year}-${pad(month)}`,
    };
  }
  let day = now.getDate();
  let y = now.getFullYear();
  let m = now.getMonth();
  if (query.date) {
    const parts = query.date.split("-").map(Number);
    if (parts.length === 3 && parts.every((p) => Number.isFinite(p))) {
      y = parts[0];
      m = parts[1] - 1;
      day = parts[2];
    }
  }
  const start = new Date(y, m, day, 0, 0, 0, 0);
  const end = new Date(y, m, day + 1, 0, 0, 0, 0);
  return { period, start, end, label: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}` };
}

export async function buildReport(query: ReportQuery): Promise<BuiltReport> {
  const bounds = periodBounds(query);
  const categoryFilter = String(query.category || "").trim();

  const [orders, menuItems, categoryRows] = await Promise.all([
    prisma.order.findMany({
      where: {
        status: { in: ["paid", "completed"] },
        OR: [{ completedAt: { gte: bounds.start, lt: bounds.end } }, { createdAt: { gte: bounds.start, lt: bounds.end } }],
      },
      include: { items: { include: { menuItem: { include: { category: true } } } }, table: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.menuItem.findMany({ include: { category: true } }),
    prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  const inRange = orders.filter((o) => {
    const when = o.completedAt || o.createdAt;
    return when >= bounds.start && when < bounds.end;
  });

  const byId = new Map(menuItems.map((i) => [i.id, i]));
  const byName = new Map(menuItems.map((i) => [i.name.toLowerCase(), i]));

  function categoryName(item: (typeof inRange)[0]["items"][0]) {
    const linked = item.menuItemId ? byId.get(item.menuItemId) : item.menuItem;
    if (linked?.category?.name) return linked.category.name;
    return byName.get(item.name.toLowerCase())?.category?.name || "Uncategorized";
  }

  function skuOf(item: (typeof inRange)[0]["items"][0]) {
    const linked = item.menuItemId ? byId.get(item.menuItemId) : item.menuItem;
    return linked?.sku || byName.get(item.name.toLowerCase())?.sku || "";
  }

  const catMap = new Map<string, CategoryReport>();
  for (const cat of categoryRows) {
    catMap.set(cat.name, { name: cat.name, qty: 0, sales: 0, items: [] });
  }

  const itemMaps = new Map<string, Map<string, { name: string; sku: string; qty: number; sales: number }>>();

  for (const order of inRange) {
    for (const item of order.items.filter((i) => i.status !== "cancelled")) {
      const cat = categoryName(item);
      if (categoryFilter && cat !== categoryFilter) continue;
      const bucket = catMap.get(cat) || { name: cat, qty: 0, sales: 0, items: [] };
      const sale = money(item.qty * item.price);
      bucket.qty += item.qty;
      bucket.sales = money(bucket.sales + sale);
      catMap.set(cat, bucket);
      const items = itemMaps.get(cat) || new Map();
      const row = items.get(item.name) || { name: item.name, sku: skuOf(item), qty: 0, sales: 0 };
      row.qty += item.qty;
      row.sales = money(row.sales + sale);
      items.set(item.name, row);
      itemMaps.set(cat, items);
    }
  }

  const categories = [...catMap.values()]
    .map((c) => ({
      ...c,
      items: [...(itemMaps.get(c.name)?.values() || [])].sort((a, b) => b.sales - a.sales),
    }))
    .filter((c) => c.qty > 0)
    .filter((c) => !categoryFilter || c.name === categoryFilter)
    .sort((a, b) => b.sales - a.sales);

  const matchingOrders = categoryFilter
    ? inRange.filter((o) =>
        o.items.some((i) => i.status !== "cancelled" && categoryName(i) === categoryFilter)
      )
    : inRange;

  const itemSales = money(categories.reduce((s, c) => s + c.sales, 0));
  const ticketSales = money(matchingOrders.reduce((s, o) => s + o.total, 0));
  const totalSales = categoryFilter ? itemSales : ticketSales;
  const orderCount = matchingOrders.length;
  const itemCount = categories.reduce((s, c) => s + c.qty, 0);
  const avgTicket = orderCount ? money(totalSales / orderCount) : 0;

  const buckets = new Map<string, { label: string; sales: number; orders: number }>();
  if (bounds.period === "day") {
    for (let h = 0; h < 24; h++) buckets.set(`${h}:00`, { label: `${pad(h)}:00`, sales: 0, orders: 0 });
  } else if (bounds.period === "month") {
    const cursor = new Date(bounds.start);
    while (cursor < bounds.end) {
      const key = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`;
      buckets.set(key, { label: key, sales: 0, orders: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
  } else {
    for (let m = 1; m <= 12; m++) {
      const key = `${bounds.start.getFullYear()}-${pad(m)}`;
      buckets.set(key, { label: key, sales: 0, orders: 0 });
    }
  }
  for (const order of matchingOrders) {
    const when = order.completedAt || order.createdAt;
    let key = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
    let label = key;
    if (bounds.period === "day") {
      key = `${when.getHours()}:00`;
      label = `${pad(when.getHours())}:00`;
    } else if (bounds.period === "year") {
      key = `${when.getFullYear()}-${pad(when.getMonth() + 1)}`;
      label = key;
    }
    const current = buckets.get(key) || { label, sales: 0, orders: 0 };
    current.sales = money(current.sales + (categoryFilter ? 0 : order.total));
    current.orders += 1;
    buckets.set(key, current);
  }
  if (categoryFilter) {
    for (const order of matchingOrders) {
      const when = order.completedAt || order.createdAt;
      let key = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
      if (bounds.period === "day") key = `${when.getHours()}:00`;
      else if (bounds.period === "year") key = `${when.getFullYear()}-${pad(when.getMonth() + 1)}`;
      const sale = order.items
        .filter((i) => i.status !== "cancelled" && categoryName(i) === categoryFilter)
        .reduce((s, i) => s + i.qty * i.price, 0);
      const current = buckets.get(key);
      if (current) current.sales = money(current.sales + sale);
    }
  }

  const itemMap = new Map<string, { name: string; qty: number; sales: number }>();
  for (const cat of categories) {
    for (const item of cat.items) {
      const row = itemMap.get(item.name) || { name: item.name, qty: 0, sales: 0 };
      row.qty += item.qty;
      row.sales = money(row.sales + item.sales);
      itemMap.set(item.name, row);
    }
  }

  const methods = new Map<string, number>();
  const types = new Map<string, number>();
  for (const order of matchingOrders) {
    const amount = categoryFilter
      ? order.items
          .filter((i) => i.status !== "cancelled" && categoryName(i) === categoryFilter)
          .reduce((s, i) => s + i.qty * i.price, 0)
      : order.total;
    methods.set(order.paymentMethod || "unknown", money((methods.get(order.paymentMethod || "unknown") || 0) + amount));
    types.set(order.type, money((types.get(order.type) || 0) + amount));
  }

  return {
    period: bounds.period,
    label: bounds.label,
    start: bounds.start,
    end: bounds.end,
    categoryFilter,
    categoryOptions: [
      ...categoryRows.map((c) => c.name),
      ...(catMap.get("Uncategorized")?.qty ? ["Uncategorized"] : []),
    ],
    summary: { totalSales, orderCount, avgTicket, itemCount },
    series: [...buckets.values()],
    categories,
    topItems: [...itemMap.values()].sort((a, b) => b.sales - a.sales).slice(0, 12),
    payments: [...methods.entries()].map(([method, amount]) => ({ method, amount })),
    types: [...types.entries()].map(([type, amount]) => ({ type, amount })),
    orders: matchingOrders.map((o) => ({
      orderNo: o.orderNo,
      when: (o.completedAt || o.createdAt).toLocaleString(),
      type: o.type,
      table: o.table ? `T${o.table.number}` : "",
      payment: o.paymentMethod || "",
      guest: o.customerName || "",
      total: categoryFilter
        ? money(
            o.items
              .filter((i) => i.status !== "cancelled" && categoryName(i) === categoryFilter)
              .reduce((s, i) => s + i.qty * i.price, 0)
          )
        : o.total,
    })),
  };
}

function sheetName(name: string, used: Set<string>) {
  let base = name.replace(/[:\\/?*[\]]/g, " ").slice(0, 28).trim() || "Category";
  let next = base;
  let i = 2;
  while (used.has(next.toLowerCase())) {
    next = `${base.slice(0, 24)} ${i++}`;
  }
  used.add(next.toLowerCase());
  return next;
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FF16241F" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD4A84B" } };
  row.alignment = { vertical: "middle" };
}

export async function buildReportWorkbook(report: BuiltReport, restaurant: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "OmniMind POS";
  wb.created = new Date();

  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Field", key: "field", width: 28 },
    { header: "Value", key: "value", width: 36 },
  ];
  styleHeader(summary.getRow(1));
  summary.addRows([
    { field: "Restaurant", value: restaurant },
    { field: "Period", value: `${report.period} · ${report.label}` },
    { field: "From", value: report.start.toLocaleString() },
    { field: "To", value: report.end.toLocaleString() },
    { field: "Category", value: report.categoryFilter || "All categories" },
    { field: "Total sales (THB)", value: report.summary.totalSales },
    { field: "Orders", value: report.summary.orderCount },
    { field: "Average ticket (THB)", value: report.summary.avgTicket },
    { field: "Items sold", value: report.summary.itemCount },
  ]);
  summary.getCell("B7").numFmt = "#,##0.00";
  summary.getCell("B9").numFmt = "#,##0.00";

  const byCat = wb.addWorksheet("By category");
  byCat.columns = [
    { header: "Category", key: "name", width: 28 },
    { header: "Qty", key: "qty", width: 12 },
    { header: "Sales (THB)", key: "sales", width: 16 },
  ];
  styleHeader(byCat.getRow(1));
  for (const cat of report.categories) {
    const row = byCat.addRow(cat);
    row.getCell("sales").numFmt = "#,##0.00";
  }
  const tot = byCat.addRow({
    name: "TOTAL",
    qty: report.categories.reduce((s, c) => s + c.qty, 0),
    sales: report.categories.reduce((s, c) => s + c.sales, 0),
  });
  tot.font = { bold: true };
  tot.getCell("sales").numFmt = "#,##0.00";

  const used = new Set(["summary", "by category", "payments", "order type", "orders", "sales over time"]);
  for (const cat of report.categories) {
    if (!cat.items.length) continue;
    const sheet = wb.addWorksheet(sheetName(cat.name, used));
    sheet.columns = [
      { header: "Item", key: "name", width: 36 },
      { header: "SKU", key: "sku", width: 12 },
      { header: "Qty", key: "qty", width: 10 },
      { header: "Sales (THB)", key: "sales", width: 16 },
    ];
    styleHeader(sheet.getRow(1));
    for (const item of cat.items) {
      const row = sheet.addRow(item);
      row.getCell("sales").numFmt = "#,##0.00";
    }
    const catTotal = sheet.addRow({
      name: `${cat.name} total`,
      sku: "",
      qty: cat.qty,
      sales: cat.sales,
    });
    catTotal.font = { bold: true };
    catTotal.getCell("sales").numFmt = "#,##0.00";
  }

  const pay = wb.addWorksheet("Payments");
  pay.columns = [
    { header: "Method", key: "method", width: 18 },
    { header: "Amount (THB)", key: "amount", width: 16 },
  ];
  styleHeader(pay.getRow(1));
  for (const row of report.payments) {
    const added = pay.addRow(row);
    added.getCell("amount").numFmt = "#,##0.00";
  }

  const types = wb.addWorksheet("Order type");
  types.columns = [
    { header: "Type", key: "type", width: 18 },
    { header: "Amount (THB)", key: "amount", width: 16 },
  ];
  styleHeader(types.getRow(1));
  for (const row of report.types) {
    const added = types.addRow({ type: row.type.replace("_", " "), amount: row.amount });
    added.getCell("amount").numFmt = "#,##0.00";
  }

  const series = wb.addWorksheet("Sales over time");
  series.columns = [
    { header: "When", key: "label", width: 16 },
    { header: "Orders", key: "orders", width: 12 },
    { header: "Sales (THB)", key: "sales", width: 16 },
  ];
  styleHeader(series.getRow(1));
  for (const row of report.series) {
    const added = series.addRow(row);
    added.getCell("sales").numFmt = "#,##0.00";
  }

  const orders = wb.addWorksheet("Orders");
  orders.columns = [
    { header: "Order", key: "orderNo", width: 12 },
    { header: "When", key: "when", width: 22 },
    { header: "Type", key: "type", width: 14 },
    { header: "Table", key: "table", width: 10 },
    { header: "Guest", key: "guest", width: 18 },
    { header: "Payment", key: "payment", width: 12 },
    { header: "Total (THB)", key: "total", width: 14 },
  ];
  styleHeader(orders.getRow(1));
  for (const row of report.orders) {
    const added = orders.addRow(row);
    added.getCell("total").numFmt = "#,##0.00";
  }

  return wb;
}

export function reportFileName(report: BuiltReport) {
  const cat = report.categoryFilter ? `-${report.categoryFilter.replace(/\s+/g, "-").toLowerCase()}` : "-all";
  return `4-corner-${report.period}-${report.label}${cat}.xlsx`;
}
