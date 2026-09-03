"use client";

import { useEffect, useState } from "react";

type Supplier = { id: string; companyName: string };
type Component = {
  id: string;
  manufacturer: string;
  partNumber: string;
  description: string;
  category?: string;
  listPrice: string | null;
  listPriceCurrency: string;
};
type PriceRow = {
  id: string;
  price: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  supplierPartNumber?: string | null;
  unit?: string;
  source?: string | null;
  supplier: Supplier;
  component: Component;
};
type ImportSummary = {
  existingSuppliers: number;
  newSuppliers: number;
  existingComponents: number;
  newComponents: number;
  newPrices: number;
  updatedPrices: number;
};
type ImportResult = {
  created: number;
  updated: number;
  rejected: number;
  errors: { row: number; field?: string; message: string }[];
  summary?: ImportSummary;
};

export default function PricingPage() {
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [componentId, setComponentId] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("EGP");
  const [search, setSearch] = useState("");
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterActive, setFilterActive] = useState("true");
  const [sort, setSort] = useState("date");
  const [importMode, setImportMode] = useState<"append" | "update" | "replace">(
    "append",
  );
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    file: File;
    mode: "append" | "update" | "replace";
    summary: ImportSummary;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    const res = await fetch(
      `/api/pricing?q=${encodeURIComponent(search)}&supplierId=${filterSupplier}&category=${filterCategory}&active=${filterActive}&sort=${sort}`,
    );
    const data = await res
      .json()
      .catch(() => ({ error: "The server returned an invalid response." }));
    if (!res.ok) {
      setMessage(data.error ?? "Unable to load pricing.");
      return;
    }
    setRows(data.rows ?? []);
    setSuppliers(data.suppliers ?? []);
    setComponents(data.components ?? []);
    if (!supplierId && data.suppliers?.[0]) setSupplierId(data.suppliers[0].id);
    if (!componentId && data.components?.[0])
      setComponentId(data.components[0].id);
  }

  useEffect(() => {
    load();
  }, [search, filterSupplier, filterCategory, filterActive, sort]);

  async function addPrice() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          componentId,
          price: Number(price),
          currency,
        }),
      });
      const data = await res
        .json()
        .catch(() => ({ error: "The server returned an invalid response." }));
      if (!res.ok)
        throw new Error(
          data.error ? JSON.stringify(data.error) : "Unable to add price",
        );
      setPrice("");
      setMessage("Price added successfully.");
      await load();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function deletePrice(id: string) {
    if (
      !confirm(
        "Deactivate this supplier price? Historical data will be retained.",
      )
    )
      return;
    setBusy(true);
    try {
      await fetch(`/api/pricing?id=${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function importExcel(
    file: File | null,
    mode: "append" | "update" | "replace" = "append",
    confirmImport = false,
  ) {
    if (!file) return;
    if (
      mode === "replace" &&
      !confirm(
        "Replace active prices? Existing records will be retained as inactive history.",
      )
    )
      return;
    setBusy(true);
    setMessage("");
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", mode);
      if (mode === "replace") fd.append("confirmReplace", "true");
      if (!confirmImport) fd.append("dryRun", "true");
      const res = await fetch("/api/pricing", { method: "PATCH", body: fd });
      const data = await res
        .json()
        .catch(() => ({ error: "The server returned an invalid response." }));
      setImportResult({
        created: data.created ?? 0,
        updated: data.updated ?? 0,
        rejected: data.rejected ?? data.errors?.length ?? 0,
        errors: data.errors ?? data.details ?? [],
        summary: data.summary,
      });
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      if (!confirmImport && data.preview) {
        setPendingImport({ file, mode, summary: data.summary });
        setMessage(
          "Import analyzed. Review the detected records, then confirm.",
        );
        return;
      }
      setPendingImport(null);
      setMessage(
        data.message ?? `Imported ${data.created ?? 0} price records.`,
      );
      await load();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const header = [
      "Supplier",
      "Supplier Part Number",
      "Manufacturer",
      "Part Number",
      "Description",
      "Unit",
      "Currency",
      "Unit Price",
      "Effective From",
      "Effective To",
      "Active",
      "Source",
    ];
    const csv = [
      header,
      ...rows.map((r) => [
        r.supplier.companyName,
        r.supplierPartNumber ?? "",
        r.component.manufacturer,
        r.component.partNumber,
        r.component.description,
        r.unit ?? "NO",
        r.currency,
        r.price,
        r.effectiveFrom,
        r.effectiveTo ?? "",
        r.active ? "true" : "false",
        r.source ?? "",
      ]),
    ]
      .map((line) =>
        line.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "pricing-list.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Supplier Pricing</h1>
        <p className="mt-1 text-sm text-slate-400">
          Maintain supplier price lists and make them available to BOQ pricing.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold">Add Supplier Price</h2>
          <select
            className="input"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.companyName}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={componentId}
            onChange={(e) => setComponentId(e.target.value)}
          >
            {components.map((c) => (
              <option key={c.id} value={c.id}>
                {c.manufacturer} — {c.partNumber}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input"
              placeholder="Price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              type="number"
              min="0"
              step="0.01"
            />
            <input
              className="input"
              placeholder="Currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </div>
          <button
            className="btn-primary"
            onClick={addPrice}
            disabled={busy || !supplierId || !componentId || !price}
          >
            Add Price
          </button>
        </div>

        <div className="card space-y-3">
          <h2 className="text-sm font-semibold">Import Price List</h2>
          <p className="text-xs text-slate-400">
            Required: Supplier, Manufacturer, Part Number, Unit Price. Optional:
            Supplier Part Number, Description, Unit, Currency, Effective
            From/To, Source, Active.
          </p>
          <div className="flex flex-wrap gap-2">
            <select
              className="input"
              value={importMode}
              onChange={(e) =>
                setImportMode(e.target.value as typeof importMode)
              }
            >
              <option value="append">Add new history</option>
              <option value="update">Update matching effective date</option>
              <option value="replace">Replace active prices</option>
            </select>
            <label className="btn-primary inline-block w-fit cursor-pointer">
              Import XLSX
              <input
                className="hidden"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) =>
                  importExcel(e.target.files?.[0] ?? null, importMode)
                }
              />
            </label>
            <a
              className="btn-secondary inline-block"
              href="/api/pricing/template"
            >
              Download Pricing Import Template.xlsx
            </a>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
            Excel files are analyzed before import. New suppliers and components
            are recognized and created transactionally; price history is
            retained. Replacement asks for confirmation and deactivates old
            prices without deleting history.
          </div>
        </div>
      </div>

      {message && <div className="card text-sm text-slate-300">{message}</div>}
      {importResult && (
        <div className="card text-sm">
          <div className="text-slate-200">
            Created: {importResult.created} · Updated: {importResult.updated} ·
            Rejected: {importResult.rejected}
          </div>
          {importResult.summary && (
            <div className="mt-2 grid gap-1 text-slate-300 sm:grid-cols-2">
              <span>
                Suppliers: {importResult.summary.existingSuppliers} recognized ·{" "}
                {importResult.summary.newSuppliers} new
              </span>
              <span>
                Components: {importResult.summary.existingComponents} matched ·{" "}
                {importResult.summary.newComponents} new
              </span>
              <span>
                Prices: {importResult.summary.newPrices} new ·{" "}
                {importResult.summary.updatedPrices} updated
              </span>
            </div>
          )}
          {pendingImport && (
            <button
              className="btn-primary mt-3"
              disabled={busy}
              onClick={() =>
                importExcel(pendingImport.file, pendingImport.mode, true)
              }
            >
              Confirm import
            </button>
          )}
          {importResult.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-red-300">
              {importResult.errors.map((e, i) => (
                <li key={i}>
                  Row {e.row}
                  {e.field ? ` (${e.field})` : ""}: {e.message}
                </li>
              ))}
            </ul>
          )}
          <button
            className="mt-2 text-xs underline"
            onClick={() => {
              setImportResult(null);
              setPendingImport(null);
            }}
          >
            Clear validation errors
          </button>
        </div>
      )}

      <div className="card space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold">Current Supplier Prices</h2>
          <div className="flex flex-wrap gap-2">
            <input
              className="input sm:max-w-xs"
              placeholder="Search supplier / part number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="input"
              value={filterSupplier}
              onChange={(e) => setFilterSupplier(e.target.value)}
            >
              <option value="">All suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.companyName}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {[
                ...new Set(
                  components.map((c) => (c as any).category).filter(Boolean),
                ),
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select
              className="input"
              value={filterActive}
              onChange={(e) => setFilterActive(e.target.value)}
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
              <option value="">All statuses</option>
            </select>
            <select
              className="input"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="date">Newest date</option>
              <option value="price">Price</option>
              <option value="supplier">Supplier</option>
            </select>
            <button className="btn-primary" onClick={exportCsv}>
              Export CSV
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table w-full">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Supplier SKU</th>
                <th>Manufacturer</th>
                <th>Part Number</th>
                <th>Price</th>
                <th>Currency</th>
                <th>Valid From</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.supplier.companyName}</td>
                  <td>{r.supplierPartNumber ?? "-"}</td>
                  <td>{r.component.manufacturer}</td>
                  <td>{r.component.partNumber}</td>
                  <td>
                    {Number(r.price).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td>{r.currency}</td>
                  <td>{new Date(r.effectiveFrom).toLocaleDateString()}</td>
                  <td>{r.active ? "Active" : "Inactive"}</td>
                  <td>
                    {r.active && (
                      <button
                        className="text-red-300 underline"
                        onClick={() => deletePrice(r.id)}
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p className="py-6 text-center text-sm text-slate-500">
              No supplier prices yet. Add one or import an Excel price list.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
