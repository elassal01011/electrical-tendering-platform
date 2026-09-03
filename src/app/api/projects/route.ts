import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
const schema = z.object({
  code: z.string().trim().max(50).optional(),
  name: z.string().trim().min(1).max(200),
  clientId: z.string().min(1),
  consultantId: z.string().optional(),
  location: z.string().max(200).optional(),
  country: z.string().default("Egypt"),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("EGP"),
  targetMarginPct: z.number().min(0).max(99).default(20),
  tenderNumber: z.string().max(100).optional(),
  tenderDeadline: z.string().optional(),
});
export async function GET(req: NextRequest) {
  try {
    const g = await requirePermission("project.view");
    if (g.error) return g.error;
    const q = req.nextUrl.searchParams.get("q") || "";
    const projects = await prisma.project.findMany({
      where: {
        deletedAt: null,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { code: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      include: { client: true, consultant: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ projects });
  } catch (e) {
    return apiError(e, "projects.list");
  }
}
export async function POST(req: Request) {
  try {
    const g = await requirePermission("project.create");
    if (g.error) return g.error;
    const input = schema.parse(await req.json());
    const project = await prisma.$transaction(async (tx) => {
      const client = await tx.party.findFirst({
        where: { id: input.clientId, type: "CLIENT", deletedAt: null },
      });
      if (!client) throw new Error("Invalid client");
      if (input.consultantId)
        await tx.party.findFirstOrThrow({
          where: {
            id: input.consultantId,
            type: "CONSULTANT",
            deletedAt: null,
          },
        });
      const year = new Date().getFullYear();
      const seq = await tx.documentSequence.upsert({
        where: { key: "PROJECT-" + year },
        create: { key: "PROJECT-" + year, value: 1 },
        update: { value: { increment: 1 } },
      });
      const code =
        input.code || "PRJ-" + year + "-" + String(seq.value).padStart(4, "0");
      const row = await tx.project.create({
        data: {
          ...input,
          code,
          tenderDeadline: input.tenderDeadline
            ? new Date(input.tenderDeadline)
            : null,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: g.userId,
          action: "PROJECT_CREATED",
          entity: "Project",
          entityId: row.id,
          newValue: { code, name: row.name },
        },
      });
      return row;
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (e) {
    return apiError(e, "projects.create");
  }
}
