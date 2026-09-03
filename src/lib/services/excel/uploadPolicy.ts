export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const EXCEL_CHUNK_BYTES = 1024 * 1024;
export class ExcelError extends Error {
  constructor(
    message: string,
    public status = 400,
    public detail = message,
  ) {
    super(message);
  }
}
export function excelUploadLimitMB() {
  const configured = Number(process.env.MAX_EXCEL_UPLOAD_MB ?? 10);
  return Number.isFinite(configured) && configured > 0 && configured <= 50
    ? configured
    : 10;
}
export function validateExcelFile(
  file: { name: string; type: string; size: number },
  limit = excelUploadLimitMB(),
) {
  if (/\.xls$/i.test(file.name))
    throw new ExcelError(
      "Legacy .xls is not supported. Please save the workbook as .xlsx.",
      415,
    );
  if (
    !/\.xlsx$/i.test(file.name) ||
    ![XLSX_MIME, "application/octet-stream", "application/zip", ""].includes(
      file.type.toLowerCase(),
    )
  )
    throw new ExcelError(
      "Unsupported file. Please select an .xlsx Excel workbook.",
      415,
    );
  if (!Number.isSafeInteger(file.size) || file.size <= 0)
    throw new ExcelError("Workbook is empty.");
  if (file.size > limit * 1024 * 1024)
    throw new ExcelError(
      `Excel file exceeds the ${limit} MB upload limit.`,
      413,
    );
}
