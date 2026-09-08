function errorValue(error: unknown) {
  return error && typeof error === "object"
    ? (error as Record<string, unknown>)
    : {};
}

export function prismaErrorCode(error: unknown) {
  const code = errorValue(error).code;
  return typeof code === "string" && /^P\d{4}$/.test(code) ? code : undefined;
}

function safeMessage(error: unknown) {
  let message = error instanceof Error ? error.message : "Database operation failed";
  for (const [name, secret] of Object.entries(process.env))
    if (
      /URL|PASSWORD|TOKEN|SECRET|KEY/i.test(name) &&
      secret &&
      secret.length > 3
    )
      message = message.split(secret).join("[REDACTED]");
  return message
    .replace(/(?:postgres(?:ql)?|https?):\/\/\S+/gi, "[REDACTED_URL]")
    .replace(
      /((?:password|token|secret|DATABASE_URL|DIRECT_URL)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .slice(0, 500);
}

/** Logs only whitelisted connection-pool diagnostics, never query arguments. */
export function logGenericExcelError(error: unknown, stage: string) {
  const value = errorValue(error);
  const code = prismaErrorCode(error);
  if (code !== "P2024") return;
  const sourceMeta =
    value.meta && typeof value.meta === "object"
      ? (value.meta as Record<string, unknown>)
      : {};
  const connectionLimit = sourceMeta.connection_limit;
  const timeout = sourceMeta.timeout;
  console.error("excel.generic", {
    stage,
    name: error instanceof Error ? error.name : "UnknownError",
    code,
    message: safeMessage(error),
    meta: {
      connection_limit:
        typeof connectionLimit === "number" || typeof connectionLimit === "string"
          ? connectionLimit
          : undefined,
      timeout:
        typeof timeout === "number" || typeof timeout === "string"
          ? timeout
          : undefined,
    },
  });
}
