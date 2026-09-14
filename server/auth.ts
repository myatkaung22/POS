import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "./db.ts";
import { assertPermission, type Permission } from "./permissions.ts";

const JWT_SECRET = process.env.JWT_SECRET || "garden-table-pos-dev-secret-change-me";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export function signToken(user: AuthUser) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "12h" });
}

export function authOptional(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET) as AuthUser;
    } catch {
      req.user = undefined;
    }
  }
  next();
}

export function authRequired(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET) as AuthUser;
    next();
  } catch {
    res.status(401).json({ error: "Session expired" });
  }
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Sign in required" });
      return;
    }
    try {
      assertPermission(req.user.role, permission);
      next();
    } catch {
      res.status(403).json({ error: "You do not have permission for this action" });
    }
  };
}

export async function findUserForLogin(email?: string, pin?: string) {
  if (pin) {
    const users = await prisma.user.findMany({ where: { active: true, pinHash: { not: null } } });
    const bcrypt = await import("bcryptjs");
    for (const user of users) {
      if (user.pinHash && (await bcrypt.default.compare(pin, user.pinHash))) return user;
    }
    return null;
  }
  if (!email) return null;
  return prisma.user.findFirst({
    where: { email: email.toLowerCase().trim(), active: true },
  });
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
