import PDFDocument from "pdfkit";
import type { Order, OrderItem, DiningTable, User, Promotion } from "@prisma/client";
import { currencySymbol } from "./currency.ts";
import { buildBillSlip, buildReceiptSlip, SLIP_WIDTH_80MM } from "./printer.ts";

type FullOrder = Order & {
  items: OrderItem[];
  table: DiningTable | null;
  waiter: Pick<User, "id" | "name" | "role"> | null;
  cashier: Pick<User, "id" | "name" | "role"> | null;
  promotion: Promotion | null;
};

const MM80 = 226.77;

function tableLabel(order: FullOrder) {
  if (order.table) return `Table ${order.table.number}  ${order.table.name}`;
  if (order.type === "delivery") return order.customerName ? `DELIVERY  ${order.customerName}` : "DELIVERY";
  if (order.type === "takeaway") return order.customerName ? `TAKEAWAY  ${order.customerName}` : "TAKEAWAY";
  return "Walk-in";
}

export function buildOrderSlipText(order: FullOrder, settings: Record<string, string>, width = SLIP_WIDTH_80MM) {
  const items = order.items
    .filter((i) => i.status !== "cancelled")
    .map((i) => ({ qty: i.qty, name: i.name, price: i.price, notes: i.notes }));
  const paid = order.paidAmount > 0 || ["paid", "completed"].includes(order.status);
  if (paid) {
    return buildReceiptSlip({
      restaurant: settings.restaurantName || "4 Corner Bar & Restaurant",
      address: settings.address || "",
      phone: settings.phone || "",
      orderNo: order.orderNo,
      tableLabel: tableLabel(order),
      cashier: order.cashier?.name || "",
      currency: currencySymbol(settings.currency),
      items,
      subtotal: order.subtotal,
      discountAmount: order.discountAmount,
      taxAmount: order.taxAmount,
      taxRate: order.taxRate,
      serviceAmount: order.serviceAmount,
      total: order.total,
      paidAmount: order.paidAmount || order.total,
      changeAmount: order.changeAmount,
      paymentMethod: order.paymentMethod,
      footer: settings.footerNote || "Thank you for visiting 4 Corner.",
      width,
    });
  }
  return buildBillSlip({
    restaurant: settings.restaurantName || "4 Corner Bar & Restaurant",
    address: settings.address || "",
    phone: settings.phone || "",
    orderNo: order.orderNo,
    tableLabel: tableLabel(order),
    type: order.type,
    guest: [order.customerName, order.customerPhone].filter(Boolean).join(" · "),
    server: order.waiter?.name,
    currency: currencySymbol(settings.currency),
    items,
    subtotal: order.subtotal,
    discountAmount: order.discountAmount,
    taxAmount: order.taxAmount,
    taxRate: order.taxRate,
    serviceAmount: order.serviceAmount,
    total: order.total,
    footer: settings.footerNote || "Please pay at cashier",
    width,
  });
}

export function buildInvoicePdf(order: FullOrder, settings: Record<string, string>): Promise<Buffer> {
  const text = buildOrderSlipText(order, settings);
  const lines = text.split("\n");
  const lineHeight = 10;
  const height = Math.max(320, 20 + lines.length * lineHeight + 24);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [MM80, height],
      margin: 8,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.font("Courier").fontSize(8).fillColor("#111");
    let y = 10;
    for (const line of lines) {
      doc.text(line || " ", 8, y, { lineBreak: false, width: MM80 - 16 });
      y += lineHeight;
    }
    doc.end();
  });
}
