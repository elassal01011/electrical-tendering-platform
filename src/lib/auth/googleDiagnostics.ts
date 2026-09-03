import { randomUUID } from "node:crypto";

export type GoogleStage =
  | "GOOGLE_PROFILE_VALIDATION"
  | "GOOGLE_EMAIL_VERIFICATION"
  | "USER_LOOKUP"
  | "OAUTH_ACCOUNT_LOOKUP"
  | "EXISTING_ACCOUNT_LINK"
  | "NEW_GOOGLE_USER_CREATE"
  | "ROLE_ASSIGNMENT"
  | "OAUTH_ACCOUNT_CREATE"
  | "AUDIT_WRITE"
  | "SESSION_CREATE";

const applicationReasons = new Set([
  "DEFAULT_SIGNUP_ROLE_INVALID",
  "DEFAULT_SIGNUP_ROLE_NOT_FOUND",
  "SIGNUP_APPROVAL_SETTING_INVALID",
]);

// Prisma messages may contain invocation arguments and connection strings.
// Keep the diagnostic text, never raw errors, stacks, metadata or OAuth objects.
export function safeGoogleError(
  error: unknown,
  sensitiveValues: string[] = [],
) {
  try {
    const value =
      error && typeof error === "object"
        ? (error as Record<string, unknown>)
        : {};
    let message =
      typeof value.message === "string"
        ? value.message
        : typeof error === "string"
          ? error
          : "Unknown error (non-string details omitted).";
    const secrets = [...sensitiveValues];
    for (const [key, secret] of Object.entries(process.env)) {
      if (
        secret &&
        /SECRET|PASSWORD|TOKEN|DATABASE_URL|DIRECT_URL|API_KEY|PRIVATE_KEY/i.test(
          key,
        )
      ) {
        secrets.push(secret);
        if (/DATABASE_URL|DIRECT_URL/i.test(key)) {
          try {
            const password = new URL(secret).password;
            if (password) {
              secrets.push(password);
              secrets.push(decodeURIComponent(password));
            }
          } catch {
            /* Do not expose invalid connection settings. */
          }
        }
      }
    }
    for (const secret of secrets
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)) {
      let uriEncoded = secret;
      try {
        uriEncoded = encodeURIComponent(secret);
      } catch {
        /* malformed input stays redacted literally */
      }
      for (const encoded of new Set([
        secret,
        uriEncoded,
        JSON.stringify(secret).slice(1, -1),
      ]))
        message = message.split(encoded).join("[REDACTED]");
    }
    if (/Invalid [`\s\S]*?invocation/.test(message)) {
      // Drop Prisma's source/argument dump. Its final paragraph is the database
      // explanation (e.g. missing table/column or unique constraint violation).
      const paragraphs = message.trim().split(/\r?\n\s*\r?\n/);
      message =
        paragraphs.length > 1
          ? paragraphs[paragraphs.length - 1]
          : message.replace(/^.*invocation[^\r\n]*[\r\n]*/s, "");
    }
    message = message
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi, "[REDACTED_URL]")
      .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]")
      .replace(
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
        "[REDACTED_EMAIL]",
      )
      .replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, "[REDACTED_HASH]")
      .replace(
        /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)+/g,
        "[REDACTED_TOKEN]",
      )
      .replace(
        /(["']?(?:passwordHash|password|GOOGLE_CLIENT_SECRET|client_secret|access_token|refresh_token|id_token|authorization[_ ]?code|code|DATABASE_URL|DIRECT_URL)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi,
        "$1[REDACTED]",
      )
      // Quoted values in unknown exceptions can be OAuth secrets too. Backtick-
      // quoted Prisma model/column names remain useful and are preserved.
      .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "[REDACTED_VALUE]")
      .replace(/^\s*(?:→\s*)?\d+\s+.*$/gm, "[source omitted]")
      .replace(/[\r\n\t]+/g, " ")
      .trim()
      .slice(0, 1800);
    return {
      name:
        typeof value.name === "string" &&
        /^(?:[A-Za-z]+Error|Error)$/.test(value.name)
          ? value.name
          : error instanceof Error
            ? "Error"
            : "UnknownError",
      message: message || "Error details omitted for security.",
      code:
        typeof (value.code ?? value.errorCode) === "string" &&
        /^P\d{4}$/.test(String(value.code ?? value.errorCode))
          ? String(value.code ?? value.errorCode)
          : undefined,
      applicationReason:
        typeof value.diagnosticReason === "string" &&
        applicationReasons.has(value.diagnosticReason)
          ? value.diagnosticReason
          : undefined,
    };
  } catch {
    // Logging must not replace the original outcome, even for unusual thrown
    // objects with throwing accessors or malformed strings.
    return {
      name: "UnknownError",
      message: "Error details omitted for security.",
      code: undefined,
      applicationReason: undefined,
    };
  }
}

export class GoogleDiagnostics {
  readonly requestId = randomUUID();
  stage: GoogleStage = "GOOGLE_PROFILE_VALIDATION";
  operation: string | undefined;
  attempt = 0;
  readonly emailPresent: boolean;
  readonly emailVerified: boolean;
  userExists: boolean | null = null;
  userActive: boolean | null = null;
  approvalPending: boolean | null = null;
  oauthAccountExists: boolean | null = null;
  private readonly sensitiveValues: string[];
  private failureLogged = false;

  constructor(profile: unknown, oauthAccount?: unknown) {
    const data =
      profile && typeof profile === "object"
        ? (profile as Record<string, unknown>)
        : {};
    const account =
      oauthAccount && typeof oauthAccount === "object"
        ? (oauthAccount as Record<string, unknown>)
        : {};
    this.emailPresent = typeof data.email === "string" && !!data.email.trim();
    this.emailVerified = data.email_verified === true;
    this.sensitiveValues = [
      data.email,
      data.sub,
      account.access_token,
      account.refresh_token,
      account.id_token,
      account.code,
      account.authorization_code,
      account.providerAccountId,
    ].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  }
  private fields() {
    return {
      provider: "google",
      requestId: this.requestId,
      stage: this.stage,
      operation: this.operation,
      attempt: this.attempt,
      emailPresent: this.emailPresent,
      emailVerified: this.emailVerified,
      userExists: this.userExists,
      userActive: this.userActive,
      approvalPending: this.approvalPending,
      oauthAccountExists: this.oauthAccountExists,
    };
  }
  start(stage: GoogleStage, operation?: string) {
    this.stage = stage;
    this.operation = operation;
    console.info("auth.google.stage", { ...this.fields(), status: "started" });
  }
  complete() {
    console.info("auth.google.stage", {
      ...this.fields(),
      status: "completed",
    });
  }
  observeUser(user: { active: boolean; approvalPending: boolean } | undefined) {
    this.userExists = !!user;
    this.userActive = user?.active ?? null;
    this.approvalPending = user?.approvalPending ?? null;
  }
  denied(reason: string) {
    console.warn("auth.google.denied", { ...this.fields(), reason });
  }
  failed(error: unknown, retrying = false) {
    if (this.failureLogged && !retrying) return;
    const safe = safeGoogleError(error, this.sensitiveValues);
    const payload = {
      ...this.fields(),
      name: safe.name,
      message: safe.message,
      code: safe.code,
      reason: "GOOGLE_SIGNIN_FAILED",
      applicationReason: safe.applicationReason || `${this.stage}_FAILED`,
    };
    if (retrying) console.warn("auth.google.retry", payload);
    else {
      this.failureLogged = true;
      console.error("auth.google.failed", payload);
    }
  }
}

// Correlates the sign-in and initial JWT callbacks without adding anything to
// the persisted JWT, user record, browser session, or a shared current-request variable.
export const googleDiagnosticContexts = new WeakMap<
  object,
  GoogleDiagnostics
>();
