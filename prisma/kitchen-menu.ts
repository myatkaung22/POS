import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { isDrinkCategory } from "../server/stations.ts";

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

export function mergeDrinkCategoriesInMenu(data: { categories: KitchenMenuCategory[]; itemCount?: number }) {
  const drinks: KitchenMenuItem[] = [];
  const food: KitchenMenuCategory[] = [];
  for (const cat of data.categories) {
    if (isDrinkCategory(cat.name)) {
      drinks.push(...cat.items.map((item) => ({ ...item, kitchenPrint: false, emoji: item.emoji || "🍹" })));
    } else {
      food.push(cat);
    }
  }
  if (drinks.length) {
    food.push({
      name: "Drink",
      emoji: "🍹",
      kitchenPrint: false,
      items: drinks,
    });
  }
  return {
    ...data,
    categories: food,
    itemCount: food.reduce((sum, cat) => sum + cat.items.length, 0),
  };
}

export function rewriteKitchenMenuJson() {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "kitchen-menu.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as { categories: KitchenMenuCategory[]; itemCount?: number };
  const merged = mergeDrinkCategoriesInMenu(data);
  fs.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

export async function mergeDrinkCategory(prisma: PrismaClient) {
  const cats = await prisma.category.findMany({ include: { items: true }, orderBy: { sortOrder: "asc" } });
  const drinkCats = cats.filter((cat) => isDrinkCategory(cat.name));
  if (!drinkCats.length) return { moved: 0, name: "Drink" };

  let dest = cats.find((cat) => cat.name.trim().toLowerCase() === "drink");
  const maxSort = Math.max(0, ...cats.map((cat) => cat.sortOrder));
  if (!dest) {
    dest = await prisma.category.create({
      data: { name: "Drink", sortOrder: maxSort + 1, active: true },
    });
  }

  const existing = await prisma.menuItem.count({ where: { categoryId: dest.id } });
  let sort = existing;
  let moved = 0;
  for (const cat of drinkCats) {
    const items = cat.id === dest.id ? cat.items : cat.items;
    for (const item of items) {
      sort += 1;
      await prisma.menuItem.update({
        where: { id: item.id },
        data: {
          categoryId: dest.id,
          kitchenPrint: false,
          sortOrder: sort,
        },
      });
      moved += 1;
    }
    if (cat.id !== dest.id) {
      await prisma.category.delete({ where: { id: cat.id } });
    }
  }
  return { moved, name: dest.name };
}
