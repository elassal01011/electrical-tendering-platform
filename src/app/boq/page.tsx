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
  type ItemForm,
} from "@/components/boq/BoqForms";
import {
  PageHeader,
  DataTable,
  StatusBadge,
  EmptyState,
} from "@/components/ui";
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
    [itemForm, setItemForm] = useState<any>(null);
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
    if (projectId)
      requestJson("/api/projects/" + projectId)
        .then((d) => setBoqs(d.project.boqs))
        .catch((e) => setError(e.message));
  }, [projectId, boqId]);
  async function load() {
    if (!boqId) return;
    const d = await requestJson(
      "/api/boq/" + boqId + "?page=" + page + "&q=" + encodeURIComponent(q),
    );
    setBoq(d.boq);
    setTotal(d.total);
  }
  useEffect(() => {
    const t = setTimeout(() => load().catch((e) => setError(e.message)), 200);
    return () => clearTimeout(t);
  }, [boqId, page, q]);
  async function action(kind: string) {
    if (!boqId) return;
    setBusy(true);
    setError("");
    try {
      const d = await requestJson("/api/boq/" + boqId + "/" + kind, {
        method: "POST",
        body: "{}",
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
            Auto match next 100 rows
          </button>
        )}
        {can("pricing.edit") && (
          <button
            className="btn-secondary"
            disabled={!boqId || busy}
            onClick={() => action("apply-prices")}
          >
            Price next 100 reviewed rows
          </button>
        )}
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
          <DataTable
            headers={[
              "Item",
              "Description",
              "Qty / unit",
              "Status",
              "Matched component",
              "Confidence",
              "Applied cost",
              "Review",
              "Actions",
            ]}
          >
            {boq.items.map((i: any) => (
              <tr key={i.id}>
                <td>{i.itemNumber || i.lineNo}</td>
                <td className="min-w-64 max-w-lg">{i.rawDescription}</td>
                <td>
                  {i.quantity} {i.unit}
                </td>
                <td>
                  <StatusBadge status={i.status} />
                </td>
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
                  {can("boq.edit") && (
                    <div className="flex gap-2">
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
                    </div>
                  )}
                </td>
                <td title={i.matchReason}>
                  {i.matchScore === null ? "—" : Number(i.matchScore) + "%"}
                </td>
                <td>
                  {i.appliedUnitPrice === null
                    ? "Not priced"
                    : Number(i.appliedUnitPrice).toLocaleString() +
                      " " +
                      i.appliedCurrency}
                  <div className="muted text-xs">
                    {i.appliedSupplier?.companyName}
                  </div>
                </td>
                <td>
                  {can("boq.review") && (
                    <button
                      className="btn-secondary"
                      onClick={() => setReview(i.id)}
                    >
                      Review
                    </button>
                  )}
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
