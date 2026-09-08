import { excelUploadHandlers } from "@/lib/services/excel/uploadHandlers";
export const runtime = "nodejs";
export const { GET, POST, PUT, DELETE } = excelUploadHandlers("pricing.edit");
