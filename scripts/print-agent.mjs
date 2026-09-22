#!/usr/bin/env node
/**
 * Shop print agent — runs on a PC, Mac, or Android (Termux).
 * Must be on the same Wi‑Fi as the Xprinter.
 *
 *   PRINT_AGENT_URL=http://178.128.81.13:8088 \
 *   PRINT_AGENT_TOKEN=your-secret \
 *   node scripts/print-agent.mjs
 */
import net from "node:net";

const SERVER = (process.env.PRINT_AGENT_URL || "http://178.128.81.13:8088").replace(/\/$/, "");
const TOKEN = (process.env.PRINT_AGENT_TOKEN || "").trim();
const POLL_MS = Number(process.env.PRINT_AGENT_POLL_MS || 800);

if (!TOKEN) {
  console.error("Set PRINT_AGENT_TOKEN (same value as on the DigitalOcean server)");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function api(path, init = {}) {
  const res = await fetch(`${SERVER}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function sendRaw(host, port, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port }, () => {
      socket.write(payload, (err) => {
        if (err) {
          socket.destroy();
          reject(err);
          return;
        }
        socket.end();
        resolve();
      });
    });
    socket.setTimeout(5000);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error(`Printer timed out (${host}:${port})`));
    });
    socket.on("error", reject);
  });
}

async function complete(id, ok, error) {
  await api(`/api/print-agent/jobs/${id}/complete`, {
    method: "POST",
    body: JSON.stringify(ok ? { ok: true } : { ok: false, error: error || "failed" }),
  });
}

async function handleJob(job) {
  const host = job.host || "192.168.1.200";
  const port = job.port || 9100;
  console.log(`Printing ${job.type} · ${job.title} → ${host}:${port}`);
  try {
    await sendRaw(host, port, Buffer.from(job.payload, "base64"));
    await complete(job.id, true);
    console.log(`OK ${job.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Print failed";
    console.error(`FAIL ${job.id}: ${message}`);
    try {
      await complete(job.id, false, message);
    } catch (reportErr) {
      console.error("Could not report failure:", reportErr);
    }
  }
}

async function loop() {
  console.log(`OmniMind print agent → ${SERVER}`);
  const health = await api("/api/print-agent/health");
  console.log(`Connected · queued=${health.queued}`);
  for (;;) {
    try {
      const { job } = await api("/api/print-agent/next");
      if (job) {
        await handleJob(job);
        continue;
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      await sleep(2000);
      continue;
    }
    await sleep(POLL_MS);
  }
}

loop().catch((err) => {
  console.error(err);
  process.exit(1);
});
