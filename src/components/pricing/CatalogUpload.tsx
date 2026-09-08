"use client";
import { useEffect, useRef, useState } from "react";
import { CATALOG_FIELDS } from "@/lib/services/pricing/catalogFields";
import { requestJson } from "@/lib/client/request";
import {
  createImportProcessingLock,
  requestCatalogBatch,
} from "@/lib/client/catalogBatchClient";
export function CatalogUpload({
  close,
  completed,
}: {
  close: () => void;
  completed: (review: number) => void;
}) {
  const [uploadId, setUploadId] = useState("");
  const [preview, setPreview] = useState<any>(null),
    [mapping, setMapping] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [header, setHeader] = useState(1),
    [sheet, setSheet] = useState("");
  const [supplier, setSupplier] = useState("Unspecified catalog supplier"),
    [currency, setCurrency] = useState("EGP");
  const [mode, setMode] = useState("revision"),
    [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<any>(null),
    [showSkipped, setShowSkipped] = useState(false);
  const [session, setSession] = useState<any>(null);
  const pauseRequested = useRef(false);
  const processingLock = useRef(createImportProcessingLock());
  const sessionKey = "price-catalog-import-session";
  useEffect(() => {
    const id = window.localStorage.getItem(sessionKey);
    if (!id) return;
    requestJson(`/api/pricing/import/${id}`)
      .then((value) => {
        setSession(value);
        setUploadId(id);
        if (value.status === "COMPLETED") {
          showCompleted(value);
          completed(value.reviewRows);
        }
      })
      .catch(() => window.localStorage.removeItem(sessionKey));
  }, []);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function analyze(id: string, sheetName?: string, headerRow?: number) {
    const data = await requestJson("/api/pricing/catalog/import", {
      method: "POST",
      body: JSON.stringify({
        uploadId: id,
        config: { action: "analyze", sheetName, headerRow },
      }),
    });
    setPreview(data);
    setMapping(data.mapping);
    setSheet(data.sheetName);
    setHeader(data.headerRow);
    setResult(null);
  }
  async function upload(file: File) {
    await run(async () => {
      if (uploadId)
        await requestJson(`/api/pricing/upload?uploadId=${uploadId}`, {
          method: "DELETE",
        });
      setPreview(null);
      setResult(null);
      const data = await requestJson("/api/pricing/upload", {
        method: "POST",
        body: JSON.stringify({
          name: file.name,
          type: file.type,
          size: file.size,
        }),
      });
      setUploadId(data.uploadId);
      for (let offset = 0; offset < file.size; offset += data.chunkBytes)
        await requestJson(
          `/api/pricing/upload?uploadId=${data.uploadId}&index=${offset / data.chunkBytes}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: file.slice(offset, offset + data.chunkBytes),
          },
        );
      await analyze(data.uploadId);
    });
  }
  async function action(action: string) {
    await run(async () => {
      const response = await fetch("/api/pricing/catalog/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId,
          config: {
            action,
            sheetName: sheet,
            headerRow: header,
            mapping,
            supplier,
            currency,
            mode,
            revisionDate: new Date(date).toISOString(),
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (typeof data.imported === "number") {
          setResult({ ...result, ...data, preview: false, interrupted: true });
          completed(result?.needsReview ?? 0);
        }
        throw new Error(data.error || "Catalog import failed.");
      }
      setResult(data);
      if (action === "import") completed(data.needsReview);
    });
  }
  async function processBatches(initial: any) {
    await processingLock.current.run(async () => {
      let current = initial;
      while (
        current.status !== "COMPLETED" &&
        current.status !== "CANCELLED" &&
        current.currentOffset < current.totalRows &&
        !pauseRequested.current
      ) {
        current = await requestCatalogBatch(current);
        setSession(current);
      }
      if (current.status === "COMPLETED") {
        showCompleted(current);
        completed(current.reviewRows);
      }
    });
  }
  function showCompleted(current: any) {
    setResult({
      preview: false,
      valid: current.importedRows,
      imported: current.importedRows,
      updated: current.updatedRows,
      skippedNoPrice: current.noPriceRows,
      skippedExisting: current.skippedRows - current.noPriceRows,
      needsReview: current.reviewRows,
      failed: current.failedRows,
      review: current.reviewReport,
      skippedRows: current.skippedReport,
      duplicateRows: 0,
    });
  }
  async function startImport() {
    await run(async () => {
      pauseRequested.current = false;
      const started = await requestJson("/api/pricing/import/start", {
        method: "POST",
        body: JSON.stringify({ uploadId: result.sessionId }),
      });
      window.localStorage.setItem(sessionKey, started.id);
      setSession(started);
      await processBatches(started);
    });
  }
  async function cancelImport() {
    await run(async () => {
      if (session?.id)
        setSession(
          await requestJson(`/api/pricing/import/${session.id}`, {
            method: "DELETE",
          }),
        );
      else if (uploadId)
        await requestJson(`/api/pricing/upload?uploadId=${uploadId}`, {
          method: "DELETE",
        });
      window.localStorage.removeItem(sessionKey);
      close();
    });
  }
  function downloadReport() {
    const report = {
      fileName: session.fileName,
      status: session.status,
      totalRows: session.totalRows,
      imported: session.importedRows,
      updated: session.updatedRows,
      skipped: session.skippedRows,
      needsReview: session.reviewRows,
      failed: session.failedRows,
      skippedRows: session.skippedReport,
      reviewRows: session.reviewReport,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "price-catalog-import-report.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  const reset = () => setResult(null);
  const step =
    session?.status === "COMPLETED"
      ? 6
      : session
        ? 5
        : result?.preview
          ? 4
          : preview
            ? 3
            : uploadId
              ? 1
              : 0;
  return (
    <section className="card space-y-4" aria-label="Upload Price Catalog">
      <div className="flex justify-between">
        <h2 className="font-semibold">Upload Price Catalog</h2>
        <button
          className="btn-secondary"
          disabled={busy}
          onClick={() => void cancelImport()}
        >
          Close
        </button>
      </div>
      <ol className="grid gap-2 text-sm md:grid-cols-6">
        {[
          "File uploaded",
          "Sheet extracted",
          "Columns mapped",
          "Ready to import",
          "Importing",
          "Complete",
        ].map((label, index) => (
          <li className={step >= index + 1 ? "badge" : "muted"} key={label}>
            Step {index + 1}: {label}
          </li>
        ))}
      </ol>
      <label className="block">
        Excel workbook
        <input
          className="input"
          type="file"
          accept=".xlsx"
          disabled={busy}
          onChange={(e) => {
            if (e.target.files?.[0]) void upload(e.target.files[0]);
            e.target.value = "";
          }}
        />
      </label>
      {busy && <p role="status">Processing price catalog…</p>}
      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}
      {session &&
        session.status !== "COMPLETED" &&
        session.status !== "CANCELLED" && (
          <div className="space-y-2">
            <h3>Importing {session.fileName}</h3>
            <p>
              Processed: {session.processedRows.toLocaleString()} /{" "}
              {session.totalRows.toLocaleString()} · Imported:{" "}
              {session.importedRows.toLocaleString()} · Skipped:{" "}
              {session.skippedRows.toLocaleString()} · Needs Review:{" "}
              {session.reviewRows.toLocaleString()} · Failed:{" "}
              {session.failedRows.toLocaleString()}
            </p>
            <div
              className="h-3 overflow-hidden rounded bg-slate-800"
              role="progressbar"
              aria-valuenow={session.processedRows}
              aria-valuemax={session.totalRows}
            >
              <div
                className="h-full bg-blue-500"
                style={{
                  width: `${session.totalRows ? Math.round((session.processedRows / session.totalRows) * 100) : 0}%`,
                }}
              />
            </div>
            <div className="flex gap-2">
              {busy ? (
                <button
                  className="btn-secondary"
                  onClick={() => {
                    pauseRequested.current = true;
                  }}
                >
                  Pause after this batch
                </button>
              ) : (
                <button
                  className="btn-primary"
                  onClick={() => {
                    pauseRequested.current = false;
                    void run(() => processBatches(session));
                  }}
                >
                  Resume Import
                </button>
              )}
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => void cancelImport()}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      {preview && (
        <>
          <div className="grid md:grid-cols-3 gap-3">
            <label>
              Worksheet
              <select
                className="input"
                disabled={busy}
                value={sheet}
                onChange={(e) =>
                  void run(() => analyze(uploadId, e.target.value))
                }
              >
                {preview.sheets.map((s: any) => (
                  <option key={s.name}>{s.name}</option>
                ))}
              </select>
            </label>
            <label>
              Header row
              <input
                className="input"
                type="number"
                min="1"
                value={header}
                onChange={(e) => {
                  setHeader(Number(e.target.value));
                  reset();
                }}
              />
            </label>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => void run(() => analyze(uploadId, sheet, header))}
            >
              Analyze Header Row
            </button>
          </div>
          <p>
            {preview.rowCount} rows found. Unknown columns are allowed. Correct
            any mapping below.
          </p>
          <button
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              setMapping(preview.mapping);
              reset();
            }}
          >
            Auto Map Columns
          </button>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Excel column</th>
                  <th>Suggestion</th>
                  <th>Confidence</th>
                  <th>Your mapping</th>
                </tr>
              </thead>
              <tbody>
                {preview.recognition.map((c: any) => (
                  <tr key={c.column}>
                    <td>{c.sourceColumn}</td>
                    <td>
                      {c.suggestedField}
                      <p className="muted text-xs">{c.reasons.join("; ")}</p>
                    </td>
                    <td>{Math.round(c.confidence * 100)}%</td>
                    <td>
                      <select
                        className="input"
                        value={
                          Object.keys(mapping).find(
                            (f) => mapping[f] === c.column,
                          ) || ""
                        }
                        onChange={(e) => {
                          const next = Object.fromEntries(
                            Object.entries(mapping).filter(
                              ([, col]) => col !== c.column,
                            ),
                          );
                          if (e.target.value) next[e.target.value] = c.column;
                          setMapping(next);
                          reset();
                        }}
                      >
                        <option value="">Ignore</option>
                        {CATALOG_FIELDS.map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>Preview source data (first 30 rows)</summary>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    {preview.headers.map((h: any) => (
                      <th key={h.key}>{h.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r: any) => (
                    <tr key={r.rowNumber}>
                      {preview.headers.map((h: any) => (
                        <td key={h.key}>{String(r.data[h.key] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <div className="grid md:grid-cols-4 gap-3">
            <label>
              Supplier if missing
              <input
                className="input"
                value={supplier}
                onChange={(e) => {
                  setSupplier(e.target.value);
                  reset();
                }}
              />
            </label>
            <label>
              Currency if missing
              <input
                className="input"
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value.toUpperCase());
                  reset();
                }}
              />
            </label>
            <label>
              Revision / default valid-from date
              <input
                className="input"
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  reset();
                }}
              />
            </label>
            <label>
              Existing prices
              <select
                className="input"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value);
                  reset();
                }}
              >
                <option value="revision">Create new revision</option>
                <option value="update">Update existing</option>
                <option value="skip">Skip existing</option>
              </select>
            </label>
          </div>
          <p className="muted">
            No-price rows are skipped. Invalid rows are listed for review. A
            revision with the same effective date updates that dated revision;
            choose a later date to retain an older price.
          </p>
          <button
            className="btn-secondary"
            disabled={busy || !date}
            onClick={() => void action("validate")}
          >
            Validate
          </button>
          {result?.preview && (
            <div className="space-y-2">
              <p className="notice">
                Excel data is ready for import. No Price Catalog records have
                been changed yet.
              </p>
              <button
                className="btn-primary"
                disabled={busy || !result.valid}
                onClick={() => void startImport()}
              >
                Continue to Import
              </button>
              <button className="btn-secondary" onClick={() => setResult(null)}>
                Review Mapping
              </button>
              <button
                className="btn-secondary"
                onClick={() => void cancelImport()}
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}
      {result && (
        <div className="space-y-2">
          <h3>
            {result.interrupted
              ? "Price Catalog Import Interrupted"
              : result.preview
                ? "Import Review"
                : "Price Catalog Import Complete"}
          </h3>
          <p>
            Imported: {result.imported ?? 0} · Valid: {result.valid} · Skipped -
            No Price: {result.skippedNoPrice} · Skipped Existing:{" "}
            {result.skippedExisting} · Needs Review: {result.needsReview} ·
            Failed: {result.failed ?? 0}
          </p>
          {result.duplicateRows > 0 && (
            <p>
              {result.duplicateRows} repeated identifiers in this file were
              skipped; the first row was used.
            </p>
          )}
          {(result.review ?? []).map((r: any) => (
            <p key={r.row}>
              Row {r.row}: {r.message}
            </p>
          ))}
          {!result.preview && (
            <>
              <button
                className="btn-primary"
                onClick={() => {
                  window.localStorage.removeItem(sessionKey);
                  close();
                }}
              >
                View Price Catalog
              </button>
              <button className="btn-secondary" onClick={downloadReport}>
                Download Import Report
              </button>
            </>
          )}
          <button
            className="btn-secondary"
            onClick={() => setShowSkipped(!showSkipped)}
          >
            View Skipped Rows
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              setPreview(null);
              setResult(null);
            }}
          >
            Upload Another File
          </button>
          {showSkipped &&
            (result.skippedRows ?? []).map((r: any) => (
              <p key={r.row}>
                Row {r.row}: {r.message}
              </p>
            ))}
        </div>
      )}
    </section>
  );
}
