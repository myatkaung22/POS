import net from "node:net";
import os from "node:os";
import { prisma } from "./db.ts";
import { formatMoney } from "./currency.ts";
import { sendWindowsRaw } from "./windows-print.ts";
import { enqueuePrint } from "./actionQueue.ts";
import { personShares } from "./pricing.ts";

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

export function combineSlipItems<T extends { qty: number; name: string; price: number; notes?: string; diner?: string }>(items: T[]) {
  const grouped = new Map<string, T>();
  for (const item of items) {
    const key = `${item.name}\0${item.price}\0${String(item.notes || "").trim()}\0${String(item.diner || "").trim().toLowerCase()}`;
    const prev = grouped.get(key);
    if (prev) prev.qty += item.qty;
    else grouped.set(key, { ...item, notes: String(item.notes || "").trim(), diner: String(item.diner || "").trim() });
  }
  return [...grouped.values()];
}

export function groupSlipByDiner<T extends { qty: number; name: string; price: number; diner?: string }>(items: T[]) {
  const buckets = new Map<string, { label: string; items: T[]; subtotal: number }>();
  for (const item of items) {
    const label = String(item.diner || "").trim();
    const key = label.toLowerCase() || "__shared__";
    const bucket = buckets.get(key) || { label: label || "Shared", items: [], subtotal: 0 };
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

function appendPricedItems(
  lines: string[],
  items: { qty: number; name: string; price: number; notes?: string; diner?: string }[],
  money: (n: number) => string,
  w: number,
  order: { subtotal: number; discountAmount: number; taxAmount: number; serviceAmount: number; total: number }
) {
  const combined = combineSlipItems(items);
  const groups = personShares(combined, order);
  const split = groups.length > 1 || (groups.length === 1 && groups[0].label !== "Shared");
  for (const group of groups) {
    if (split) {
      lines.push(center(group.label.toUpperCase(), w));
    }
    for (const item of group.items) {
      lines.push(lineItem(item.name, item.qty, item.price, w));
      if (item.notes) wrap(`  ${item.notes}`, w).forEach((l) => lines.push(l));
    }
    if (split) {
      lines.push(row(`${group.label} total`, money(group.total), w));
      lines.push("");
    }
  }
  return { groups, split };
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
  items: { qty: number; name: string; notes: string; diner?: string }[];
  width?: number;
  addon?: boolean;
}) {
  const w = opts.width ?? SLIP_WIDTH_80MM;
  const lines = [
    rule(w, "*"),
    center(opts.addon ? "KITCHEN  ·  NEW ITEMS" : "KITCHEN SLIP", w),
    center(opts.restaurant, w),
    rule(w, "*"),
    `#${opts.orderNo}  ${opts.tableLabel}`.slice(0, w),
    `${opts.type.replace("_", " ").toUpperCase()}  ${new Date().toLocaleString()}`.slice(0, w),
  ];
  if (opts.addon) {
    lines.push(center("ADD-ON  ·  PRINT NEW ONLY", w));
  }
  lines.push(rule(w));
  const kitchenGroups = groupSlipByDiner(opts.items.map((item) => ({ ...item, price: 0 })));
  const splitKitchen = kitchenGroups.length > 1 || (kitchenGroups.length === 1 && kitchenGroups[0].label !== "Shared");
  for (const group of kitchenGroups) {
    if (splitKitchen) {
      lines.push(center(group.label.toUpperCase(), w));
    }
    for (const item of group.items) {
      const qty = String(item.qty).padStart(2, " ");
      wrap(`${qty}  ${item.name.toUpperCase()}`, w).forEach((l) => lines.push(l));
      if (!splitKitchen && item.diner) wrap(`    @ ${item.diner}`, w).forEach((l) => lines.push(l));
      if (item.notes) wrap(`    ** ${item.notes}`, w).forEach((l) => lines.push(l));
      lines.push("");
    }
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
  items: { qty: number; name: string; price: number; notes?: string; diner?: string }[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  taxRate: number;
  serviceAmount: number;
  total: number;
  roundAmount?: number;
  footer: string;
  width?: number;
  decimals?: number;
}) {
  const w = opts.width ?? SLIP_WIDTH_80MM;
  const money = (n: number) => formatMoney(n, opts.currency, true, opts.decimals ?? 2);
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
  const people = appendPricedItems(lines, opts.items, money, w, opts);
  lines.push(rule(w));
  lines.push(row("Subtotal", money(opts.subtotal), w));
  if (opts.discountAmount) lines.push(row("Discount", `-${money(opts.discountAmount)}`, w));
  if (opts.taxAmount) lines.push(row(`Tax ${opts.taxRate}%`, money(opts.taxAmount), w));
  if (opts.serviceAmount) lines.push(row("Service", money(opts.serviceAmount), w));
  if (opts.roundAmount) lines.push(row(opts.roundAmount > 0 ? "Round up" : "Round down", money(opts.roundAmount), w));
  lines.push(row("TOTAL DUE", money(opts.total), w));
  if (people.split) {
    lines.push(rule(w));
    lines.push(center("EACH PERSON", w));
    for (const group of people.groups) {
      lines.push(row(group.label, money(group.total), w));
    }
  }
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
  items: { qty: number; name: string; price: number; notes?: string; diner?: string }[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  taxRate?: number;
  serviceAmount: number;
  total: number;
  paidAmount: number;
  changeAmount: number;
  paymentMethod: string;
  payments?: { method: string; amount: number }[];
  roundAmount?: number;
  footer: string;
  width?: number;
  decimals?: number;
}) {
  const w = opts.width ?? SLIP_WIDTH_80MM;
  const money = (n: number) => formatMoney(n, opts.currency, true, opts.decimals ?? 2);
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
  const people = appendPricedItems(lines, opts.items, money, w, opts);
  lines.push(rule(w));
  lines.push(row("Subtotal", money(opts.subtotal), w));
  if (opts.discountAmount) lines.push(row("Discount", `-${money(opts.discountAmount)}`, w));
  if (opts.taxAmount) lines.push(row(opts.taxRate ? `Tax ${opts.taxRate}%` : "Tax", money(opts.taxAmount), w));
  if (opts.serviceAmount) lines.push(row("Service", money(opts.serviceAmount), w));
  if (opts.roundAmount) lines.push(row(opts.roundAmount > 0 ? "Round up" : "Round down", money(opts.roundAmount), w));
  lines.push(row("TOTAL", money(opts.total), w));
  if (people.split) {
    lines.push(rule(w));
    lines.push(center("EACH PERSON", w));
    for (const group of people.groups) {
      lines.push(row(group.label, money(group.total), w));
    }
  }
  if (opts.payments?.length) {
    for (const pay of opts.payments) {
      lines.push(row((pay.method || "paid").toUpperCase(), money(pay.amount), w));
    }
  } else {
    lines.push(row((opts.paymentMethod || "PAID").toUpperCase(), money(opts.paidAmount), w));
  }
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

function probePort(host: string, port: number, timeout = 400) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(timeout);
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

export async function discoverNetworkPrinters() {
  const prefixes = new Set<string>();
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.family !== "IPv4" || addr.internal || addr.address.startsWith("169.254.")) continue;
      const parts = addr.address.split(".");
      prefixes.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
    }
  }
  const found: { host: string; port: number }[] = [];
  await Promise.all(
    [...prefixes].flatMap((prefix) =>
      Array.from({ length: 254 }, (_, i) => i + 1).map(async (n) => {
        const host = `${prefix}.${n}`;
        if (await probePort(host, 9100)) found.push({ host, port: 9100 });
      })
    )
  );
  return found.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
}

