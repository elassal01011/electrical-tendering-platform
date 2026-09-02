"use client";

import { useEffect, useState } from "react";

type Panel = { id: string; code: string; name: string | null; _count: { components: number } };
type PanelDetail = {
  panel: {
    id: string;
    code: string;
    components: {
      id: string;
      quantity: string;
      component: { manufacturer: string; partNumber: string; description: string; listPrice: string | null };
    }[];
  };
  pricingSummary: {
    materialCost: number;
    laborCost: number;
    overheadCost: number;
    totalCost: number;
    sellingPrice: number;
    profit: number;
    grossMarginPct: number;
    markupPct: number;
  } | null;
};

export default function PanelsPage() {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [selected, setSelected] = useState<PanelDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/panels")
      .then((r) => r.json())
      .then((d) => setPanels(d.panels ?? []));
  }, []);

  async function openPanel(id: string) {
    setSelectedId(id);
    const data = await fetch(`/api/panels/${id}`).then((r) => r.json());
    setSelected(data);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Panels / Bill of Materials</h1>

      <div className="card">
        <table className="data-table w-full">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Components</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {panels.map((p) => (
              <tr key={p.id}>
                <td>{p.code}</td>
                <td>{p.name}</td>
                <td>{p._count.components}</td>
                <td>
                  <button className="text-brand-100 underline" onClick={() => openPanel(p.id)}>
                    View BOM
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300">{selected.panel.code} — Bill of Materials</h2>
            <a className="btn-primary" href={`/api/export/excel?panelId=${selectedId}`}>
              Export Excel
            </a>
          </div>

          <table className="data-table w-full">
            <thead>
              <tr>
                <th>Manufacturer</th>
                <th>Part Number</th>
                <th>Description</th>
                <th>Qty</th>
                <th>Catalog List Price</th>
              </tr>
            </thead>
            <tbody>
              {selected.panel.components.map((pc) => (
                <tr key={pc.id}>
                  <td>{pc.component.manufacturer}</td>
                  <td>{pc.component.partNumber}</td>
                  <td>{pc.component.description}</td>
                  <td>{pc.quantity}</td>
                  <td>{pc.component.listPrice ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {selected.pricingSummary && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <SummaryCard label="Material Cost" value={selected.pricingSummary.materialCost} />
              <SummaryCard label="Labor Cost" value={selected.pricingSummary.laborCost} />
              <SummaryCard label="Overhead" value={selected.pricingSummary.overheadCost} />
              <SummaryCard label="Total Cost" value={selected.pricingSummary.totalCost} />
              <SummaryCard label="Selling Price" value={selected.pricingSummary.sellingPrice} highlight />
              <SummaryCard label="Profit" value={selected.pricingSummary.profit} />
              <SummaryCard label="Gross Margin %" value={selected.pricingSummary.grossMarginPct} suffix="%" />
              <SummaryCard label="Markup %" value={selected.pricingSummary.markupPct} suffix="%" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, suffix, highlight }: { label: string; value: number; suffix?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border border-slate-800 p-3 ${highlight ? "bg-brand-500/10" : "bg-slate-950"}`}>
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold">
        {value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        {suffix}
      </div>
    </div>
  );
}
