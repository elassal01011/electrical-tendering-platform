import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { ExcelError } from "./services/excel/uploadPolicy";
export function apiError(error: unknown, context: string) {
  if (error instanceof ExcelError)
    return NextResponse.json(
      { error: error.message, detail: error.detail },
      { status: error.status },
    );
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        error: "Please check the supplied values.",
        detail: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  if (error instanceof SyntaxError)
    return NextResponse.json(
      {
        error: "Invalid request format.",
        detail: "The request could not be read. Please try again.",
      },
      { status: 400 },
    );
  const code =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? error.code
      : undefined;
  console.error(context, {
    name: error instanceof Error ? error.name : "UnknownError",
    code,
  });
  const errorText =
    code === "P2002"
      ? "This record already exists. Refresh before trying again."
      : code === "P2003" || code === "P2025"
        ? "The related record was not found. Refresh and try again."
        : "Unable to complete the request.";
  return NextResponse.json(
    {
      error: errorText,
      detail: code
        ? "Check the selected record and try again."
        : "The service is temporarily unavailable. Please retry or contact your administrator.",
    },
    {
      status:
        code === "P2002"
          ? 409
          : code === "P2003" || code === "P2025"
            ? 404
            : 503,
    },
  );
}
