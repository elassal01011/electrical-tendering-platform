"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { hasPermission } from "@/lib/auth/permissions";
import { requestJson } from "@/lib/client/request";
import { ExcelImportPanel } from "@/components/boq/ExcelImportPanel";
import { EngineeringReview } from "@/components/boq/EngineeringReview";
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
    [manual, setManual] = useState(false),
    [text, setText] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    requestJson("/api/projects")
      .then((d) => {
        setProjects(d.projects);
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
  async function addManual() {
    setBusy(true);
    setError("");
    try {
      const rows = text
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => {
          const [description, quantity, unit] = l
            .split("|")
            .map((s) => s.trim());
          return {
            description,
            quantity: Number(quantity),
            unit: unit || "NO",
          };
        });
      const d = await requestJson("/api/boq/import", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          name: "BOQ " + new Date().toISOString(),
          rows,
        }),
      });
      setBoqId(d.boq.id);
      setManual(false);
      setText("");
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
        <label>
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
                {b.name}
              </option>
            ))}
          </select>
        </label>
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
        {can("boq.import") && (
          <button
            className="btn-secondary"
            disabled={!projectId}
            onClick={() => setManual(!manual)}
          >
            + Add manual BOQ
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
      {manual && (
        <section className="card mb-4 space-y-3">
          <label>
            One row per line: description | quantity | unit
            <textarea
              className="input h-32"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button
            disabled={busy || !text.trim()}
            className="btn-primary"
            onClick={addManual}
          >
            Create manual BOQ
          </button>
        </section>
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
            <h2 className="font-semibold">{boq.name}</h2>
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
          <EmptyState
            title="Bring your tender scope into focus."
            detail="Select a BOQ or upload an Excel workbook to start analysis."
          />
        </div>
      )}
    </>
  );
}
