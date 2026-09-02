import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission, writeAuditLog } from "@/lib/auth/apiGuard";

const createProjectSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  clientId: z.string().min(1),
  consultantId: z.string().optional(),
  location: z.string().optional(),
  country: z.string().default("Egypt"),
  currency: z.string().default("EGP"),
  targetMarginPct: z.number().default(20),
});

export async function GET() {
  const guard = await requirePermission("project.view");
  if (guard.error) return guard.error;

  const projects = await prisma.project.findMany({
    where: { deletedAt: null },
    include: { client: true, consultant: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission("project.create");
  if (guard.error) return guard.error;

  const body = await req.json();
  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const project = await prisma.project.create({ data: parsed.data });

  await writeAuditLog({
    userId: guard.userId,
    action: "PROJECT_CREATED",
    entity: "Project",
    entityId: project.id,
    newValue: project,
  });

  return NextResponse.json({ project }, { status: 201 });
}
