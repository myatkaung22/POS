import type { Request, Response, NextFunction } from "express";
import { prisma } from "./db.ts";

export function printAgentConfigured() {
  return Boolean(process.env.PRINT_AGENT_TOKEN?.trim());
}

export function printAgentRequired(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.PRINT_AGENT_TOKEN?.trim();
  if (!expected) {
    res.status(503).json({ error: "Print agent is not configured on this server" });
    return;
  }
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : String(req.headers["x-print-agent-token"] || "");
  if (!token || token !== expected) {
    res.status(401).json({ error: "Invalid print agent token" });
    return;
  }
  next();
}

export async function claimNextAgentJob() {
  const pending = await prisma.printJob.findFirst({
    where: { status: "queued", payload: { not: "" } },
    orderBy: { createdAt: "asc" },
  });
  if (!pending) return null;

  const claimed = await prisma.printJob.updateMany({
    where: { id: pending.id, status: "queued" },
    data: { status: "claimed" },
  });
  if (claimed.count !== 1) return null;

  return prisma.printJob.findUnique({ where: { id: pending.id } });
}

export async function completeAgentJob(id: string, result: { ok: boolean; error?: string }) {
  const job = await prisma.printJob.findUnique({ where: { id } });
  if (!job || (job.status !== "claimed" && job.status !== "queued")) {
    return null;
  }
  return prisma.printJob.update({
    where: { id },
    data: result.ok
      ? { status: "printed", error: "" }
      : { status: "failed", error: String(result.error || "Print agent failed").slice(0, 500) },
  });
}

export function agentHeartbeat() {
  return {
    ok: true,
    queued: true as const,
    serverTime: new Date().toISOString(),
  };
}
