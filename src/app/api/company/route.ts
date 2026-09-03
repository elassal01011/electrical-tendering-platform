import { NextResponse } from "next/server";
import { getCompany } from "@/lib/company";
import { apiError } from "@/lib/apiError";
export const dynamic = "force-dynamic";
// Public brand fields only, for sign-in. Internal commercial defaults stay authenticated.
export async function GET() {
  try {
    const c = await getCompany();
    return NextResponse.json({
      companyName: c.companyName,
      productName: c.productName,
      logo: c.logo,
    });
  } catch (e) {
    return apiError(e, "company.brand");
  }
}
