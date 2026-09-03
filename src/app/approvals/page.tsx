"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { requestJson } from "@/lib/client/request";
import {
  PageHeader,
  DataTable,
  EmptyState,
  LoadingSkeleton,
} from "@/components/ui";
export default function Approvals() {
  const [rows, setRows] = useState<any[] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    requestJson("/api/quotes?status=INTERNAL_REVIEW")
      .then((d) => setRows(d.quotes))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <PageHeader
        eyebrow="COMMERCIAL CONTROL"
        title="Approval center"
        description="Review commercial scope, margin protection and terms before issue."
      />
      {error ? (
        <p className="error-box">{error}</p>
      ) : !rows ? (
        <LoadingSkeleton />
      ) : (
        <div className="card">
          {!rows.length ? (
            <EmptyState
              title="No quotations awaiting approval."
              detail="Submitted quotation drafts appear here for a manager's review."
            />
          ) : (
            <DataTable
              headers={["Quotation", "Project", "Net selling value", "Review"]}
            >
              {rows.map((q) => (
                <tr key={q.id}>
                  <td>
                    {q.quoteNumber} · Rev {q.revision}
                  </td>
                  <td>{q.project.name}</td>
                  <td>
                    {Number(q.totalSell).toLocaleString()} {q.currency}
                  </td>
                  <td>
                    <Link className="btn-primary" href={"/quotations/" + q.id}>
                      Review quotation
                    </Link>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </div>
      )}
    </>
  );
}
