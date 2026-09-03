import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
import { hasPermission } from "@/lib/auth/permissions";
export async function GET(
  _: Request,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  try {
    const g = await requirePermission("project.view");
    if (g.error) return g.error;
    const project = await prisma.project.findFirst({
      where: { id: params.id, deletedAt: null },
      include: {
        client: true,
        consultant: true,
        boqs: {
          select: {
            id: true,
            name: true,
            version: true,
            _count: { select: { items: true } },
          },
        },
        _count: { select: { panels: true, documents: true } },
      },
    });
    if (!project)
      return NextResponse.json(
        { error: "Project not found." },
        { status: 404 },
      );
    const quotes = hasPermission(g.session!.user.roles, "quote.view")
      ? await prisma.quote.findMany({
          where: { projectId: params.id },
          select: {
            id: true,
            quoteNumber: true,
            revision: true,
            status: true,
            totalSell: true,
            currency: true,
          },
          take: 50,
          orderBy: { createdAt: "desc" },
        })
      : [];
    const activity = await prisma.auditLog.findMany({
      where: { entity: "Project", entityId: params.id },
      select: {
        id: true,
        action: true,
        createdAt: true,
        user: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return NextResponse.json({ project, quotes, activity });
  } catch (e) {
    return apiError(e, "projects.detail");
  }
}
export async function PATCH(
  req: Request,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  try {
    const g = await requirePermission("project.edit");
    if (g.error) return g.error;
    const data = z
      .object({
        status: z.enum([
          "NEW",
          "UNDER_REVIEW",
          "BOQ_ANALYSIS",
          "ENGINEERING",
          "PRICING",
          "INTERNAL_REVIEW",
          "SUBMITTED",
          "NEGOTIATION",
          "WON",
          "LOST",
          "CANCELLED",
        ]),
        notes: z.string().max(5000).optional(),
      })
      .parse(await req.json());
    const project = await prisma.$transaction(async (tx) => {
      const old = await tx.project.findUniqueOrThrow({
        where: { id: params.id },
      });
      const row = await tx.project.update({ where: { id: params.id }, data });
      await tx.auditLog.create({
        data: {
          userId: g.userId,
          action: "PROJECT_STATUS_CHANGED",
          entity: "Project",
          entityId: row.id,
          oldValue: { status: old.status },
          newValue: data,
        },
      });
      return row;
    });
    return NextResponse.json({ project });
  } catch (e) {
    return apiError(e, "projects.status");
  }
}
