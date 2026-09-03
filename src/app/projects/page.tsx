"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { requestJson } from "@/lib/client/request";
import {
  PageHeader,
  DataTable,
  EmptyState,
  StatusBadge,
  LoadingSkeleton,
} from "@/components/ui";
import { useSession } from "next-auth/react";
import { hasPermission } from "@/lib/auth/permissions";
export default function Projects() {
  const [rows, setRows] = useState<any[]>([]),
    [clients, setClients] = useState<any[]>([]),
    [consultants, setConsultants] = useState<any[]>([]),
    [q, setQ] = useState(""),
    [adding, setAdding] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const { data: session } = useSession();
  useEffect(() => {
    const c = new AbortController();
    const t = setTimeout(
      () =>
        requestJson("/api/projects?q=" + encodeURIComponent(q), {
          signal: c.signal,
        })
          .then((d) => setRows(d.projects))
          .catch((e) => {
            if (!c.signal.aborted) setError(e.message);
          })
          .finally(() => setLoading(false)),
      200,
    );
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [q]);
  useEffect(() => {
    Promise.all([
      requestJson("/api/parties?type=CLIENT"),
      requestJson("/api/parties?type=CONSULTANT"),
    ])
      .then(([a, b]) => {
        setClients(a.rows);
        setConsultants(b.rows);
      })
      .catch((e) => setError(e.message));
  }, []);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = Object.fromEntries(new FormData(e.currentTarget));
      await requestJson("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          consultantId: data.consultantId || undefined,
        }),
      });
      setRows((await requestJson("/api/projects")).projects);
      setAdding(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="SALES & TENDERS"
        title="Projects & tenders"
        description="Every opportunity, from first enquiry to final award."
      >
        {hasPermission(session?.user.roles ?? [], "project.create") && (
          <button className="btn-primary" onClick={() => setAdding(!adding)}>
            {adding ? "Close" : "+ New project"}
          </button>
        )}
      </PageHeader>
      {error && <p className="error-box mb-4">{error}</p>}
      {adding && (
        <form className="card mb-5 space-y-5" onSubmit={save}>
          <div className="grid md:grid-cols-3 gap-4">
            <label>
              Project name
              <input name="name" className="input" required />
            </label>
            <label>
              Client
              <select name="clientId" className="input" required>
                <option value="">Choose client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.companyName}
                  </option>
                ))}
              </select>
              <Link href="/clients" className="muted text-xs">
                Add a client →
              </Link>
            </label>
            <label>
              Consultant
              <select name="consultantId" className="input">
                <option value="">None</option>
                {consultants.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.companyName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tender number
              <input className="input" name="tenderNumber" />
            </label>
            <label>
              Submission deadline
              <input
                className="input"
                name="tenderDeadline"
                type="datetime-local"
              />
            </label>
            <label>
              Currency
              <input
                className="input"
                name="currency"
                defaultValue="EGP"
                required
                pattern="[A-Z]{3}"
              />
            </label>
            <label>
              Location
              <input className="input" name="location" />
            </label>
          </div>
          <button disabled={busy} className="btn-primary">
            {busy ? "Creating…" : "Create project"}
          </button>
        </form>
      )}
      <div className="card">
        <input
          className="input mb-5 max-w-sm"
          aria-label="Search projects"
          placeholder="Search project name or number…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {loading ? (
          <LoadingSkeleton />
        ) : !rows.length ? (
          <EmptyState
            title="No projects yet."
            detail="Create a project to begin your next tender."
          />
        ) : (
          <DataTable
            headers={["Project", "Client", "Stage", "Deadline", "Currency"]}
          >
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={"/projects/" + p.id} className="font-semibold">
                    {p.code}
                  </Link>
                  <div className="muted text-xs mt-1">{p.name}</div>
                </td>
                <td>{p.client.companyName}</td>
                <td>
                  <StatusBadge status={p.status} />
                </td>
                <td>
                  {p.tenderDeadline
                    ? new Date(p.tenderDeadline).toLocaleDateString()
                    : "Not set"}
                </td>
                <td>{p.currency}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>
    </>
  );
}
