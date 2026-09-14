import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { createKitchenMenu } from "./kitchen-menu.ts";

const prisma = new PrismaClient();

async function main() {
  await prisma.printJob.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.inboxMessage.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.category.deleteMany();
  await prisma.diningTable.deleteMany();
  await prisma.promotion.deleteMany();
  await prisma.printer.deleteMany();
  await prisma.user.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.counter.deleteMany();

  const password = async (plain: string) => bcrypt.hash(plain, 10);
  const pin = async (plain: string) => bcrypt.hash(plain, 10);

  await prisma.user.createMany({
    data: [
      {
        name: "Ava Chen",
        email: "admin@gardentable.local",
        passwordHash: await password("admin123"),
        pinHash: await pin("1234"),
        role: "admin",
      },
      {
        name: "Marcus Hale",
        email: "manager@gardentable.local",
        passwordHash: await password("manager123"),
        pinHash: await pin("5555"),
        role: "manager",
      },
      {
        name: "Sofia Reyes",
        email: "cashier@gardentable.local",
        passwordHash: await password("cashier123"),
        pinHash: await pin("2222"),
        role: "cashier",
      },
      {
        name: "Liam Park",
        email: "waiter@gardentable.local",
        passwordHash: await password("waiter123"),
        pinHash: await pin("4444"),
        role: "waiter",
      },
      {
        name: "Nina Brooks",
        email: "kitchen@gardentable.local",
        passwordHash: await password("kitchen123"),
        pinHash: await pin("3333"),
        role: "kitchen",
      },
    ],
  });

  await createKitchenMenu(prisma);

  const tables = [
    { number: 1, name: "Window 1", seats: 2, posX: 8, posY: 12 },
    { number: 2, name: "Window 2", seats: 2, posX: 24, posY: 12 },
    { number: 3, name: "Lounge 3", seats: 4, posX: 44, posY: 10 },
    { number: 4, name: "Lounge 4", seats: 4, posX: 62, posY: 10 },
    { number: 5, name: "Booth 5", seats: 4, posX: 82, posY: 14 },
    { number: 6, name: "Booth 6", seats: 4, posX: 82, posY: 38 },
    { number: 7, name: "Patio 7", seats: 6, posX: 10, posY: 42 },
    { number: 8, name: "Patio 8", seats: 6, posX: 30, posY: 42 },
    { number: 9, name: "Center 9", seats: 4, posX: 50, posY: 40 },
    { number: 10, name: "Center 10", seats: 4, posX: 66, posY: 40 },
    { number: 11, name: "Bar 11", seats: 2, posX: 12, posY: 72 },
    { number: 12, name: "Bar 12", seats: 2, posX: 28, posY: 72 },
    { number: 13, name: "Private 13", seats: 8, posX: 54, posY: 70 },
    { number: 14, name: "Private 14", seats: 8, posX: 76, posY: 70 },
  ];

  for (const t of tables) {
    await prisma.diningTable.create({
      data: { ...t, qrToken: `tbl-${t.number}-${Math.random().toString(36).slice(2, 8)}` },
    });
  }

  const now = new Date();
  const nextMonth = new Date(now);
  nextMonth.setMonth(now.getMonth() + 2);

  await prisma.promotion.createMany({
    data: [
      {
        name: "Lunch 10% Off",
        type: "percent",
        value: 10,
        minOrder: 250,
        active: true,
        startDate: now,
        endDate: nextMonth,
      },
      {
        name: "Welcome ฿50 Off",
        type: "fixed",
        value: 50,
        minOrder: 300,
        active: true,
        startDate: now,
        endDate: nextMonth,
      },
      {
        name: "Happy Hour 15%",
        type: "percent",
        value: 15,
        minOrder: 200,
        active: true,
        startDate: now,
        endDate: nextMonth,
      },
    ],
  });

  await prisma.printer.createMany({
    data: [
      {
        name: "Kitchen Expo",
        type: "kitchen",
        connection: "network",
        host: "192.168.1.50",
        port: 9100,
        paperWidth: 42,
        cashDrawerEnabled: false,
        active: true,
      },
      {
        name: "Cashier Receipt",
        type: "receipt",
        connection: "network",
        host: "192.168.1.51",
        port: 9100,
        paperWidth: 42,
        cashDrawerEnabled: true,
        active: true,
      },
    ],
  });

  await prisma.setting.createMany({
    data: [
      { id: "restaurantName", value: "4 Corner Bar & Restaurant" },
      { id: "address", value: "4 Corner" },
      { id: "phone", value: "(555) 014-2200" },
      { id: "currency", value: "฿" },
      { id: "taxRate", value: "7" },
      { id: "serviceRate", value: "0" },
      { id: "footerNote", value: "Thank you for visiting 4 Corner." },
      { id: "publicUrl", value: process.env.PUBLIC_URL || "http://localhost:5173" },
    ],
  });

  const admin = await prisma.user.findFirst({ where: { email: "admin@gardentable.local" } });
  const cashier = await prisma.user.findFirst({ where: { email: "cashier@gardentable.local" } });
  const menuItems = await prisma.menuItem.findMany({ take: 8 });
  const tableRows = await prisma.diningTable.findMany({ take: 8 });
  let orderNo = 980;
  for (let d = 0; d < 16; d++) {
    const count = 2 + (d % 4);
    for (let i = 0; i < count; i++) {
      const when = new Date();
      when.setDate(when.getDate() - d);
      when.setHours(11 + (i * 2), 10 + i, 0, 0);
      const item = menuItems[i % menuItems.length];
      const extra = menuItems[(i + 3) % menuItems.length];
      const qty = 1 + (i % 3);
      const subtotal = Math.round((item.price * qty + extra.price) * 100) / 100;
      const taxAmount = Math.round(subtotal * 0.07 * 100) / 100;
      const total = Math.round((subtotal + taxAmount) * 100) / 100;
      await prisma.order.create({
        data: {
          orderNo: orderNo++,
          tableId: tableRows[i % tableRows.length].id,
          type: i % 4 === 0 ? "qr" : i % 5 === 0 ? "takeaway" : "dine_in",
          status: "completed",
          waiterId: admin?.id,
          cashierId: cashier?.id,
          taxRate: 7,
          subtotal,
          taxAmount,
          total,
          paidAmount: total,
          paymentMethod: i % 3 === 0 ? "cash" : i % 3 === 1 ? "card" : "qr",
          completedAt: when,
          createdAt: when,
          items: {
            create: [
              { menuItemId: item.id, name: item.name, price: item.price, qty, status: "ready" },
              { menuItemId: extra.id, name: extra.name, price: extra.price, qty: 1, status: "ready" },
            ],
          },
        },
      });
    }
  }

  await prisma.counter.create({ data: { id: "orderNo", value: Math.max(orderNo, 1000) } });

  await prisma.inboxMessage.create({
    data: {
      type: "system",
      title: "OmniMind POS is ready",
      body: "4 Corner Bar & Restaurant is set up. Open the floor map or scan a table QR to take the first order.",
      meta: "{}",
    },
  });

  console.log("Seeded OmniMind POS · 4 Corner Bar & Restaurant");
  console.log("Logins:");
  console.log("  admin@gardentable.local / admin123  PIN 1234");
  console.log("  manager@gardentable.local / manager123  PIN 5555");
  console.log("  cashier@gardentable.local / cashier123  PIN 2222");
  console.log("  waiter@gardentable.local / waiter123  PIN 4444");
  console.log("  kitchen@gardentable.local / kitchen123  PIN 3333");
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
