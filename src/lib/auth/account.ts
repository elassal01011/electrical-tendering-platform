import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  hashPassword,
  comparePassword,
  loginAttemptKey,
} from "./credentialPolicy";
import { signupPasswordSchema, profileSchema } from "./signupPolicy";
import { checkDuplicates, RegistrationError } from "./registration";

export const accountSelect = {
  id: true,
  name: true,
  username: true,
  email: true,
  image: true,
  active: true,
  approvalPending: true,
  registrationMethod: true,
  createdAt: true,
  lastLoginAt: true,
  roles: { select: { role: { select: { name: true } } } },
  oauthAccounts: { select: { provider: true } },
} as const;
export async function getAccount(db: PrismaClient, userId: string) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { ...accountSelect, passwordHash: true },
  });
  const { passwordHash, oauthAccounts, ...safe } = user;
  const hasPassword = !!passwordHash;
  const hasGoogle = oauthAccounts.some(
    (account) => account.provider === "google",
  );
  return {
    ...safe,
    hasPassword,
    hasGoogle,
    authMethod: hasGoogle
      ? hasPassword
        ? "Google + password"
        : "Google"
      : "Password",
  };
}
export async function updateProfile(
  db: PrismaClient,
  userId: string,
  input: unknown,
) {
  const data = profileSchema.parse(input);
  await checkDuplicates(db, undefined, data.username, userId);
  await db.$transaction(async (tx) => {
    const previous = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    await tx.user.update({ where: { id: userId }, data });
    await tx.auditLog.create({
      data: {
        userId,
        entity: "User",
        entityId: userId,
        action:
          previous.username !== data.username
            ? "USERNAME_CHANGED"
            : "PROFILE_CHANGED",
        oldValue: { name: previous.name, username: previous.username },
        newValue: data,
      },
    });
  });
}
export async function changeAccountPassword(
  db: PrismaClient,
  userId: string,
  sessionVersion: number,
  input: unknown,
) {
  const data = z
    .object({
      currentPassword: z.string().max(72).optional(),
      newPassword: signupPasswordSchema,
    })
    .parse(input);
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { oauthAccounts: true },
  });
  if (!user.active || user.deletedAt || user.sessionVersion !== sessionVersion)
    throw new RegistrationError(
      "Your session expired. Please sign in again.",
      401,
    );
  if (user.passwordHash) {
    if (
      !data.currentPassword ||
      Buffer.byteLength(data.currentPassword, "utf8") > 72 ||
      !(await comparePassword(data.currentPassword, user.passwordHash))
    )
      throw new RegistrationError("Current password is incorrect.");
  } else if (
    !user.oauthAccounts.some((account) => account.provider === "google")
  ) {
    throw new RegistrationError(
      "Contact your administrator to set a password.",
      403,
    );
  }
  const passwordHash = await hashPassword(data.newPassword);
  await db.$transaction(async (tx) => {
    // Compare-and-swap prevents two first-password requests or a concurrent
    // administrator reset from silently overwriting one another.
    const changed = await tx.user.updateMany({
      where: {
        id: userId,
        passwordHash: user.passwordHash,
        sessionVersion,
        active: true,
        deletedAt: null,
      },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    if (changed.count !== 1)
      throw new RegistrationError(
        "Your session expired. Please sign in again.",
        401,
      );
    await tx.loginAttempt.deleteMany({
      where: { key: loginAttemptKey(user.email) },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "PASSWORD_CHANGED",
        entity: "User",
        entityId: userId,
      },
    });
  });
}
