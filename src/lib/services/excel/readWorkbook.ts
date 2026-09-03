import ExcelJS from "exceljs";
import { ExcelError, validateExcelFile } from "./uploadPolicy";

export type WorkbookFile = {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

// Inspect ZIP directory before decompression: compressed input alone does not bound memory.
export function validateZip(buffer: Buffer) {
  if (buffer.length < 22)
    throw new ExcelError("Workbook is corrupted or invalid.");
  if (buffer.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex")))
    throw new ExcelError("Password-protected Excel files are not supported.");
  if (buffer.readUInt32LE(0) !== 0x04034b50)
    throw new ExcelError("Workbook is corrupted or invalid.");
  let end = -1;
  for (
    let i = buffer.length - 22;
    i >= Math.max(0, buffer.length - 65557);
    i--
  ) {
    if (
      buffer.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + buffer.readUInt16LE(i + 20) === buffer.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ExcelError("Workbook is corrupted or invalid.");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16),
    expanded = 0;
  if (count > 5000)
    throw new ExcelError(
      "Workbook contains too many archive entries. Split it into smaller workbooks.",
      413,
    );
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50)
      throw new ExcelError("Workbook is corrupted or invalid.");
    if (buffer.readUInt16LE(offset + 8) & 1)
      throw new ExcelError("Password-protected Excel files are not supported.");
    expanded += buffer.readUInt32LE(offset + 24);
    if (expanded > 80 * 1024 * 1024)
      throw new ExcelError(
        "Workbook expands beyond the safe memory limit. Split it into smaller workbooks.",
        413,
      );
    offset +=
      46 +
      buffer.readUInt16LE(offset + 28) +
      buffer.readUInt16LE(offset + 30) +
      buffer.readUInt16LE(offset + 32);
  }
  if (offset > end) throw new ExcelError("Workbook is corrupted or invalid.");
}
export async function readWorkbook(file: WorkbookFile) {
  validateExcelFile(file);
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length !== file.size || bytes.length < 22)
      throw new ExcelError("Workbook is corrupted or invalid.");
    validateZip(bytes);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    if (!workbook.worksheets.length)
      throw new ExcelError("Workbook contains no worksheets.");
    for (const sheet of workbook.worksheets) {
      if (sheet.rowCount > 25000 || sheet.columnCount > 200)
        throw new ExcelError(
          "Worksheet exceeds 25,000 rows or 200 columns. Split the workbook before importing.",
          413,
        );
    }
    return workbook;
  } catch (error) {
    if (error instanceof ExcelError) throw error;
    // Parser messages can contain workbook contents; log the error class only.
    console.error("excel.read", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    throw new ExcelError(
      "Workbook is corrupted or invalid.",
      400,
      "Unable to read Excel workbook. Re-save it as an unencrypted .xlsx file and try again.",
    );
  }
}
export function readCell(cell: ExcelJS.Cell): string | number | null {
  const master = cell.isMerged ? cell.master : cell;
  const value = master.value;
  if (value == null) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if ("formula" in value || "sharedFormula" in value) {
    const result = value.result;
    if (typeof result === "number" || typeof result === "string") return result;
    return master.text;
  }
  if ("richText" in value)
    return value.richText.map((part) => part.text).join("");
  if ("text" in value) return value.text;
  return master.text;
}
