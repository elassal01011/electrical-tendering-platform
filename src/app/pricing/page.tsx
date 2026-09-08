"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { hasPermission } from "@/lib/auth/permissions";
import { requestJson } from "@/lib/client/request";
import { CatalogUpload } from "@/components/pricing/CatalogUpload";
const blank = () => ({
  supplier: "Unspecified catalog supplier",
  supplierPartNumber: "",
  manufacturer: "Unspecified",
  partNumber: "",
  description: "",
  price: "",
  currency: "EGP",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: "",
  active: true,
});
export default function PricingPage() {
  const { data: session } = useSession();
  const can = (permission: string) =>
    hasPermission(session?.user.roles ?? [], permission);
  const [data, setData] = useState<any>({ rows: [], total: 0, summary: {} });
  const [filters, setFilters] = useState({
    q: "",
    supplier: "",
    manufacturer: "",
    currency: "",
    active: "",
    validity: "",
    min: "",
    max: "",
  });
  const [page, setPage] = useState(1),
    [upload, setUpload] = useState(false),
    [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [review, setReview] = useState<number | null>(null);
  async function load() {
    try {
      setData(
        await requestJson(
          "/api/pricing/catalog?" +
            new URLSearchParams({ ...filters, page: String(page) }),
        ),
      );
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [filters, page]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await requestJson("/api/pricing/catalog", {
        method: form.id ? "PUT" : "POST",
        body: JSON.stringify({
          ...form,
          supplierPartNumber: form.supplierPartNumber || null,
          price: Number(form.price),
          effectiveFrom: new Date(form.effectiveFrom).toISOString(),
          effectiveTo: form.effectiveTo
            ? new Date(form.effectiveTo).toISOString()
            : null,
        }),
      });
      setForm(null);
      setMessage("Price saved.");
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string, hard: boolean) {
    if (
      !confirm(
        hard
          ? "Permanently delete this price?"
          : "Deactivate this price and preserve its history?",
      )
    )
      return;
    setBusy(true);
    try {
      await requestJson(`/api/pricing/catalog?id=${id}&delete=${hard}`, {
        method: "DELETE",
      });
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const filter = (name: string, value: string) => {
    setFilters((current) => ({ ...current, [name]: value }));
    setPage(1);
  };
  return (
    <div className="space-y-5">
      <div className="flex justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Price Catalog</h1>
          <p className="muted">
            Manage prices for BOQ pricing, supplier comparison and quotations.
          </p>
        </div>
        {can("pricing.edit") && (
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => setForm(blank())}>
              + Add Price Manually
            </button>
            <button className="btn-secondary" onClick={() => setUpload(true)}>
              Upload Price Catalog
            </button>
          </div>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-6">
        {Object.entries({
          "Total Prices": data.summary.totalPrices,
          "Active Prices": data.summary.activePrices,
          Suppliers: data.summary.suppliers,
          Manufacturers: data.summary.manufacturers,
          "Expired Prices": data.summary.expiredPrices,
          "Needs Review (last upload)": review,
        }).map(([label, value]) => (
          <div className="card" key={label}>
            <p className="muted text-sm">{label}</p>
            <strong>{value == null ? "�" : String(value)}</strong>
          </div>
        ))}
      </div>
      {message && (
        <p role="status" className="card">
          {message}
        </p>
      )}
      {upload && can("pricing.edit") && (
        <CatalogUpload
          close={() => setUpload(false)}
          completed={(count) => {
            setReview(count);
            void load();
          }}
        />
      )}
      {form && can("pricing.edit") && (
        <form className="card space-y-3" onSubmit={save}>
          <h2>{form.id ? "Edit Price" : "Add Price Manually"}</h2>
          <div className="grid md:grid-cols-3 gap-3">
            {[
              ["supplier", "Supplier", "text"],
              ["supplierPartNumber", "Supplier SKU", "text"],
              ["manufacturer", "Manufacturer", "text"],
              ["partNumber", "Part Number", "text"],
              ["description", "Description", "text"],
              ["price", "Price *", "number"],
              ["currency", "Currency *", "text"],
              ["effectiveFrom", "Valid From", "date"],
              ["effectiveTo", "Valid To", "date"],
            ].map(([field, label, type]) => (
              <label key={field}>
                {label}
                <input
                  className="input"
                  type={type}
                  step={type === "number" ? "0.01" : undefined}
                  min={type === "number" ? "0" : undefined}
                  required={["price", "currency", "effectiveFrom"].includes(
                    field,
                  )}
                  value={form[field]}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      [field]:
                        field === "currency"
                          ? e.target.value.toUpperCase()
                          : e.target.value,
                    })
                  }
                />
              </label>
            ))}
            <label>
              Status
              <select
                className="input"
                value={String(form.active)}
                onChange={(e) =>
                  setForm({ ...form, active: e.target.value === "true" })
                }
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
          </div>
          <button className="btn-primary" disabled={busy}>
            Save Price
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setForm(null)}
          >
            Cancel
          </button>
        </form>
      )}
      <section className="card space-y-3">
        <div className="grid md:grid-cols-4 gap-3">
          {[
            ["q", "Search Part Number / Description / SKU"],
            ["supplier", "Supplier"],
            ["manufacturer", "Manufacturer"],
            ["currency", "Currency"],
            ["min", "Minimum Price"],
            ["max", "Maximum Price"],
          ].map(([field, label]) => (
            <label key={field}>
              {label}
              <input
                className="input"
                placeholder={label}
                value={filters[field as keyof typeof filters]}
                onChange={(e) => filter(field, e.target.value)}
              />
            </label>
          ))}
          <label>
            Status
            <select
              className="input"
              value={filters.active}
              onChange={(e) => filter("active", e.target.value)}
            >
              <option value="">All</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
          <label>
            Validity
            <select
              className="input"
              value={filters.validity}
              onChange={(e) => filter("validity", e.target.value)}
            >
              <option value="">All</option>
              <option value="valid">Valid</option>
              <option value="expired">Expired</option>
            </select>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                {[
                  "Supplier",
                  "Supplier SKU",
                  "Manufacturer",
                  "Part Number",
                  "Description",
                  "Price",
                  "Currency",
                  "Valid From",
                  "Valid To",
                  "Status",
                  "Actions",
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row: any) => (
                <tr key={row.id}>
                  <td>{row.supplier.companyName}</td>
                  <td>{row.supplierPartNumber}</td>
                  <td>{row.component.manufacturer}</td>
                  <td>{row.component.partNumber}</td>
                  <td>{row.component.description}</td>
                  <td>{Number(row.price).toLocaleString()}</td>
                  <td>{row.currency}</td>
                  <td>{row.effectiveFrom.slice(0, 10)}</td>
                  <td>{row.effectiveTo?.slice(0, 10) || "�"}</td>
                  <td>{row.active ? "Active" : "Inactive"}</td>
                  <td>
                    <div className="flex gap-2">
                      {can("pricing.edit") && (
                        <>
                          <button
                            className="btn-secondary"
                            disabled={busy}
                            onClick={() =>
                              setForm({
                                id: row.id,
                                ...blank(),
                                supplier: row.supplier.companyName,
                                supplierPartNumber:
                                  row.supplierPartNumber || "",
                                manufacturer: row.component.manufacturer,
                                partNumber: row.component.partNumber,
                                description: row.component.description,
                                price: String(row.price),
                                currency: row.currency,
                                effectiveFrom: row.effectiveFrom.slice(0, 10),
                                effectiveTo:
                                  row.effectiveTo?.slice(0, 10) || "",
                                active: row.active,
                              })
                            }
                          >
                            Edit
                          </button>
                          <button
                            className="btn-secondary"
                            disabled={busy || !row.active}
                            onClick={() => void remove(row.id, false)}
                          >
                            Deactivate
                          </button>
                        </>
                      )}
                      {can("pricing.delete") && (
                        <button
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() => void remove(row.id, true)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.rows.length && (
          <div className="text-center py-5">
            <p>
              {data.summary.totalPrices
                ? "No prices match these filters."
                : "No price catalog entries yet."}
            </p>
            {can("pricing.edit") && (
              <div className="flex justify-center gap-2 mt-3">
                <button
                  className="btn-primary"
                  onClick={() => setForm(blank())}
                >
                  Add Price Manually
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => setUpload(true)}
                >
                  Upload Excel
                </button>
              </div>
            )}
          </div>
        )}
        <div className="flex gap-3">
          <button
            className="btn-secondary"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} of {Math.max(1, Math.ceil(data.total / 100))} �{" "}
            {data.total} prices
          </span>
          <button
            className="btn-secondary"
            disabled={page * 100 >= data.total}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </section>
    </div>
  );
}
