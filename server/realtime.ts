import type { Server as SocketServer } from "socket.io";
import { prisma } from "./db.ts";

let ioRef: SocketServer | null = null;

export function attachIo(io: SocketServer) {
  ioRef = io;
}

export function emitAll(event: string, payload: unknown) {
  ioRef?.emit(event, payload);
}

export async function pushInbox(data: { type: string; title: string; body: string; meta?: unknown }) {
  const message = await prisma.inboxMessage.create({
    data: {
      type: data.type,
      title: data.title,
      body: data.body,
      meta: JSON.stringify(data.meta ?? {}),
    },
  });
  emitAll("inbox:new", message);
  return message;
}
