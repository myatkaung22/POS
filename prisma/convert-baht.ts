import { PrismaClient } from "@prisma/client";
import { calcPricing } from "../server/pricing.ts";

const prisma = new PrismaClient();

const menuPrices: Record<string, number> = {
  "ST-01": 220,
  "ST-02": 240,
  "ST-03": 120,
  "ST-04": 180,
  "MN-01": 320,
  "MN-02": 380,
  "MN-03": 290,
  "MN-04": 250,
  "MN-05": 340,
  "MN-06": 280,
  "SD-01": 90,
  "SD-02": 50,
  "SD-03": 80,
  "DS-01": 150,
  "DS-02": 140,
  "DR-01": 80,
  "DR-02": 70,
  "DR-03": 180,
  "DR-04": 40,
  "DR-05": 160,
};

async function main() {
  await prisma.setting.upsert({
    where: { id: "currency" },
    update: { value: "฿" },
    create: { id: "currency", value: "฿" },
  });
  await prisma.setting.upsert({
    where: { id: "taxRate" },
    update: { value: "7" },
    create: { id: "taxRate", value: "7" },
  });

  const items = await prisma.menuItem.findMany();
  for (const item of items) {
    const next = menuPrices[item.sku] ?? (item.price < 80 ? Math.round(item.price * 35) : item.price);
    if (next !== item.price) {
      await prisma.menuItem.update({ where: { id: item.id }, data: { price: next } });
    }
  }

  const menuById = Object.fromEntries((await prisma.menuItem.findMany()).map((i) => [i.id, i.price]));
  const lines = await prisma.orderItem.findMany();
  for (const line of lines) {
    const catalog = line.menuItemId ? menuById[line.menuItemId] : undefined;
    const next = catalog ?? (line.price < 80 ? Math.round(line.price * 35) : line.price);
    if (next !== line.price) {
      await prisma.orderItem.update({ where: { id: line.id }, data: { price: next } });
    }
  }

  const promos = await prisma.promotion.findMany();
  for (const promo of promos) {
    const data: { name?: string; value?: number; minOrder?: number } = {};
    if (promo.name.includes("$5") || promo.name.includes("Welcome")) {
      data.name = "Welcome ฿50 Off";
      if (promo.type === "fixed") data.value = 50;
      data.minOrder = 300;
    } else if (promo.name.includes("Lunch")) {
      data.minOrder = 250;
    } else if (promo.name.includes("Happy Hour")) {
      data.minOrder = 200;
    }
    if (promo.type === "fixed" && promo.value < 20) data.value = 50;
    if (Object.keys(data).length) {
      await prisma.promotion.update({ where: { id: promo.id }, data });
    }
  }

  const orders = await prisma.order.findMany({ include: { items: true, promotion: true } });
  for (const order of orders) {
    const pricing = calcPricing({
      items: order.items,
      taxRate: order.taxRate,
      serviceRate: order.serviceRate,
      discountType: order.discountType,
      discountValue: order.discountValue,
      promotion: order.promotion,
    });
    const paid = ["paid", "completed"].includes(order.status) ? pricing.total : order.paidAmount;
    await prisma.order.update({
      where: { id: order.id },
      data: {
        ...pricing,
        paidAmount: paid,
        changeAmount: 0,
      },
    });
  }

  console.log("Converted prices and settings to Thai baht.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
