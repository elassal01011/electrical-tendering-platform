import type { PrismaClient } from "@prisma/client";
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
  credentials: { email?: string; password?: string } | undefined,
) {
  const email = normalizeEmail(credentials?.email ?? "");
  const key = loginAttemptKey(email);
  const requestId = randomUUID();
  const reject = (reason: FailureReason) => {
    // Never log the credentials, user record, or raw database exception.
    console.warn("auth.credentials", { reason, emailHash: key, requestId });
    return null;
  };
  if (
    !email ||
    !credentials?.password ||
    Buffer.byteLength(credentials.password, "utf8") > 72
  )
    return reject("INVALID_PASSWORD");

  try {
    // Reserve an attempt atomically across server instances. Expired records start
    // a new fixed window; requests during lockout never extend the old window.
    const attempts = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "LoginAttempt" ("key", "count", "expiresAt")
      VALUES (${key}, 1, NOW() + ${LOGIN_WINDOW_MINUTES} * INTERVAL '1 minute')
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "LoginAttempt"."expiresAt" <= NOW() THEN 1
          ELSE LEAST("LoginAttempt"."count"::bigint + 1, ${LOGIN_ATTEMPT_LIMIT + 1}) END,
        "expiresAt" = CASE WHEN "LoginAttempt"."expiresAt" <= NOW()
          THEN NOW() + ${LOGIN_WINDOW_MINUTES} * INTERVAL '1 minute'
          ELSE "LoginAttempt"."expiresAt" END
      RETURNING "count"`;
    if (attempts[0].count > LOGIN_ATTEMPT_LIMIT) return reject("RATE_LIMITED");

    const accounts = await prisma.user.findMany({
      where: { email: { equals: email, mode: "insensitive" } },
      include: { roles: { include: { role: true } } },
      take: 2,
    });
    // Fail closed for legacy case-variant duplicates, just as the old provider did.
    if (accounts.length !== 1) return reject("USER_NOT_FOUND");
    const user = accounts[0];
    if (!user.active || user.deletedAt) return reject("USER_INACTIVE");
    if (!(await comparePassword(credentials.password, user.passwordHash)))
      return reject("INVALID_PASSWORD");
    await prisma.loginAttempt.deleteMany({ where: { key } });
    return {
      id: user.id,
      sessionVersion: user.sessionVersion,
      email: user.email,
      name: user.name,
      roles: user.roles.map((r) => r.role.name),
    };
  } catch {
    return reject("DATABASE_ERROR");
  }
}
