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

export function slipDestinations(slips?: { station?: string }[] | null) {
  const labels = (slips || []).map((slip) => (slip.station === "front_desk" ? "Front Desk" : "Kitchen"));
  return [...new Set(labels)].join(" + ");
}
