import { Prisma, RoleName, type PrismaClient } from "@prisma/client";
import { hashPassword } from "./credentialPolicy";
import { signupSchema } from "./signupPolicy";

export class RegistrationError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function signupSettings(db: Prisma.TransactionClient) {
  const configured =
    process.env.DEFAULT_SIGNUP_ROLE?.trim() || "E_SOLUTIONS_USER";
  if (!Object.values(RoleName).includes(configured as RoleName))
    throw new RegistrationError(
      "Account registration is temporarily unavailable. Contact your administrator.",
      503,
    );
  const role = await db.role.findUnique({
    where: { name: configured as RoleName },
  });
  if (!role)
    throw new RegistrationError(
      "Account registration is temporarily unavailable. Contact your administrator.",
      503,
    );
  const approval = process.env.SIGNUP_REQUIRES_APPROVAL || "false";
  if (!["true", "false"].includes(approval))
    throw new RegistrationError(
      "Account registration is temporarily unavailable. Contact your administrator.",
      503,
    );
  return { role, approval: approval === "true" };
}

export async function checkDuplicates(
  db: Prisma.TransactionClient,
  email?: string,
  username?: string,
  excludeId?: string,
) {
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
}

export async function registerCredentials(db: PrismaClient, input: unknown) {
  const data = signupSchema.parse(input);
  await checkDuplicates(db, data.email, data.username);
  const settings = await signupSettings(db);
  const passwordHash = await hashPassword(data.password);
  try {
    const user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
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
      });
      await tx.auditLog.create({
        data: {
          userId: created.id,
          entity: "User",
          entityId: created.id,
          action: "USER_SIGNUP",
        },
      });
      return created;
    });
    return { id: user.id, pendingApproval: settings.approval };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      await checkDuplicates(db, data.email, data.username);
      throw new RegistrationError(
        "An account with these details already exists.",
        409,
      );
    }
    throw error;
  }
}
