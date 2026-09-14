export const DEFAULT_CURRENCY = "฿";

export function currencySymbol(raw?: string | null) {
  const value = (raw || DEFAULT_CURRENCY).trim();
  if (!value || value === "$" || value.toUpperCase() === "USD" || value.toUpperCase() === "THB" || value.toLowerCase() === "baht") {
    return DEFAULT_CURRENCY;
  }
  return value;
}

export function formatMoney(n: number, currency?: string | null, ascii = false) {
  const amount = Number(n || 0).toFixed(2);
  const symbol = currencySymbol(currency);
  if (ascii && symbol === DEFAULT_CURRENCY) return `THB ${amount}`;
  return `${symbol}${amount}`;
}
