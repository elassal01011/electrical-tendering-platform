import type { Prisma } from "@prisma/client";
import { loginAttemptKey } from "./credentialPolicy";
import { RegistrationDiagnostics } from "./registrationDiagnostics";

export async function reserveAttempt(
  db: Prisma.TransactionClient,
  key: string,
  limit: number,
  minutes: number,
) {
  const [attempt] = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "LoginAttempt" ("key", "count", "expiresAt")
    VALUES (${key}, 1, NOW() + ${minutes} * INTERVAL '1 minute')
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "LoginAttempt"."expiresAt" <= NOW() THEN 1
        ELSE LEAST("LoginAttempt"."count"::bigint + 1, ${limit + 1}) END,
      "expiresAt" = CASE WHEN "LoginAttempt"."expiresAt" <= NOW()
        THEN NOW() + ${minutes} * INTERVAL '1 minute' ELSE "LoginAttempt"."expiresAt" END
    RETURNING "count"`;
  return attempt.count <= limit;
}

export async function allowSignup(
  db: Prisma.TransactionClient,
  email: string,
  ip: string,
  diagnostics = new RegistrationDiagnostics(),
) {
  diagnostics.protect(email, ip);
  diagnostics.start("RATE_LIMIT_CHECK", "signup_limits");
  // Separate namespace: resetting a login never resets registration limits.
  const byIp = await diagnostics.run(
    "LOGIN_ATTEMPT_WRITE",
    "signup_ip_limit",
    () => reserveAttempt(db, loginAttemptKey(`signup:ip:${ip}`), 10, 60),
  );
  const byEmail = await diagnostics.run(
    "LOGIN_ATTEMPT_WRITE",
    "signup_email_limit",
    () => reserveAttempt(db, loginAttemptKey(`signup:email:${email}`), 5, 60),
  );
  diagnostics.event("RATE_LIMIT_CHECK", "completed", "signup_limits");
  return byIp && byEmail;
}
