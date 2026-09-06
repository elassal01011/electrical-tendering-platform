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
