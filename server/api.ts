import type { Express, Request, Response } from "express";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { prisma, getSettingsMap, nextOrderNo, orderInclude } from "./db.ts";
import { authRequired, findUserForLogin, requirePermission, signToken } from "./auth.ts";
import { calcPricing } from "./pricing.ts";
import { buildInvoicePdf, buildOrderSlipText } from "./invoice.ts";
import { buildKitchenSlip, buildReceiptSlip, kickCashDrawer, printToPrinter, slipWidth } from "./printer.ts";
import { emitAll, pushInbox } from "./realtime.ts";
import { PERMISSIONS } from "./permissions.ts";
import { currencySymbol, formatMoney } from "./currency.ts";
import { asBool, publicImageUrl, removeImageFile, withMenuImage } from "./uploads.ts";

function money(n: number) {
  return Math.round(n * 100) / 100;
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
  const pricing = calcPricing({
    items: order.items,
    taxRate: order.taxRate,
    serviceRate: order.serviceRate,
    discountType: order.discountType,
    discountValue: order.discountValue,
    promotion: order.promotion,
  });
  return prisma.order.update({
    where: { id: orderId },
    data: pricing,
    include: orderInclude,
  });
}

async function syncTableStatus(tableId?: string | null) {
  if (!tableId) return;
  const open = await prisma.order.findFirst({
    where: { tableId, status: { in: ["open", "in_kitchen", "billed"] } },
    orderBy: { createdAt: "desc" },
  });
  let status = "available";
  if (open?.status === "billed") status = "billing";
  else if (open) status = "occupied";
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

  app.get("/api/settings", authRequired, asyncHandler(async (_req, res) => {
    res.json(await getSettingsMap());
  }));

  app.put("/api/settings", authRequired, requirePermission("settings"), asyncHandler(async (req, res) => {
    const body = req.body as Record<string, string>;
    for (const [id, raw] of Object.entries(body)) {
      const value = id === "currency" ? currencySymbol(String(raw)) : String(raw);
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
    res.json(tables);
  }));

  app.post("/api/tables", authRequired, requirePermission("settings"), asyncHandler(async (req, res) => {
    const max = await prisma.diningTable.aggregate({ _max: { number: true } });
    const number = req.body.number ?? (max._max.number || 0) + 1;
    const table = await prisma.diningTable.create({
      data: {
        number,
        name: req.body.name || `Table ${number}`,
        seats: req.body.seats ?? 4,
        qrToken: `tbl-${number}-${Math.random().toString(36).slice(2, 8)}`,
        posX: req.body.posX ?? 10,
        posY: req.body.posY ?? 10,
      },
    });
    emitAll("table:updated", table);
    res.json(table);
  }));

  app.patch("/api/tables/:id", authRequired, requirePermission("tables"), asyncHandler(async (req, res) => {
    const table = await prisma.diningTable.update({
      where: { id: req.params.id },
      data: {
        name: req.body.name,
        seats: req.body.seats,
        status: req.body.status,
        posX: req.body.posX,
        posY: req.body.posY,
        active: req.body.active,
      },
    });
    emitAll("table:updated", table);
    res.json(table);
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
    const items = (req.body.items || []) as { menuItemId: string; qty: number; notes?: string }[];
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
      const existing = await prisma.orderItem.findFirst({
        where: {
          orderId: order.id,
          menuItemId: menuItem.id,
          notes: line.notes || "",
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
            notes: line.notes || "",
            status: "pending",
          },
        });
      }
    }

    const updated = await reprice(order.id);
    await prisma.diningTable.update({ where: { id: table.id }, data: { status: "occupied" } });
    const pending = updated.items.filter((i) => i.status === "pending");
    const itemSummary = pending.map((i) => `${i.qty}× ${i.name}`).join(", ");
    await pushInbox({
      type: "qr_order",
      title: `QR order · Table ${table.number}`,
      body: `Guest order #${updated.orderNo} · ${itemSummary} · ${formatMoney(updated.total, settings.currency)}`,
      meta: { orderId: updated.id, tableId: table.id },
    });
    emitAll("order:updated", updated);
    emitAll("table:updated", { ...table, status: "occupied" });
    emitAll("pos:qr-order", {
      orderId: updated.id,
      orderNo: updated.orderNo,
      tableId: table.id,
      tableNumber: table.number,
      tableName: table.name,
      total: updated.total,
      currency: currencySymbol(settings.currency),
      note: updated.customerNote,
      items: pending.map((i) => ({ qty: i.qty, name: i.name, notes: i.notes })),
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
          ? { items: { some: { status: { in: ["sent", "preparing"] } } } }
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
    const existing = await prisma.orderItem.findFirst({
      where: { orderId: order.id, menuItemId: menuItem.id, notes, status: "pending" },
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
    if (qty <= 0) {
      await prisma.orderItem.delete({ where: { id: item.id } });
    } else {
      await prisma.orderItem.update({
        where: { id: item.id },
        data: {
          qty,
          notes: req.body.notes ?? item.notes,
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
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { items: true, table: true },
    });
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    const pending = order.items.filter((i) => i.status === "pending");
    if (!pending.length) {
      res.status(400).json({ error: "No new items to send" });
      return;
    }
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
      items: pending.map((i) => ({ qty: i.qty, name: i.name, notes: i.notes })),
      width,
    });
    const print = await printToPrinter({
      printerType: "kitchen",
      title: `Kitchen #${order.orderNo}`,
      content,
    });
    const updated = await prisma.order.findUnique({
      where: { id: order.id },
      include: orderInclude,
    });
    emitAll("order:updated", updated);
    emitAll("kitchen:ticket", { order: updated, items: pending, print });
    await syncTableStatus(order.tableId);
    res.json({ order: updated, print, content });
  }));

  app.post("/api/orders/:id/item-status", authRequired, requirePermission("kitchen"), asyncHandler(async (req, res) => {
    const { itemIds, status } = req.body as { itemIds: string[]; status: string };
    await prisma.orderItem.updateMany({
      where: { id: { in: itemIds }, orderId: req.params.id },
      data: { status },
    });
    let updated = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: orderInclude,
    });
    if (updated && ["takeaway", "delivery"].includes(updated.type) && status === "ready") {
      const remaining = updated.items.filter(
        (i) => i.status !== "cancelled" && i.status !== "pending" && i.status !== "ready"
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
    const items = order.items.filter((i) => i.status !== "cancelled" && i.status !== "pending");
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
      items: items.map((i) => ({ qty: i.qty, name: i.name, notes: i.notes })),
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
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: orderInclude,
    });
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    const paidAmount = money(Number(req.body.paidAmount ?? order.total));
    const paymentMethod = req.body.paymentMethod || "cash";
    const changeAmount = money(Math.max(paidAmount - order.total, 0));
    const offPrem = ["takeaway", "delivery"].includes(order.type);
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: offPrem ? "paid" : "completed",
        paidAmount,
        changeAmount,
        paymentMethod,
        cashierId: req.user!.id,
        completedAt: offPrem ? null : new Date(),
      },
      include: orderInclude,
    });
    const settings = await getSettingsMap();
    const width = await slipWidth("receipt");
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
      currency: currencySymbol(settings.currency),
      items: updated.items.filter((i) => i.status !== "cancelled").map((i) => ({
        qty: i.qty,
        name: i.name,
        price: i.price,
      })),
      subtotal: updated.subtotal,
      discountAmount: updated.discountAmount,
      taxAmount: updated.taxAmount,
      taxRate: updated.taxRate,
      serviceAmount: updated.serviceAmount,
      total: updated.total,
      paidAmount,
      changeAmount,
      paymentMethod,
      footer: settings.footerNote || "Thank you",
      width,
    });
    const print = await printToPrinter({
      printerType: "receipt",
      title: `Receipt #${updated.orderNo}`,
      content,
      kickDrawer: paymentMethod === "cash",
    });
    emitAll("order:updated", updated);
    const table = await syncTableStatus(updated.tableId);
    res.json({ order: updated, print, table, content });
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
    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: { status: "cancelled", completedAt: new Date() },
      include: orderInclude,
    });
    await syncTableStatus(updated.tableId);
    emitAll("order:updated", updated);
    res.json(updated);
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
        new Date().toLocaleString(),
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
    const range = (req.query.range as string) || "daily";
    const now = new Date();
    const start = new Date(now);
    if (range === "weekly") start.setDate(now.getDate() - 6);
    else if (range === "monthly") start.setDate(now.getDate() - 29);
    else start.setHours(0, 0, 0, 0);
    if (range !== "daily") start.setHours(0, 0, 0, 0);

    const orders = await prisma.order.findMany({
      where: {
        status: { in: ["paid", "completed"] },
        completedAt: { gte: start },
      },
      include: { items: true, table: true },
    });
    const paid = orders.length
      ? orders
      : await prisma.order.findMany({
          where: {
            status: { in: ["paid", "completed"] },
            createdAt: { gte: start },
          },
          include: { items: true, table: true },
        });

    const source = paid;
    const totalSales = money(source.reduce((s, o) => s + o.total, 0));
    const orderCount = source.length;
    const avgTicket = orderCount ? money(totalSales / orderCount) : 0;
    const itemCount = source.reduce(
      (s, o) => s + o.items.filter((i) => i.status !== "cancelled").reduce((n, i) => n + i.qty, 0),
      0
    );

    const buckets = new Map<string, { label: string; sales: number; orders: number }>();
    const keyOf = (d: Date) => {
      if (range === "daily") return `${d.getHours()}:00`;
      return d.toISOString().slice(0, 10);
    };
    if (range === "daily") {
      for (let h = 0; h < 24; h++) buckets.set(`${h}:00`, { label: `${String(h).padStart(2, "0")}:00`, sales: 0, orders: 0 });
    }
    for (const order of source) {
      const when = order.completedAt || order.createdAt;
      const key = keyOf(when);
      const current = buckets.get(key) || { label: key, sales: 0, orders: 0 };
      current.sales = money(current.sales + order.total);
      current.orders += 1;
      buckets.set(key, current);
    }

    const itemMap = new Map<string, { name: string; qty: number; sales: number }>();
    for (const order of source) {
      for (const item of order.items.filter((i) => i.status !== "cancelled")) {
        const row = itemMap.get(item.name) || { name: item.name, qty: 0, sales: 0 };
        row.qty += item.qty;
        row.sales = money(row.sales + item.qty * item.price);
        itemMap.set(item.name, row);
      }
    }

    const methods = new Map<string, number>();
    for (const order of source) {
      const m = order.paymentMethod || "unknown";
      methods.set(m, money((methods.get(m) || 0) + order.total));
    }

    const types = new Map<string, number>();
    for (const order of source) {
      types.set(order.type, money((types.get(order.type) || 0) + order.total));
    }

    res.json({
      range,
      start: start.toISOString(),
      end: now.toISOString(),
      summary: { totalSales, orderCount, avgTicket, itemCount },
      series: [...buckets.values()],
      topItems: [...itemMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 8),
      payments: [...methods.entries()].map(([method, amount]) => ({ method, amount })),
      types: [...types.entries()].map(([type, amount]) => ({ type, amount })),
    });
  }));
}
