import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";

export type KitchenMenuItem = {
  name: string;
  description?: string;
  price: number;
  sku: string;
  emoji: string;
  kitchenPrint: boolean;
};

export type KitchenMenuCategory = {
  name: string;
  emoji: string;
  kitchenPrint: boolean;
  items: KitchenMenuItem[];
};

export function loadKitchenMenu(): { categories: KitchenMenuCategory[]; itemCount: number } {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "kitchen-menu.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export async function createKitchenMenu(prisma: PrismaClient) {
  const { categories } = loadKitchenMenu();
  for (const [i, cat] of categories.entries()) {
    await prisma.category.create({
      data: {
        name: cat.name,
        sortOrder: i + 1,
        items: {
          create: cat.items.map((item, j) => ({
            name: item.name,
            description: item.description || "",
            price: item.price,
            emoji: item.emoji || "🍽️",
            sku: item.sku || "",
            kitchenPrint: item.kitchenPrint,
            sortOrder: j + 1,
            imageUrl: "",
          })),
        },
      },
    });
  }
}

export async function replaceKitchenMenu(prisma: PrismaClient) {
  await prisma.orderItem.updateMany({ data: { menuItemId: null } });
  await prisma.menuItem.deleteMany();
  await prisma.category.deleteMany();
  await createKitchenMenu(prisma);
}
