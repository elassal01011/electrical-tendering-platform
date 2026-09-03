"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/client/request";
import { PageHeader, DataTable, LoadingSkeleton } from "@/components/ui";
export default function Audit() {
  const [data, setData] = useState<any>(null),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    const t = setTimeout(
      () =>
        requestJson("/api/audit?page=" + page + "&q=" + encodeURIComponent(q), {
          signal: c.signal,
        })
          .then(setData)
          .catch((e) => {
            if (!c.signal.aborted) setError(e.message);
          }),
      200,
    );
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [q, page]);
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Audit logs"
        description="Recorded changes to engineering, pricing and access."
      />
      <input
        className="input max-w-sm mb-4"
        aria-label="Filter audit log"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
        placeholder="Search action or entity…"
      />
      {error && <p className="error-box">{error}</p>}
      {!data ? (
        <LoadingSkeleton />
      ) : (
        <div className="card">
          <DataTable headers={["Time", "User", "Action", "Entity", "Details"]}>
            {data.rows.map((r: any) => (
              <tr key={r.id}>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td>{r.user?.name || "System"}</td>
                <td>{r.action}</td>
                <td>{r.entity}</td>
                <td>
                  <details>
                    <summary>View change</summary>
                    <pre className="max-w-md max-h-56 overflow-auto text-xs whitespace-pre-wrap">
                      {JSON.stringify(
                        { before: r.oldValue, after: r.newValue },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
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
              Page {page} · {data.total} entries
            </span>
            <button
              className="btn-secondary"
              disabled={page * 50 >= data.total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}
