import net from "node:net";
import { prisma } from "./db.ts";
import { formatMoney } from "./currency.ts";

export const SLIP_WIDTH_80MM = 42;
export const SLIP_WIDTH_58MM = 32;

function wrap(text: string, width: number) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= width) line = next;
    else {
      if (line) lines.push(line);
      if (word.length > width) {
        for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
        line = "";
      } else line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function center(text: string, width: number) {
  const value = String(text || "");
  if (value.length >= width) return value.slice(0, width);
  const pad = Math.floor((width - value.length) / 2);
  return " ".repeat(pad) + value;
}

function row(label: string, value: string, width: number) {
  const space = Math.max(1, width - label.length - value.length);
  return label + " ".repeat(space) + value;
}

function rule(width: number, char = "-") {
  return char.repeat(width);
}

function lineItem(name: string, qty: number, price: number, width: number) {
  const right = (qty * price).toFixed(2);
  const left = `${qty}x ${name}`;
  if (left.length + 1 + right.length <= width) {
    return left + " ".repeat(width - left.length - right.length) + right;
  }
  const nameLines = wrap(`${qty}x ${name}`, width - right.length - 1);
  const last = nameLines.pop() || "";
  const aligned = last + " ".repeat(Math.max(1, width - last.length - right.length)) + right;
  return [...nameLines, aligned].join("\n");
}

export async function slipWidth(printerType: "kitchen" | "receipt") {
  const printer = await prisma.printer.findFirst({
    where: { type: printerType, active: true },
  });
  const raw = printer?.paperWidth || SLIP_WIDTH_80MM;
  return raw <= 36 ? SLIP_WIDTH_58MM : SLIP_WIDTH_80MM;
}

function tableLabel(opts: {
  table?: { number: number; name: string } | null;
  type: string;
  customerName?: string;
}) {
  if (opts.table) return `Table ${opts.table.number}  ${opts.table.name}`;
  if (opts.type === "delivery") return opts.customerName ? `DELIVERY  ${opts.customerName}` : "DELIVERY";
  if (opts.type === "takeaway") return opts.customerName ? `TAKEAWAY  ${opts.customerName}` : "TAKEAWAY";
  return opts.type.replace("_", " ").toUpperCase();
}

export function buildKitchenSlip(opts: {
  restaurant: string;
  orderNo: number;
  tableLabel: string;
  type: string;
  note: string;
  items: { qty: number; name: string; notes: string }[];
  width?: number;
}) {
  const w = opts.width ?? SLIP_WIDTH_80MM;
  const lines = [
    rule(w, "*"),
    center("KITCHEN SLIP", w),
    center(opts.restaurant, w),
    rule(w, "*"),
    `#${opts.orderNo}  ${opts.tableLabel}`.slice(0, w),
    `${opts.type.replace("_", " ").toUpperCase()}  ${new Date().toLocaleString()}`.slice(0, w),
    rule(w),
  ];
  for (const item of opts.items) {
    const qty = String(item.qty).padStart(2, " ");
    wrap(`${qty}  ${item.name.toUpperCase()}`, w).forEach((l) => lines.push(l));
    if (item.notes) wrap(`    ** ${item.notes}`, w).forEach((l) => lines.push(l));
    lines.push("");
  }
  if (opts.note) {
    lines.push(rule(w));
    lines.push(center("NOTE", w));
    wrap(opts.note, w).forEach((l) => lines.push(l));
  }
  lines.push(rule(w), center("SEND TO EXPO", w), rule(w, "*"), "");
  return lines.join("\n");
}

export function buildBillSlip(opts: {
  restaurant: string;
  address: string;
  phone: string;
  orderNo: number;
  tableLabel: string;
  type: string;
  guest?: string;
  server?: string;
  currency: string;
  items: { qty: number; name: string; price: number; notes?: string }[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  taxRate: number;
  serviceAmount: number;
  total: number;
  footer: string;
  width?: number;
}) {
  const w = opts.width ?? SLIP_WIDTH_80MM;
  const money = (n: number) => formatMoney(n, opts.currency, true);
  const lines = [
    center(opts.restaurant, w),
    ...wrap(opts.address, w).map((l) => center(l, w)),
    center(opts.phone, w),
    rule(w),
    center("BILL / CHECK", w),
    `Order #${opts.orderNo}`,
    opts.tableLabel,
    opts.type.replace("_", " ").toUpperCase(),
  ];
  if (opts.guest) wrap(`Guest: ${opts.guest}`, w).forEach((l) => lines.push(l));
  if (opts.server) lines.push(`Server: ${opts.server}`);
  lines.push(new Date().toLocaleString(), rule(w));
  for (const item of opts.items) {
    lines.push(lineItem(item.name, item.qty, item.price, w));
    if (item.notes) wrap(`  ${item.notes}`, w).forEach((l) => lines.push(l));
  }
  lines.push(rule(w));
  lines.push(row("Subtotal", money(opts.subtotal), w));
  if (opts.discountAmount) lines.push(row("Discount", `-${money(opts.discountAmount)}`, w));
  if (opts.taxAmount) lines.push(row(`Tax ${opts.taxRate}%`, money(opts.taxAmount), w));
  if (opts.serviceAmount) lines.push(row("Service", money(opts.serviceAmount), w));
  lines.push(row("TOTAL DUE", money(opts.total), w));
  lines.push(rule(w));
  wrap(opts.footer || "Please pay at cashier", w).map((l) => center(l, w)).forEach((l) => lines.push(l));
  lines.push("");
  return lines.join("\n");
}

export function buildReceiptSlip(opts: {
  restaurant: string;
  address: string;
  phone: string;
  orderNo: number;
  tableLabel: string;
  cashier: string;
  currency: string;
  items: { qty: number; name: string; price: number }[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  taxRate?: number;
  serviceAmount: number;
  total: number;
  paidAmount: number;
  changeAmount: number;
  paymentMethod: string;
  footer: string;
  width?: number;
}) {
  const w = opts.width ?? SLIP_WIDTH_80MM;
  const money = (n: number) => formatMoney(n, opts.currency, true);
  const lines = [
    center(opts.restaurant, w),
    ...wrap(opts.address, w).map((l) => center(l, w)),
    center(opts.phone, w),
    rule(w),
    center("RECEIPT", w),
    `Order #${opts.orderNo}`,
    opts.tableLabel,
    `Cashier: ${opts.cashier}`,
    new Date().toLocaleString(),
    rule(w),
  ];
  for (const item of opts.items) {
    lines.push(lineItem(item.name, item.qty, item.price, w));
  }
  lines.push(rule(w));
  lines.push(row("Subtotal", money(opts.subtotal), w));
  if (opts.discountAmount) lines.push(row("Discount", `-${money(opts.discountAmount)}`, w));
  if (opts.taxAmount) lines.push(row(opts.taxRate ? `Tax ${opts.taxRate}%` : "Tax", money(opts.taxAmount), w));
  if (opts.serviceAmount) lines.push(row("Service", money(opts.serviceAmount), w));
  lines.push(row("TOTAL", money(opts.total), w));
  lines.push(row((opts.paymentMethod || "PAID").toUpperCase(), money(opts.paidAmount), w));
  if (opts.changeAmount) lines.push(row("Change", money(opts.changeAmount), w));
  lines.push(rule(w));
  wrap(opts.footer || "Thank you", w).map((l) => center(l, w)).forEach((l) => lines.push(l));
  lines.push(center("Slip copy", w), "");
  return lines.join("\n");
}

export { tableLabel as formatTableLabel };

function escpos(text: string, opts?: { cut?: boolean; kick?: boolean; kitchen?: boolean }) {
  const cut = opts?.cut ?? true;
  const kick = opts?.kick ?? false;
  const chunks: Buffer[] = [Buffer.from([0x1b, 0x40])];
  chunks.push(Buffer.from([0x1b, 0x74, 0x00]));
  if (opts?.kitchen) {
    chunks.push(Buffer.from([0x1b, 0x61, 0x01]));
    chunks.push(Buffer.from([0x1d, 0x21, 0x11]));
    chunks.push(Buffer.from("KITCHEN\n", "ascii"));
    chunks.push(Buffer.from([0x1d, 0x21, 0x00]));
    chunks.push(Buffer.from([0x1b, 0x61, 0x00]));
  }
  chunks.push(Buffer.from(text, "utf8"));
  chunks.push(Buffer.from("\n\n"));
  if (kick) chunks.push(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]));
  if (cut) chunks.push(Buffer.from([0x1d, 0x56, 0x41, 0x10]));
  return Buffer.concat(chunks);
}

function sendNetwork(host: string, port: number, payload: Buffer) {
  return new Promise<void>((resolve, reject) => {
    const socket = net.connect({ host, port }, () => {
      socket.write(payload, (err) => {
        if (err) {
          socket.destroy();
          reject(err);
          return;
        }
        socket.end();
        resolve();
      });
    });
    socket.setTimeout(2500);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("Printer timed out"));
    });
    socket.on("error", reject);
  });
}

