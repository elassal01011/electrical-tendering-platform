import { z } from "zod";

// Browser-safe validation shared by the signup form and server. Never import env
// configuration or password hashing into this module.
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_.]+$/, "Use only letters, numbers, underscores and dots.");
export const profileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  username: usernameSchema,
});
export const signupPasswordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .refine(
    (value) => new TextEncoder().encode(value).length <= 72,
    "Use no more than 72 UTF-8 bytes.",
  );
export const signupSchema = profileSchema
  .extend({
    email: z.string().trim().toLowerCase().email(),
    password: signupPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export function safeAuthRedirect(url: string, baseUrl: string) {
  try {
    const base = new URL(baseUrl);
    const target = new URL(url, base);
    if (target.origin === base.origin && !target.username && !target.password)
      return target.href;
    return new URL("/dashboard", base).href;
  } catch {
    return new URL("/dashboard", baseUrl).href;
  }
}
