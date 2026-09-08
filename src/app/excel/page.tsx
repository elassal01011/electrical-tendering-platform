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

const DESCRIPTION_FIELDS = [
  ["category", "Category", "text"],
  ["ratedCurrent", "Current (A)", "number"],
  ["poles", "Poles", "number"],
  ["breakingCapacity", "Breaking (kA)", "number"],
  ["manufacturer", "Manufacturer", "text"],
  ["conductorMaterial", "Conductor", "text"],
  ["insulation", "Insulation", "text"],
  ["cableCores", "Cable cores", "number"],
  ["cableSize", "Cable size (mm²)", "number"],
] as const;

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
  recognition: {
    column: number;
    sourceColumn: string;
    suggestedField: string;
    confidence: number;
    reasons: string[];
  }[];
  descriptionSuggestions: {
    rowNumber: number;
    original: string;
    category: string | null;
    ratedCurrent: number | null;
    poles: number | null;
    breakingCapacity: number | null;
    manufacturer: string | null;
    conductorMaterial: string | null;
    insulation: string | null;
    cableCores: number | null;
    cableSize: number | null;
  }[];
  suggestedImportTypes: { type: string; confidence: number }[];
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
    [mapping, setMapping] = useState<Record<string, number>>({}),
    [descriptionSuggestions, setDescriptionSuggestions] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]),
    [projectId, setProjectId] = useState(""),
    [boqs, setBoqs] = useState<any[]>([]);
  const [boqDestination, setBoqDestination] = useState<"create" | "append">(
      "create",
    ),
    [targetBoqId, setTargetBoqId] = useState(""),
    [boqName, setBoqName] = useState(""),
    [boqRevision, setBoqRevision] = useState(0),
    [boqCurrency, setBoqCurrency] = useState("EGP"),
    [boqReview, setBoqReview] = useState<any>(null),
    [skipReview, setSkipReview] = useState(false),
    [defaultQuantityOne, setDefaultQuantityOne] = useState(false);
  const uploadId = useRef("");
  useEffect(() => {
    requestJson("/api/boq/excel/upload")
      .then((d) => setLimit(d.maxUploadMB))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    requestJson("/api/projects")
      .then((d) => {
        setProjects(d.projects);
        setProjectId(d.projects[0]?.id || "");
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!projectId) {
      setBoqs([]);
      return;
    }
    requestJson("/api/projects/" + projectId)
      .then((d) => setBoqs(d.project.boqs))
      .catch((e) => setError(e.message));
  }, [projectId]);
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
    setDescriptionSuggestions(result.descriptionSuggestions ?? []);
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
  function boqMapping() {
    return Object.fromEntries(
      [
        ["description", mapping.description],
        ["quantity", mapping.quantity],
        ["unit", mapping.unit],
        ["manufacturer", mapping.manufacturer],
        ["model", mapping.partNumber],
      ].filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    );
  }
  function descriptionOverrides() {
    return Object.fromEntries(
      descriptionSuggestions.map(
        ({ rowNumber, original: _original, ...values }) => [
          String(rowNumber),
          values,
        ],
      ),
    );
  }
  async function reviewBoq() {
    await execute(async () => {
      const data = await requestJson("/api/boq/excel/preview", {
        method: "POST",
        body: JSON.stringify({
          uploadId: uploadId.current,
          config: {
            sheetName: preview!.sheetName,
            headerRow: preview!.headerRow,
            mapping: boqMapping(),
            defaultQuantityOne,
            descriptionOverrides: descriptionOverrides(),
          },
        }),
      });
      setBoqReview(data);
      setMessage(
        "BOQ mapping validated. Review the row counts before importing.",
      );
    });
  }
  async function importBoq() {
    await execute(async () => {
      const data = await requestJson("/api/boq/excel/import", {
        method: "POST",
        body: JSON.stringify({
          uploadId: uploadId.current,
          config: {
            projectId: boqDestination === "create" ? projectId : undefined,
            targetBoqId: boqDestination === "append" ? targetBoqId : undefined,
            name: boqName.trim() || preview!.fileName.replace(/\.xlsx$/i, ""),
            revision: boqRevision,
            currency: boqCurrency,
            sheetName: preview!.sheetName,
            headerRow: preview!.headerRow,
            mapping: boqMapping(),
            skipReviewRows: skipReview,
            defaultQuantityOne,
            descriptionOverrides: descriptionOverrides(),
          },
        }),
      });
      setMessage(`${data.itemCount} BOQ rows imported successfully.`);
      setBoqReview(null);
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
                      Imports here prepare the selected sheet for the next
                      workflow step. No business records change during this
                      review. Download JSON remains available as an advanced
                      export option.
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
                    <p className="notice">
                      Likely workbook type:{" "}
                      {preview.suggestedImportTypes
                        .map(
                          (item) =>
                            `${item.type} ${Math.round(item.confidence * 100)}%`,
                        )
                        .join(" · ")}
                    </p>
                    <h3>Column recognition</h3>
                    <button
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() => setMapping(preview.suggestions)}
                    >
                      Auto Map Columns
                    </button>
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Excel Column</th>
                            <th>Detected As</th>
                            <th>Confidence</th>
                            <th>Your Mapping</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.recognition.map((column) => {
                            const selected =
                              Object.entries(mapping).find(
                                ([, value]) => value === column.column,
                              )?.[0] || "";
                            const level =
                              column.confidence >= 0.85
                                ? "High"
                                : column.confidence >= 0.6
                                  ? "Medium"
                                  : "Low";
                            return (
                              <tr key={column.column}>
                                <td>{column.sourceColumn}</td>
                                <td>
                                  {column.suggestedField === "unknown"
                                    ? "Unknown"
                                    : column.suggestedField}
                                  <div className="muted text-xs">
                                    {column.reasons.join("; ")}
                                  </div>
                                </td>
                                <td>
                                  {column.confidence
                                    ? `${Math.round(column.confidence * 100)}% · ${level}`
                                    : "—"}
                                </td>
                                <td>
                                  <select
                                    className="input"
                                    disabled={busy}
                                    value={selected}
                                    onChange={(e) =>
                                      setMapping((current) => {
                                        const next = Object.fromEntries(
                                          Object.entries(current).filter(
                                            ([, value]) =>
                                              value !== column.column,
                                          ),
                                        );
                                        if (e.target.value)
                                          next[e.target.value] = column.column;
                                        return next;
                                      })
                                    }
                                  >
                                    <option value="">Unknown / Ignore</option>
                                    {MAPPING_FIELDS.map((field) => (
                                      <option key={field} value={field}>
                                        {field}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {descriptionSuggestions.length > 0 && (
                      <div className="space-y-2">
                        <h3>Editable description suggestions</h3>
                        <p className="muted">
                          The original description stays unchanged. Correct any
                          inferred electrical value before importing the BOQ.
                        </p>
                        <div className="table-wrap">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>Row</th>
                                <th>Description</th>
                                {DESCRIPTION_FIELDS.map(([, label]) => (
                                  <th key={label}>{label}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {descriptionSuggestions.map(
                                (suggestion, index) => (
                                  <tr key={suggestion.rowNumber}>
                                    <td>{suggestion.rowNumber}</td>
                                    <td>{suggestion.original}</td>
                                    {DESCRIPTION_FIELDS.map(
                                      ([field, , type]) => (
                                        <td key={field}>
                                          <input
                                            className="input min-w-28"
                                            type={type}
                                            value={suggestion[field] ?? ""}
                                            onChange={(event) =>
                                              setDescriptionSuggestions(
                                                (current) =>
                                                  current.map(
                                                    (entry, entryIndex) =>
                                                      entryIndex === index
                                                        ? {
                                                            ...entry,
                                                            [field]:
                                                              type === "number"
                                                                ? event.target
                                                                    .value ===
                                                                  ""
                                                                  ? null
                                                                  : Number(
                                                                      event
                                                                        .target
                                                                        .value,
                                                                    )
                                                                : event.target
                                                                    .value ||
                                                                  null,
                                                          }
                                                        : entry,
                                                  ),
                                              )
                                            }
                                          />
                                        </td>
                                      ),
                                    )}
                                  </tr>
                                ),
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {importType === "BOQ" && (
                      <div
                        className="space-y-3 border-t pt-4"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <h3 className="font-medium">BOQ destination</h3>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label>
                            Project
                            <select
                              className="input"
                              value={projectId}
                              onChange={(e) => {
                                setProjectId(e.target.value);
                                setTargetBoqId("");
                                setBoqReview(null);
                              }}
                            >
                              <option value="">Select project</option>
                              {projects.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.code} · {p.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Import mode
                            <select
                              className="input"
                              value={boqDestination}
                              onChange={(e) => {
                                setBoqDestination(
                                  e.target.value as "create" | "append",
                                );
                                setBoqReview(null);
                              }}
                            >
                              <option value="create">Create New BOQ</option>
                              <option value="append">
                                Add to Existing BOQ
                              </option>
                            </select>
                          </label>
                        </div>
                        {boqDestination === "create" ? (
                          <div className="grid gap-3 md:grid-cols-3">
                            <label className="block">
                              BOQ Name
                              <input
                                className="input"
                                maxLength={200}
                                value={boqName}
                                placeholder={preview.fileName.replace(
                                  /\.xlsx$/i,
                                  "",
                                )}
                                onChange={(e) => setBoqName(e.target.value)}
                              />
                            </label>
                            <label>
                              Revision
                              <input
                                className="input"
                                type="number"
                                min="0"
                                max="9999"
                                value={boqRevision}
                                onChange={(e) =>
                                  setBoqRevision(Number(e.target.value))
                                }
                              />
                            </label>
                            <label>
                              Currency
                              <input
                                className="input uppercase"
                                maxLength={3}
                                value={boqCurrency}
                                onChange={(e) =>
                                  setBoqCurrency(e.target.value.toUpperCase())
                                }
                              />
                            </label>
                          </div>
                        ) : (
                          <label className="block">
                            Existing BOQ
                            <select
                              className="input"
                              value={targetBoqId}
                              onChange={(e) => {
                                setTargetBoqId(e.target.value);
                                setBoqReview(null);
                              }}
                            >
                              <option value="">Select existing BOQ</option>
                              {boqs.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.name} — Rev {b.version}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <button
                          className="btn-secondary"
                          disabled={
                            busy ||
                            !mapping.description ||
                            (!mapping.quantity && !defaultQuantityOne) ||
                            (boqDestination === "create"
                              ? !projectId
                              : !targetBoqId)
                          }
                          onClick={reviewBoq}
                        >
                          Review BOQ rows
                        </button>
                        {!mapping.quantity && (
                          <label className="flex gap-2">
                            <input
                              type="checkbox"
                              checked={defaultQuantityOne}
                              onChange={(e) => {
                                setDefaultQuantityOne(e.target.checked);
                                setBoqReview(null);
                              }}
                            />{" "}
                            I accept quantity 1 for every imported row without a
                            quantity column.
                          </label>
                        )}
                        {boqReview && (
                          <div className="notice space-y-2">
                            <p>
                              {boqReview.summary.validRows} valid rows ·{" "}
                              {boqReview.summary.reviewRows} rows require review
                            </p>
                            {boqReview.summary.reviewRows > 0 && (
                              <label className="flex gap-2">
                                <input
                                  type="checkbox"
                                  checked={skipReview}
                                  onChange={(e) =>
                                    setSkipReview(e.target.checked)
                                  }
                                />{" "}
                                Skip all review rows
                              </label>
                            )}
                            <button
                              className="btn-primary"
                              disabled={
                                busy ||
                                (boqReview.summary.reviewRows > 0 &&
                                  !skipReview)
                              }
                              onClick={importBoq}
                            >
                              Confirm BOQ import
                            </button>
                          </div>
                        )}
                      </div>
                    )}
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
