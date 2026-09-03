"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/lib/client/request";
import { commercialTotals } from "@/lib/services/quotes/commercial";
type Line = {
  description: string;
  manufacturer: string;
  partNumber: string;
  quantity: number;
  unit: string;
  unitCost: number;
  unitSell: number;
};
const empty: Line = {
  description: "",
  manufacturer: "",
  partNumber: "",
  quantity: 1,
  unit: "NO",
  unitCost: 0,
  unitSell: 0,
};
const steps = [
  "Information",
  "Scope & items",
  "Commercial pricing",
  "Terms",
  "Review",
];
export function QuoteBuilder({
  onCancel,
  initial,
}: {
  onCancel: () => void;
  initial?: any;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0),
    [projects, setProjects] = useState<any[]>([]),
    [projectId, setProjectId] = useState(initial?.projectId || ""),
    [currency, setCurrency] = useState(initial?.currency || "EGP"),
    [validUntil, setValidUntil] = useState(
      initial?.validUntil?.slice(0, 10) ||
        new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    ),
    [items, setItems] = useState<Line[]>(
      initial?.items?.map((i: any) => ({
        ...i,
        manufacturer: i.manufacturer || "",
        partNumber: i.partNumber || "",
        quantity: Number(i.quantity),
        unitCost: Number(i.unitCost),
        unitSell: Number(i.unitSell),
      })) || [{ ...empty }],
    ),
    [discount, setDiscount] = useState(Number(initial?.discountPct) || 0),
    [vat, setVat] = useState(Number(initial?.vatPct) || 0),
    [margin, setMargin] = useState(0),
    [terms, setTerms] = useState<Record<string, string>>(
      initial?.terms || {
        delivery: "",
        payment: "",
        warranty: "",
        inclusions: "",
        exclusions: "",
        notes: "",
      },
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [boqs, setBoqs] = useState<any[]>([]);
  useEffect(() => {
    requestJson("/api/quotes/defaults")
      .then((defaults) => {
        setMargin(defaults.targetMarginPct);
        if (!initial) setVat(defaults.vatPct);
      })
      .catch((e) => setError(e.message));
  }, [initial]);
  useEffect(() => {
    requestJson("/api/projects")
      .then((d) => {
        setProjects(d.projects);
        if (!initial) {
          const id =
            new URLSearchParams(window.location.search).get("projectId") ||
            d.projects[0]?.id ||
            "";
          setProjectId(id);
          const p = d.projects.find((p: any) => p.id === id);
          if (p) setCurrency(p.currency);
        }
      })
      .catch((e) => setError(e.message));
  }, [initial]);
  useEffect(() => {
    if (projectId)
      requestJson("/api/projects/" + projectId)
        .then((d) => setBoqs(d.project.boqs))
        .catch((e) => setError(e.message));
  }, [projectId]);
  let totals: ReturnType<typeof commercialTotals> | null = null;
  try {
    totals = commercialTotals(items, discount, vat);
  } catch {}
  function update(index: number, key: keyof Line, value: string | number) {
    setItems(items.map((i, n) => (n === index ? { ...i, [key]: value } : i)));
  }
  async function fromBoq(id: string) {
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      const d = await requestJson("/api/boq/" + id + "?pageSize=500");
      if (d.total > 500)
        throw new Error(
          "This BOQ exceeds the 500-line quotation limit. Divide the commercial scope into smaller quotations.",
        );
      if (
        d.boq.items.some(
          (i: any) => !["MATCHED", "MANUAL_OVERRIDE"].includes(i.status),
        )
      )
        throw new Error(
          "Complete engineering review before adding BOQ items to a quotation.",
        );
      if (
        d.boq.items.some(
          (i: any) =>
            i.appliedUnitPrice == null || i.appliedCurrency !== currency,
        )
      )
        throw new Error(
          "Every BOQ item needs a price in the quotation currency before it can be added.",
        );
      setItems(
        d.boq.items.map((i: any) => ({
          description: i.rawDescription,
          manufacturer: i.matchedComponent?.manufacturer || "",
          partNumber: i.matchedComponent?.partNumber || "",
          quantity: Number(i.quantity),
          unit: i.unit,
          unitCost: Number(i.appliedUnitPrice),
          unitSell:
            Math.round(
              (Number(i.appliedUnitPrice) / (1 - margin / 100)) * 100,
            ) / 100,
        })),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const payload = {
        projectId,
        currency,
        validUntil,
        items,
        discountPct: discount,
        vatPct: vat,
        terms,
      };
      const d = await requestJson(
        initial ? "/api/quotes/" + initial.id : "/api/quotes",
        { method: initial ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      router.push("/quotations/" + d.quote.id);
      router.refresh();
      onCancel();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card space-y-6">
      <div className="flex justify-between">
        <h2 className="font-semibold">
          {initial ? "Edit draft quotation" : "New commercial quotation"}
        </h2>
        <button className="btn-secondary" onClick={onCancel}>
          Close
        </button>
      </div>
      <div className="workflow">
        {steps.map((s, i) => (
          <button key={s} onClick={() => setStep(i)}>
            <span className={step === i ? "current" : ""}>
              {i + 1}. {s}
            </span>
          </button>
        ))}
      </div>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {step === 0 && (
        <div className="grid md:grid-cols-3 gap-4">
          <label>
            Project
            <select
              className="input"
              disabled={!!initial}
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setCurrency(
                  projects.find((p) => p.id === e.target.value)?.currency ||
                    "EGP",
                );
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
            Currency
            <input
              className="input"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
            />
          </label>
          <label>
            Valid until
            <input
              type="date"
              className="input"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </label>
        </div>
      )}
      {step === 1 && (
        <>
          <label className="block max-w-xl">
            Add reviewed, priced BOQ scope
            <select
              className="input"
              disabled={busy}
              value=""
              onChange={(e) => fromBoq(e.target.value)}
            >
              <option value="">Select BOQ to replace current items</option>
              {boqs.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {[
                    "Description",
                    "Manufacturer",
                    "Part number",
                    "Qty",
                    "Unit",
                    "Unit cost",
                    "Unit sell",
                    "",
                  ].map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i}>
                    {Object.keys(empty)
                      .map((key) => [key, item[key as keyof Line]] as const)
                      .map(([key, value]) => (
                        <td key={key}>
                          <input
                            className="input min-w-24"
                            aria-label={key + " line " + (i + 1)}
                            type={
                              ["quantity", "unitCost", "unitSell"].includes(key)
                                ? "number"
                                : "text"
                            }
                            step="any"
                            value={value as string | number}
                            onChange={(e) =>
                              update(
                                i,
                                key as keyof Line,
                                ["quantity", "unitCost", "unitSell"].includes(
                                  key,
                                )
                                  ? Number(e.target.value)
                                  : e.target.value,
                              )
                            }
                          />
                        </td>
                      ))}
                    <td>
                      <button
                        className="btn-secondary"
                        aria-label={"Remove line " + (i + 1)}
                        onClick={() =>
                          setItems(items.filter((_, n) => n !== i))
                        }
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="btn-secondary"
            onClick={() => setItems([...items, { ...empty }])}
          >
            + Add item
          </button>
        </>
      )}
      {step === 2 && (
        <>
          <div className="grid md:grid-cols-3 gap-4">
            <label>
              Target gross margin (%)
              <input
                className="input"
                type="number"
                min="0"
                max="99"
                value={margin}
                onChange={(e) => setMargin(Number(e.target.value))}
              />
            </label>
            <label>
              Commercial discount (%)
              <input
                className="input"
                type="number"
                min="0"
                max="100"
                value={discount}
                onChange={(e) => setDiscount(Number(e.target.value))}
              />
            </label>
            <label>
              VAT (%)
              <input
                className="input"
                type="number"
                min="0"
                max="100"
                value={vat}
                onChange={(e) => setVat(Number(e.target.value))}
              />
            </label>
          </div>
          <button
            className="btn-secondary"
            disabled={margin < 0 || margin >= 100}
            onClick={() =>
              setItems(
                items.map((i) => ({
                  ...i,
                  unitSell:
                    Math.round((i.unitCost / (1 - margin / 100)) * 100) / 100,
                })),
              )
            }
          >
            Apply target margin to item prices
          </button>
          <p className="muted text-sm">
            Selling = cost ÷ (1 − margin). Commercial discounts reduce the final
            gross margin. VAT is excluded from profit.
          </p>
        </>
      )}
      {step === 3 && (
        <div className="grid md:grid-cols-2 gap-4">
          {[
            "delivery",
            "payment",
            "warranty",
            "inclusions",
            "exclusions",
            "notes",
          ].map((key) => (
            <label className="capitalize" key={key}>
              {key}
              <textarea
                className="input h-24"
                value={terms[key] || ""}
                onChange={(e) => setTerms({ ...terms, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
      )}
      {step === 4 && (
        <>
          <p className="notice">
            Verify the scope, prices and terms. Save a draft, then submit it to
            a different manager for approval.
          </p>
          <p>
            {items.length} line items · {currency} · Valid until {validUntil}
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Quantity</th>
                  <th>Unit sell</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i, n) => (
                  <tr key={n}>
                    <td>{i.description || "Missing description"}</td>
                    <td>{i.quantity}</td>
                    <td>{i.unitSell.toFixed(2)}</td>
                    <td>{(i.quantity * i.unitSell).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {totals && (
        <div
          className="grid md:grid-cols-4 gap-4 rounded-lg p-4"
          style={{ background: "var(--surface-raised)" }}
        >
          {Object.entries({
            "Internal cost": totals.totalCost,
            "Net sell": totals.netSell,
            "Gross margin %": totals.marginPct,
            "Grand total": totals.grandTotal,
          }).map(([label, value]) => (
            <div key={label}>
              <p className="muted text-xs">{label}</p>
              <strong>
                {value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </strong>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-between">
        <button
          className="btn-secondary"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
        >
          Back
        </button>
        {step < 4 ? (
          <button className="btn-primary" onClick={() => setStep(step + 1)}>
            Continue →
          </button>
        ) : (
          <button
            className="btn-primary"
            disabled={
              busy ||
              !projectId ||
              !totals ||
              items.some((i) => !i.description.trim())
            }
            onClick={save}
          >
            {busy ? "Saving…" : "Save quotation draft"}
          </button>
        )}
      </div>
    </section>
  );
}
