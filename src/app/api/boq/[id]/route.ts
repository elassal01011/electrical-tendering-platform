import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission("boq.view");
  if (guard.error) return guard.error;

  const boq = await prisma.bOQ.findUnique({
    where: { id: params.id },
    include: {
      items: { include: { matchedComponent: true, appliedSupplier: true, appliedSupplierPrice: true }, orderBy: { lineNo: "asc" } },
      project: true,
    },
  });
  if (!boq) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ boq });
}
