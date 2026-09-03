import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { signupSettings } from "./registration";
import { GoogleDiagnostics } from "./googleDiagnostics";
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
  diagnostics?: GoogleDiagnostics,
) {
  diagnostics?.start("USER_LOOKUP", "username_allocation");
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
  diagnostics = new GoogleDiagnostics(rawProfile),
) {
  diagnostics.start("GOOGLE_PROFILE_VALIDATION");
  const profile = googleProfile.safeParse(rawProfile);
  diagnostics.complete();
  diagnostics.start("GOOGLE_EMAIL_VERIFICATION");
  if (!profile.success || profile.data.sub !== providerAccountId) {
    const invalidProfile =
      !profile.success &&
      profile.error.issues.some((issue) => issue.path[0] !== "email_verified");
    if (invalidProfile || profile.success)
      diagnostics.start("GOOGLE_PROFILE_VALIDATION");
    diagnostics.denied(
      invalidProfile
        ? "GOOGLE_PROFILE_INVALID"
        : profile.success
          ? "GOOGLE_SUBJECT_MISMATCH"
          : "GOOGLE_EMAIL_NOT_VERIFIED",
    );
    return { status: "denied" as const };
  }
  diagnostics.complete();
  const data = profile.data;
  for (let retry = 0; retry < 5; retry++) {
    diagnostics.attempt = retry + 1;
    diagnostics.userExists =
      diagnostics.userActive =
      diagnostics.approvalPending =
      diagnostics.oauthAccountExists =
        null;
    diagnostics.start("OAUTH_ACCOUNT_LOOKUP", "transaction_start");
    try {
      return await db.$transaction(
        async (tx) => {
          diagnostics.start("OAUTH_ACCOUNT_LOOKUP", "google_subject");
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
          diagnostics.oauthAccountExists = !!linked;
          if (linked) diagnostics.observeUser(linked.user);
          diagnostics.complete();
          let user = linked?.user;
          if (!user) {
            diagnostics.start("USER_LOOKUP", "normalized_email");
            const matches = await tx.user.findMany({
              where: { email: { equals: data.email, mode: "insensitive" } },
              include: { roles: { include: { role: true } } },
              take: 2,
            });
            diagnostics.observeUser(matches[0]);
            diagnostics.complete();
            if (matches.length > 1) {
              diagnostics.denied("DUPLICATE_EMAIL_ACCOUNTS");
              return { status: "denied" as const };
            }
            user = matches[0];
          }
          const isNew = !user;
          if (user && (!user.active || user.deletedAt)) {
            diagnostics.denied(
              user.deletedAt
                ? "USER_DELETED"
                : user.approvalPending
                  ? "APPROVAL_PENDING"
                  : "USER_INACTIVE",
            );
            return {
              status:
                user.approvalPending && !user.deletedAt
                  ? ("pending" as const)
                  : ("denied" as const),
            };
          }
          if (!user) {
            diagnostics.start(
              "ROLE_ASSIGNMENT",
              "signup_role_and_approval_policy",
            );
            const settings = await signupSettings(tx);
            diagnostics.complete();
            diagnostics.start(
              "NEW_GOOGLE_USER_CREATE",
              "user_create_with_role",
            );
            user = await tx.user.create({
              data: {
                email: data.email,
                name:
                  data.name?.trim().slice(0, 100) || data.email.split("@")[0],
                username: await availableGoogleUsername(
                  tx,
                  data.email.split("@")[0],
                  diagnostics,
                ).then((username) => {
                  diagnostics.complete();
                  diagnostics.start(
                    "NEW_GOOGLE_USER_CREATE",
                    "user_create_with_role",
                  );
                  return username;
                }),
                image: googleImage(data.picture),
                emailVerified: new Date(),
                active: !settings.approval,
                approvalPending: settings.approval,
                registrationMethod: "google",
                roles: { create: { roleId: settings.role.id } },
              },
              include: { roles: { include: { role: true } } },
            });
            diagnostics.observeUser(user);
            diagnostics.complete();
            diagnostics.start("AUDIT_WRITE", "GOOGLE_SIGNUP");
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
            diagnostics.start(
              "EXISTING_ACCOUNT_LINK",
              "check_existing_google_identity",
            );
            diagnostics.start(
              "OAUTH_ACCOUNT_LOOKUP",
              "existing_user_google_identity",
            );
            if (
              await tx.oAuthAccount.findUnique({
                where: {
                  userId_provider: { userId: user.id, provider: "google" },
                },
              })
            ) {
              diagnostics.oauthAccountExists = true;
              diagnostics.complete();
              diagnostics.denied("GOOGLE_ACCOUNT_ALREADY_LINKED");
              return { status: "denied" as const };
            }
            diagnostics.oauthAccountExists = false;
            diagnostics.complete();
            diagnostics.start("OAUTH_ACCOUNT_CREATE");
            await tx.oAuthAccount.create({
              data: {
                userId: user.id,
                provider: "google",
                providerAccountId: data.sub,
              },
            });
            diagnostics.oauthAccountExists = true;
            diagnostics.complete();
            // Prevent pre-registration account takeover: an unverified public
            // signup may have been created by someone who does not own the email.
            // Google's verified owner gains control; that password and all old
            // sessions must not survive the first verified link. Legacy/admin-
            // provisioned accounts retain their existing credentials.
            const replaceUnverifiedPassword =
              user.registrationMethod === "credentials" && !user.emailVerified;
            diagnostics.start(
              "EXISTING_ACCOUNT_LINK",
              "verified_email_link_update",
            );
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
            diagnostics.observeUser(user);
            diagnostics.complete();
            if (!isNew) {
              diagnostics.start("AUDIT_WRITE", "GOOGLE_ACCOUNT_LINKED");
              await tx.auditLog.create({
                data: {
                  userId: user.id,
                  entity: "User",
                  entityId: user.id,
                  action: "GOOGLE_ACCOUNT_LINKED",
                },
              });
            }
          }
          if (!user.active) {
            diagnostics.denied("APPROVAL_PENDING");
            return { status: "pending" as const };
          }
          diagnostics.start("SESSION_CREATE", "last_login_update");
          await tx.user.update({
            where: { id: user.id },
            data: {
              lastLoginAt: new Date(),
              image: googleImage(data.picture) || user.image,
            },
          });
          diagnostics.complete();
          diagnostics.start("SESSION_CREATE", "clear_login_attempts");
          await tx.loginAttempt.deleteMany({
            where: { key: loginAttemptKey(user.email) },
          });
          diagnostics.start("AUDIT_WRITE", "LOGIN_SUCCESS");
          await tx.auditLog.create({
            data: {
              userId: user.id,
              action: "LOGIN_SUCCESS",
              entity: "User",
              entityId: user.id,
              newValue: { provider: "google" },
            },
          });
          diagnostics.complete();
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
      ) {
        diagnostics.failed(error, true);
        continue;
      }
      diagnostics.failed(error);
      throw error;
    }
  }
  return { status: "denied" as const };
}
