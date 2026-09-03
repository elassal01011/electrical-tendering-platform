import { randomUUID } from "node:crypto";
import { safeGoogleError as safeAuthError } from "./googleDiagnostics";

export type RegistrationStage =
  | "REQUEST_VALIDATION"
  | "RATE_LIMIT_CHECK"
  | "EMAIL_LOOKUP"
  | "USERNAME_LOOKUP"
  | "ROLE_LOOKUP"
  | "PASSWORD_HASH"
  | "TRANSACTION_BEGIN"
  | "USER_CREATE"
  | "ROLE_ASSIGNMENT"
  | "LOGIN_ATTEMPT_WRITE"
  | "AUDIT_WRITE"
  | "TRANSACTION_COMMIT"
  | "AUTO_LOGIN_PREPARATION";

// Prisma meta can contain raw SQL, arguments and record values. Only retain
// diagnostic fields, sanitizing their values with the same auth error redactor.
export function safeRegistrationMeta(error: unknown, secrets: string[] = []) {
  try {
    const meta = (error as { meta?: unknown } | null)?.meta;
    if (!meta || typeof meta !== "object") return undefined;
    const result: Record<string, string | string[] | number> = {};
    for (const key of [
      "modelName",
      "target",
      "field_name",
      "constraint",
      "table",
      "column",
      "code",
      "message",
      "database_error",
      "error",
      "connection_limit",
      "timeout",
    ]) {
      const value = (meta as Record<string, unknown>)[key];
      if (typeof value === "string")
        result[key] = safeAuthError(value, secrets).message;
      else if (typeof value === "number" && Number.isFinite(value))
        result[key] = value;
      else if (Array.isArray(value))
        result[key] = value
          .slice(0, 20)
          .filter((v): v is string => typeof v === "string")
          .map((v) => safeAuthError(v, secrets).message);
    }
    return result;
  } catch {
    return undefined;
  }
}

function databaseReason(code: string | undefined, message: string) {
  if (/prepared statement.*(?:already exists|does not exist)/i.test(message))
    return "PREPARED_STATEMENT_CONFLICT";
  if (
    /too many (?:clients|connections)|max client connections|pool.*exhaust/i.test(
      message,
    )
  )
    return "CONNECTION_POOL_EXHAUSTED";
  if (/invalid input value for enum/i.test(message)) return "ENUM_MISMATCH";
  return (
    (
      {
        P1001: "DATABASE_UNREACHABLE",
        P2024: "CONNECTION_POOL_TIMEOUT",
        P2002: "UNIQUE_CONSTRAINT_FAILED",
        P2003: "FOREIGN_KEY_FAILED",
        P2004: "DATABASE_CONSTRAINT_FAILED",
        P2021: "TABLE_MISSING",
        P2022: "COLUMN_MISSING",
        P2028: "TRANSACTION_FAILED",
      } as Record<string, string>
    )[code || ""] || "DATABASE_OPERATION_FAILED"
  );
}

export class RegistrationDiagnostics {
  readonly requestId = randomUUID();
  stage: RegistrationStage = "REQUEST_VALIDATION";
  private operation: string | undefined;
  private readonly secrets: string[] = [];
  private readonly logged = new Set<unknown>();

  protect(...values: unknown[]) {
    for (const value of values)
      if (typeof value === "string" && value) this.secrets.push(value);
  }

  event(
    stage: RegistrationStage,
    status: "started" | "completed",
    operation?: string,
  ) {
    console.info("auth.registration.stage", {
      requestId: this.requestId,
      stage,
      operation,
      status,
    });
  }

  start(stage: RegistrationStage, operation?: string) {
    this.stage = stage;
    this.operation = operation;
    this.event(stage, "started", operation);
  }

  complete() {
    this.event(this.stage, "completed", this.operation);
  }

  async run<T>(
    stage: RegistrationStage,
    operation: string,
    action: () => Promise<T>,
  ) {
    this.start(stage, operation);
    try {
      const result = await action();
      this.complete();
      return result;
    } catch (error) {
      this.failed(error);
      throw error;
    }
  }

  failed(error: unknown) {
    if (this.logged.has(error)) return;
    this.logged.add(error);
    const safe = safeAuthError(error, this.secrets);
    const meta = safeRegistrationMeta(error, this.secrets);
    // A nested roles.create is part of user.create. Only attribute its failure
    // specifically to the role link when Prisma identifies that model.
    const stage =
      this.stage === "USER_CREATE" && meta?.modelName === "UserRole"
        ? "ROLE_ASSIGNMENT"
        : this.stage;
    console.error("auth.registration.failed", {
      requestId: this.requestId,
      stage,
      operation: this.operation,
      name: safe.name,
      message: safe.message,
      code: safe.code,
      meta,
      reason: "DATABASE_ERROR",
      applicationReason:
        safe.applicationReason ||
        databaseReason(
          safe.code,
          `${safe.message} ${JSON.stringify(meta) || ""}`,
        ),
    });
  }
}
