import type { Express, Request, Response } from "express";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { prisma, getSettingsMap, nextOrderNo, orderInclude } from "./db.ts";
import { authRequired, findUserForLogin, requirePermission, signToken } from "./auth.ts";
import { calcPricing, billDecimals, withBillRounding } from "./pricing.ts";
import { buildInvoicePdf, buildOrderSlipText } from "./invoice.ts";
import { buildCancelSlip, buildKitchenSlip, buildReceiptSlip, discoverNetworkPrinters, kickCashDrawer, printToPrinter, slipDateTime, slipWidth } from "./printer.ts";
import { listWindowsPrinters, paperWidthForPrinter } from "./windows-print.ts";
import { agentHeartbeat, claimNextAgentJob, completeAgentJob, printAgentConfigured, printAgentRequired } from "./print-agent.ts";
import { emitAll, pushInbox } from "./realtime.ts";
import { PERMISSIONS, assertPermission, hasPermission } from "./permissions.ts";
import { currencySymbol, formatMoney } from "./currency.ts";
import { buildReport, buildReportWorkbook, reportFileName } from "./reports.ts";
import { answerQuestion, type AskMessage } from "./ask.ts";
import { asBool, publicImageUrl, removeImageFile, withMenuImage } from "./uploads.ts";
import { businessDate, businessDayBounds, dateKey, hoursFromSettings, parseDateKey } from "./hours.ts";
import { coalesceExclusive, runSerial } from "./actionQueue.ts";

function money(n: number) {
  return Math.round(n * 100) / 100;
}

function dinerName(value: unknown) {
  return String(value || "").trim().slice(0, 40);
}

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      const status = (err as { status?: number }).status || 500;
      console.error(err);
      res.status(status).json({ error: err instanceof Error ? err.message : "Server error" });
    });
  };
}

async function reprice(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, promotion: true },
  });
  if (!order) throw Object.assign(new Error("Order not found"), { status: 404 });
  const settings = await getSettingsMap();
  const pricing = withBillRounding(
    calcPricing({
      items: order.items,
      taxRate: order.taxRate,
      serviceRate: order.serviceRate,
      discountType: order.discountType,
      discountValue: order.discountValue,
      promotion: order.promotion,
    }),
    billDecimals(settings.billDecimals)
  );
  return prisma.order.update({
    where: { id: orderId },
    data: pricing,
    include: orderInclude,
  });
}

const PAY_METHODS = new Set(["cash", "card", "qr"]);

function parsePayRequest(body: Record<string, unknown>, total: number) {
  const raw = Array.isArray(body.payments) ? body.payments : null;
  let lines: { method: string; amount: number }[];
  if (raw && raw.length) {
    lines = raw.map((row) => {
      const item = (row || {}) as { method?: string; amount?: number };
      const method = String(item.method || "").toLowerCase();
      if (!PAY_METHODS.has(method)) {
        throw Object.assign(new Error(`Unknown payment method ${method || ""}`.trim()), { status: 400 });
      }
      const amount = money(Number(item.amount));
      if (amount <= 0) throw Object.assign(new Error("Each payment must be greater than 0"), { status: 400 });
      return { method, amount };
    });
  } else {
    const method = String(body.paymentMethod || "cash").toLowerCase();
    if (!PAY_METHODS.has(method)) {
      throw Object.assign(new Error("Unknown payment method"), { status: 400 });
    }
    lines = [{ method, amount: money(total) }];
  }
  const combined = new Map<string, number>();
  for (const line of lines) combined.set(line.method, money((combined.get(line.method) || 0) + line.amount));
  const payments = [...combined.entries()].map(([method, amount]) => ({ method, amount }));
  const sum = money(payments.reduce((s, p) => s + p.amount, 0));
  if (sum !== money(total)) {
    throw Object.assign(new Error("Payment amounts must equal the bill"), { status: 400 });
  }
  const cashAmt = payments.find((p) => p.method === "cash")?.amount || 0;
  const cashTender = cashAmt ? money(Number(body.paidAmount ?? cashAmt)) : 0;
  if (cashAmt && cashTender < cashAmt) {
    throw Object.assign(new Error("Cash tendered is short"), { status: 400 });
  }
  return {
    payments,
    paidAmount: money(sum - cashAmt + (cashAmt ? cashTender : 0)),
    changeAmount: cashAmt ? money(cashTender - cashAmt) : 0,
    paymentMethod: payments.map((p) => p.method).join("+"),
    kickDrawer: cashAmt > 0,
  };
}

function settingValue(id: string, raw: unknown) {
  if (id === "currency") return currencySymbol(String(raw));
  if (id === "billDecimals") return String(billDecimals(raw));
  if (id === "dayStartHour" || id === "dayEndHour") {
    const n = Number(raw);
    const fallback = id === "dayStartHour" ? 14 : 2;
    return String(Number.isFinite(n) ? Math.min(23, Math.max(0, Math.round(n))) : fallback);
  }
  return String(raw);
}

function occupancyFromOrder(order?: { status: string; items?: { status: string }[] } | null) {
  if (!order) return "available";
  if (order.status === "billed") return "billing";
  if (order.status === "in_kitchen") return "occupied";
  if ((order.items || []).some((item) => ["sent", "preparing", "ready", "served"].includes(item.status))) return "occupied";
  return "available";
}

async function syncTableStatus(tableId?: string | null) {
  if (!tableId) return;
  const open = await prisma.order.findFirst({
    where: { tableId, status: { in: ["open", "in_kitchen", "billed"] } },
    include: { items: true },
    orderBy: { createdAt: "desc" },
  });
  const status = occupancyFromOrder(open);
  const table = await prisma.diningTable.update({
    where: { id: tableId },
    data: { status },
  });
  emitAll("table:updated", table);
  return table;
}

