"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { hasPermission } from "@/lib/auth/permissions";
import { requestJson } from "@/lib/client/request";
import {
  PageHeader,
  DataTable,
  StatusBadge,
  EmptyState,
  LoadingSkeleton,
} from "@/components/ui";
import { QuoteBuilder } from "@/components/quotes/QuoteBuilder";
export default function Quotes() {
  const [rows, setRows] = useState<any[]>([]),
    [adding, setAdding] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const { data: session } = useSession();
  useEffect(() => {
    requestJson("/api/quotes" + window.location.search)
      .then((d) => setRows(d.quotes))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [adding]);
  return (
    <>
      <PageHeader
        eyebrow="COMMERCIAL"
        title="Quotations"
        description="Build, review and issue clear commercial offers."
      >
        {hasPermission(session?.user.roles ?? [], "quote.create") && (
          <button className="btn-primary" onClick={() => setAdding(!adding)}>
            + New quotation
          </button>
        )}
      </PageHeader>
      {error && <p className="error-box">{error}</p>}
      {adding ? (
        <QuoteBuilder onCancel={() => setAdding(false)} />
      ) : loading ? (
        <LoadingSkeleton />
      ) : (
        <div className="card">
          {!rows.length ? (
            <EmptyState
              title="No quotations yet."
              detail="Create your first quotation from reviewed BOQ scope or manual items."
            />
          ) : (
            <DataTable
              headers={[
                "Quotation",
                "Project",
                "Revision",
                "Status",
                "Net value",
                "Validity",
              ]}
            >
              {rows.map((q) => (
                <tr key={q.id}>
                  <td>
                    <Link
                      href={"/quotations/" + q.id}
                      className="font-semibold"
                    >
                      {q.quoteNumber}
                    </Link>
                  </td>
                  <td>{q.project.name}</td>
                  <td>Rev {q.revision}</td>
                  <td>
                    <StatusBadge status={q.status} />
                  </td>
                  <td>
                    {Number(q.totalSell).toLocaleString()} {q.currency}
                  </td>
                  <td>
                    {q.validUntil
                      ? new Date(q.validUntil).toLocaleDateString()
                      : "Not set"}
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
