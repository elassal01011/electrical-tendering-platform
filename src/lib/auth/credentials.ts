import type { PrismaClient } from "@prisma/client";
import { reserveAttempt } from "./rateLimit";
import { randomUUID } from "node:crypto";
import {
  comparePassword,
  LOGIN_ATTEMPT_LIMIT,
  LOGIN_WINDOW_MINUTES,
  loginAttemptKey,
  normalizeEmail,
} from "./credentialPolicy";

type FailureReason =
  | "USER_NOT_FOUND"
  | "INVALID_PASSWORD"
  | "USER_INACTIVE"
  | "RATE_LIMITED"
  | "DATABASE_ERROR";

export async function authorizeCredentials(
  prisma: PrismaClient,
  credentials:
    | { identifier?: string; email?: string; password?: string }
    | undefined,
) {
  const email = normalizeEmail(
    credentials?.identifier ?? credentials?.email ?? "",
  );
  let key = loginAttemptKey(email);
  const requestId = randomUUID();
  const reject = async (reason: FailureReason) => {
    // Never log the credentials, user record, or raw database exception.
    console.warn("auth.credentials", { reason, emailHash: key, requestId });
    try {
      await prisma.auditLog.create({
        data: {
          action: "LOGIN_FAILED",
          entity: "Authentication",
          entityId: key,
          newValue: { reason, requestId },
        },
      });
    } catch {
      console.warn("auth.audit", { reason: "DATABASE_ERROR" });
    }
    return null;
  };
  if (
    !email ||
    !credentials?.password ||
    Buffer.byteLength(credentials.password, "utf8") > 72
  )
    return reject("INVALID_PASSWORD");

  try {
    const accounts = await prisma.user.findMany({
      where: email.includes("@")
        ? { email: { equals: email, mode: "insensitive" } }
        : { username: { equals: email, mode: "insensitive" } },
      include: { roles: { include: { role: true } } },
      take: 2,
    });
    // Both aliases consume the same canonical email budget, including legacy
    // attempts created before username login was introduced.
    if (accounts.length === 1) key = loginAttemptKey(accounts[0].email);
    if (
      !(await reserveAttempt(
        prisma,
        key,
        LOGIN_ATTEMPT_LIMIT,
        LOGIN_WINDOW_MINUTES,
      ))
    )
      return reject("RATE_LIMITED");
    // Fail closed for legacy case-variant duplicates, just as the old provider did.
    if (accounts.length !== 1) return reject("USER_NOT_FOUND");
    const user = accounts[0];
    if (!user.active || user.deletedAt) return reject("USER_INACTIVE");
    if (
      !user.passwordHash ||
      !(await comparePassword(credentials.password, user.passwordHash))
    )
      return reject("INVALID_PASSWORD");
    await prisma.$transaction(async (tx) => {
      await tx.loginAttempt.deleteMany({ where: { key } });
      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "LOGIN_SUCCESS",
          entity: "User",
          entityId: user.id,
          newValue: { provider: "credentials" },
        },
      });
    });
    return {
      id: user.id,
      sessionVersion: user.sessionVersion,
      email: user.email,
      name: user.name,
      username: user.username,
      image: user.image,
      roles: user.roles.map((r) => r.role.name),
    };
  } catch {
    return reject("DATABASE_ERROR");
  }
}
