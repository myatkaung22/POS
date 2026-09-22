export const DEFAULT_CURRENCY = "฿";

export function currencySymbol(raw?: string | null) {
  const value = (raw || DEFAULT_CURRENCY).trim();
  if (!value || value === "$" || value.toUpperCase() === "USD" || value.toUpperCase() === "THB" || value.toLowerCase() === "baht") {
    return DEFAULT_CURRENCY;
  }
  return value;
}

export function formatMoney(n: number, currency?: string | null, ascii = false, decimals = 2) {
  const places = Math.min(2, Math.max(0, Number.isFinite(Number(decimals)) ? Math.round(Number(decimals)) : 2));
  const amount = Number(n || 0).toFixed(places);
  const symbol = currencySymbol(currency);
  if (ascii && symbol === DEFAULT_CURRENCY) return `THB ${amount}`;
  return `${symbol}${amount}`;
}
