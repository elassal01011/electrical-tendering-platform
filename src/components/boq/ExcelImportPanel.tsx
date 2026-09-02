"use client";
import { useState } from "react";
import { BOQ_FIELDS, type BoqField } from "@/lib/services/excel/columnDetector";

type Mapping = { column: number; letter: string; header: string; field: BoqField; confidence: number };
type Preview = { sheets: string[]; sheetName: string; headerRow: number; mapping: Mapping[]; previewRows: { rowNumber: number; cells: (string|number|null)[] }[] };

export function ExcelImportPanel({ projectId, onImported }: { projectId: string; onImported: (boq: unknown) => void }) {
  const [file, setFile] = useState<File|null>(null); const [preview, setPreview] = useState<Preview|null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function loadPreview(sheetName?: string) { if (!file) return; setBusy(true); setError(""); const fd = new FormData(); fd.append("file", file); if (sheetName) fd.append("sheetName", sheetName); const res = await fetch("/api/boq/excel/preview", { method: "POST", body: fd }); const data = await res.json(); setBusy(false); if (!res.ok) return setError(data.error ?? "Preview failed"); setPreview(data); }
  function change(index: number, field: BoqField) { setPreview(p => p ? { ...p, mapping: p.mapping.map((m,i) => i === index ? { ...m, field } : m) } : p); }
  async function importFile() { if (!file || !preview) return; const mapping = Object.fromEntries(preview.mapping.filter(m => m.field !== "ignore").map(m => [m.field, m.column])); const fd = new FormData(); fd.append("file", file); fd.append("config", JSON.stringify({ projectId, name: file.name.replace(/\.xlsx$/i, ""), sheetName: preview.sheetName, headerRow: preview.headerRow, mapping })); setBusy(true); const res = await fetch("/api/boq/excel/import", { method: "POST", body: fd }); const data = await res.json(); setBusy(false); if (!res.ok) return setError(data.error ?? "Import failed"); onImported(data.boq); }
  return <div className="card space-y-4">
    <div><h2 className="font-semibold">Excel Mapping Preview</h2><p className="text-sm text-slate-400">Upload an .xlsx workbook, verify the detected structure, then confirm import.</p></div>
    <div className="flex gap-2"><input className="input" type="file" accept=".xlsx" onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} /><button className="btn-primary" disabled={!file || busy || !projectId} onClick={() => loadPreview()}>Preview</button></div>
    {error && <p className="text-sm text-red-400">{error}</p>}
    {preview && <>
      <div className="flex gap-3"><label className="text-sm">Sheet <select className="input ml-2" value={preview.sheetName} onChange={e => loadPreview(e.target.value)}>{preview.sheets.map(s => <option key={s}>{s}</option>)}</select></label><label className="text-sm">Header row <input className="input ml-2 w-20" type="number" value={preview.headerRow} onChange={e => setPreview({ ...preview, headerRow: Number(e.target.value) })}/></label></div>
      <div className="overflow-x-auto"><table className="data-table w-full"><thead><tr><th>Excel Column</th><th>Header</th><th>Detected Meaning</th><th>Confidence</th><th>User Override</th></tr></thead><tbody>{preview.mapping.map((m,i) => <tr key={m.column}><td>{m.letter}</td><td>{m.header || "(blank)"}</td><td>{m.field}</td><td>{m.confidence}%</td><td><select className="input" value={m.field} onChange={e => change(i, e.target.value as BoqField)}>{BOQ_FIELDS.map(f => <option key={f}>{f}</option>)}</select></td></tr>)}</tbody></table></div>
      <div className="overflow-x-auto"><table className="data-table"><tbody>{preview.previewRows.map(r => <tr key={r.rowNumber} className={r.rowNumber === preview.headerRow ? "bg-brand-500/20" : ""}><td>{r.rowNumber}</td>{r.cells.map((c,i) => <td key={i}>{c}</td>)}</tr>)}</tbody></table></div>
      <button className="btn-primary" disabled={busy} onClick={importFile}>Confirm Import</button><p className="text-xs text-amber-300">Imported specifications and automatic selections are preliminary and require engineer verification.</p>
    </>}
  </div>;
}