function publicBase(settings: Record<string, string>, req: Request) {
  return (settings.publicUrl || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

function kitchenTableLabel(order: {
  type: string;
  customerName?: string | null;
  table?: { number: number; name: string } | null;
}) {
  if (order.table) return `Table ${order.table.number} ${order.table.name}`;
  if (order.type === "delivery") return order.customerName ? `DELIVERY ${order.customerName}` : "DELIVERY";
  if (order.type === "takeaway") return order.customerName ? `TAKEAWAY ${order.customerName}` : "TAKEAWAY";
  return order.type;
}

function itemWasInKitchen(item: { status: string; kitchenPrinted?: boolean }) {
  return Boolean(item.kitchenPrinted) || ["sent", "preparing", "ready", "served"].includes(item.status);
}

export function registerRoutes(app: Express) {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/bootstrap", authRequired, asyncHandler(async (req, res) => {
    const [settings, unread] = await Promise.all([
      getSettingsMap(),
      prisma.inboxMessage.count({ where: { read: false } }),
    ]);
    res.json({
      user: req.user,
      settings,
      unreadInbox: unread,
      permissions: PERMISSIONS,
    });
  }));

  app.post("/api/auth/login", asyncHandler(async (req, res) => {
    const { email, password, pin } = req.body as { email?: string; password?: string; pin?: string };
    const user = await findUserForLogin(email, pin);
    if (!user) {
      res.status(401).json({ error: "Invalid login" });
      return;
    }
    if (!pin) {
      const ok = await bcrypt.compare(password || "", user.passwordHash);
      if (!ok) {
        res.status(401).json({ error: "Invalid login" });
        return;
      }
    }
    const payload = { id: user.id, name: user.name, email: user.email, role: user.role };
    res.json({ token: signToken(payload), user: payload });
  }));

  app.get("/api/time/me", authRequired, asyncHandler(async (req, res) => {
    const shift = await prisma.timeShift.findFirst({
      where: { userId: req.user!.id, clockOut: null },
      orderBy: { clockIn: "desc" },
    });
    res.json({ shift });
  }));

  app.post("/api/time/clock-in", authRequired, requirePermission("clock"), asyncHandler(async (req, res) => {
    const open = await prisma.timeShift.findFirst({ where: { userId: req.user!.id, clockOut: null } });
    if (open) {
      res.status(409).json({ error: "Already clocked in", shift: open });
      return;
    }
    const shift = await prisma.timeShift.create({
      data: { userId: req.user!.id, clockIn: new Date(), note: String((req.body as { note?: string })?.note || "") },
    });
    res.json({ shift });
  }));

  app.post("/api/time/clock-out", authRequired, requirePermission("clock"), asyncHandler(async (req, res) => {
    const open = await prisma.timeShift.findFirst({ where: { userId: req.user!.id, clockOut: null } });
    if (!open) {
      res.status(400).json({ error: "Not clocked in" });
      return;
    }
    const shift = await prisma.timeShift.update({
      where: { id: open.id },
      data: { clockOut: new Date() },
    });
    res.json({ shift });
  }));

  app.get("/api/time/shifts", authRequired, requirePermission("clock"), asyncHandler(async (req, res) => {
    const settings = await getSettingsMap();
    const hours = hoursFromSettings(settings);
    const parsed = parseDateKey(String(req.query.date || "")) || businessDate(new Date(), hours);
    const { start, end } = businessDayBounds(parsed.year, parsed.month, parsed.day, hours);
    const seeAll = hasPermission(req.user!.role, "timesheet");
    const shifts = await prisma.timeShift.findMany({
      where: {
        ...(seeAll ? {} : { userId: req.user!.id }),
        clockIn: { lt: end },
        OR: [{ clockOut: null }, { clockOut: { gte: start } }],
      },
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: { clockIn: "asc" },
    });
    res.json({ date: dateKey(parsed.year, parsed.month, parsed.day), start, end, shifts });
  }));

  app.get("/api/settings", authRequired, asyncHandler(async (_req, res) => {
    res.json(await getSettingsMap());
  }));

  app.put("/api/settings", authRequired, requirePermission("settings"), asyncHandler(async (req, res) => {
    const body = req.body as Record<string, string>;
    for (const [id, raw] of Object.entries(body)) {
      const value = settingValue(id, raw);
      await prisma.setting.upsert({
        where: { id },
        update: { value },
        create: { id, value },
      });
    }
    const settings = await getSettingsMap();
    emitAll("settings:updated", settings);
    res.json(settings);
  }));

  app.get("/api/users", authRequired, requirePermission("users"), asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
    res.json(users);
  }));

  app.post("/api/users", authRequired, requirePermission("users"), asyncHandler(async (req, res) => {
    const { name, email, password, role, pin } = req.body;
    const user = await prisma.user.create({
      data: {
        name,
        email: String(email).toLowerCase(),
        passwordHash: await bcrypt.hash(password || "changeme", 10),
        pinHash: pin ? await bcrypt.hash(String(pin), 10) : null,
        role,
      },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
    res.json(user);
  }));

  app.patch("/api/users/:id", authRequired, requirePermission("users"), asyncHandler(async (req, res) => {
    const { name, role, active, password, pin } = req.body;
    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (role !== undefined) data.role = role;
    if (active !== undefined) data.active = active;
    if (password) data.passwordHash = await bcrypt.hash(password, 10);
    if (pin === "") data.pinHash = null;
    else if (pin) data.pinHash = await bcrypt.hash(String(pin), 10);
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
    res.json(user);
  }));

  app.get("/api/menu", asyncHandler(async (_req, res) => {
    const categories = await prisma.category.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    res.json(categories);
  }));

  app.get("/api/menu/admin", authRequired, requirePermission("menu"), asyncHandler(async (_req, res) => {
    const categories = await prisma.category.findMany({
      orderBy: { sortOrder: "asc" },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    res.json(categories);
  }));

  app.post("/api/categories", authRequired, requirePermission("menu"), asyncHandler(async (req, res) => {
    const count = await prisma.category.count();
    const category = await prisma.category.create({
      data: { name: req.body.name, sortOrder: req.body.sortOrder ?? count + 1 },
    });
    emitAll("menu:updated", {});
    res.json(category);
  }));

  app.patch("/api/categories/:id", authRequired, requirePermission("menu"), asyncHandler(async (req, res) => {
    const category = await prisma.category.update({
      where: { id: req.params.id },
      data: {
        name: req.body.name,
        sortOrder: req.body.sortOrder,
        active: req.body.active,
      },
    });
    emitAll("menu:updated", {});
    res.json(category);
  }));

  app.delete("/api/categories/:id", authRequired, requirePermission("menu"), asyncHandler(async (req, res) => {
    const items = await prisma.menuItem.findMany({ where: { categoryId: req.params.id } });
    for (const item of items) removeImageFile(item.imageUrl);
    await prisma.category.delete({ where: { id: req.params.id } });
    emitAll("menu:updated", {});
    res.json({ ok: true });
  }));

  app.post("/api/menu-items", authRequired, requirePermission("menu"), withMenuImage, asyncHandler(async (req, res) => {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    const item = await prisma.menuItem.create({
      data: {
        categoryId: String(req.body.categoryId),
        name: String(req.body.name || "").trim(),
        description: String(req.body.description || ""),
        price: Number(req.body.price),
        emoji: req.body.emoji || "🍽️",
        sku: req.body.sku || "",
        available: asBool(req.body.available, true),
        kitchenPrint: asBool(req.body.kitchenPrint, true),
        sortOrder: req.body.sortOrder !== undefined && req.body.sortOrder !== "" ? Number(req.body.sortOrder) : 0,
        imageUrl: file ? publicImageUrl(file.filename) : "",
      },
    });
    emitAll("menu:updated", {});
    res.json(item);
  }));

  app.patch("/api/menu-items/:id", authRequired, requirePermission("menu"), withMenuImage, asyncHandler(async (req, res) => {
    const current = await prisma.menuItem.findUnique({ where: { id: req.params.id } });
    if (!current) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    const file = (req as Request & { file?: Express.Multer.File }).file;
    let imageUrl = current.imageUrl;
    if (file) {
      removeImageFile(current.imageUrl);
      imageUrl = publicImageUrl(file.filename);
    } else if (asBool(req.body.removeImage, false)) {
      removeImageFile(current.imageUrl);
      imageUrl = "";
    }
    const item = await prisma.menuItem.update({
      where: { id: req.params.id },
      data: {
        categoryId: req.body.categoryId || current.categoryId,
        name: req.body.name !== undefined ? String(req.body.name).trim() : current.name,
        description: req.body.description !== undefined ? String(req.body.description) : current.description,
        price: req.body.price !== undefined && req.body.price !== "" ? Number(req.body.price) : current.price,
        emoji: req.body.emoji !== undefined ? req.body.emoji : current.emoji,
        sku: req.body.sku !== undefined ? req.body.sku : current.sku,
        available: req.body.available !== undefined && req.body.available !== "" ? asBool(req.body.available, true) : current.available,
        kitchenPrint: req.body.kitchenPrint !== undefined && req.body.kitchenPrint !== "" ? asBool(req.body.kitchenPrint, true) : current.kitchenPrint,
        sortOrder: req.body.sortOrder !== undefined && req.body.sortOrder !== "" ? Number(req.body.sortOrder) : current.sortOrder,
        imageUrl,
      },
    });
    emitAll("menu:updated", {});
    res.json(item);
  }));

  app.delete("/api/menu-items/:id", authRequired, requirePermission("menu"), asyncHandler(async (req, res) => {
    const current = await prisma.menuItem.findUnique({ where: { id: req.params.id } });
    if (current) removeImageFile(current.imageUrl);
    await prisma.menuItem.delete({ where: { id: req.params.id } });
    emitAll("menu:updated", {});
    res.json({ ok: true });
  }));

  app.get("/api/tables", authRequired, requirePermission("tables"), asyncHandler(async (_req, res) => {
    const tables = await prisma.diningTable.findMany({
      orderBy: { number: "asc" },
      include: {
        orders: {
          where: { status: { in: ["open", "in_kitchen", "billed"] } },
          include: { items: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    res.json(tables.map((table) => ({ ...table, status: occupancyFromOrder(table.orders[0]) })));
  }));

  app.post("/api/tables", authRequired, requirePermission("settings"), asyncHandler(async (req, res) => {
    const max = await prisma.diningTable.aggregate({ _max: { number: true } });
    const number = req.body.number !== undefined && req.body.number !== "" ? Number(req.body.number) : (max._max.number || 0) + 1;
    if (!Number.isInteger(number) || number < 1) {
      res.status(400).json({ error: "Table number must be 1 or higher" });
      return;
    }
    const clash = await prisma.diningTable.findFirst({ where: { number } });
    if (clash) {
      res.status(400).json({ error: `Table ${number} already exists` });
      return;
    }
    const seats = req.body.seats !== undefined && req.body.seats !== "" ? Number(req.body.seats) : 4;
    const table = await prisma.diningTable.create({
      data: {
        number,
        name: String(req.body.name || `Table ${number}`).trim() || `Table ${number}`,
        seats: Number.isFinite(seats) && seats > 0 ? seats : 4,
        qrToken: `tbl-${number}-${Math.random().toString(36).slice(2, 8)}`,
        posX: req.body.posX ?? 10,
        posY: req.body.posY ?? 10,
      },
    });
    emitAll("table:updated", table);
    res.json(table);
  }));

  app.patch("/api/tables/:id", authRequired, requirePermission("tables"), asyncHandler(async (req, res) => {
    const current = await prisma.diningTable.findUnique({ where: { id: req.params.id } });
    if (!current) {
      res.status(404).json({ error: "Table not found" });
      return;
    }
    if (req.body.number !== undefined) {
      const number = Number(req.body.number);
      if (!Number.isInteger(number) || number < 1) {
        res.status(400).json({ error: "Table number must be 1 or higher" });
        return;
      }
      const clash = await prisma.diningTable.findFirst({ where: { number, id: { not: current.id } } });
      if (clash) {
        res.status(400).json({ error: `Table ${number} already exists` });
        return;
      }
    }
    const table = await prisma.diningTable.update({
      where: { id: req.params.id },
      data: {
        name: req.body.name !== undefined ? String(req.body.name).trim() || current.name : undefined,
        number: req.body.number !== undefined ? Number(req.body.number) : undefined,
        seats: req.body.seats !== undefined && req.body.seats !== "" ? Number(req.body.seats) : undefined,
        status: req.body.status,
        posX: req.body.posX,
        posY: req.body.posY,
        active: req.body.active,
      },
    });
    emitAll("table:updated", table);
    res.json(table);
  }));

  app.delete("/api/tables/:id", authRequired, requirePermission("settings"), asyncHandler(async (req, res) => {
    const table = await prisma.diningTable.findUnique({ where: { id: req.params.id } });
    if (!table) {
      res.status(404).json({ error: "Table not found" });
      return;
    }
    const open = await prisma.order.findFirst({
      where: { tableId: table.id, status: { in: ["open", "in_kitchen", "billed"] } },
    });
    if (open) {
      res.status(400).json({ error: `Table ${table.number} has an open ticket. Pay or cancel it first.` });
      return;
    }
    await prisma.order.updateMany({ where: { tableId: table.id }, data: { tableId: null } });
    await prisma.diningTable.delete({ where: { id: table.id } });
    emitAll("table:updated", { id: table.id, deleted: true });
    res.json({ ok: true });
  }));

  app.get("/api/tables/:id/qr", authRequired, asyncHandler(async (req, res) => {
    const table = await prisma.diningTable.findUnique({ where: { id: req.params.id } });
    if (!table) {
      res.status(404).json({ error: "Table not found" });
      return;
    }
    const settings = await getSettingsMap();
    const url = `${publicBase(settings, req)}/qr/${table.qrToken}`;
    const dataUrl = await QRCode.toDataURL(url, { width: 480, margin: 1 });
    res.json({ url, dataUrl, table });
  }));

  app.post("/api/tables/:id/share", authRequired, asyncHandler(async (req, res) => {
    const table = await prisma.diningTable.findUnique({ where: { id: req.params.id } });
    if (!table) {
      res.status(404).json({ error: "Table not found" });
      return;
    }
    const settings = await getSettingsMap();
    const url = `${publicBase(settings, req)}/qr/${table.qrToken}`;
    const message = await pushInbox({
      type: "qr_share",
      title: `QR shared · Table ${table.number}`,
      body: `${req.user?.name} shared the guest menu for ${table.name}.`,
      meta: { tableId: table.id, url, by: req.user?.id },
    });
    res.json({ message, url });
  }));

  app.get("/api/qr/:token", asyncHandler(async (req, res) => {
    const table = await prisma.diningTable.findUnique({ where: { qrToken: req.params.token } });
    if (!table || !table.active) {
      res.status(404).json({ error: "Table not found" });
      return;
    }
    const [menu, settings, order] = await Promise.all([
      prisma.category.findMany({
        where: { active: true },
        orderBy: { sortOrder: "asc" },
        include: { items: { where: { available: true }, orderBy: { sortOrder: "asc" } } },
      }),
      getSettingsMap(),
      prisma.order.findFirst({
        where: { tableId: table.id, status: { in: ["open", "in_kitchen", "billed"] } },
        include: orderInclude,
        orderBy: { createdAt: "desc" },
      }),
    ]);
    res.json({ table, menu, settings, order });
  }));

  app.post("/api/qr/:token/call-staff", asyncHandler(async (req, res) => {
    const table = await prisma.diningTable.findUnique({ where: { qrToken: req.params.token } });
    if (!table) {
      res.status(404).json({ error: "Table not found" });
      return;
    }
    const message = await pushInbox({
      type: "qr_share",
      title: `Guest call · Table ${table.number}`,
      body: req.body.note || `Guests at ${table.name} requested assistance.`,
      meta: { tableId: table.id },
    });
    res.json({ ok: true, message });
  }));

  app.post("/api/qr/:token/orders", asyncHandler(async (req, res) => {
    const table = await prisma.diningTable.findUnique({ where: { qrToken: req.params.token } });
    if (!table) {
      res.status(404).json({ error: "Table not found" });
      return;
    }
    const items = (req.body.items || []) as { menuItemId: string; qty: number; notes?: string; diner?: string }[];
    const cartDiner = dinerName(req.body.diner);
    if (!items.length) {
      res.status(400).json({ error: "Add at least one item" });
      return;
    }
    const settings = await getSettingsMap();
    let order = await prisma.order.findFirst({
      where: { tableId: table.id, status: { in: ["open", "in_kitchen"] } },
    });
    if (!order) {
      order = await prisma.order.create({
        data: {
          orderNo: await nextOrderNo(),
          tableId: table.id,
          type: "qr",
          status: "open",
          customerNote: req.body.note || "",
          taxRate: Number(settings.taxRate || 0),
          serviceRate: Number(settings.serviceRate || 0),
        },
      });
    } else if (req.body.note) {
      await prisma.order.update({
        where: { id: order.id },
        data: { customerNote: req.body.note },
      });
    }

    for (const line of items) {
      const menuItem = await prisma.menuItem.findUnique({ where: { id: line.menuItemId } });
      if (!menuItem || !menuItem.available) continue;
      const notes = line.notes || "";
      const diner = dinerName(line.diner || cartDiner);
      const existing = await prisma.orderItem.findFirst({
        where: {
          orderId: order.id,
          menuItemId: menuItem.id,
          notes,
          diner,
          status: "pending",
        },
      });
      if (existing) {
        await prisma.orderItem.update({
          where: { id: existing.id },
          data: { qty: existing.qty + Number(line.qty || 1) },
        });
      } else {
        await prisma.orderItem.create({
          data: {
            orderId: order.id,
            menuItemId: menuItem.id,
            name: menuItem.name,
            price: menuItem.price,
            qty: Number(line.qty || 1),
            notes,
            diner,
            status: "pending",
          },
        });
      }
    }

    const updated = await reprice(order.id);
    await syncTableStatus(table.id);
    const pending = updated.items.filter((i) => i.status === "pending");
    const itemSummary = pending.map((i) => `${i.qty}× ${i.name}`).join(", ");
    await pushInbox({
      type: "qr_order",
      title: `QR order · Table ${table.number}`,
      body: `Guest order #${updated.orderNo} · ${itemSummary} · ${formatMoney(updated.total, settings.currency)}`,
      meta: { orderId: updated.id, tableId: table.id },
    });
    emitAll("order:updated", updated);
    emitAll("pos:qr-order", {
      orderId: updated.id,
      orderNo: updated.orderNo,
      tableId: table.id,
      tableNumber: table.number,
      tableName: table.name,
      total: updated.total,
      currency: currencySymbol(settings.currency),
      note: updated.customerNote,
      items: pending.map((i) => ({ qty: i.qty, name: i.name, notes: i.notes, diner: i.diner })),
      order: updated,
    });
    res.json(updated);
  }));

  app.get("/api/orders", authRequired, requirePermission("orders"), asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const active = String(req.query.active || "") === "1";
    const kitchen = String(req.query.kitchen || "") === "1";
    const dispatch = String(req.query.dispatch || "") === "1";
    const orders = await prisma.order.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(kitchen
          ? { items: { some: { status: { in: ["sent", "preparing", "ready"] } } } }
          : dispatch
            ? {
                type: { in: ["takeaway", "delivery"] },
                status: { notIn: ["cancelled", "completed"] },
                items: { some: {} },
              }
            : active
              ? { status: { in: ["open", "in_kitchen", "billed"] } }
              : {}),
      },
      include: orderInclude,
      orderBy: { createdAt: "desc" },
      take: Number(req.query.take || 100),
    });
    res.json(orders);
  }));

  app.get("/api/orders/:id", authRequired, requirePermission("orders"), asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: orderInclude });
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.json(order);
  }));

  app.post("/api/orders", authRequired, requirePermission("pos"), asyncHandler(async (req, res) => {
    const settings = await getSettingsMap();
    const tableId = req.body.tableId as string | undefined;
    if (tableId) {
      const existing = await prisma.order.findFirst({
        where: { tableId, status: { in: ["open", "in_kitchen", "billed"] } },
        include: orderInclude,
      });
      if (existing) {
        res.json(existing);
        return;
      }
    }
    const order = await prisma.order.create({
      data: {
        orderNo: await nextOrderNo(),
        tableId: tableId || null,
        type: req.body.type || (tableId ? "dine_in" : "takeaway"),
        status: "open",
        waiterId: req.user!.id,
        taxRate: Number(settings.taxRate || 0),
        serviceRate: Number(settings.serviceRate || 0),
        customerName: req.body.customerName || "",
        customerPhone: req.body.customerPhone || "",
        deliveryAddress: req.body.deliveryAddress || "",
        fulfillment: ["takeaway", "delivery"].includes(req.body.type) ? "none" : "none",
      },
      include: orderInclude,
    });
    await syncTableStatus(tableId);
    emitAll("order:updated", order);
    res.json(order);
  }));

  app.post("/api/orders/:id/items", authRequired, requirePermission("pos"), asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order || ["completed", "cancelled"].includes(order.status)) {
      res.status(400).json({ error: "Order cannot be changed" });
      return;
    }
    if (order.status === "paid" && !["takeaway", "delivery"].includes(order.type)) {
      res.status(400).json({ error: "Order cannot be changed" });
      return;
    }
    const menuItem = await prisma.menuItem.findUnique({ where: { id: req.body.menuItemId } });
    if (!menuItem) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    const notes = req.body.notes || "";
    const diner = dinerName(req.body.diner);
    const existing = await prisma.orderItem.findFirst({
      where: { orderId: order.id, menuItemId: menuItem.id, notes, diner, status: "pending" },
    });
    if (existing) {
      await prisma.orderItem.update({
        where: { id: existing.id },
        data: { qty: existing.qty + Number(req.body.qty || 1) },
      });
    } else {
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          menuItemId: menuItem.id,
          name: menuItem.name,
          price: menuItem.price,
          qty: Number(req.body.qty || 1),
          notes,
          diner,
        },
      });
    }
    const updated = await reprice(order.id);
    await syncTableStatus(order.tableId);
    emitAll("order:updated", updated);
    res.json(updated);
  }));

  app.patch("/api/orders/:id/items/:itemId", authRequired, requirePermission("pos"), asyncHandler(async (req, res) => {
    const item = await prisma.orderItem.findUnique({ where: { id: req.params.itemId } });
    if (!item || item.orderId !== req.params.id) {
      res.status(404).json({ error: "Line not found" });
      return;
    }
    const qty = req.body.qty !== undefined ? Number(req.body.qty) : item.qty;
    const diner = req.body.diner !== undefined ? dinerName(req.body.diner) : item.diner;
    const alreadyInKitchen = ["sent", "preparing", "ready", "served"].includes(item.status);
    if (qty <= 0) {
      await prisma.orderItem.delete({ where: { id: item.id } });
    } else if (alreadyInKitchen && qty > item.qty) {
      await prisma.orderItem.create({
        data: {
          orderId: item.orderId,
          menuItemId: item.menuItemId,
          name: item.name,
          price: item.price,
          qty: qty - item.qty,
          notes: req.body.notes ?? item.notes,
          diner,
          status: "pending",
        },
      });
    } else {
      await prisma.orderItem.update({
        where: { id: item.id },
        data: {
          qty,
          notes: req.body.notes ?? item.notes,
          diner,
          status: req.body.status ?? item.status,
        },
      });
    }
    const updated = await reprice(req.params.id);
    emitAll("order:updated", updated);
    res.json(updated);
  }));

  app.delete("/api/orders/:id/items/:itemId", authRequired, requirePermission("pos"), asyncHandler(async (req, res) => {
    const item = await prisma.orderItem.findUnique({ where: { id: req.params.itemId } });
    if (!item || item.orderId !== req.params.id) {
      res.status(404).json({ error: "Line not found" });
      return;
    }
    await prisma.orderItem.delete({ where: { id: item.id } });
    const updated = await reprice(req.params.id);
    emitAll("order:updated", updated);
    res.json(updated);
  }));

  app.patch("/api/orders/:id", authRequired, requirePermission("pos"), asyncHandler(async (req, res) => {
    const current = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!current) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (req.body.discountType && req.body.discountType !== "none") {
      const { hasPermission } = await import("./permissions.ts");
      if (!hasPermission(req.user!.role, "discount") && req.body.discountType !== "promotion") {
        res.status(403).json({ error: "You cannot apply a custom discount" });
        return;
      }
    }
    await prisma.order.update({
      where: { id: req.params.id },
      data: {
        customerNote: req.body.customerNote,
        customerName: req.body.customerName,
        customerPhone: req.body.customerPhone,
        deliveryAddress: req.body.deliveryAddress,
        discountType: req.body.discountType,
        discountValue: req.body.discountValue,
        promotionId: req.body.promotionId,
        taxRate: req.body.taxRate,
        serviceRate: req.body.serviceRate,
      },
    });
    const updated = await reprice(req.params.id);
    emitAll("order:updated", updated);
    res.json(updated);
  }));

  app.post("/api/orders/:id/send-kitchen", authRequired, requirePermission("pos"), asyncHandler(async (req, res) => {
    const payload = await runSerial(`kitchen-send:${req.params.id}`, async () => {
      const order = await prisma.order.findUnique({
        where: { id: req.params.id },
        include: { items: { include: { menuItem: true } }, table: true },
      });
      if (!order) throw Object.assign(new Error("Order not found"), { status: 404 });
      const pending = order.items.filter((i) => i.status === "pending");
      if (!pending.length) throw Object.assign(new Error("No new items to send"), { status: 400 });
      await prisma.orderItem.updateMany({
        where: { id: { in: pending.map((i) => i.id) } },
        data: { status: "sent", kitchenPrinted: true },
      });
      const offPrem = ["takeaway", "delivery"].includes(order.type);
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: order.status === "billed" || order.status === "paid" ? order.status : "in_kitchen",
          fulfillment: offPrem ? "packing" : order.fulfillment,
        },
      });
      const settings = await getSettingsMap();
      const guestBits = [order.customerName, order.customerPhone, order.deliveryAddress].filter(Boolean).join(" · ");
      const width = await slipWidth("kitchen");
      const followUp = order.items.some(
        (i) => i.status !== "pending" && i.status !== "cancelled" && (i.kitchenPrinted || ["sent", "preparing", "ready", "served"].includes(i.status))
      );
      const printItems = pending.filter((i) => i.menuItem?.kitchenPrint !== false);
      const content = buildKitchenSlip({
        restaurant: settings.restaurantName || "4 Corner Bar & Restaurant",
        orderNo: order.orderNo,
        tableLabel: order.table
          ? `Table ${order.table.number} ${order.table.name}`
          : order.type === "delivery"
            ? "DELIVERY"
            : order.type === "takeaway"
              ? "TAKEAWAY"
              : order.type,
        type: order.type,
        note: [order.customerNote, guestBits].filter(Boolean).join(" | "),
        items: printItems.map((i) => ({ qty: i.qty, name: i.name, notes: i.notes, diner: i.diner })),
        width,
        addon: followUp,
      });
      const print = printItems.length
        ? await printToPrinter({
            printerType: "kitchen",
            title: followUp ? `Kitchen #${order.orderNo} add-on` : `Kitchen #${order.orderNo}`,
            content,
          })
        : { status: "skipped" };
      const updated = await prisma.order.findUnique({
        where: { id: order.id },
        include: orderInclude,
      });
      emitAll("order:updated", updated);
      emitAll("kitchen:ticket", { order: updated, items: pending, print });
      await syncTableStatus(order.tableId);
      return { order: updated, print, content };
    });
    res.json(payload);
  }));

  app.post("/api/orders/:id/item-status", authRequired, asyncHandler(async (req, res) => {
    const { itemIds, status } = req.body as { itemIds: string[]; status: string };
    const allowed = ["sent", "preparing", "ready", "served"];
    if (!allowed.includes(status) || !Array.isArray(itemIds) || !itemIds.length) {
      res.status(400).json({ error: "Invalid item status" });
      return;
    }
    assertPermission(req.user?.role || "", status === "served" ? "pos" : "kitchen");
    await prisma.orderItem.updateMany({
      where: {
        id: { in: itemIds },
        orderId: req.params.id,
        ...(status === "served" ? { status: { in: ["sent", "preparing", "ready"] } } : {}),
      },
      data: { status },
    });
    let updated = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: orderInclude,
    });
    if (updated && ["takeaway", "delivery"].includes(updated.type) && status === "ready") {
      const remaining = updated.items.filter(
        (i) => i.status !== "cancelled" && i.status !== "pending" && i.status !== "ready" && i.status !== "served"
      );
      if (!remaining.length) {
        updated = await prisma.order.update({
          where: { id: updated.id },
          data: { fulfillment: "ready" },
          include: orderInclude,
        });
      }
    }
    emitAll("order:updated", updated);
    res.json(updated);
  }));

  app.post("/api/orders/:id/bill", authRequired, requirePermission("pos"), asyncHandler(async (req, res) => {
    const current = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: orderInclude,
    });
    if (!current) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    const updated = ["paid", "completed"].includes(current.status)
      ? current
      : await prisma.order.update({
          where: { id: current.id },
          data: { status: "billed" },
          include: orderInclude,
        });
    await syncTableStatus(updated.tableId);
    const settings = await getSettingsMap();
    const width = await slipWidth("receipt");
    const content = buildOrderSlipText(updated, settings, width);
    const print = await printToPrinter({
      printerType: "receipt",
      title: `${updated.paidAmount ? "Receipt" : "Bill"} #${updated.orderNo}`,
      content,
    });
    emitAll("order:updated", updated);
    res.json({ order: updated, print, content });
  }));

  app.post("/api/orders/:id/print-kitchen", authRequired, asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { items: { include: { menuItem: true } }, table: true },
    });
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    const items = order.items.filter((i) => i.status !== "cancelled" && i.status !== "pending" && i.status !== "served");
    if (!items.length) {
      res.status(400).json({ error: "No kitchen items to print" });
      return;
    }
    const settings = await getSettingsMap();
    const width = await slipWidth("kitchen");
    const guestBits = [order.customerName, order.customerPhone, order.deliveryAddress].filter(Boolean).join(" · ");
    const content = buildKitchenSlip({
      restaurant: settings.restaurantName || "4 Corner Bar & Restaurant",
      orderNo: order.orderNo,
      tableLabel: order.table
        ? `Table ${order.table.number} ${order.table.name}`
        : order.type === "delivery"
          ? "DELIVERY"
          : order.type === "takeaway"
            ? "TAKEAWAY"
            : order.type,
      type: order.type,
      note: [order.customerNote, guestBits].filter(Boolean).join(" | "),
      items: items.map((i) => ({ qty: i.qty, name: i.name, notes: i.notes, diner: i.diner })),
      width,
    });
    const print = await printToPrinter({
      printerType: "kitchen",
      title: `Kitchen #${order.orderNo}`,
      content,
    });
    res.json({ print, content });
  }));

  app.get("/api/orders/:id/invoice.pdf", authRequired, requirePermission("orders"), asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: orderInclude,
    });
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    const settings = await getSettingsMap();
    const pdf = await buildInvoicePdf(order, settings);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${order.orderNo}.pdf"`);
    res.send(pdf);
  }));

  app.post("/api/orders/:id/pay", authRequired, requirePermission("checkout"), asyncHandler(async (req, res) => {
    const { value, coalesced } = await coalesceExclusive(`pay:${req.params.id}`, async () => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: orderInclude,
    });
    if (!order) throw Object.assign(new Error("Order not found"), { status: 404 });
    if (["paid", "completed"].includes(order.status)) {
      throw Object.assign(new Error("Already paid"), { status: 400 });
    }
    const pay = parsePayRequest(req.body as Record<string, unknown>, order.total);
    const offPrem = ["takeaway", "delivery"].includes(order.type);
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: offPrem ? "paid" : "completed",
        paidAmount: pay.paidAmount,
        changeAmount: pay.changeAmount,
        paymentMethod: pay.paymentMethod,
        cashierId: req.user!.id,
        completedAt: offPrem ? null : new Date(),
        payments: {
          deleteMany: {},
          create: pay.payments,
        },
      },
      include: orderInclude,
    });
    const settings = await getSettingsMap();
    const width = await slipWidth("receipt");
    const decimals = billDecimals(settings.billDecimals);
    const content = buildReceiptSlip({
      restaurant: settings.restaurantName || "4 Corner Bar & Restaurant",
      address: settings.address || "",
      phone: settings.phone || "",
      orderNo: updated.orderNo,
      tableLabel: updated.table
        ? `Table ${updated.table.number} · ${updated.table.name}`
        : updated.type === "delivery"
          ? `Delivery${updated.customerName ? ` · ${updated.customerName}` : ""}`
          : updated.type === "takeaway"
            ? `Takeaway${updated.customerName ? ` · ${updated.customerName}` : ""}`
            : updated.type,
      cashier: req.user!.name,
      guest: [updated.customerName, updated.customerPhone].filter(Boolean).join(" · "),
      deliveryAddress: updated.type === "delivery" ? updated.deliveryAddress || "" : "",
      currency: currencySymbol(settings.currency),
      items: updated.items.filter((i) => i.status !== "cancelled").map((i) => ({
        qty: i.qty,
        name: i.name,
        price: i.price,
        notes: i.notes,
        diner: i.diner,
      })),
      subtotal: updated.subtotal,
      discountAmount: updated.discountAmount,
      taxAmount: updated.taxAmount,
      taxRate: updated.taxRate,
      serviceAmount: updated.serviceAmount,
      total: updated.total,
      paidAmount: pay.paidAmount,
      changeAmount: pay.changeAmount,
      paymentMethod: pay.paymentMethod,
      payments: pay.payments,
      roundAmount: updated.roundAmount,
      footer: settings.footerNote || "Thank you",
      width,
      decimals,
    });
    const print = await printToPrinter({
      printerType: "receipt",
      title: `Receipt #${updated.orderNo}`,
      content,
      kickDrawer: pay.kickDrawer,
    });
    emitAll("order:updated", updated);
    const table = await syncTableStatus(updated.tableId);
    return { order: updated, print, table, content };
    });
    res.json({ ...value, coalesced });
  }));

  app.post("/api/orders/:id/complete", authRequired, requirePermission("checkout"), asyncHandler(async (req, res) => {
    const current = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!current) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        cashierId: current.cashierId || req.user!.id,
      },
      include: orderInclude,
    });
    await syncTableStatus(updated.tableId);
    emitAll("order:updated", updated);
    res.json(updated);
  }));

  app.post("/api/orders/:id/fulfill", authRequired, requirePermission("dispatch"), asyncHandler(async (req, res) => {
    const current = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!current) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (!["takeaway", "delivery"].includes(current.type)) {
      res.status(400).json({ error: "Not a pickup or delivery order" });
      return;
    }
    const next = String(req.body.fulfillment || "");
    if (!["packing", "ready", "out", "done"].includes(next)) {
      res.status(400).json({ error: "Unknown fulfillment step" });
      return;
    }
    const updated = await prisma.order.update({
      where: { id: current.id },
      data: {
        fulfillment: next,
        ...(next === "done"
          ? { status: "completed", completedAt: new Date(), cashierId: current.cashierId || req.user!.id }
          : {}),
      },
      include: orderInclude,
    });
    emitAll("order:updated", updated);
    res.json(updated);
  }));

  app.post("/api/orders/:id/cancel", authRequired, requirePermission("pos"), asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: orderInclude,
    });
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (["paid", "completed", "cancelled"].includes(order.status)) {
      res.status(400).json({ error: "This order cannot be cancelled" });
      return;
    }
    const live = order.items.filter((i) => i.status !== "cancelled");
    const kitchenItems = live.filter(itemWasInKitchen);
    await prisma.orderItem.updateMany({
      where: { orderId: order.id, status: { not: "cancelled" } },
      data: { status: "cancelled" },
    });
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: "cancelled", completedAt: new Date(), subtotal: 0, discountAmount: 0, taxAmount: 0, serviceAmount: 0, roundAmount: 0, total: 0 },
      include: orderInclude,
    });
    await syncTableStatus(updated.tableId);
    const settings = await getSettingsMap();
    const width = await slipWidth("kitchen");
    const slipItems = (kitchenItems.length ? kitchenItems : live).map((i) => ({
      qty: i.qty,
      name: i.name,
      notes: i.notes,
      diner: i.diner,
    }));
    let print = null;
    let content = "";
    if (slipItems.length) {
      content = buildCancelSlip({
        restaurant: settings.restaurantName || "4 Corner Bar & Restaurant",
        orderNo: order.orderNo,
        tableLabel: kitchenTableLabel(order),
        type: order.type,
        note: [order.customerName, order.customerPhone, order.deliveryAddress].filter(Boolean).join(" · "),
        items: slipItems,
        width,
        scope: "order",
      });
      print = await printToPrinter({
        printerType: "kitchen",
        title: `Cancel #${order.orderNo}`,
        content,
      });
    }
    emitAll("order:updated", updated);
    res.json({ order: updated, print, content });
  }));

  app.post("/api/orders/:id/items/:itemId/cancel", authRequired, requirePermission("pos"), asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { items: true, table: true },
    });
    if (!order || ["paid", "completed", "cancelled"].includes(order.status)) {
      res.status(400).json({ error: "Order cannot be changed" });
      return;
    }
    const item = order.items.find((i) => i.id === req.params.itemId);
    if (!item || item.status === "cancelled") {
      res.status(404).json({ error: "Line not found" });
      return;
    }
    await prisma.orderItem.update({
      where: { id: item.id },
      data: { status: "cancelled" },
    });
    const remaining = await prisma.orderItem.count({
      where: { orderId: order.id, status: { not: "cancelled" } },
    });
    let updated;
    if (remaining === 0) {
      updated = await prisma.order.update({
        where: { id: order.id },
        data: { status: "cancelled", completedAt: new Date(), subtotal: 0, discountAmount: 0, taxAmount: 0, serviceAmount: 0, roundAmount: 0, total: 0 },
        include: orderInclude,
      });
    } else {
      updated = await reprice(order.id);
    }
    await syncTableStatus(order.tableId);
    const settings = await getSettingsMap();
    const width = await slipWidth("kitchen");
    const content = buildCancelSlip({
      restaurant: settings.restaurantName || "4 Corner Bar & Restaurant",
      orderNo: order.orderNo,
      tableLabel: kitchenTableLabel(order),
      type: order.type,
      note: remaining === 0 ? "Order cleared · table free" : undefined,
      items: [{ qty: item.qty, name: item.name, notes: item.notes, diner: item.diner }],
      width,
      scope: remaining === 0 ? "order" : "item",
    });
    const print = await printToPrinter({
      printerType: "kitchen",
      title: `Cancel item #${order.orderNo}`,
      content,
    });
    emitAll("order:updated", updated);
    res.json({ order: updated, print, content });
  }));

  app.get("/api/promotions", authRequired, asyncHandler(async (_req, res) => {
    const promotions = await prisma.promotion.findMany({ orderBy: { name: "asc" } });
    res.json(promotions);
  }));

  app.post("/api/promotions", authRequired, requirePermission("promotions"), asyncHandler(async (req, res) => {
    const promo = await prisma.promotion.create({
      data: {
        name: req.body.name,
        type: req.body.type,
        value: Number(req.body.value),
        minOrder: Number(req.body.minOrder || 0),
        active: req.body.active ?? true,
        startDate: req.body.startDate ? new Date(req.body.startDate) : null,
        endDate: req.body.endDate ? new Date(req.body.endDate) : null,
      },
    });
    res.json(promo);
  }));

  app.patch("/api/promotions/:id", authRequired, requirePermission("promotions"), asyncHandler(async (req, res) => {
    const promo = await prisma.promotion.update({
      where: { id: req.params.id },
      data: {
        name: req.body.name,
        type: req.body.type,
        value: req.body.value !== undefined ? Number(req.body.value) : undefined,
        minOrder: req.body.minOrder !== undefined ? Number(req.body.minOrder) : undefined,
        active: req.body.active,
        startDate: req.body.startDate ? new Date(req.body.startDate) : undefined,
        endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
      },
    });
    res.json(promo);
  }));

  app.delete("/api/promotions/:id", authRequired, requirePermission("promotions"), asyncHandler(async (req, res) => {
    await prisma.promotion.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  }));

  app.get("/api/inbox", authRequired, requirePermission("inbox"), asyncHandler(async (req, res) => {
    const messages = await prisma.inboxMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: Number(req.query.take || 80),
    });
    res.json(messages);
  }));

  app.post("/api/inbox/:id/read", authRequired, requirePermission("inbox"), asyncHandler(async (req, res) => {
    const message = await prisma.inboxMessage.update({
      where: { id: req.params.id },
      data: { read: true },
    });
    res.json(message);
  }));

  app.post("/api/inbox/read-all", authRequired, requirePermission("inbox"), asyncHandler(async (_req, res) => {
    await prisma.inboxMessage.updateMany({ data: { read: true } });
    res.json({ ok: true });
  }));

  app.get("/api/printers", authRequired, requirePermission("printers"), asyncHandler(async (_req, res) => {
    const [printers, jobs] = await Promise.all([
      prisma.printer.findMany({ orderBy: { type: "asc" } }),
      prisma.printJob.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
    ]);
    res.json({ printers, jobs });
  }));

  app.get("/api/printers/system", authRequired, requirePermission("printers"), asyncHandler(async (_req, res) => {
    res.json({ printers: await listWindowsPrinters() });
  }));

  app.get("/api/printers/discover", authRequired, requirePermission("printers"), asyncHandler(async (_req, res) => {
    res.json({ printers: await discoverNetworkPrinters() });
  }));

  app.get("/api/print-agent/health", printAgentRequired, asyncHandler(async (_req, res) => {
    const queued = await prisma.printJob.count({ where: { status: "queued", payload: { not: "" } } });
    res.json({ ...agentHeartbeat(), configured: printAgentConfigured(), queued });
  }));

  app.get("/api/print-agent/next", printAgentRequired, asyncHandler(async (_req, res) => {
    const job = await claimNextAgentJob();
    if (!job) {
      res.json({ job: null });
      return;
    }
    res.json({
      job: {
        id: job.id,
        host: job.host,
        port: job.port || 9100,
        payload: job.payload,
        title: job.title,
        type: job.type,
      },
    });
  }));

  app.post("/api/print-agent/jobs/:id/complete", printAgentRequired, asyncHandler(async (req, res) => {
    const updated = await completeAgentJob(String(req.params.id), {
      ok: req.body?.ok !== false && !req.body?.error,
      error: req.body?.error ? String(req.body.error) : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: "Job not found or already finished" });
      return;
    }
    res.json({ job: updated });
  }));

  app.post("/api/printers/network-setup", authRequired, requirePermission("printers"), asyncHandler(async (req, res) => {
    const host = String(req.body.host || "").trim();
    const port = Number(req.body.port || 9100);
    if (!host) {
      res.status(400).json({ error: "Enter the printer IP address" });
      return;
    }
    const viaAgent = Boolean(req.body.viaAgent) || process.env.PRINT_VIA_AGENT === "1";
    const connection = viaAgent ? "agent" : "network";
    const paperWidth = Number(req.body.paperWidth || 32);
    const roles = [
      {
        type: "kitchen",
        name: viaAgent ? "Kitchen via shop agent" : "Kitchen Ethernet",
        cashDrawerEnabled: false,
      },
      {
        type: "receipt",
        name: viaAgent ? "Receipt via shop agent" : "Receipt / invoice Ethernet",
        cashDrawerEnabled: Boolean(req.body.cashDrawer),
      },
    ];
    const saved = [];
    for (const role of roles) {
      const existing = await prisma.printer.findFirst({ where: { type: role.type } });
      const data = {
        name: role.name,
        type: role.type,
        connection,
        host,
        port,
        paperWidth,
        cashDrawerEnabled: role.cashDrawerEnabled,
        active: true,
      };
      saved.push(
        existing
          ? await prisma.printer.update({ where: { id: existing.id }, data })
          : await prisma.printer.create({ data })
      );
    }
    res.json({ printers: saved, host, port, connection });
  }));

  app.post("/api/printers/usb-setup", authRequired, requirePermission("printers"), asyncHandler(async (req, res) => {
    const windowsName = String(req.body.windowsName || "").trim();
    if (!windowsName) {
      res.status(400).json({ error: "Choose a Windows printer" });
      return;
    }
    const roles = [
      { type: "kitchen", name: "Kitchen USB", cashDrawerEnabled: false },
      { type: "receipt", name: "Receipt / invoice USB", cashDrawerEnabled: Boolean(req.body.cashDrawer) },
    ];
    const saved = [];
    for (const role of roles) {
      const existing = await prisma.printer.findFirst({ where: { type: role.type } });
      const data = {
        name: role.name,
        type: role.type,
        connection: "usb",
        host: windowsName,
        port: 0,
        paperWidth: paperWidthForPrinter(windowsName),
        cashDrawerEnabled: role.cashDrawerEnabled,
        active: true,
      };
      saved.push(
        existing
          ? await prisma.printer.update({ where: { id: existing.id }, data })
          : await prisma.printer.create({ data })
      );
    }
    res.json({ printers: saved, windowsName });
  }));

  app.post("/api/printers", authRequired, requirePermission("printers"), asyncHandler(async (req, res) => {
    const printer = await prisma.printer.create({
      data: {
        name: req.body.name,
        type: req.body.type,
        connection: req.body.connection || "network",
        host: req.body.host || "127.0.0.1",
        port: Number(req.body.port || 9100),
        paperWidth: Number(req.body.paperWidth || 42),
        cashDrawerEnabled: Boolean(req.body.cashDrawerEnabled),
        active: req.body.active ?? true,
      },
    });
    res.json(printer);
  }));

  app.patch("/api/printers/:id", authRequired, requirePermission("printers"), asyncHandler(async (req, res) => {
    const printer = await prisma.printer.update({
      where: { id: req.params.id },
      data: {
        name: req.body.name,
        type: req.body.type,
        connection: req.body.connection,
        host: req.body.host,
        port: req.body.port !== undefined ? Number(req.body.port) : undefined,
        paperWidth: req.body.paperWidth !== undefined ? Number(req.body.paperWidth) : undefined,
        cashDrawerEnabled: req.body.cashDrawerEnabled,
        active: req.body.active,
      },
    });
    res.json(printer);
  }));

  app.post("/api/printers/:id/test", authRequired, requirePermission("printers"), asyncHandler(async (req, res) => {
    const printer = await prisma.printer.findUnique({ where: { id: req.params.id } });
    if (!printer) {
      res.status(404).json({ error: "Printer not found" });
      return;
    }
    const result = await printToPrinter({
      printerType: printer.type as "kitchen" | "receipt",
      title: `Test · ${printer.name}`,
      content: [
        "******************************************",
        "              TEST SLIP",
        printer.name,
        slipDateTime(),
        "------------------------------------------",
        "80mm kitchen / bill format",
        "******************************************",
        "",
      ].join("\n"),
      kickDrawer: printer.type === "receipt" && printer.cashDrawerEnabled,
    });
    res.json(result);
  }));

  app.post("/api/printers/drawer", authRequired, requirePermission("checkout"), asyncHandler(async (_req, res) => {
    res.json(await kickCashDrawer());
  }));

  app.get("/api/reports", authRequired, requirePermission("reports"), asyncHandler(async (req, res) => {
    const report = await buildReport({
      period: String(req.query.period || req.query.range || "day"),
      date: String(req.query.date || ""),
      month: String(req.query.month || ""),
      year: String(req.query.year || ""),
      category: String(req.query.category || ""),
    });
    res.json({
      ...report,
      start: report.start.toISOString(),
      end: report.end.toISOString(),
    });
  }));

  app.get("/api/reports/export.xlsx", authRequired, requirePermission("reports"), asyncHandler(async (req, res) => {
    const report = await buildReport({
      period: String(req.query.period || "day"),
      date: String(req.query.date || ""),
      month: String(req.query.month || ""),
      year: String(req.query.year || ""),
      category: String(req.query.category || ""),
    });
    const settings = await getSettingsMap();
    const wb = await buildReportWorkbook(report, settings.restaurantName || "4 Corner Bar & Restaurant");
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${reportFileName(report)}"`);
    res.send(buffer);
  }));

  app.post("/api/ask", authRequired, requirePermission("reports"), asyncHandler(async (req, res) => {
    const question = String(req.body?.question || req.body?.q || "").trim();
    const history = Array.isArray(req.body?.history)
      ? (req.body.history as AskMessage[]).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      : [];
    res.json(await answerQuestion(question, history));
  }));
}
