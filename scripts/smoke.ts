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
    if (kitchen.items.some((i) => i.status === "served")) throw new Error("kitchen send must not mark items served");
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

  await check("Kitchen add-on prints only new items", async () => {
    const cats = (await fetchJson("/api/menu")) as { items: { id: string; name: string }[] }[];
    const dishes = cats.flatMap((c) => c.items);
    const first = dishes[0];
    const second = dishes.find(
      (d) =>
        d.id !== first?.id &&
        !d.name.toLowerCase().includes((first?.name || "").toLowerCase()) &&
        !first?.name.toLowerCase().includes(d.name.toLowerCase())
    );
    if (!first || !second) throw new Error("need two menu items");
    const created = (await fetchJson("/api/orders", {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ type: "takeaway" }),
    })) as { id: string };
    await fetchJson(`/api/orders/${created.id}/items`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ menuItemId: first.id, qty: 1 }),
    });
    const wave1 = (await fetchJson(`/api/orders/${created.id}/send-kitchen`, {
      method: "POST",
      headers: auth(),
      body: "{}",
    })) as { content: string; order: { items: { status: string; name: string }[] } };
    if (wave1.order.items.some((i) => i.status === "served")) throw new Error("first send marked served");
    await fetchJson(`/api/orders/${created.id}/items`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ menuItemId: second.id, qty: 1 }),
    });
    const wave2 = (await fetchJson(`/api/orders/${created.id}/send-kitchen`, {
      method: "POST",
      headers: auth(),
      body: "{}",
    })) as { content: string; order: { items: { status: string; name: string }[] } };
    const slip = (wave2.content || "").toUpperCase();
    if (slip.includes(first.name.toUpperCase())) throw new Error("add-on slip reprinted the first item");
    if (!slip.includes(second.name.toUpperCase())) throw new Error("add-on slip missing the new item");
    if (!slip.includes("NEW ITEMS") && !slip.includes("ADD-ON")) throw new Error("add-on slip missing NEW ITEMS label");
    if (wave2.order.items.some((i) => i.status === "served")) throw new Error("add-on send marked served");
    return `${first.name} then ${second.name} only`;
  });

  await check("Clock in / out", async () => {
    const me = (await fetchJson("/api/time/me", { headers: auth() })) as { shift?: { id: string } | null };
    if (me.shift) {
      await fetchJson("/api/time/clock-out", { method: "POST", headers: auth(), body: "{}" });
    }
    const inn = (await fetchJson("/api/time/clock-in", { method: "POST", headers: auth(), body: "{}" })) as {
      shift?: { id: string };
    };
    if (!inn.shift?.id) throw new Error("clock-in did not return a shift");
    const out = (await fetchJson("/api/time/clock-out", { method: "POST", headers: auth(), body: "{}" })) as {
      shift?: { clockOut?: string | null };
    };
    if (!out.shift?.clockOut) throw new Error("clock-out missing timestamp");
  });

  await check("Split payment methods", async () => {
    const created = (await fetchJson("/api/orders", {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ type: "takeaway" }),
    })) as { id: string; total: number };
    const menu = (await fetchJson("/api/menu")) as { items: { id: string; price: number }[] }[];
    const dish = menu.flatMap((c) => c.items).find((i) => i.price > 1);
    if (!dish) throw new Error("no menu item");
    const ticket = (await fetchJson(`/api/orders/${created.id}/items`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ menuItemId: dish.id, qty: 1 }),
    })) as { total: number; id: string };
    const cash = Math.round((ticket.total / 2) * 100) / 100;
    const qr = Math.round((ticket.total - cash) * 100) / 100;
    const paid = (await fetchJson(`/api/orders/${ticket.id}/pay`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({
        payments: [
          { method: "cash", amount: cash },
          { method: "qr", amount: qr },
        ],
        paidAmount: cash,
      }),
    })) as { order: { paymentMethod: string; payments?: { method: string; amount: number }[] } };
    if (paid.order.paymentMethod !== "cash+qr") throw new Error(`expected cash+qr, got ${paid.order.paymentMethod}`);
    if ((paid.order.payments || []).length !== 2) throw new Error("expected two payment rows");
    return `${cash} cash + ${qr} qr`;
  });

  await check("Sales day 14:00–02:00", async () => {
    const report = (await fetchJson("/api/reports?period=day", { headers: auth() })) as {
      start: string;
      end: string;
      hours?: { startHour: number; endHour: number };
    };
    if (report.hours?.startHour !== 14 || report.hours?.endHour !== 2) {
      throw new Error(`hours ${report.hours?.startHour}-${report.hours?.endHour}`);
    }
    const start = new Date(report.start);
    const end = new Date(report.end);
    const bangkokHour = (when: Date) =>
      Number(
        new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", hour: "2-digit", hourCycle: "h23" }).format(when)
      );
    if (bangkokHour(start) !== 14) throw new Error(`start hour ${bangkokHour(start)}`);
    if (bangkokHour(end) !== 2) throw new Error(`end hour ${bangkokHour(end)}`);
    const spanH = (end.getTime() - start.getTime()) / 3600000;
    if (spanH !== 12) throw new Error(`span ${spanH}h`);
    return `${start.toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })} → ${end.toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })}`;
  });

  await check("Bill print can run twice", async () => {
    const created = (await fetchJson("/api/orders", {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ type: "takeaway" }),
    })) as { id: string };
    const menu = (await fetchJson("/api/menu")) as { items: { id: string }[] }[];
    const dish = menu.flatMap((c) => c.items)[0];
    if (!dish) throw new Error("no menu item");
    await fetchJson(`/api/orders/${created.id}/items`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ menuItemId: dish.id, qty: 1 }),
    });
    await fetchJson(`/api/orders/${created.id}/bill`, { method: "POST", headers: auth(), body: "{}" });
    await fetchJson(`/api/orders/${created.id}/bill`, { method: "POST", headers: auth(), body: "{}" });
    return "two sequential prints accepted";
  });

  await check("Bill groups items by diner name", async () => {
    const created = (await fetchJson("/api/orders", {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ type: "takeaway" }),
    })) as { id: string };
    const menu = (await fetchJson("/api/menu")) as { items: { id: string; name: string }[] }[];
    const dishes = menu.flatMap((c) => c.items);
    const first = dishes[0];
    const second = dishes.find((d) => d.id !== first?.id) || first;
    if (!first || !second) throw new Error("no menu item");
    await fetchJson(`/api/orders/${created.id}/items`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ menuItemId: first.id, qty: 1, diner: "Anna" }),
    });
    await fetchJson(`/api/orders/${created.id}/items`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ menuItemId: first.id, qty: 1, diner: "Anna" }),
    });
    await fetchJson(`/api/orders/${created.id}/items`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ menuItemId: second.id, qty: 1, diner: "Bob" }),
    });
    const ticket = (await fetchJson(`/api/orders/${created.id}`, { headers: auth() })) as {
      items: { diner?: string; qty: number; menuItemId?: string }[];
    };
    const anna = ticket.items.filter((i) => (i.diner || "") === "Anna");
    const bob = ticket.items.filter((i) => (i.diner || "") === "Bob");
    if (anna.length !== 1 || anna[0].qty !== 2) throw new Error("same diner should merge pending lines");
    if (bob.length !== 1) throw new Error("different diner should stay a separate line");
    const billed = (await fetchJson(`/api/orders/${created.id}/bill`, {
      method: "POST",
      headers: auth(),
      body: "{}",
    })) as { content: string };
    const slip = (billed.content || "").toUpperCase();
    if (!slip.includes("ANNA")) throw new Error("bill missing Anna");
    if (!slip.includes("BOB")) throw new Error("bill missing Bob");
    if (!slip.includes("ANNA TOTAL") || !slip.includes("BOB TOTAL")) throw new Error("bill missing person subtotals");
    if (!slip.includes("EACH PERSON")) throw new Error("bill missing each-person totals");
    return "Anna / Bob named on check";
  });

  await check("QR total bill groups by diner name", async () => {
    const tables = (await fetchJson("/api/tables", { headers: auth() })) as {
      id: string;
      qrToken: string;
      status: string;
    }[];
    let free: { id: string; qrToken: string } | undefined;
    for (const table of tables.filter((t) => t.status === "available" && t.qrToken)) {
      const preview = (await fetchJson(`/api/qr/${table.qrToken}`)) as { order?: { id?: string } | null };
      if (!preview.order) {
        free = table;
        break;
      }
    }
    if (!free?.qrToken) throw new Error("no empty table for QR check");
    const menu = (await fetchJson("/api/menu")) as { items: { id: string }[] }[];
    const dishes = menu.flatMap((c) => c.items);
    const first = dishes[0];
    const second = dishes.find((d) => d.id !== first?.id) || first;
    if (!first || !second) throw new Error("no menu item");
    const sent = (await fetchJson(`/api/qr/${free.qrToken}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { menuItemId: first.id, qty: 1, diner: "Anna" },
          { menuItemId: second.id, qty: 1, diner: "Bob" },
        ],
      }),
    })) as { id: string; items?: { diner?: string }[] };
    try {
      const qr = (await fetchJson(`/api/qr/${free.qrToken}`)) as {
        order?: { items?: { diner?: string }[] };
      };
      const people = [...new Set((qr.order?.items || sent.items || []).map((i) => String(i.diner || "").trim()).filter(Boolean))];
      if (!people.includes("Anna") || !people.includes("Bob")) throw new Error("QR bill missing named guests");
      return `QR ${people.sort().join(" / ")}`;
    } finally {
      await fetchJson(`/api/orders/${sent.id}/cancel`, { method: "POST", headers: auth(), body: "{}" });
    }
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
