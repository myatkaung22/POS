import { PrismaClient } from "@prisma/client";
import { currencySymbol } from "./currency.ts";

export const prisma = new PrismaClient();

export const orderInclude = {
  items: { orderBy: { createdAt: "asc" as const } },
  payments: { orderBy: { createdAt: "asc" as const } },
  table: true,
  waiter: { select: { id: true, name: true, role: true } },
  cashier: { select: { id: true, name: true, role: true } },
  promotion: true,
};

const SETTING_DEFAULTS: Record<string, string> = {
  billDecimals: "2",
  dayStartHour: "14",
  dayEndHour: "2",
};

export async function getSettingsMap() {
  const rows = await prisma.setting.findMany();
  const settings = { ...SETTING_DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.id, r.value])) } as Record<string, string>;
  settings.currency = currencySymbol(settings.currency);
  return settings;
}

export async function nextOrderNo() {
  const row = await prisma.counter.update({
    where: { id: "orderNo" },
    data: { value: { increment: 1 } },
  });
  return row.value;
}
