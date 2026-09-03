"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { hasPermission } from "@/lib/auth/permissions";
import { requestJson } from "@/lib/client/request";
import { PageHeader, DataTable, EmptyState } from "@/components/ui";
export default function Documents() {
  const { data: session } = useSession();
  const [data, setData] = useState<any>(null),
    [projectId, setProjectId] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState("");
  async function load(id = projectId) {
    setData(
      await requestJson("/api/documents" + (id ? "?projectId=" + id : "")),
    );
  }
  useEffect(() => {
    const id =
      new URLSearchParams(window.location.search).get("projectId") || "";
    setProjectId(id);
    load(id).catch((e) => setError(e.message));
  }, []);
  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      fd = new FormData(form),
      file = fd.get("file");
    if (file instanceof File && file.size > 3 * 1024 * 1024) {
      setError("Documents must be 3 MB or smaller.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await requestJson("/api/documents", {
        method: "POST",
        body: fd,
      });
      setNotice("Document revision " + result.version + " uploaded.");
      await load();
      form.reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteDoc() {
    setBusy(true);
    try {
      await requestJson("/api/documents/" + remove, { method: "DELETE" });
      setRemove("");
      await load();
      setNotice("Document removed from the active list.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const can = (p: string) => hasPermission(session?.user.roles ?? [], p);
  return (
    <>
      <PageHeader
        eyebrow="PROJECT OPERATIONS"
        title="Document center"
        description="Controlled document revisions, with private authenticated downloads."
      />
      {error && <p className="error-box mb-4">{error}</p>}
      {notice && <p className="success-box mb-4">{notice}</p>}
      {data && (
        <>
          <label className="block mb-5 max-w-lg">
            Project
            <select
              className="input"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                load(e.target.value);
              }}
            >
              <option value="">All projects</option>
              {data.projects.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
          </label>
          {can("document.upload") && (
            <form className="card mb-5 space-y-4" onSubmit={upload}>
              <h2 className="font-semibold">Upload a document</h2>
              <p className="muted text-xs">
                PDF, PNG, JPEG, XLSX or DOCX · up to 3 MB. Uploading the same
                filename creates a new revision.
              </p>
              <div className="grid md:grid-cols-3 gap-4">
                <label>
                  Project
                  <select
                    className="input"
                    required
                    name="projectId"
                    defaultValue={projectId}
                    key={projectId}
                  >
                    <option value="">Select project</option>
                    {data.projects.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.code}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Category
                  <select className="input" name="category">
                    {[
                      "Tender Documents",
                      "Drawings",
                      "Specifications",
                      "BOQ",
                      "Vendor Offers",
                      "Datasheets",
                      "Technical Submittals",
                      "Commercial Offers",
                      "Contracts",
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  File
                  <input
                    className="input"
                    name="file"
                    type="file"
                    required
                    accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
                  />
                </label>
                <label className="md:col-span-3">
                  Description
                  <input className="input" name="description" />
                </label>
              </div>
              <button disabled={busy} className="btn-primary">
                {busy ? "Uploading…" : "Upload new revision"}
              </button>
            </form>
          )}
          {remove && (
            <div
              role="alertdialog"
              aria-label="Confirm document deletion"
              className="card mb-4"
            >
              <p>Remove this document revision from the active list?</p>
              <div className="flex gap-2 mt-3">
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={deleteDoc}
                >
                  Confirm removal
                </button>
                <button className="btn-secondary" onClick={() => setRemove("")}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          <section className="card">
            {!data.rows.length ? (
              <EmptyState
                title="No documents yet."
                detail="Upload tender documents and drawings to preserve their revision history."
              />
            ) : (
              <DataTable
                headers={[
                  "File",
                  "Project",
                  "Category",
                  "Revision",
                  "Uploaded",
                  "Actions",
                ]}
              >
                {data.rows.map((d: any, i: number) => (
                  <tr key={d.id}>
                    <td>
                      {d.fileName}
                      <p className="muted text-xs">{d.description}</p>
                    </td>
                    <td>{d.project.code}</td>
                    <td>{d.category}</td>
                    <td>
                      Rev {d.version} ·{" "}
                      {data.rows.some(
                        (x: any) =>
                          x.projectId === d.projectId &&
                          x.fileName === d.fileName &&
                          x.version > d.version,
                      )
                        ? "Superseded"
                        : "Current"}
                    </td>
                    <td>{new Date(d.createdAt).toLocaleString()}</td>
                    <td>
                      <a
                        className="btn-secondary"
                        href={"/api/documents/" + d.id}
                      >
                        Download
                      </a>
                      {can("document.delete") && (
                        <button
                          className="btn-secondary ml-2"
                          onClick={() => setRemove(d.id)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </DataTable>
            )}
          </section>
        </>
      )}
    </>
  );
}
