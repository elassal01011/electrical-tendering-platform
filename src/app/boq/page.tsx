"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { hasPermission } from "@/lib/auth/permissions";
import { requestJson } from "@/lib/client/request";
import { applyCreatedBoq } from "@/lib/client/boqWorkflow";
import { ExcelImportPanel } from "@/components/boq/ExcelImportPanel";
import { EngineeringReview } from "@/components/boq/EngineeringReview";
import {
  BoqItemModal,
  CreateBoqModal,
  ManualPriceModal,
  type ItemForm,
  type PriceForm,
} from "@/components/boq/BoqForms";
import { PageHeader, DataTable, EmptyState } from "@/components/ui";
export default function BOQ() {
  const { data: session } = useSession();
  const can = (p: string) => hasPermission(session?.user.roles ?? [], p);
  const [projects, setProjects] = useState<any[]>([]),
    [projectId, setProjectId] = useState(""),
    [boqs, setBoqs] = useState<any[]>([]),
    [boq, setBoq] = useState<any>(null),
    [boqId, setBoqId] = useState(""),
    [upload, setUpload] = useState(false),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [q, setQ] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(""),
    [creating, setCreating] = useState(false),
    [itemForm, setItemForm] = useState<any>(null),
    [priceItem, setPriceItem] = useState<any>(null),
    [suppliers, setSuppliers] = useState<any[]>([]),
    [summary, setSummary] = useState<any>(null),
    [filter, setFilter] = useState("all"),
    [bulk, setBulk] = useState(false),
    [bulkPrices, setBulkPrices] = useState<
      Record<string, { unitCost: string; currency: string }>
    >({});
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    requestJson("/api/projects")
      .then((d) => {
        setProjects(d.projects);
        if (params.get("create") === "1") setCreating(true);
        if (params.get("boqId")) {
          setBoqId(params.get("boqId")!);
          requestJson("/api/boq/" + params.get("boqId"))
            .then((b) => setProjectId(b.boq.projectId))
            .catch((e) => setError(e.message));
        } else setProjectId(params.get("projectId") || d.projects[0]?.id || "");
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (can("pricing.edit") || can("boq.edit"))
      requestJson("/api/parties?type=SUPPLIER")
        .then((d) => setSuppliers(d.rows))
        .catch(() => setSuppliers([]));
  }, [session]);
  useEffect(() => {
    if (projectId)
      requestJson("/api/projects/" + projectId)
        .then((d) => setBoqs(d.project.boqs))
        .catch((e) => setError(e.message));
  }, [projectId, boqId]);
  async function load() {
    if (!boqId) return;
    const d = await requestJson(
      "/api/boq/" +
        boqId +
        "?page=" +
        page +
        "&filter=" +
        filter +
        "&q=" +
        encodeURIComponent(q),
    );
    setBoq(d.boq);
    setTotal(d.total);
    setSummary(d.summary);
  }
  useEffect(() => {
    const t = setTimeout(() => load().catch((e) => setError(e.message)), 200);
    return () => clearTimeout(t);
  }, [boqId, page, q, filter]);
  async function action(kind: string, body: object = {}) {
    if (!boqId) return;
    setBusy(true);
    setError("");
    try {
      const d = await requestJson("/api/boq/" + boqId + "/" + kind, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setNotice(
        kind === "match"
          ? d.processed +
              " rows analyzed; " +
              d.suggested +
              " preliminary matches. " +
              d.remaining +
              " rows remain."
          : d.results.filter((r: any) => r.source !== "UNPRICED").length +
              " prices applied. " +
              d.results.filter((r: any) => r.source === "UNPRICED").length +
              " items need a price or currency rate.",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function createBoq(input: any) {
    setBusy(true);
    setError("");
    try {
      const d = await requestJson("/api/boq", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setProjectId(d.boq.projectId);
      const next = applyCreatedBoq(
        projectId === d.boq.projectId ? boqs : [],
        d.boq,
      );
      setBoqs(next.boqs);
      setBoqId(next.selectedBoqId);
      setBoq(d.boq);
      setCreating(false);
      setPage(1);
      setNotice("BOQ created successfully.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveItem(input: ItemForm) {
    setBusy(true);
    setError("");
    try {
      const editing = itemForm?.id;
      await requestJson(
        editing ? "/api/boq/items/" + editing : "/api/boq/" + boqId + "/items",
        { method: editing ? "PUT" : "POST", body: JSON.stringify(input) },
      );
      setItemForm(null);
      setNotice(
        editing
          ? "BOQ item updated successfully."
          : "BOQ item added successfully.",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteItem(item: any) {
    if (
      !window.confirm(
        `Delete BOQ item “${item.rawDescription}”? This action cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/boq/items/" + item.id, { method: "DELETE" });
      setNotice("BOQ item deleted successfully.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function savePrice(input: PriceForm) {
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/boq/items/" + priceItem.id + "/price", {
        method: "PUT",
        body: JSON.stringify(input),
      });
      setPriceItem(null);
      setNotice("Manual BOQ price saved successfully.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function clearPrice() {
    if (
      !window.confirm(
        "Clear the applied price from this BOQ item? Supplier catalog records will not be changed.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/boq/items/" + priceItem.id + "/price", {
        method: "DELETE",
      });
      setPriceItem(null);
      setNotice("BOQ price cleared.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function autoPriceItem(itemId: string) {
    setBusy(true);
    setError("");
    try {
      const data = await requestJson("/api/boq/" + boqId + "/apply-prices", {
        method: "POST",
        body: JSON.stringify({ itemId }),
      });
      const result = data.results[0];
      setNotice(
        result?.source === "UNPRICED"
          ? result.message
          : "Automatic price applied.",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function clearMatch(item: any) {
    const replaceManualPrice =
      item.priceSource === "MANUAL"
        ? window.confirm("Clearing this component will also clear its locked manual price. Continue?")
        : false;
    if (item.priceSource === "MANUAL" && !replaceManualPrice) return;
    setBusy(true);
    try {
      await requestJson("/api/boq/items/" + item.id, {
        method: "PATCH",
        body: JSON.stringify({ action: "clear", replaceManualPrice }),
      });
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function openBulk() {
    setBulkPrices(
      Object.fromEntries(
        (boq?.items || []).map((item: any) => [
          item.id,
          {
            unitCost:
              item.appliedUnitPrice === null
                ? ""
                : String(item.manualBaseUnitCost ?? item.appliedUnitPrice),
            currency: item.appliedCurrency || boq.currency,
          },
        ]),
      ),
    );
    setBulk(true);
  }
  async function saveBulk() {
    const priced = boq.items.filter(
      (item: any) => Number(bulkPrices[item.id]?.unitCost) > 0,
    );
    const replaces = priced.some(
      (item: any) =>
        item.appliedUnitPrice !== null && item.priceSource !== "MANUAL",
    );
    if (
      replaces &&
      !window.confirm(
        "Replace the currently applied supplier prices in these rows with manual prices?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/boq/" + boqId + "/prices", {
        method: "PUT",
        body: JSON.stringify({
          prices: priced.map((item: any) => ({
            itemId: item.id,
            price: {
              unitCost: Number(bulkPrices[item.id].unitCost),
              currency: bulkPrices[item.id].currency,
              replaceExisting: replaces,
            },
          })),
        }),
      });
      setBulk(false);
      setNotice(`${priced.length} BOQ prices saved.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="ENGINEERING"
        title="BOQ analysis"
        description="Import consultant workbooks, verify selections, and price your tender scope."
      >
        {can("boq.import") && (
          <button className="btn-primary" onClick={() => setUpload(!upload)}>
            {upload ? "Close upload" : "↑ Upload Excel BOQ"}
          </button>
        )}
      </PageHeader>
      <div className="card mb-5 grid md:grid-cols-2 gap-4">
        <label>
          Project
          <select
            className="input"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setBoqId("");
              setBoq(null);
              setPage(1);
              setReview("");
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
        <div>
          <label className="block">
            Bill of quantities
            <select
              className="input"
              value={boqId}
              onChange={(e) => {
                setBoqId(e.target.value);
                setPage(1);
                setReview("");
              }}
            >
              <option value="">Select BOQ</option>
              {boqs.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} — Rev {b.version}
                </option>
              ))}
            </select>
          </label>
          {can("boq.edit") && (
            <button
              className="btn-primary mt-2"
              disabled={busy}
              onClick={() => setCreating(true)}
            >
              + Create BOQ
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="error-box mb-4" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success-box mb-4" role="status">
          {notice}
        </p>
      )}
      {upload && (
        <div className="mb-5">
          <ExcelImportPanel
            projectId={projectId}
            existingBoqs={boqs}
            onImported={(b: any) => {
              setBoqId(b.id);
              setBoq(b);
              setPage(1);
              setUpload(false);
              setNotice(
                "Excel BOQ imported successfully. Open engineering review to verify component selections.",
              );
            }}
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2 mb-4">
        {can("boq.edit") && (
          <button
            className="btn-secondary"
            disabled={!boqId || busy}
            onClick={() => setItemForm({})}
          >
            + Add Item
          </button>
        )}
        {can("boq.edit") && (
          <button
            className="btn-secondary"
            disabled={!boqId || busy}
            onClick={() => action("match")}
          >
            Auto Match
          </button>
        )}
        {can("boq.review") && (
          <button
            className="btn-secondary"
            disabled={!boqId || busy}
            onClick={() => action("match", { acceptHigh: true })}
          >
            Accept All High Confidence
          </button>
        )}
        {can("pricing.edit") && (
          <button
            className="btn-secondary"
            disabled={!boqId || busy}
            onClick={() => action("apply-prices")}
          >
            Auto Price All
          </button>
        )}
        {(can("pricing.edit") || can("boq.edit")) && (
          <button
            className="btn-secondary"
            disabled={!boqId || busy}
            onClick={openBulk}
          >
            Edit Prices
          </button>
        )}
        <select
          className="input max-w-xs"
          aria-label="Filter BOQ pricing status"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All</option>
          <option value="priced">Priced</option>
          <option value="unpriced">Unpriced</option>
          <option value="manual">Manual Price</option>
          <option value="supplier">Supplier Price</option>
          <option value="review">Needs Review</option>
        </select>
        <input
          className="input max-w-xs"
          placeholder="Filter description…"
          aria-label="Filter BOQ rows"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {creating && can("boq.edit") && (
        <CreateBoqModal
          projects={projects}
          initialProjectId={projectId}
          busy={busy}
          onCancel={() => setCreating(false)}
          onSubmit={createBoq}
        />
      )}
      {itemForm && (
        <BoqItemModal
          busy={busy}
          initial={
            itemForm.id
              ? {
                  itemNumber: itemForm.itemNumber || "",
                  description: itemForm.rawDescription,
                  quantity: Number(itemForm.quantity),
                  unit: itemForm.unit,
                  manufacturer: itemForm.manufacturerRequirement || "",
                  model: itemForm.modelRequirement || "",
                  remarks: itemForm.remarks || "",
                }
              : undefined
          }
          onCancel={() => setItemForm(null)}
          onSubmit={saveItem}
        />
      )}
      {priceItem && (
        <ManualPriceModal
          item={{ ...priceItem, boqCurrency: boq?.currency }}
          suppliers={suppliers}
          busy={busy}
          onCancel={() => setPriceItem(null)}
          onSubmit={savePrice}
          onClear={clearPrice}
        />
      )}
      {review && (
        <div className="mb-5">
          <EngineeringReview
            itemId={review}
            onClose={() => setReview("")}
            onSaved={() => {
              load();
              setNotice(
                "Engineering selection verified. Reapply pricing for this item.",
              );
            }}
          />
        </div>
      )}
      {boq ? (
        <div className="card">
          <div className="flex justify-between mb-4">
            <div>
              <h2 className="font-semibold">
                {boq.name} — Rev {boq.version}
              </h2>
              <p className="muted text-sm">
                {boq.description || "No description"} · {boq.currency}
              </p>
            </div>
            <span className="badge">{total} ROWS</span>
          </div>
          {summary && (
            <div className="grid grid-cols-2 gap-3 mb-5 lg:grid-cols-5">
              {Object.entries({
                Items: summary.items,
                Matched: summary.matched,
                Unmatched: summary.unmatched,
                Verified: summary.verified,
                Priced: summary.priced,
                Unpriced: summary.unpriced,
                "Manual Prices": summary.manual,
                "Auto Prices": summary.autoPrices,
                "Needs Review": summary.needsReview,
              }).map(([label, value]) => (
                <div className="metric" key={label}>
                  <span>{label}</span>
                  <strong>{String(value)}</strong>
                </div>
              ))}
              <div className="metric">
                <span>Total material cost</span>
                <strong>
                  {Object.entries(summary.totalsByCurrency)
                    .map(
                      ([currency, value]) =>
                        `${Number(value).toLocaleString()} ${currency}`,
                    )
                    .join(" · ") || "—"}
                </strong>
              </div>
            </div>
          )}
          {bulk && (
            <section className="notice mb-5 space-y-3">
              <h3 className="font-medium">Edit Prices — current page</h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Unit Cost</th>
                      <th>Currency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boq.items.map((item: any) => (
                      <tr key={item.id}>
                        <td>{item.itemNumber || item.lineNo}</td>
                        <td>{String(item.quantity)}</td>
                        <td>
                          <input
                            className="input"
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={bulkPrices[item.id]?.unitCost ?? ""}
                            onChange={(e) =>
                              setBulkPrices((current) => ({
                                ...current,
                                [item.id]: {
                                  ...(current[item.id] || {
                                    currency: boq.currency,
                                  }),
                                  unitCost: e.target.value,
                                },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="input uppercase"
                            maxLength={3}
                            value={
                              bulkPrices[item.id]?.currency ?? boq.currency
                            }
                            onChange={(e) =>
                              setBulkPrices((current) => ({
                                ...current,
                                [item.id]: {
                                  ...(current[item.id] || { unitCost: "" }),
                                  currency: e.target.value.toUpperCase(),
                                },
                              }))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <button
                  className="btn-primary"
                  disabled={
                    busy ||
                    !Object.values(bulkPrices).some(
                      (row) => Number(row.unitCost) > 0,
                    )
                  }
                  onClick={saveBulk}
                >
                  Save All
                </button>
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => setBulk(false)}
                >
                  Cancel
                </button>
              </div>
            </section>
          )}
          <DataTable
            headers={[
              "Item",
              "Description",
              "Qty",
              "Unit",
              "Manufacturer",
              "Part Number",
              "Selected Component",
              "Confidence",
              "Match Status",
              "Unit Cost",
              "Price Source",
              "Currency",
              "Total Cost",
              "Actions",
            ]}
          >
            {boq.items.map((i: any) => (
              <tr key={i.id}>
                <td>{i.itemNumber || i.lineNo}</td>
                <td className="min-w-64 max-w-lg">{i.rawDescription}</td>
                <td>{String(i.quantity)}</td>
                <td>{i.unit}</td>
                <td>{i.manufacturerRequirement || "—"}</td>
                <td>{i.modelRequirement || "—"}</td>
                <td>
                  {i.matchedComponent ? (
                    <>
                      {i.matchedComponent.manufacturer}
                      <div className="muted text-xs">
                        {i.matchedComponent.partNumber}
                      </div>
                    </>
                  ) : (
                    "Unselected"
                  )}
                </td>
                <td>
                  {i.matchScore === null ? "—" : `${Number(i.matchScore).toFixed(0)}%`}
                  {i.matchReason && <details><summary>Reasons</summary><p className="text-xs">{i.matchReason}</p></details>}
                </td>
                <td>{i.status}</td>
                <td>
                  {i.appliedUnitPrice === null
                    ? "Not priced"
                    : Number(i.appliedUnitPrice).toLocaleString()}
                </td>
                <td>
                  {i.priceSource ? (
                    <span className="badge">
                      {i.priceSource === "MANUAL"
                        ? "Manual"
                        : i.priceSource === "SUPPLIER_PRICE"
                          ? `Supplier${i.appliedSupplier?.companyName ? ": " + i.appliedSupplier.companyName : ""}`
                          : "Catalog / Auto"}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{i.appliedCurrency || "—"}</td>
                <td>
                  {i.appliedUnitPrice === null
                    ? "—"
                    : (
                        Number(i.quantity) * Number(i.appliedUnitPrice)
                      ).toLocaleString()}
                </td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    {(can("pricing.edit") || can("boq.edit")) && (
                      <>
                        <button
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() => setPriceItem(i)}
                        >
                          {i.priceSource === "MANUAL"
                            ? "Change Manual Price"
                            : "Set Manual Price"}
                        </button>
                        {i.appliedUnitPrice !== null && (
                          <button
                            className="btn-secondary"
                            disabled={busy}
                            onClick={() => {
                              setPriceItem(i);
                            }}
                          >
                            Clear Price
                          </button>
                        )}
                        {i.status === "MATCHED" &&
                          i.appliedUnitPrice === null && (
                            <>
                              <button
                                className="btn-secondary"
                                disabled={busy}
                                onClick={() => autoPriceItem(i.id)}
                              >
                                Find Supplier Price
                              </button>
                              <button
                                className="btn-secondary"
                                disabled={busy}
                                onClick={() => autoPriceItem(i.id)}
                              >
                                Auto Price
                              </button>
                            </>
                          )}
                      </>
                    )}
                    {can("boq.review") && (
                      <>
                        <button className="btn-secondary" onClick={() => setReview(i.id)}>
                          {i.status === "SUGGESTED" ? "Accept / Change" : "Change"}
                        </button>
                        {i.matchedComponentId && (
                          <button className="btn-secondary" disabled={busy} onClick={() => void clearMatch(i)}>
                            Clear
                          </button>
                        )}
                      </>
                    )}
                    {can("boq.edit") && (
                      <>
                        <button
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() => setItemForm(i)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() => deleteItem(i)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
          <div className="flex gap-3 mt-4">
            <button
              className="btn-secondary"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <span className="muted py-2">
              Page {page} of {Math.max(1, Math.ceil(total / 100))}
            </span>
            <button
              className="btn-secondary"
              disabled={page * 100 >= total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : (
        <div className="card">
          {projectId && boqs.length === 0 ? (
            <div className="space-y-3">
              <h2 className="font-semibold">
                No BOQs have been created for this project yet.
              </h2>
              <p className="muted">
                Create one manually or import an Excel BOQ.
              </p>
              <div className="flex flex-wrap gap-2">
                {can("boq.edit") && (
                  <button
                    className="btn-primary"
                    onClick={() => setCreating(true)}
                  >
                    + Create Blank BOQ
                  </button>
                )}
                {can("boq.import") && (
                  <button
                    className="btn-secondary"
                    onClick={() => setUpload(true)}
                  >
                    Import Excel
                  </button>
                )}
              </div>
            </div>
          ) : (
            <EmptyState
              title="No BOQ selected."
              detail="Select a project and BOQ to view its items."
            />
          )}
        </div>
      )}
    </>
  );
}
