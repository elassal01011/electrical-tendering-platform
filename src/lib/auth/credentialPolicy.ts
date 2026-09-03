import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { z } from "zod";

export const BCRYPT_ROUNDS = 12;
export const LOGIN_ATTEMPT_LIMIT = 8;
export const LOGIN_WINDOW_MINUTES = 15;
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const loginAttemptKey = (email: string) =>
  createHash("sha256").update(normalizeEmail(email)).digest("hex");

export const emailSchema = z.string().trim().toLowerCase().email();
export const newPasswordSchema = z.string().refine((value) => {
  const bytes = Buffer.byteLength(value, "utf8");
  return bytes >= 12 && bytes <= 72;
}, "Password must contain 12–72 UTF-8 bytes.");

export async function hashPassword(password: string) {
  return bcrypt.hash(newPasswordSchema.parse(password), BCRYPT_ROUNDS);
}

export const comparePassword = (password: string, hash: string) =>
  bcrypt.compare(password, hash);
