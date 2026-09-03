import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { signupSettings } from "./registration";
import { loginAttemptKey } from "./credentialPolicy";

const googleProfile = z.object({
  sub: z.string().min(1).max(255),
  email: z.string().trim().toLowerCase().email(),
  email_verified: z.literal(true),
  name: z.string().max(200).optional(),
  picture: z.string().optional(),
});
export function googleImage(value?: string) {
  try {
    const url = new URL(value || "");
    return url.protocol === "https:" &&
      /(^|\.)googleusercontent\.com$/.test(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export async function availableGoogleUsername(
  db: Prisma.TransactionClient,
  name: string,
) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9_.]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 24);
  const prefix = base.length >= 3 ? base : "user";
  for (let suffix = 1; suffix < 10000; suffix++) {
    const candidate = prefix + (suffix === 1 ? "" : String(suffix));
    if (
      !(await db.user.findUnique({
        where: { username: candidate },
        select: { id: true },
      }))
    )
      return candidate;
  }
  throw new Error("USERNAME_ALLOCATION_FAILED");
}

// This function is called only from NextAuth's validated Google OAuth callback.
// Never accept provider profiles or subject identifiers from a public JSON API.
export async function signInGoogle(
  db: PrismaClient,
  rawProfile: unknown,
  providerAccountId: string,
) {
  const profile = googleProfile.safeParse(rawProfile);
  if (!profile.success || profile.data.sub !== providerAccountId)
    return { status: "denied" as const };
  const data = profile.data;
  for (let retry = 0; retry < 5; retry++) {
    try {
      return await db.$transaction(
        async (tx) => {
          const linked = await tx.oAuthAccount.findUnique({
            where: {
              provider_providerAccountId: {
                provider: "google",
                providerAccountId: data.sub,
              },
            },
            include: {
              user: { include: { roles: { include: { role: true } } } },
            },
          });
          let user = linked?.user;
          if (!user) {
            const matches = await tx.user.findMany({
              where: { email: { equals: data.email, mode: "insensitive" } },
              include: { roles: { include: { role: true } } },
              take: 2,
            });
            if (matches.length > 1) return { status: "denied" as const };
            user = matches[0];
          }
          const isNew = !user;
          if (user && (!user.active || user.deletedAt))
            return {
              status:
                user.approvalPending && !user.deletedAt
                  ? ("pending" as const)
                  : ("denied" as const),
            };
          if (!user) {
            const settings = await signupSettings(tx);
            user = await tx.user.create({
              data: {
                email: data.email,
                name:
                  data.name?.trim().slice(0, 100) || data.email.split("@")[0],
                username: await availableGoogleUsername(
                  tx,
                  data.email.split("@")[0],
                ),
                image: googleImage(data.picture),
                emailVerified: new Date(),
                active: !settings.approval,
                approvalPending: settings.approval,
                registrationMethod: "google",
                roles: { create: { roleId: settings.role.id } },
              },
              include: { roles: { include: { role: true } } },
            });
            await tx.auditLog.create({
              data: {
                userId: user.id,
                entity: "User",
                entityId: user.id,
                action: "GOOGLE_SIGNUP",
              },
            });
          }
          if (!linked) {
            // One Google identity per user. A changed email cannot transfer a link.
            if (
              await tx.oAuthAccount.findUnique({
                where: {
                  userId_provider: { userId: user.id, provider: "google" },
                },
              })
            )
              return { status: "denied" as const };
            await tx.oAuthAccount.create({
              data: {
                userId: user.id,
                provider: "google",
                providerAccountId: data.sub,
              },
            });
            // Prevent pre-registration account takeover: an unverified public
            // signup may have been created by someone who does not own the email.
            // Google's verified owner gains control; that password and all old
            // sessions must not survive the first verified link. Legacy/admin-
            // provisioned accounts retain their existing credentials.
            const replaceUnverifiedPassword =
              user.registrationMethod === "credentials" && !user.emailVerified;
            user = await tx.user.update({
              where: { id: user.id },
              data: {
                emailVerified: new Date(),
                image: googleImage(data.picture),
                ...(replaceUnverifiedPassword
                  ? { passwordHash: null, sessionVersion: { increment: 1 } }
                  : {}),
              },
              include: { roles: { include: { role: true } } },
            });
            if (!isNew)
              await tx.auditLog.create({
                data: {
                  userId: user.id,
                  entity: "User",
                  entityId: user.id,
                  action: "GOOGLE_ACCOUNT_LINKED",
                },
              });
          }
          if (!user.active) return { status: "pending" as const };
          await tx.user.update({
            where: { id: user.id },
            data: {
              lastLoginAt: new Date(),
              image: googleImage(data.picture) || user.image,
            },
          });
          await tx.loginAttempt.deleteMany({
            where: { key: loginAttemptKey(user.email) },
          });
          await tx.auditLog.create({
            data: {
              userId: user.id,
              action: "LOGIN_SUCCESS",
              entity: "User",
              entityId: user.id,
              newValue: { provider: "google" },
            },
          });
          return {
            status: "allowed" as const,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
              username: user.username,
              image: googleImage(data.picture) || user.image,
              sessionVersion: user.sessionVersion,
              roles: user.roles.map((r) => r.role.name),
            },
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2034"].includes(error.code) &&
        retry < 4
      )
        continue;
      throw error;
    }
  }
  return { status: "denied" as const };
}
