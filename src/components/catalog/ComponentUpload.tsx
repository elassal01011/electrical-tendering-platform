"use client";
import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/client/request";
import { createImportProcessingLock, requestCatalogBatch } from "@/lib/client/catalogBatchClient";
import { COMPONENT_FIELDS } from "@/lib/services/components/componentFields";

export function ComponentUpload({ close, completed }: { close: () => void; completed: () => void }) {
  const [uploadId, setUploadId] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [session, setSession] = useState<any>(null);
  const [review, setReview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duplicateMode, setDuplicateMode] = useState("UPDATE_EXISTING");
  const lock = useRef(createImportProcessingLock());
  const pauseRequested = useRef(false);
  const sessionKey = "component-catalog-import-session";
  useEffect(() => {
    const id = window.localStorage.getItem(sessionKey);
    if (!id) return;
    requestJson(`/api/components/import/${id}`)
      .then((value) => {
        setUploadId(id);
        setSession(value);
      })
      .catch(() => window.localStorage.removeItem(sessionKey));
  }, []);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await work(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  async function analyze(id: string, sheetName?: string, headerRow?: number) {
    const data = await requestJson("/api/components/import", {
      method: "POST",
      body: JSON.stringify({ uploadId: id, config: { action: "analyze", sheetName, headerRow } }),
    });
    setPreview(data);
    setMapping(data.mapping);
    setReview(null);
  }
  async function upload(file: File) {
    await run(async () => {
      const created = await requestJson("/api/components/upload", {
        method: "POST",
        body: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
      });
      setUploadId(created.uploadId);
      for (let offset = 0; offset < file.size; offset += created.chunkBytes)
        await requestJson(`/api/components/upload?uploadId=${created.uploadId}&index=${offset / created.chunkBytes}`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: file.slice(offset, offset + created.chunkBytes),
        });
      await analyze(created.uploadId);
    });
  }
  async function validate() {
    await run(async () => {
      setReview(await requestJson("/api/components/import", {
        method: "POST",
        body: JSON.stringify({
          uploadId,
          config: {
            action: "validate", sheetName: preview.sheetName,
            headerRow: preview.headerRow, mapping, duplicateMode,
          },
        }),
      }));
    });
  }
  async function process(initial: any) {
    await lock.current.run(async () => {
      let current = initial;
      while (
        current.status !== "COMPLETED" &&
        current.currentOffset < current.totalRows &&
        !pauseRequested.current
      ) {
        current = await requestCatalogBatch(current, fetch, undefined, "/api/components/import");
        setSession(current);
      }
      if (current.status === "COMPLETED") {
        window.localStorage.removeItem(sessionKey);
        completed();
      }
    });
  }
  async function start() {
    await run(async () => {
      const started = await requestJson("/api/components/import/start", {
        method: "POST", body: JSON.stringify({ uploadId: review.sessionId }),
      });
      setSession(started);
      window.localStorage.setItem(sessionKey, started.id);
      pauseRequested.current = false;
      await process(started);
    });
  }
  return (
    <section className="card space-y-4" aria-label="Upload Component Catalog">
      <div className="flex justify-between">
        <h2 className="font-semibold">Upload Component Catalog</h2>
        <button className="btn-secondary" disabled={busy} onClick={close}>Close</button>
      </div>
      {error && <p className="error-box">{error}</p>}
      <input type="file" accept=".xlsx" disabled={busy} onChange={(event) => {
        if (event.target.files?.[0]) void upload(event.target.files[0]);
      }} />
      {busy && <p role="status">Processing component catalog…</p>}
      {preview && (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <label>Sheet<select className="input" value={preview.sheetName} onChange={(event) => void run(() => analyze(uploadId, event.target.value))}>{preview.sheets.map((sheet: any) => <option key={sheet.name}>{sheet.name}</option>)}</select></label>
            <label>Rows detected<input className="input" readOnly value={preview.rowsDetected} /></label>
            <label>Columns detected<input className="input" readOnly value={preview.columnsDetected} /></label>
            <label>Header row<input className="input" type="number" min="1" value={preview.headerRow} onChange={(event) => void run(() => analyze(uploadId, preview.sheetName, Number(event.target.value)))} /></label>
          </div>
          <div className="table-wrap"><table className="data-table">
            <thead><tr>{preview.headers.map((header: any) => <th key={header.key}>{header.label}</th>)}</tr></thead>
            <tbody>{preview.rows.map((row: any) => <tr key={row.rowNumber}>{preview.headers.map((header: any) => <td key={header.key}>{String(row.data[header.key] ?? "")}</td>)}</tr>)}</tbody>
          </table></div>
          <h3 className="font-semibold">Detected mapping</h3>
          <div className="grid gap-3 md:grid-cols-3">{preview.recognition.map((column: any) => (
            <label key={column.column}>{column.sourceColumn} ({Math.round(column.confidence * 100)}%)
              <select className="input" value={Object.keys(mapping).find((field) => mapping[field] === column.column) || ""} onChange={(event) => {
                const next = Object.fromEntries(Object.entries(mapping).filter(([, value]) => value !== column.column));
                if (event.target.value) next[event.target.value] = column.column;
                setMapping(next); setReview(null);
              }}><option value="">Ignore</option>{COMPONENT_FIELDS.map((field) => <option key={field}>{field}</option>)}</select>
            </label>
          ))}</div>
          <label>Existing duplicates<select className="input max-w-sm" value={duplicateMode} onChange={(event) => setDuplicateMode(event.target.value)}>
            <option value="UPDATE_EXISTING">Update existing (default)</option>
            <option value="SKIP_EXISTING">Skip existing</option>
            <option value="CREATE_NEW">Create new record</option>
          </select></label>
          <button className="btn-primary" disabled={busy} onClick={() => void validate()}>Validate Components</button>
        </>
      )}
      {review && <div className="space-y-2">
        <p className="notice">{review.message}</p>
        <p>Valid: {review.valid} · Incomplete: {review.incomplete} · Invalid: {review.invalid}</p>
        {review.review.slice(0, 20).map((row: any) => <p key={row.row}>Row {row.row}: {row.classification} — {row.message}</p>)}
        <button className="btn-primary" disabled={busy || !review.valid} onClick={() => void start()}>Import Valid Components</button>
      </div>}
      {session && <div className="space-y-2">
        <p>Processed {session.processedRows} / {session.totalRows} · Created {session.createdRows} · Updated {session.updatedRows} · Skipped {session.skippedRows}</p>
        <progress className="w-full" max={session.totalRows} value={session.processedRows} />
        {session.status !== "COMPLETED" && (busy ? (
          <button className="btn-secondary" onClick={() => { pauseRequested.current = true; }}>Pause after this batch</button>
        ) : (
          <button className="btn-primary" onClick={() => void run(async () => {
            pauseRequested.current = false;
            const started = await requestJson("/api/components/import/start", {
              method: "POST", body: JSON.stringify({ uploadId: session.id }),
            });
            setSession(started);
            await process(started);
          })}>Resume Import</button>
        ))}
      </div>}
    </section>
  );
}
