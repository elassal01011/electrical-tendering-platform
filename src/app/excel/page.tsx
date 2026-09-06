"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { requestJson } from "@/lib/client/request";
import { validateExcelFile } from "@/lib/services/excel/uploadPolicy";
import {
  IMPORT_TYPES,
  MAPPING_FIELDS,
} from "@/lib/services/excel/importMapping";
import type { normalizeSheet } from "@/lib/services/excel/extractWorkbook";

type Preview = ReturnType<typeof normalizeSheet> & {
  fileName: string;
  sheets: {
    name: string;
    rowCount: number;
    columnCount: number;
    detectedHeaderRow: number;
    headerConfidence: number;
  }[];
  dataRowCount: number;
  detectedHeaderRow: number;
  headerConfidence: number;
  suggestions: Record<string, number>;
};
export default function ExcelPage() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [limit, setLimit] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [header, setHeader] = useState(1),
    [step, setStep] = useState(0);
  const [importType, setImportType] = useState<string>(IMPORT_TYPES[0]),
    [mapping, setMapping] = useState<Record<string, number>>({});
  const uploadId = useRef("");
  useEffect(() => {
    requestJson("/api/boq/excel/upload")
      .then((d) => setLimit(d.maxUploadMB))
      .catch((e) => setError(e.message));
  }, []);
  async function execute(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function read(sheetName?: string, headerRow?: number) {
    const result = await requestJson("/api/excel", {
      method: "POST",
      body: JSON.stringify({
        uploadId: uploadId.current,
        config: { sheetName, headerRow },
      }),
    });
    setPreview(result);
    setHeader(result.headerRow);
    setMapping({});
    setStep(0);
  }
  async function upload(file?: File) {
    if (!file) return;
    await execute(async () => {
      validateExcelFile(file, limit);
      if (uploadId.current)
        await requestJson(
          `/api/boq/excel/upload?uploadId=${encodeURIComponent(uploadId.current)}`,
          { method: "DELETE" },
        );
      uploadId.current = "";
      setPreview(null);
      setStep(0);
      const data = await requestJson("/api/boq/excel/upload", {
        method: "POST",
        body: JSON.stringify({
          name: file.name,
          type: file.type,
          size: file.size,
        }),
      });
      uploadId.current = data.uploadId;
      try {
        for (let offset = 0; offset < file.size; offset += data.chunkBytes)
          await requestJson(
            `/api/boq/excel/upload?uploadId=${encodeURIComponent(data.uploadId)}&index=${offset / data.chunkBytes}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/octet-stream" },
              body: file.slice(offset, offset + data.chunkBytes),
            },
          );
        await read();
      } catch (e) {
        await requestJson(
          `/api/boq/excel/upload?uploadId=${encodeURIComponent(data.uploadId)}`,
          { method: "DELETE" },
        ).catch(() => {});
        uploadId.current = "";
        throw e;
      }
    });
  }
  async function action(action: string) {
    await execute(async () => {
      const data = await requestJson("/api/excel", {
        method: "POST",
        body: JSON.stringify({
          uploadId: uploadId.current,
          config: {
            action,
            sheetName: preview!.sheetName,
            headerRow: preview!.headerRow,
            mapping,
            importType,
          },
        }),
      });
      if (action === "validate") {
        setStep(2);
        setMessage(
          "Mapping is valid. Review the selected sheet and import type before saving.",
        );
      }
      if (action === "stage") {
        setMessage(data.message);
        setStep(1);
      }
      if (action === "export") {
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json",
          }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = "excel-extraction.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
  }
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Excel Data Extractor</h1>
      <p className="muted">
        Upload any normal .xlsx workbook, select a sheet, and preview its actual
        columns.
      </p>
      <section className="card space-y-4" aria-busy={busy}>
        <label className="block">
          Upload Excel · {limit || "…"} MB maximum
          <input
            aria-label="Upload Excel workbook"
            className="input"
            type="file"
            accept=".xlsx"
            disabled={busy || !limit}
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {busy && <p role="status">Processing workbook…</p>}
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="notice">
            {message}
          </p>
        )}
        {preview && (
          <>
            <h2 className="font-semibold">Workbook: {preview.fileName}</h2>
            <p>
              Step {step + 1} of 3:{" "}
              {step === 0
                ? "Sheet and preview"
                : step === 1
                  ? "Import type and optional mapping"
                  : "Confirm staging import"}
            </p>
            {step === 0 && (
              <>
                <label className="block">
                  Worksheet
                  <select
                    className="input"
                    value={preview.sheetName}
                    disabled={busy}
                    onChange={(e) => execute(() => read(e.target.value))}
                  >
                    {preview.sheets.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name} · {s.rowCount} rows · {s.columnCount} columns ·
                        header {s.detectedHeaderRow || "none"}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  Detected header row: {preview.detectedHeaderRow || "none"} ·
                  confidence {preview.headerConfidence}% ·{" "}
                  {preview.dataRowCount} useful data rows
                </p>
                <label>
                  Header row
                  <input
                    className="input"
                    type="number"
                    min={preview.detectedHeaderRow ? 1 : 0}
                    value={header}
                    disabled={busy}
                    onChange={(e) => setHeader(Number(e.target.value))}
                  />
                </label>
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => execute(() => read(preview.sheetName, header))}
                >
                  Apply header row
                </button>
              </>
            )}
            <div className="table-wrap">
              <table className="data-table">
                <caption>First 30 useful rows — {preview.sheetName}</caption>
                <thead>
                  <tr>
                    <th>Excel row</th>
                    {preview.headers.map((h) => (
                      <th key={h.key}>
                        {h.label}
                        <span className="muted"> ({h.key})</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.rowNumber}>
                      <td>{r.rowNumber}</td>
                      {preview.headers.map((h) => (
                        <td key={h.key}>
                          {r.data[h.key] === null ? "" : String(r.data[h.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {step === 0 ? (
              <button
                className="btn-primary"
                disabled={busy || header !== preview.headerRow}
                onClick={() => setStep(1)}
              >
                Continue
              </button>
            ) : (
              <>
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => {
                    setStep(step - 1);
                    setMessage("");
                  }}
                >
                  Back
                </button>
                {step === 1 && (
                  <>
                    <label className="block">
                      Import as
                      <select
                        className="input"
                        disabled={busy}
                        value={importType}
                        onChange={(e) => setImportType(e.target.value)}
                      >
                        {IMPORT_TYPES.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                    <p className="notice">
                      Imports here save the selected sheet as normalized JSON in
                      temporary staging for later processing. Uploads expire
                      after 30 minutes. Download JSON to keep a copy. Catalog,
                      pricing, BOQ, client, and supplier choices label the
                      staged data.
                    </p>
                    <p>
                      To create business records, use the existing{" "}
                      <Link className="underline" href="/boq">
                        BOQ importer
                      </Link>{" "}
                      or{" "}
                      <Link className="underline" href="/pricing">
                        supplier pricing importer
                      </Link>
                      .
                    </p>
                    <h3>Optional column mapping</h3>
                    <button
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() => setMapping(preview.suggestions)}
                    >
                      Use suggested mappings
                    </button>
                    <div className="grid gap-3 md:grid-cols-3">
                      {MAPPING_FIELDS.map((field) => (
                        <label key={field}>
                          {field}
                          <select
                            className="input"
                            disabled={busy}
                            value={mapping[field] ?? ""}
                            onChange={(e) =>
                              setMapping((current) => {
                                const next = { ...current };
                                if (e.target.value)
                                  next[field] = Number(e.target.value);
                                else delete next[field];
                                return next;
                              })
                            }
                          >
                            <option value="">Unmapped</option>
                            {preview.headers.map((h) => (
                              <option key={h.key} value={h.column}>
                                {h.label} ({h.key})
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                    {importType !== IMPORT_TYPES[0] && (
                      <button
                        className="btn-primary"
                        disabled={busy}
                        onClick={() => action("validate")}
                      >
                        Validate
                      </button>
                    )}
                  </>
                )}
                {step === 2 && (
                  <>
                    <p>
                      Save {preview.dataRowCount} rows from {preview.sheetName}{" "}
                      as {importType}?
                    </p>
                    <button
                      className="btn-primary"
                      disabled={busy}
                      onClick={() => action("stage")}
                    >
                      Confirm import to staging
                    </button>
                  </>
                )}
              </>
            )}
            <button
              className="btn-secondary"
              disabled={busy || header !== preview.headerRow}
              onClick={() => action("export")}
            >
              Download normalized JSON
            </button>
          </>
        )}
      </section>
    </div>
  );
}
