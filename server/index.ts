import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { prisma } from "./db.ts";
import { authOptional } from "./auth.ts";
import { registerRoutes } from "./api.ts";
import { attachIo } from "./realtime.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
});

attachIo(io);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(path.resolve(__dirname, "../uploads")));
app.use(authOptional);

registerRoutes(app);

const dist = path.resolve(__dirname, "../dist");
app.use(express.static(dist));
app.get(/^(?!\/api\/)(?!\/socket\.io\/).*/, (_req, res, next) => {
  res.sendFile(path.join(dist, "index.html"), (err) => {
    if (err) next();
  });
});

io.on("connection", (socket) => {
  socket.emit("hello", { ok: true });
});

function lanUrl(port: number) {
  const nets = os.networkInterfaces();
  for (const addrs of Object.values(nets)) {
    for (const addr of addrs || []) {
      if (addr.family === "IPv4" && !addr.internal) return `http://${addr.address}:${port}`;
    }
  }
  return `http://localhost:${port}`;
}

httpServer.listen(PORT, HOST, () => {
  console.log(`OmniMind POS API on http://localhost:${PORT}`);
  console.log(`LAN API ${lanUrl(PORT)} · Guest QR should use LAN Vite URL on port 5173`);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
