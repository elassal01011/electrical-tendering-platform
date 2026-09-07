"use client";
import { useEffect, useState } from "react";

export type ProjectOption = {
  id: string;
  code: string;
  name: string;
  currency: string;
};
const overlay =
  "fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4";

export function CreateBoqModal({
  projects,
  initialProjectId,
  busy,
  onCancel,
  onSubmit,
}: {
  projects: ProjectOption[];
  initialProjectId: string;
  busy: boolean;
  onCancel(): void;
  onSubmit(value: {
    projectId: string;
    name: string;
    description: string;
    revision: number;
    currency: string;
  }): void;
}) {
  const project = projects.find((p) => p.id === initialProjectId);
  const [form, setForm] = useState({
    projectId: initialProjectId,
    name: "",
    description: "",
    revision: 0,
    currency: project?.currency || "EGP",
  });
  const update = (name: string, value: string | number) =>
    setForm((current) => ({ ...current, [name]: value }));
  return (
    <div
      className={overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-boq-title"
    >
      <form
        className="card w-full max-w-xl space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(form);
        }}
      >
        <h2 id="create-boq-title" className="text-xl font-semibold">
          Create BOQ
        </h2>
        <label className="block">
          BOQ Name *
          <input
            autoFocus
            required
            maxLength={200}
            className="input"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
          />
        </label>
        <label className="block">
          Project *
          <select
            required
            className="input"
            value={form.projectId}
            onChange={(e) => {
              const p = projects.find(
                (project) => project.id === e.target.value,
              );
              setForm((current) => ({
                ...current,
                projectId: e.target.value,
                currency: p?.currency || current.currency,
              }));
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
        <label className="block">
          Description
          <textarea
            maxLength={5000}
            className="input h-24"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label>
            Revision
            <input
              required
              min="0"
              max="9999"
              type="number"
              className="input"
              value={form.revision}
              onChange={(e) => update("revision", Number(e.target.value))}
            />
          </label>
          <label>
            Currency
            <input
              required
              pattern="[A-Za-z]{3}"
              maxLength={3}
              className="input uppercase"
              value={form.currency}
              onChange={(e) => update("currency", e.target.value.toUpperCase())}
            />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button className="btn-primary" disabled={busy}>
            {busy ? "Creating…" : "Create BOQ"}
          </button>
        </div>
      </form>
    </div>
  );
}

export type ItemForm = {
  itemNumber: string;
  description: string;
  quantity: number;
  unit: string;
  manufacturer: string;
  model: string;
  remarks: string;
};
export function BoqItemModal({
  initial,
  busy,
  onCancel,
  onSubmit,
}: {
  initial?: Partial<ItemForm>;
  busy: boolean;
  onCancel(): void;
  onSubmit(value: ItemForm): void;
}) {
  const [form, setForm] = useState<ItemForm>({
    itemNumber: "",
    description: "",
    quantity: 1,
    unit: "EA",
    manufacturer: "",
    model: "",
    remarks: "",
    ...initial,
  });
  useEffect(
    () =>
      setForm({
        itemNumber: "",
        description: "",
        quantity: 1,
        unit: "EA",
        manufacturer: "",
        model: "",
        remarks: "",
        ...initial,
      }),
    [initial],
  );
  const update = (name: keyof ItemForm, value: string | number) =>
    setForm((current) => ({ ...current, [name]: value }));
  return (
    <div
      className={overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="item-title"
    >
      <form
        className="card w-full max-w-2xl space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(form);
        }}
      >
        <h2 id="item-title" className="text-xl font-semibold">
          {initial ? "Edit BOQ item" : "Add BOQ item"}
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label>
            Item No
            <input
              className="input"
              maxLength={100}
              value={form.itemNumber}
              onChange={(e) => update("itemNumber", e.target.value)}
            />
          </label>
          <label>
            Quantity *
            <input
              className="input"
              required
              type="number"
              min="0.001"
              step="any"
              value={form.quantity}
              onChange={(e) => update("quantity", Number(e.target.value))}
            />
          </label>
        </div>
        <label className="block">
          Description *
          <textarea
            autoFocus
            required
            maxLength={5000}
            className="input h-24"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </label>
        <div className="grid gap-3 md:grid-cols-3">
          <label>
            Unit
            <input
              className="input"
              maxLength={30}
              value={form.unit}
              onChange={(e) => update("unit", e.target.value)}
            />
          </label>
          <label>
            Manufacturer
            <input
              className="input"
              maxLength={200}
              value={form.manufacturer}
              onChange={(e) => update("manufacturer", e.target.value)}
            />
          </label>
          <label>
            Model / Part Number
            <input
              className="input"
              maxLength={200}
              value={form.model}
              onChange={(e) => update("model", e.target.value)}
            />
          </label>
        </div>
        <label className="block">
          Remarks
          <textarea
            className="input h-20"
            maxLength={2000}
            value={form.remarks}
            onChange={(e) => update("remarks", e.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : initial ? "Save changes" : "Add Item"}
          </button>
        </div>
      </form>
    </div>
  );
}

export type PriceForm = {
  unitCost: number;
  currency: string;
  supplierId: string | null;
  supplierReference: string;
  discountPct: number;
  leadTimeDays: number | null;
  validUntil: string | null;
  notes: string;
  replaceExisting: boolean;
};
export function ManualPriceModal({
  item,
  suppliers,
  busy,
  onCancel,
  onSubmit,
  onClear,
}: {
  item: any;
  suppliers: { id: string; companyName: string }[];
  busy: boolean;
  onCancel(): void;
  onSubmit(value: PriceForm): void;
  onClear(): void;
}) {
  const [form, setForm] = useState<PriceForm>({
    unitCost: Number(item.manualBaseUnitCost ?? item.appliedUnitPrice ?? 0),
    currency: item.appliedCurrency || item.boqCurrency || "EGP",
    supplierId: item.appliedSupplierId || null,
    supplierReference: item.manualSupplierReference || "",
    discountPct: Number(item.manualDiscountPct ?? 0),
    leadTimeDays: item.manualLeadTimeDays ?? null,
    validUntil: item.manualValidUntil?.slice(0, 10) || null,
    notes: item.manualPriceNotes || "",
    replaceExisting: false,
  });
  const net =
      Math.round(form.unitCost * (1 - form.discountPct / 100) * 100) / 100,
    total = Math.round(net * Number(item.quantity) * 100) / 100;
  return (
    <div
      className={overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="price-title"
    >
      <form
        className="card w-full max-w-2xl space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const replacing =
            item.appliedUnitPrice !== null && item.priceSource !== "MANUAL";
          if (
            replacing &&
            !window.confirm(
              "Replace the currently applied supplier price with this manual price?",
            )
          )
            return;
          onSubmit({ ...form, replaceExisting: replacing });
        }}
      >
        <h2 id="price-title" className="text-xl font-semibold">
          {item.priceSource === "MANUAL"
            ? "Change Manual Price"
            : "Set Manual Price"}
        </h2>
        <p>
          {item.rawDescription} · Quantity {String(item.quantity)}
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <label>
            Unit Cost *
            <input
              autoFocus
              required
              type="number"
              min="0.01"
              step="0.01"
              className="input"
              value={form.unitCost}
              onChange={(e) =>
                setForm({ ...form, unitCost: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Currency *
            <input
              required
              pattern="[A-Za-z]{3}"
              maxLength={3}
              className="input uppercase"
              value={form.currency}
              onChange={(e) =>
                setForm({ ...form, currency: e.target.value.toUpperCase() })
              }
            />
          </label>
          <label>
            Supplier (optional)
            <select
              className="input"
              value={form.supplierId || ""}
              onChange={(e) =>
                setForm({ ...form, supplierId: e.target.value || null })
              }
            >
              <option value="">No supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.companyName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Supplier Reference
            <input
              className="input"
              maxLength={200}
              value={form.supplierReference}
              onChange={(e) =>
                setForm({ ...form, supplierReference: e.target.value })
              }
            />
          </label>
          <label>
            Discount %
            <input
              className="input"
              type="number"
              min="0"
              max="100"
              step="0.001"
              value={form.discountPct}
              onChange={(e) =>
                setForm({ ...form, discountPct: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Lead Time Days
            <input
              className="input"
              type="number"
              min="0"
              max="3650"
              value={form.leadTimeDays ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  leadTimeDays: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </label>
          <label>
            Valid Until
            <input
              className="input"
              type="date"
              value={form.validUntil || ""}
              onChange={(e) =>
                setForm({ ...form, validUntil: e.target.value || null })
              }
            />
          </label>
        </div>
        <label className="block">
          Notes
          <textarea
            className="input h-20"
            maxLength={2000}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </label>
        <p className="notice">
          Net unit cost: {net.toLocaleString()} {form.currency} · Total:{" "}
          {Number(item.quantity).toLocaleString()} × {net.toLocaleString()} ={" "}
          {total.toLocaleString()} {form.currency}
        </p>
        <div className="flex justify-between gap-2">
          <div>
            {item.appliedUnitPrice !== null && (
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={onClear}
              >
                Clear Price
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button className="btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save Price"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
