import type { Prisma, PrismaClient } from "@prisma/client";
import {
  emailSchema,
  hashPassword,
  LOGIN_ATTEMPT_LIMIT,
  loginAttemptKey,
  newPasswordSchema,
} from "./credentialPolicy";

// Only errors constructed here may be shown by administrative CLIs.
export class AdminCommandError extends Error {}
type AdminEnvironment = Record<string, string | undefined>;
export const BOOTSTRAP_HELP =
  "Admin bootstrap skipped. Set ADMIN_EMAIL and ADMIN_PASSWORD (12–72 UTF-8 bytes), then run npm run seed. Existing passwords require npm run reset-admin.";

export function requireAdminEmail(env: AdminEnvironment) {
  const result = emailSchema.safeParse(env.ADMIN_EMAIL);
  if (!result.success)
    throw new AdminCommandError("Set ADMIN_EMAIL to a valid email address.");
  return result.data;
}

export function requireAdminCredentials(env: AdminEnvironment) {
  const email = requireAdminEmail(env);
  const result = newPasswordSchema.safeParse(env.ADMIN_PASSWORD);
  if (!result.success)
    throw new AdminCommandError(
      "Set ADMIN_PASSWORD to a password of 12–72 UTF-8 bytes.",
    );
  return { email, password: result.data };
}

async function findAdmin(db: Prisma.TransactionClient, email: string) {
  const users = await db.user.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, active: true, deletedAt: true },
    take: 2,
  });
  if (users.length > 1)
    throw new AdminCommandError(
      "Multiple accounts match ADMIN_EMAIL. Resolve duplicate email casing before continuing.",
    );
  return users[0];
}

export async function bootstrapAdmin(
  prisma: PrismaClient,
  env: AdminEnvironment,
) {
  if (!env.ADMIN_EMAIL?.trim() || !env.ADMIN_PASSWORD) return null;
  const { email, password } = requireAdminCredentials(env);
  return prisma.$transaction(async (tx) => {
    const existing = await findAdmin(tx, email);
    const admin = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: {
            email,
            active: true,
            deletedAt: null,
            ...(!existing.active || existing.deletedAt
              ? { sessionVersion: { increment: 1 } }
              : {}),
          },
        })
      : await tx.user.upsert({
          where: { email },
          // A concurrent bootstrap must never replace an existing password.
          update: { active: true, deletedAt: null },
          create: {
            email,
            name: "Platform Admin",
            passwordHash: await hashPassword(password),
          },
        });
    const role = await tx.role.upsert({
      where: { name: "SUPER_ADMIN" },
      update: {},
      create: { name: "SUPER_ADMIN" },
    });
    await tx.userRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: role.id } },
      update: {},
      create: { userId: admin.id, roleId: role.id },
    });
    return { id: admin.id, created: !existing };
  });
}

export async function resetAdmin(prisma: PrismaClient, env: AdminEnvironment) {
  const { email, password } = requireAdminCredentials(env);
  const existing = await findAdmin(prisma, email);
  if (!existing)
    throw new AdminCommandError(
      "Admin user was not found. Run npm run seed to bootstrap it first.",
    );
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: existing.id },
      data: {
        email,
        passwordHash,
        active: true,
        deletedAt: null,
        sessionVersion: { increment: 1 },
      },
    });
    await tx.loginAttempt.deleteMany({
      where: { key: loginAttemptKey(email) },
    });
    await tx.auditLog.create({
      data: {
        action: "ADMIN_PASSWORD_RESET",
        entity: "User",
        entityId: existing.id,
      },
    });
  });
}

export async function checkAdmin(prisma: PrismaClient, env: AdminEnvironment) {
  const email = requireAdminEmail(env);
  const admin = await findAdmin(prisma, email);
  const role = admin
    ? await prisma.userRole.findFirst({
        where: { userId: admin.id, role: { name: "SUPER_ADMIN" } },
        select: { userId: true },
      })
    : null;
  // Use the database clock, exactly as the authentication window does.
  const [attempt] = await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM "LoginAttempt"
      WHERE "key" = ${loginAttemptKey(email)} AND "count" >= ${LOGIN_ATTEMPT_LIMIT}
      AND "expiresAt" > NOW()) AS locked`;
  return {
    exists: !!admin,
    active: !!admin?.active && !admin.deletedAt,
    superAdmin: !!role,
    locked: attempt.locked,
  };
}
