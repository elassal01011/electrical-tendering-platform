import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { allowSignup } from "@/lib/auth/rateLimit";
import { signupSchema } from "@/lib/auth/signupPolicy";
import { registerCredentials } from "@/lib/auth/registration";
import { requireSameOrigin, registrationResponse } from "@/lib/auth/http";
import { RegistrationDiagnostics } from "@/lib/auth/registrationDiagnostics";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const diagnostics = new RegistrationDiagnostics();
  try {
    requireSameOrigin(req);
    // Bound the body before JSON parsing/hash work, even without Content-Length.
    const reader = req.body?.getReader();
    if (!reader)
      return NextResponse.json(
        { error: "Please complete the form." },
        { status: 400 },
      );
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) {
        await reader.cancel();
        return NextResponse.json(
          { error: "The submitted form is too large." },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
    const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    diagnostics.protect(
      raw?.password,
      raw?.confirmPassword,
      raw?.email,
      raw?.username,
      raw?.name,
    );
    const email =
      typeof raw?.email === "string"
        ? raw.email.trim().toLowerCase().slice(0, 254)
        : "invalid";
    // Vercel overwrites x-vercel-forwarded-for. Do not trust client-supplied
    // x-forwarded-for on other hosts; use a conservative shared fallback.
    const ip =
      process.env.VERCEL === "1"
        ? req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown"
        : "local";
    if (!(await allowSignup(prisma, email, ip, diagnostics)))
      return NextResponse.json(
        {
          error: "Too many registration attempts. Please try again in an hour.",
        },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    diagnostics.start("REQUEST_VALIDATION", "signup_form");
    const data = signupSchema.parse(raw);
    diagnostics.complete();
    const result = await registerCredentials(prisma, data, diagnostics);
    return NextResponse.json(
      {
        ...result,
        message: result.pendingApproval
          ? "Your E-SOLUTIONS account has been created and is awaiting administrator approval."
          : "Account created successfully.",
      },
      { status: 201 },
    );
  } catch (error) {
    return registrationResponse(error, diagnostics);
  }
}
