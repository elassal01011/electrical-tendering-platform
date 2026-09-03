"use client";
import { useEffect, useRef, useState } from "react";
import {
  BOQ_FIELDS,
  type BoqField,
  type Detection,
} from "@/lib/services/excel/columnDetector";
import {
  validateExcelFile,
  XLSX_MIME,
} from "@/lib/services/excel/uploadPolicy";
import { requestJson } from "@/lib/client/request";

type Preview = {
  sheets: string[];
  sheetName: string;
  headerRow: number;
  mapping: Detection[];
  previewRows: { rowNumber: number; cells: (string | number | null)[] }[];
  summary: {
    totalRows: number;
    validRows: number;
    sectionHeaders: number;
    reviewRows: number;
    missingQuantity: number;
  };
  issues: { rowNumber: number; description: string; reason: string }[];
  issueCount: number;
};
export function ExcelImportPanel({
  projectId,
  onImported,
}: {
  projectId: string;
  onImported: (boq: unknown) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const [limit, setLimit] = useState<number | null>(null),
    [header, setHeader] = useState(1),
    [reviewed, setReviewed] = useState(false),
    [skip, setSkip] = useState(false);
  const uploadId = useRef(""),
    inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    requestJson("/api/boq/excel/upload")
      .then((d) => setLimit(d.maxUploadMB))
      .catch((e) => setError(e.message));
  }, []);
  async function clear() {
    const id = uploadId.current;
    uploadId.current = "";
    setFile(null);
    setPreview(null);
    setReviewed(false);
    setSkip(false);
    setSuccess("");
    setError("");
    if (inputRef.current) inputRef.current.value = "";
    if (id)
      await requestJson(
        `/api/boq/excel/upload?uploadId=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      ).catch((e) => setError(e.message));
  }
  async function selectFile(selected?: File) {
    await clear();
    if (!selected || !limit) return;
    try {
      validateExcelFile(selected, limit);
      setFile(selected);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function upload() {
    if (uploadId.current) return uploadId.current;
    if (!file) throw new Error("Choose a workbook first.");
    const result = await requestJson("/api/boq/excel/upload", {
      method: "POST",
      body: JSON.stringify({
        name: file.name,
        type: file.type,
        size: file.size,
      }),
    });
    uploadId.current = result.uploadId;
    try {
      for (let offset = 0; offset < file.size; offset += result.chunkBytes) {
        setBusy(`Uploading ${Math.round((offset / file.size) * 100)}%`);
        await requestJson(
          `/api/boq/excel/upload?uploadId=${encodeURIComponent(result.uploadId)}&index=${offset / result.chunkBytes}`,
          {
            method: "PUT",
            body: file.slice(offset, offset + result.chunkBytes),
            headers: { "Content-Type": "application/octet-stream" },
          },
        );
      }
      return result.uploadId;
    } catch (e) {
      uploadId.current = "";
      await fetch(
        `/api/boq/excel/upload?uploadId=${encodeURIComponent(result.uploadId)}`,
        { method: "DELETE" },
      ).catch(() => {});
      throw e;
    }
  }
  function currentMapping() {
    if (!preview) throw new Error("Preview the workbook first.");
    const selected = preview.mapping.filter((m) => m.field !== "ignore");
    if (new Set(selected.map((m) => m.field)).size !== selected.length)
      throw new Error("Assign each field only once.");
    return Object.fromEntries(selected.map((m) => [m.field, m.column]));
  }
  async function loadPreview(
    sheetName?: string,
    headerRow?: number,
    review = false,
  ) {
    setBusy("Reading workbook…");
    setError("");
    setSuccess("");
    setReviewed(false);
    setSkip(false);
    try {
      const mapping = review ? currentMapping() : undefined;
      const id = await upload();
      setBusy("Preparing preview…");
      const data = await requestJson("/api/boq/excel/preview", {
        method: "POST",
        body: JSON.stringify({
          uploadId: id,
          config: { sheetName, headerRow, mapping },
        }),
      });
      setPreview(
        review && preview ? { ...data, mapping: preview.mapping } : data,
      );
      setHeader(data.headerRow);
      setReviewed(review);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function importFile() {
    if (!file || !preview || !reviewed) return;
    setBusy("Importing BOQ…");
    setError("");
    try {
      const data = await requestJson("/api/boq/excel/import", {
        method: "POST",
        body: JSON.stringify({
          uploadId: uploadId.current,
          config: {
            projectId,
            name: file.name.replace(/\.xlsx$/i, ""),
            sheetName: preview.sheetName,
            headerRow: preview.headerRow,
            mapping: currentMapping(),
            skipReviewRows: skip,
          },
        }),
      });
      setSuccess(
        `${data.itemCount} BOQ rows imported successfully. ${data.summary.reviewRows} review rows were skipped and recorded in the audit log.`,
      );
      setReviewed(false);
      onImported(data.boq);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="card space-y-5" aria-busy={!!busy}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">Import an Excel BOQ</h2>
          <p className="muted text-sm">
            Upload → verify columns → review rows → confirm import
          </p>
        </div>
        <span className="badge">
          .xlsx {limit ? `· up to ${limit} MB` : ""}
        </span>
      </div>
      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy) void selectFile(e.dataTransfer.files[0]);
        }}
      >
        <label htmlFor="boq-file" className="block font-medium">
          Drop your workbook here or choose a file
        </label>
        <input
          id="boq-file"
          ref={inputRef}
          disabled={!!busy || !limit}
          className="mt-3 max-w-full text-sm"
          type="file"
          accept={`.xlsx,${XLSX_MIME}`}
          onChange={(e) => void selectFile(e.target.files?.[0])}
        />
        {file && (
          <p className="mt-3 text-sm">
            {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="btn-primary"
          disabled={!file || !!busy || !projectId}
          onClick={() => loadPreview()}
        >
          Preview workbook
        </button>
        <button
          className="btn-secondary"
          disabled={!file || !!busy}
          onClick={clear}
        >
          Clear selected file
        </button>
        {!projectId && (
          <span className="muted text-sm">Select a project to continue.</span>
        )}
      </div>
      {busy && (
        <p role="status" className="notice">
          <span className="spinner" /> {busy}
        </p>
      )}
      {error && (
        <div role="alert" className="error-box">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="success-box">
          {success}
        </div>
      )}
      {preview && (
        <>
          <div className="flex flex-wrap gap-4">
            <label>
              Worksheet
              <select
                className="input"
                disabled={!!busy}
                value={preview.sheetName}
                onChange={(e) => loadPreview(e.target.value)}
              >
                {preview.sheets.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Header row
              <input
                className="input w-28"
                type="number"
                min="1"
                value={header}
                disabled={!!busy}
                onChange={(e) => {
                  setHeader(Number(e.target.value));
                  setReviewed(false);
                }}
              />
            </label>
            <button
              className="btn-secondary self-end"
              disabled={!!busy}
              onClick={() => loadPreview(preview.sheetName, header)}
            >
              Read this header
            </button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Header</th>
                  <th>Detected field</th>
                  <th>Confidence</th>
                  <th>Your mapping</th>
                </tr>
              </thead>
              <tbody>
                {preview.mapping.map((m, i) => (
                  <tr key={m.column}>
                    <td>{m.letter}</td>
                    <td>{m.header || "—"}</td>
                    <td>{m.field}</td>
                    <td>{m.confidence}%</td>
                    <td>
                      <select
                        aria-label={`Mapping for column ${m.letter}`}
                        className="input"
                        disabled={!!busy}
                        value={m.field}
                        onChange={(e) => {
                          setPreview({
                            ...preview,
                            mapping: preview.mapping.map((item, index) =>
                              index === i
                                ? { ...item, field: e.target.value as BoqField }
                                : item,
                            ),
                          });
                          setReviewed(false);
                          setSkip(false);
                        }}
                      >
                        {BOQ_FIELDS.map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="font-medium">First 20 useful rows</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Excel row</th>
                  {preview.mapping.map((m) => (
                    <th key={m.column}>{m.letter}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.previewRows.map((r) => (
                  <tr key={r.rowNumber}>
                    <td>{r.rowNumber}</td>
                    {r.cells.map((c, i) => (
                      <td key={i} className="max-w-sm">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="btn-secondary"
            disabled={!!busy || header !== preview.headerRow}
            onClick={() =>
              loadPreview(preview.sheetName, preview.headerRow, true)
            }
          >
            Review mapped rows
          </button>
          {reviewed && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                {Object.entries({
                  "Rows detected": preview.summary.totalRows,
                  "Valid rows": preview.summary.validRows,
                  "Section headers skipped": preview.summary.sectionHeaders,
                  "Require review": preview.summary.reviewRows,
                  "Missing quantity": preview.summary.missingQuantity,
                }).map(([name, value]) => (
                  <div className="metric" key={name}>
                    <span>{name}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              {preview.issueCount > 0 && (
                <>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Description</th>
                          <th>Review reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.issues.map((issue) => (
                          <tr key={issue.rowNumber}>
                            <td>{issue.rowNumber}</td>
                            <td>{issue.description}</td>
                            <td>{issue.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted text-sm">
                    Showing {preview.issues.length} of {preview.issueCount}{" "}
                    review rows. Correct the source workbook and re-upload, or
                    acknowledge skipping all review rows.
                  </p>
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={skip}
                      onChange={(e) => setSkip(e.target.checked)}
                    />
                    Skip all {preview.issueCount} review rows and retain their
                    details in the audit log.
                  </label>
                </>
              )}
              <button
                className="btn-primary"
                disabled={
                  !!busy ||
                  !preview.summary.validRows ||
                  (!!preview.summary.reviewRows && !skip)
                }
                onClick={importFile}
              >
                Confirm import of {preview.summary.validRows} rows
              </button>
            </div>
          )}
          <p className="notice text-sm">
            Preliminary Selection — Requires Engineer Verification
          </p>
        </>
      )}
    </section>
  );
}
