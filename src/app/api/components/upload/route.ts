import { excelUploadHandlers } from "@/lib/services/excel/uploadHandlers";

export const runtime = "nodejs";
export const maxDuration = 60;
export const { GET, POST, PUT, DELETE } = excelUploadHandlers("catalog.edit");
