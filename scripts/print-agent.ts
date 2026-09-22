/**
 * Shop-side print agent for DigitalOcean-hosted OmniMind POS.
 * Runs on a Mac/PC on the same LAN as the Xprinter and forwards queued jobs.
 *
 *   PRINT_AGENT_URL=http://178.128.81.13:8088 \
 *   PRINT_AGENT_TOKEN=your-secret \
 *   npm run print-agent
 */
import net from "node:net";

const SERVER = (process.env.PRINT_AGENT_URL || process.env.PUBLIC_URL || "http://127.0.0.1:8088").replace(/\/$/, "");
const TOKEN = process.env.PRINT_AGENT_TOKEN?.trim() || "";
const POLL_MS = Number(process.env.PRINT_AGENT_POLL_MS || 800);

if (!TOKEN) {
  console.error("Set PRINT_AGENT_TOKEN to the same value as on the DigitalOcean server .env");
  process.exit(1);
}

type AgentJob = {
  id: string;
  host: string;
  port: number;
  payload: string;
  title: string;
  type: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const err = data as { error?: string };
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return data as T;
}

function sendRaw(host: string, port: number, payload: Buffer) {
  return new Promise<void>((resolve, reject) => {
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

async function complete(id: string, ok: boolean, error?: string) {
  await api(`/api/print-agent/jobs/${id}/complete`, {
    method: "POST",
    body: JSON.stringify(ok ? { ok: true } : { ok: false, error: error || "failed" }),
  });
}

async function handleJob(job: AgentJob) {
  const host = job.host || "192.168.1.200";
  const port = job.port || 9100;
  console.log(`Printing ${job.type} · ${job.title} → ${host}:${port}`);
  try {
    const payload = Buffer.from(job.payload, "base64");
    await sendRaw(host, port, payload);
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
  const health = await api<{ ok: boolean; queued: number }>("/api/print-agent/health");
  console.log(`Connected · queued=${health.queued}`);

  for (;;) {
    try {
      const { job } = await api<{ job: AgentJob | null }>("/api/print-agent/next");
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