function printerPayload(printer: { cashDrawerEnabled: boolean }, content: string, opts: { kickDrawer?: boolean; kitchen?: boolean }) {
  return escpos(content, {
    cut: true,
    kick: Boolean(opts.kickDrawer && printer.cashDrawerEnabled),
    kitchen: Boolean(opts.kitchen),
  });
}

async function sendToDevice(
  printer: { connection: string; host: string; port: number; cashDrawerEnabled: boolean },
  content: string,
  opts: { kickDrawer?: boolean; kitchen?: boolean }
) {
  const payload = printerPayload(printer, content, opts);
  if ((printer.connection === "usb" || printer.connection === "windows") && printer.host) {
    await sendWindowsRaw(printer.host, payload);
    return;
  }
  if (printer.connection === "network" && printer.host) {
    await sendNetwork(printer.host, printer.port, payload);
    return;
  }
  throw new Error("Printer is not set to USB or Ethernet");
}

export async function printToPrinter(opts: {
  printerType: "kitchen" | "receipt";
  title: string;
  content: string;
  kickDrawer?: boolean;
}) {
  return enqueuePrint(() => dispatchPrint(opts));
}

async function dispatchPrint(opts: {
  printerType: "kitchen" | "receipt";
  title: string;
  content: string;
  kickDrawer?: boolean;
}) {
  const printers = await prisma.printer.findMany({ where: { active: true } });
  const preferred = printers.filter((p) => p.type === opts.printerType);
  const fallback = printers.filter((p) => p.type !== opts.printerType);
  const queue = [...preferred, ...fallback];

  let status = queue.length ? "failed" : "simulated";
  let error = queue.length ? "No printer accepted the job" : "";
  let used = preferred[0] || fallback[0] || null;

  for (const printer of queue) {
    try {
      await sendToDevice(printer, opts.content, {
        kickDrawer: opts.kickDrawer && opts.printerType === "receipt",
        kitchen: opts.printerType === "kitchen",
      });
      used = printer;
      status = "printed";
      error = "";
      break;
    } catch (err) {
      error = err instanceof Error ? err.message : "Print failed";
    }
  }

  const job = await prisma.printJob.create({
    data: {
      printerId: used?.id,
      type: opts.kickDrawer && opts.printerType === "receipt" ? "receipt_drawer" : opts.printerType,
      title: opts.title,
      content: opts.content,
      status,
      error,
    },
  });

  return { job, printer: used, status: job.status, content: opts.content };
}

export async function kickCashDrawer() {
  return enqueuePrint(() => pulseCashDrawer());
}

async function pulseCashDrawer() {
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
  if (printer.connection === "usb" || printer.connection === "windows") {
    try {
      await sendWindowsRaw(printer.host, escpos("", { cut: false, kick: true }));
      status = "printed";
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : "Drawer kick failed";
    }
  } else if (printer.connection === "network") {
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
