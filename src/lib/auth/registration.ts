import { Prisma, RoleName, type PrismaClient } from "@prisma/client";
import { hashPassword } from "./credentialPolicy";
import { signupSchema } from "./signupPolicy";
import { RegistrationDiagnostics } from "./registrationDiagnostics";

export class RegistrationError extends Error {
  constructor(
    message: string,
    public status = 400,
    public diagnosticReason?: string,
  ) {
    super(message);
  }
}
export async function signupSettings(
  db: Prisma.TransactionClient,
  diagnostics?: RegistrationDiagnostics,
) {
  diagnostics?.start("ROLE_LOOKUP", "default_signup_role");
  const configured =
    process.env.DEFAULT_SIGNUP_ROLE?.trim() || "E_SOLUTIONS_USER";
  if (!Object.values(RoleName).includes(configured as RoleName))
    throw new RegistrationError(
      "Account registration is temporarily unavailable. Contact your administrator.",
      503,
      "DEFAULT_SIGNUP_ROLE_INVALID",
    );
  const role = await db.role.findUnique({
    where: { name: configured as RoleName },
  });
  if (!role)
    throw new RegistrationError(
      "Account registration is temporarily unavailable. Contact your administrator.",
      503,
      "DEFAULT_SIGNUP_ROLE_NOT_FOUND",
    );
  const approval = process.env.SIGNUP_REQUIRES_APPROVAL || "false";
  if (!["true", "false"].includes(approval))
    throw new RegistrationError(
      "Account registration is temporarily unavailable. Contact your administrator.",
      503,
      "SIGNUP_APPROVAL_SETTING_INVALID",
    );
  diagnostics?.complete();
  return { role, approval: approval === "true" };
}

export async function checkDuplicates(
  db: Prisma.TransactionClient,
  email?: string,
  username?: string,
  excludeId?: string,
  diagnostics?: RegistrationDiagnostics,
) {
  if (email)
    diagnostics?.start("EMAIL_LOOKUP", "case_insensitive_duplicate_check");
  if (
    email &&
    (await db.user.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    }))
  )
    throw new RegistrationError(
      "An account with this email already exists.",
      409,
    );
  if (email) diagnostics?.complete();
  if (username)
    diagnostics?.start("USERNAME_LOOKUP", "case_insensitive_duplicate_check");
  if (
    username &&
    (await db.user.findFirst({
      where: {
        username: { equals: username, mode: "insensitive" },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    }))
  )
    throw new RegistrationError("That username is already taken.", 409);
  if (username) diagnostics?.complete();
}

export async function registerCredentials(
  db: PrismaClient,
  input: unknown,
  diagnostics = new RegistrationDiagnostics(),
) {
  const data = signupSchema.parse(input);
  diagnostics.protect(
    data.password,
    data.confirmPassword,
    data.email,
    data.username,
    data.name,
  );
  try {
    await checkDuplicates(
      db,
      data.email,
      data.username,
      undefined,
      diagnostics,
    );
    const settings = await signupSettings(db, diagnostics);
    const passwordHash = await diagnostics.run(
      "PASSWORD_HASH",
      "hash_password",
      () => hashPassword(data.password),
    );
    diagnostics.protect(passwordHash);
    try {
      diagnostics.start("TRANSACTION_BEGIN", "credentials_signup");
      const user = await db.$transaction(async (tx) => {
        diagnostics.complete();
        diagnostics.event("ROLE_ASSIGNMENT", "started", "nested_user_create");
        const created = await diagnostics.run(
          "USER_CREATE",
          "user_create_with_nested_role",
          () =>
            tx.user.create({
              data: {
                name: data.name,
                username: data.username,
                email: data.email,
                passwordHash,
                active: !settings.approval,
                approvalPending: settings.approval,
                registrationMethod: "credentials",
                roles: { create: { roleId: settings.role.id } },
              },
              select: { id: true },
            }),
        );
        diagnostics.event("ROLE_ASSIGNMENT", "completed", "nested_user_create");
        await diagnostics.run("AUDIT_WRITE", "user_signup_audit", () =>
          tx.auditLog.create({
            data: {
              userId: created.id,
              entity: "User",
              entityId: created.id,
              action: "USER_SIGNUP",
            },
          }),
        );
        diagnostics.start("TRANSACTION_COMMIT", "credentials_signup");
        return created;
      });
      diagnostics.complete();
      diagnostics.start(
        "AUTO_LOGIN_PREPARATION",
        "signup_response_for_client_login",
      );
      const result = { id: user.id, pendingApproval: settings.approval };
      diagnostics.complete();
      return result;
    } catch (error) {
      diagnostics.failed(error);
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        await checkDuplicates(
          db,
          data.email,
          data.username,
          undefined,
          diagnostics,
        );
        throw new RegistrationError(
          "An account with these details already exists.",
          409,
        );
      }
      throw error;
    }
  } catch (error) {
    if (!(error instanceof RegistrationError) || error.status >= 500)
      diagnostics.failed(error);
    throw error;
  }
}
