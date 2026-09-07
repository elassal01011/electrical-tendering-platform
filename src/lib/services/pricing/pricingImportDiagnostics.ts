/** Prisma transaction diagnostics without credentials, query payloads or workbook data. */
export function logPricingImportError(error: unknown, stage: string) {
  const value =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const sanitize = (input: unknown) => {
    let message = String(input ?? "");
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
      .slice(0, 4000);
  };
  const meta =
    value.meta && typeof value.meta === "object"
      ? (value.meta as Record<string, unknown>)
      : {};
  console.error("pricing.import", {
    stage,
    name: error instanceof Error ? error.name : "UnknownError",
    // Other Prisma errors can contain complete query arguments; only transaction diagnostics are safe here.
    message:
      value.code === "P2028"
        ? sanitize(error instanceof Error ? error.message : meta.error)
        : "Pricing import operation failed",
    code:
      typeof value.code === "string" && /^P\d{4}$/.test(value.code)
        ? value.code
        : undefined,
    meta: value.code === "P2028" ? { error: sanitize(meta.error) } : undefined,
  });
}
