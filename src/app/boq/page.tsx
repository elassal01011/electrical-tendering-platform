"use client";

import { useEffect, useState } from "react";
import { ExcelImportPanel } from "@/components/boq/ExcelImportPanel";

type Project = { id: string; code: string; name: string };
type BOQItem = {
  id: string; lineNo: number; rawDescription: string; quantity: string; unit: string; status: string;
  matchScore: string | null; matchReason: string | null;
  matchedComponent: { manufacturer: string; partNumber: string; description: string; listPrice: string | null; listPriceCurrency: string } | null;
  appliedUnitPrice: string | null; appliedCurrency: string | null; priceSource: string | null;
  appliedSupplier: { companyName: string } | null;
};
type BOQ = { id: string; name: string; items: BOQItem[] };

const SAMPLE_ROWS = `250A MCCB, 4P, 36kA, adjustable trip, Schneider | 4 | NO\n1600A ACB 4P 65kA 415V ABB draw-out | 1 | NO\n100A MCB 3P | 20 | NO\n63A RCCB 4P 30mA | 10 | NO`;

export default function BOQPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [rowsText, setRowsText] = useState(SAMPLE_ROWS);
  const [boq, setBoq] = useState<BOQ | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/projects").then(r => r.json()).then(d => {
      setProjects(d.projects ?? []);
      if (d.projects?.[0]) setProjectId(d.projects[0].id);
    });
  }, []);

  async function handleImport() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const rows = rowsText.split("\n").map(l => l.trim()).filter(Boolean).map(line => {
        const [description, qty, unit] = line.split("|").map(s => s.trim());
        return { description, quantity: Number(qty || "1"), unit: unit || "NO" };
      });
      const res = await fetch("/api/boq/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, name: "Imported BOQ", sourceType: "MANUAL", rows }) });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error ?? data));
      setBoq(data.boq);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function handleMatch() {
    if (!boq) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/boq/${boq.id}/match`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const refreshed = await fetch(`/api/boq/${boq.id}`).then(r => r.json());
      setBoq(refreshed.boq);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function handleApplyPrices() {
    if (!boq) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/boq/${boq.id}/apply-prices`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error ?? data));
      const refreshed = await fetch(`/api/boq/${boq.id}`).then(r => r.json());
      setBoq(refreshed.boq);
      const supplierCount = (data.results ?? []).filter((r: any) => r.source === "SUPPLIER_PRICE").length;
      const fallbackCount = (data.results ?? []).filter((r: any) => r.source === "COMPONENT_LIST_PRICE").length;
      setNotice(`Applied prices to ${supplierCount + fallbackCount} line(s): ${supplierCount} supplier price(s), ${fallbackCount} catalog fallback(s).`);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  const pricedTotal = boq?.items.reduce((sum, item) => sum + (item.appliedUnitPrice ? Number(item.appliedUnitPrice) * Number(item.quantity) : 0), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">BOQ Import, Matching &amp; Pricing</h1>
        <p className="mt-1 text-sm text-slate-400">Match tender lines to catalog components, then apply the best active supplier price or catalog fallback.</p>
      </div>
      <div className="card space-y-3">
        <label className="block text-xs uppercase text-slate-500">Project</label>
        <select className="input" value={projectId} onChange={e => setProjectId(e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select>
        <label className="block text-xs uppercase text-slate-500">BOQ rows — <code>description | quantity | unit</code></label>
        <textarea className="input h-40 font-mono text-xs" value={rowsText} onChange={e => setRowsText(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={handleImport} disabled={busy || !projectId}>Import BOQ</button>
          <button className="btn-primary" onClick={handleMatch} disabled={busy || !boq}>Run Component Matching</button>
          <button className="btn-primary" onClick={handleApplyPrices} disabled={busy || !boq}>Apply Best Available Prices</button>
          <a className="btn-primary" href="/pricing">Manage Price Lists</a>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {notice && <p className="text-sm text-emerald-400">{notice}</p>}
      </div>
      <ExcelImportPanel projectId={projectId} onImported={value => setBoq(value as BOQ)} />

      {boq && (
        <div className="card overflow-x-auto">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-slate-300">{boq.name}</h2>
            <div className="text-sm text-slate-400">Applied BOQ value: <span className="font-semibold text-slate-100">{pricedTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
          </div>
          <table className="data-table w-full">
            <thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Status</th><th>Matched Component</th><th>Applied Price</th><th>Supplier / Source</th><th>Reason</th></tr></thead>
            <tbody>{boq.items.map(item => <tr key={item.id}>
              <td>{item.lineNo}</td>
              <td className="max-w-xs">{item.rawDescription}</td>
              <td>{item.quantity}</td>
              <td><span className={item.status === "MATCHED" ? "text-green-400" : item.status === "SUGGESTED" ? "text-yellow-400" : "text-slate-500"}>{item.status}</span></td>
              <td>{item.matchedComponent ? `${item.matchedComponent.manufacturer} ${item.matchedComponent.partNumber}` : "-"}</td>
              <td className="whitespace-nowrap">{item.appliedUnitPrice ? `${Number(item.appliedUnitPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${item.appliedCurrency ?? ""}` : "-"}</td>
              <td className="text-xs">{item.appliedSupplier?.companyName ?? (item.priceSource === "COMPONENT_LIST_PRICE" ? "Catalog list price" : "-")}</td>
              <td className="max-w-sm text-xs text-slate-400">{item.matchReason}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
