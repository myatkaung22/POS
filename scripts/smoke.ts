import ExcelJS from "exceljs";

const API = process.env.SMOKE_API || "http://127.0.0.1:3001";
const UI = process.env.SMOKE_UI || "http://127.0.0.1:5173";
const PIN = process.env.SMOKE_PIN || "1234";

type Check = { name: string; ok: boolean; detail?: string };

const results: Check[] = [];

async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = (await fn()) || undefined;
    results.push({ name, ok: true, detail });
    console.log(`PASS  ${name}${detail ? ` · ${detail}` : ""}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail });
    console.log(`FAIL  ${name} · ${detail}`);
  }
}

async function fetchJson(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, init);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    const err = typeof body === "object" && body && "error" in body ? String((body as { error: string }).error) : text.slice(0, 180);
    throw new Error(`${res.status} ${err}`);
  }
  return body;
}

async function main() {
  await check("API health", async () => {
    const data = (await fetchJson("/api/health")) as { ok?: boolean };
    if (!data.ok) throw new Error("health did not return ok");
  });

  await check("Vite UI", async () => {
    const res = await fetch(UI);
    if (!res.ok) throw new Error(`UI status ${res.status}`);
    const html = await res.text();
    if (!html.includes("<div id=\"root\">") && !html.includes("id=\"root\"")) throw new Error("UI HTML missing root");
    return UI;
  });

  await check("Public menu", async () => {
    const cats = (await fetchJson("/api/menu")) as { name: string; items: unknown[] }[];
    if (!Array.isArray(cats) || cats.length === 0) throw new Error("no categories");
    const items = cats.reduce((n, c) => n + (c.items?.length || 0), 0);
    return `${cats.length} categories, ${items} items`;
  });

  let token = "";
  await check("Admin PIN login", async () => {
    const data = (await fetchJson("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: PIN }),
    })) as { token?: string; user?: { role?: string; name?: string } };
    if (!data.token) throw new Error("no token");
    token = data.token;
    return `${data.user?.name || "user"} (${data.user?.role || "?"})`;
  });

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  await check("Bootstrap", async () => {
    const data = (await fetchJson("/api/bootstrap", { headers: auth() })) as { settings?: { restaurantName?: string } };
    return data.settings?.restaurantName || "settings loaded";
  });

  await check("Tables", async () => {
    const tables = (await fetchJson("/api/tables", { headers: auth() })) as unknown[];
    return `${tables.length} tables`;
  });

  await check("Orders list", async () => {
    const orders = (await fetchJson("/api/orders", { headers: auth() })) as unknown[];
    return `${orders.length} orders`;
  });

  await check("Inbox", async () => {
    const inbox = (await fetchJson("/api/inbox", { headers: auth() })) as unknown[];
    return `${inbox.length} messages`;
  });

  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const month = String(now.getMonth() + 1);
  const year = String(now.getFullYear());

  for (const [name, qs] of [
    ["Reports day", `period=day&date=${date}`],
    ["Reports month", `period=month&month=${month}&year=${year}`],
    ["Reports year", `period=year&year=${year}`],
  ] as const) {
    await check(name, async () => {
      const report = (await fetchJson(`/api/reports?${qs}`, { headers: auth() })) as {
        label?: string;
        summary?: { totalSales?: number; orderCount?: number };
        categoryOptions?: string[];
      };
      return `${report.label} · ${report.summary?.orderCount ?? 0} orders · ${report.summary?.totalSales ?? 0} sales · ${(report.categoryOptions || []).length} categories`;
    });
  }

  await check("Excel export (all categories)", async () => {
    const res = await fetch(`${API}/api/reports/export.xlsx?period=month&month=${month}&year=${year}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`export status ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error(`file too small (${buf.length} bytes)`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const names = wb.worksheets.map((s) => s.name);
    for (const required of ["Summary", "By category", "Payments", "Order type", "Sales over time", "Orders"]) {
      if (!names.includes(required)) throw new Error(`missing sheet ${required}`);
    }
    const disposition = res.headers.get("content-disposition") || "";
    return `${buf.length} bytes · ${names.length} sheets · ${disposition || names.join(", ")}`;
  });

  await check("Excel export (one category)", async () => {
    const report = (await fetchJson(`/api/reports?period=month&month=${month}&year=${year}`, { headers: auth() })) as {
      categoryOptions?: string[];
    };
    const category = (report.categoryOptions || [])[0];
    if (!category) throw new Error("no category options");
    const res = await fetch(
      `${API}/api/reports/export.xlsx?period=month&month=${month}&year=${year}&category=${encodeURIComponent(category)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`export status ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const names = wb.worksheets.map((s) => s.name);
    if (!names.includes("Summary")) throw new Error("missing Summary");
    return `${category} · ${buf.length} bytes · ${names.join(", ")}`;
  });

  await check("Serve all items", async () => {
    const cats = (await fetchJson("/api/menu")) as { items: { id: string; name: string }[] }[];
    const dish = cats.flatMap((c) => c.items)[0];
    if (!dish) throw new Error("no menu item");
    const created = (await fetchJson("/api/orders", {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ type: "takeaway" }),
    })) as { id: string; orderNo: number };
    await fetchJson(`/api/orders/${created.id}/items`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ menuItemId: dish.id, qty: 1 }),
    });
    await fetchJson(`/api/orders/${created.id}/send-kitchen`, { method: "POST", headers: auth(), body: "{}" });
    const kitchen = (await fetchJson(`/api/orders/${created.id}`, { headers: auth() })) as {
      status: string;
      items: { id: string; status: string }[];
    };
    if (kitchen.status !== "in_kitchen") throw new Error(`expected in_kitchen, got ${kitchen.status}`);
    const served = (await fetchJson(`/api/orders/${created.id}/item-status`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ itemIds: kitchen.items.map((i) => i.id), status: "served" }),
    })) as { items: { status: string }[]; total: number };
    const live = served.items.filter((i) => i.status !== "cancelled");
    if (!live.length || live.some((i) => i.status !== "served")) throw new Error("items were not marked served");
    await fetchJson(`/api/orders/${created.id}/pay`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ paymentMethod: "cash", paidAmount: served.total }),
    });
    return `#${created.orderNo} all served`;
  });

  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
