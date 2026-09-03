import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { RegistrationError } from "./registration";

export function requireSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (
    origin &&
    origin !== new URL(req.url).origin &&
    origin !== process.env.NEXTAUTH_URL
  )
    throw new RegistrationError(
      "This request could not be verified. Please reload the page.",
      403,
    );
}
export function registrationResponse(error: unknown) {
  if (error instanceof RegistrationError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        error: error.issues[0]?.message || "Please check your details.",
        fields: error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  if (error instanceof SyntaxError)
    return NextResponse.json(
      { error: "Please submit a valid form." },
      { status: 400 },
    );
  console.error("auth.registration", { reason: "DATABASE_ERROR" });
  return NextResponse.json(
    { error: "Unable to complete the request. Please try again later." },
    { status: 503 },
  );
}
