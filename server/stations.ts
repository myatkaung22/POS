export type PrintStation = "kitchen" | "front_desk";

const DRINK_CATEGORY_NAMES = new Set([
  "drink",
  "drinks",
  "classic cocktails",
  "beer bottle",
  "draft beer",
  "soft drinks",
  "brandy",
  "gin",
  "rum",
  "tequila",
  "vodka",
  "whisky",
  "whiskey",
  "liqueur",
  "beer",
  "cocktail",
  "cocktails",
]);

export function isDrinkCategory(name?: string | null) {
  return DRINK_CATEGORY_NAMES.has(String(name || "").trim().toLowerCase());
}

export function isDrinkItem(item: { menuItem?: { category?: { name?: string | null } | null } | null } | null | undefined) {
  return isDrinkCategory(item?.menuItem?.category?.name);
}

export function stationOf(item: { menuItem?: { category?: { name?: string | null } | null } | null } | null | undefined): PrintStation {
  return isDrinkItem(item) ? "front_desk" : "kitchen";
}

export function splitByStation<T extends { menuItem?: { category?: { name?: string | null } | null; kitchenPrint?: boolean } | null }>(
  items: T[]
): { kitchen: T[]; drinks: T[] } {
  const kitchen: T[] = [];
  const drinks: T[] = [];
  for (const item of items) {
    if (isDrinkItem(item)) drinks.push(item);
    else if (item.menuItem?.kitchenPrint !== false) kitchen.push(item);
  }
  return { kitchen, drinks };
}