export async function printToPrinter(opts: {
  printerType: "kitchen" | "receipt";
  title: string;
  content: string;
  kickDrawer?: boolean;
}) {
  const printer = await prisma.printer.findFirst({
    where: { type: opts.printerType, active: true },
  });

  let status = "simulated";
  let error = "";

  if (printer?.connection === "network" && printer.host) {
    try {
      await sendNetwork(
        printer.host,
        printer.port,
        escpos(opts.content, {
          cut: true,
          kick: Boolean(opts.kickDrawer && printer.cashDrawerEnabled),
          kitchen: opts.printerType === "kitchen",
        })
      );
      status = "printed";
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : "Print failed";
    }
  } else if (opts.kickDrawer && printer?.cashDrawerEnabled && printer.host) {
    try {
      await sendNetwork(printer.host, printer.port, escpos("", { cut: false, kick: true }));
      status = "printed";
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : "Drawer kick failed";
    }
  }

  const job = await prisma.printJob.create({
    data: {
      printerId: printer?.id,
      type: opts.kickDrawer && opts.printerType === "receipt" ? "receipt_drawer" : opts.printerType,
      title: opts.title,
      content: opts.content,
      status: printer ? status : "simulated",
      error,
    },
  });

  return { job, printer, status: job.status, content: opts.content };
}

export async function kickCashDrawer() {
  const printer = await prisma.printer.findFirst({
    where: { type: "receipt", active: true, cashDrawerEnabled: true },
  });
  if (!printer) {
    const job = await prisma.printJob.create({
      data: {
        type: "drawer",
        title: "Cash drawer kick",
        content: "[No receipt printer with drawer configured]",
        status: "simulated",
      },
    });
    return { job, status: "simulated" };
  }
  let status = "simulated";
  let error = "";
  if (printer.connection === "network") {
    try {
      await sendNetwork(printer.host, printer.port, escpos("", { cut: false, kick: true }));
      status = "printed";
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : "Drawer kick failed";
    }
  }
  const job = await prisma.printJob.create({
    data: {
      printerId: printer.id,
      type: "drawer",
      title: "Cash drawer kick",
      content: "ESC p pulse to cash drawer",
      status,
      error,
    },
  });
  return { job, status };
}
