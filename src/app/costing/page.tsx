"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { hasPermission } from "@/lib/auth/permissions";
import { requestJson } from "@/lib/client/request";
import {
  costModel,
  DEFAULT_PROFILES,
  type CostInputs,
} from "@/lib/services/pricing/costModel";
import { PageHeader, StatCard, DataTable } from "@/components/ui";
const initial: CostInputs = {
  material: 0,
  labor: 0,
  engineering: 0,
  testing: 0,
  busbar: 0,
  enclosure: 0,
  accessories: 0,
  transport: 0,
  ...DEFAULT_PROFILES.STANDARD,
  mode: "MARGIN",
};
export default function Costing() {
  const [input, setInput] = useState(initial),
    [data, setData] = useState<any>(null),
    [profile, setProfile] = useState("CUSTOM"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const { data: session } = useSession();
  const canEdit = hasPermission(session?.user.roles ?? [], "pricing.edit");
  async function load() {
    setData(await requestJson("/api/costing"));
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  let result: ReturnType<typeof costModel> | null = null;
  try {
    result = costModel(input);
  } catch {}
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.currentTarget));
    const values: any = { ...fd };
    ["rate", "hourlyRate", "discountPct", "qtyBandMin"].forEach((k) => {
      if (k in values) values[k] = Number(values[k]);
    });
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/costing", {
        method: "POST",
        body: JSON.stringify(values),
      });
      await load();
      setNotice("Pricing configuration saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveProfile() {
    if (profile === "CUSTOM") return;
    setBusy(true);
    try {
      const p = {
        targetPct: input.targetPct,
        overheadPct: input.overheadPct,
        contingencyPct: input.contingencyPct,
        warrantyPct: input.warrantyPct,
        financePct: input.financePct,
        commissionPct: input.commissionPct,
      };
      await requestJson("/api/costing", {
        method: "POST",
        body: JSON.stringify({
          kind: "profiles",
          profiles: { ...data.profiles, [profile]: p },
        }),
      });
      await load();
      setNotice("Pricing profile saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="COMMERCIAL"
        title="Smart pricing & cost planning"
        description="Explore cost and margin scenarios. Only explicit configuration saves change stored data."
      />
      {error && <p className="error-box mb-4">{error}</p>}
      {notice && <p className="success-box mb-4">{notice}</p>}
      <section className="card mb-5">
        <div className="flex gap-4 mb-5">
          <label>
            Profile
            <select
              className="input"
              value={profile}
              onChange={(e) => {
                setProfile(e.target.value);
                if (data?.profiles[e.target.value])
                  setInput({ ...input, ...data.profiles[e.target.value] });
              }}
            >
              {["CUSTOM", "AGGRESSIVE", "STANDARD", "SAFE"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Pricing method
            <select
              className="input"
              value={input.mode}
              onChange={(e) =>
                setInput({
                  ...input,
                  mode: e.target.value as "MARGIN" | "MARKUP",
                })
              }
            >
              <option value="MARGIN">Gross margin</option>
              <option value="MARKUP">Markup on cost</option>
            </select>
          </label>
          {canEdit && (
            <button
              className="btn-secondary self-end"
              disabled={busy || profile === "CUSTOM" || !data}
              onClick={saveProfile}
            >
              Save profile percentages
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(input)
            .filter(([k]) => k !== "mode")
            .map(([key, value]) => (
              <label key={key} className="capitalize">
                {key.replace(/([A-Z])/g, " $1").replace("Pct", "%")}
                <input
                  className="input"
                  type="number"
                  min="0"
                  max={key.endsWith("Pct") ? 99 : undefined}
                  step="any"
                  value={value}
                  onChange={(e) =>
                    setInput({ ...input, [key]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
        </div>
        <p className="muted text-xs mt-4">
          All amounts use one chosen currency. Overhead, contingency, warranty,
          finance and commission are applied to direct cost. Convert material
          costs using your configured rates before entry.
        </p>
      </section>
      {result ? (
        <div className="grid md:grid-cols-4 gap-4 mb-5">
          <StatCard label="Total cost" value={result.totalCost.toFixed(2)} />
          <StatCard
            label="Recommended selling"
            value={result.selling.toFixed(2)}
          />
          <StatCard label="Gross profit" value={result.profit.toFixed(2)} />
          <StatCard
            label="Margin / markup"
            value={
              <span className="text-xl">
                {result.marginPct.toFixed(1)}% / {result.markupPct.toFixed(1)}%
              </span>
            }
          />
        </div>
      ) : (
        <p className="error-box">
          Enter valid non-negative amounts and percentages below 100.
        </p>
      )}
      {data && (
        <div className="grid lg:grid-cols-2 gap-5">
          <section className="card">
            <h2 className="font-semibold mb-4">Currency rates</h2>
            <DataTable headers={["From", "To", "Rate", "Date"]}>
              {data.rates.map((r: any) => (
                <tr key={r.id}>
                  <td>{r.baseCurrency}</td>
                  <td>{r.quoteCurrency}</td>
                  <td>{Number(r.rate)}</td>
                  <td>{new Date(r.asOf).toLocaleDateString()}</td>
                </tr>
              ))}
            </DataTable>
            {canEdit && (
              <form className="grid grid-cols-3 gap-3 mt-4" onSubmit={save}>
                <input type="hidden" name="kind" value="rate" />
                <label>
                  From
                  <input
                    className="input"
                    name="baseCurrency"
                    required
                    placeholder="USD"
                    pattern="[A-Z]{3}"
                  />
                </label>
                <label>
                  To
                  <input
                    className="input"
                    name="quoteCurrency"
                    required
                    placeholder="EGP"
                    pattern="[A-Z]{3}"
                  />
                </label>
                <label>
                  Rate
                  <input
                    className="input"
                    name="rate"
                    type="number"
                    min="0.00000001"
                    step="any"
                    required
                  />
                </label>
                <button className="btn-primary" disabled={busy}>
                  Save rate
                </button>
              </form>
            )}
          </section>
          <section className="card">
            <h2 className="font-semibold mb-4">Labor rates</h2>
            <DataTable headers={["Role", "Hourly rate", "Currency"]}>
              {data.labor.map((r: any) => (
                <tr key={r.id}>
                  <td>{r.label}</td>
                  <td>{r.hourlyRate}</td>
                  <td>{r.currency}</td>
                </tr>
              ))}
            </DataTable>
            {canEdit && (
              <form className="grid grid-cols-3 gap-3 mt-4" onSubmit={save}>
                <input type="hidden" name="kind" value="labor" />
                <label>
                  Label
                  <input className="input" name="label" required />
                </label>
                <label>
                  Hourly rate
                  <input
                    className="input"
                    name="hourlyRate"
                    type="number"
                    min="0"
                    step="any"
                    required
                  />
                </label>
                <label>
                  Currency
                  <input
                    className="input"
                    name="currency"
                    required
                    defaultValue="EGP"
                    pattern="[A-Z]{3}"
                  />
                </label>
                <button className="btn-primary" disabled={busy}>
                  Save labor rate
                </button>
              </form>
            )}
          </section>
          <section className="card lg:col-span-2">
            <h2 className="font-semibold mb-4">Supplier discounts</h2>
            <DataTable
              headers={["Supplier", "Brand", "Discount", "Minimum qty"]}
            >
              {data.discounts.map((d: any) => (
                <tr key={d.id}>
                  <td>{d.supplier.companyName}</td>
                  <td>{d.brand || "All"}</td>
                  <td>{d.discountPct}%</td>
                  <td>{d.qtyBandMin}</td>
                </tr>
              ))}
            </DataTable>
            {canEdit && (
              <form onSubmit={save} className="grid md:grid-cols-4 gap-3 mt-4">
                <input type="hidden" name="kind" value="discount" />
                <label>
                  Supplier
                  <select name="supplierId" className="input" required>
                    {data.suppliers.map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.companyName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Brand (optional)
                  <input name="brand" className="input" />
                </label>
                <label>
                  Discount %
                  <input
                    name="discountPct"
                    className="input"
                    type="number"
                    min="0"
                    max="100"
                    required
                    step="any"
                  />
                </label>
                <label>
                  Minimum quantity
                  <input
                    name="qtyBandMin"
                    className="input"
                    type="number"
                    min="0"
                    defaultValue="0"
                    required
                  />
                </label>
                <button disabled={busy} className="btn-primary">
                  Add discount
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </>
  );
}
