import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import multer from "multer";
import type { Request, Response, NextFunction } from "express";

const menuDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../uploads/menu");
fs.mkdirSync(menuDir, { recursive: true });

const allowed = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export const menuUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, menuDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      cb(null, `${crypto.randomUUID()}${allowed.has(ext) ? ext : ".jpg"}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Please upload a JPG, PNG, WEBP, or GIF image"));
  },
});

export function withMenuImage(req: Request, res: Response, next: NextFunction) {
  const ct = String(req.headers["content-type"] || "");
  if (!ct.includes("multipart/form-data")) {
    next();
    return;
  }
  menuUpload.single("image")(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : "Image upload failed";
      res.status(400).json({ error: message });
      return;
    }
    next();
  });
}

export function publicImageUrl(filename: string) {
  return `/uploads/menu/${filename}`;
}

export function removeImageFile(url?: string | null) {
  if (!url || !url.startsWith("/uploads/menu/")) return;
  const file = path.join(menuDir, path.basename(url));
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export function asBool(value: unknown, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return String(value) === "true" || String(value) === "1";
}
