export type PricingInput = {
  items: { price: number; qty: number; status?: string }[];
  taxRate: number;
  serviceRate: number;
  discountType: string;
  discountValue: number;
  promotion?: { type: string; value: number; minOrder: number; active: boolean; startDate?: Date | null; endDate?: Date | null } | null;
};

export type PricingResult = {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  serviceAmount: number;
  total: number;
};

function money(n: number) {
  return Math.round(n * 100) / 100;
}

export function calcPricing(input: PricingInput): PricingResult {
  const subtotal = money(
    input.items
      .filter((i) => i.status !== "cancelled")
      .reduce((sum, i) => sum + i.price * i.qty, 0)
  );

  let discountAmount = 0;
  const now = new Date();
  const promo = input.promotion;
  const promoOk =
    promo &&
    promo.active &&
    subtotal >= (promo.minOrder || 0) &&
    (!promo.startDate || promo.startDate <= now) &&
    (!promo.endDate || promo.endDate >= now);

  if (input.discountType === "promotion" && promoOk && promo) {
    discountAmount =
      promo.type === "percent" ? subtotal * (promo.value / 100) : promo.value;
  } else if (input.discountType === "percent") {
    discountAmount = subtotal * (input.discountValue / 100);
  } else if (input.discountType === "fixed") {
    discountAmount = input.discountValue;
  }

  discountAmount = money(Math.min(Math.max(discountAmount, 0), subtotal));
  const taxable = money(Math.max(subtotal - discountAmount, 0));
  const taxAmount = money(taxable * ((input.taxRate || 0) / 100));
  const serviceAmount = money(taxable * ((input.serviceRate || 0) / 100));
  const total = money(taxable + taxAmount + serviceAmount);

  return { subtotal, discountAmount, taxAmount, serviceAmount, total };
}
