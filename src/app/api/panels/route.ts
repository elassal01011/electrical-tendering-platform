import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission, writeAuditLog } from "@/lib/auth/apiGuard";

const createPanelSchema = z.object({
  projectId: z.string().min(1),
  code: z.string().min(1),
  name: z.string().optional(),
  panelType: z.string().optional(),
  ipRating: z.string().optional(),
  ratedVoltageV: z.number().optional(),
  faultLevelKA: z.number().optional(),
});

export async function GET(req: NextRequest) {
  const guard = await requirePermission("panel.view");
  if (guard.error) return guard.error;
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId") ?? undefined;

  const panels = await prisma.panel.findMany({
    where: projectId ? { projectId } : undefined,
    include: { _count: { select: { components: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ panels });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission("panel.edit");
  if (guard.error) return guard.error;

  const body = await req.json();
  const parsed = createPanelSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );

  const panel = await prisma.panel.create({ data: parsed.data });

  await writeAuditLog({
    userId: guard.userId,
    action: "PANEL_CREATED",
    entity: "Panel",
    entityId: panel.id,
    newValue: panel,
  });

  return NextResponse.json({ panel }, { status: 201 });
}
