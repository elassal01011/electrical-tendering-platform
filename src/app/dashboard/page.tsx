"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { requestJson } from "@/lib/client/request";
import {
  PageHeader,
  StatCard,
  LoadingSkeleton,
  StatusBadge,
  DataTable,
  EmptyState,
} from "@/components/ui";
export default function Dashboard() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    requestJson("/api/dashboard")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  const money = (n: number) =>
    Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  return (
    <>
      <PageHeader
        eyebrow="E-SOLUTIONS · OVERVIEW"
        title="Tendering overview"
        description="Your pipeline, priorities and upcoming submissions."
      >
        <Link className="btn-secondary" href="/boq">
          Upload BOQ
        </Link>
        <Link className="btn-primary" href="/projects">
          + New project
        </Link>
      </PageHeader>
      {error ? (
        <p className="error-box">{error}</p>
      ) : !data ? (
        <LoadingSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="ACTIVE TENDERS"
              value={Object.entries(data.byStatus).reduce(
                (n: number, [k, v]) =>
                  n +
                  (!["WON", "LOST", "CANCELLED"].includes(k) ? Number(v) : 0),
                0,
              )}
              detail="Across all active stages"
            />
            <StatCard
              label="TENDER PIPELINE VALUE"
              value={
                <span className="text-xl">
                  {Object.entries(data.pipeline)
                    .map(([c, v]) => money(Number(v)) + " " + c)
                    .join(" / ") || "—"}
                </span>
              }
              detail="Latest revisions · grouped by currency"
            />
            <StatCard
              label="QUOTATIONS THIS MONTH"
              value={data.quoteCount ?? "—"}
              detail="Including new revisions"
            />
            <StatCard
              label="ENGINEERING REVIEW"
              value={data.pendingEngineering ?? "—"}
              detail="Unmatched and suggested BOQ items"
            />
            <StatCard
              label="COMMERCIAL APPROVAL"
              value={data.pendingApproval ?? "—"}
              detail="Quotations awaiting a decision"
            />
            <StatCard
              label="WON TENDERS"
              value={data.won}
              detail="Recorded project awards"
            />
            <StatCard
              label="WIN RATE"
              value={
                data.winRate === null ? "—" : data.winRate.toFixed(1) + "%"
              }
              detail="Won / (won + lost)"
            />
            <StatCard
              label="GROSS MARGIN"
              value={
                data.averageMargin === null
                  ? "—"
                  : data.averageMargin.toFixed(1) + "%"
              }
              detail="Latest quotes · one currency only"
            />
          </div>
          <div className="grid xl:grid-cols-3 gap-5 mb-6">
            <section className="card xl:col-span-2">
              <div className="flex justify-between mb-5">
                <h2 className="font-semibold">Tender pipeline</h2>
                <Link href="/projects" className="muted text-xs">
                  View projects →
                </Link>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                {[
                  "NEW",
                  "BOQ_ANALYSIS",
                  "ENGINEERING",
                  "PRICING",
                  "SUBMITTED",
                  "WON",
                ].map((s, i) => (
                  <div
                    key={s}
                    className="rounded-md p-3"
                    style={{ background: "var(--surface-raised)" }}
                  >
                    <span className="muted text-[9px] font-semibold">
                      {s.replaceAll("_", " ")}
                    </span>
                    <div className="text-2xl font-semibold my-3">
                      {data.byStatus[s] || 0}
                    </div>
                    <div
                      className="h-1 rounded"
                      style={{ background: "var(--border)" }}
                    >
                      <div
                        className="h-1 rounded"
                        style={{
                          background: "var(--primary)",
                          width:
                            Math.min(
                              100,
                              ((data.byStatus[s] || 0) /
                                Math.max(
                                  1,
                                  ...Object.values(data.byStatus).map(Number),
                                )) *
                                100,
                            ) + "%",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="card">
              <h2 className="font-semibold mb-4">Focus for today</h2>
              <Link
                href="/boq"
                className="block py-3 border-b"
                style={{ borderColor: "var(--border)" }}
              >
                <span className="badge badge-warning mr-3">
                  {data.pendingEngineering ?? "—"}
                </span>
                Engineering items to review
              </Link>
              <Link href="/approvals" className="block py-3">
                <span className="badge mr-3">
                  {data.pendingApproval ?? "—"}
                </span>
                Commercial approvals
              </Link>
              <p className="muted text-xs mt-3">
                Figures reflect stored records and your access permissions.
              </p>
            </section>
          </div>
          <section className="card mb-5">
            <div className="flex justify-between mb-4">
              <h2 className="font-semibold">Upcoming submissions</h2>
              <span className="badge">ACTIVE TENDERS</span>
            </div>
            {!data.projects.length ? (
              <EmptyState
                title="Your next opportunity starts here."
                detail="Create a project, upload its BOQ, and begin the engineering review."
                href="/projects"
                action="Create first project"
              />
            ) : (
              <DataTable
                headers={[
                  "Project",
                  "Client",
                  "Stage",
                  "Submission",
                  "Time remaining",
                ]}
              >
                {data.projects.map((p: any) => {
                  const days = p.tenderDeadline
                    ? Math.ceil(
                        (new Date(p.tenderDeadline).getTime() - Date.now()) /
                          86400000,
                      )
                    : null;
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link
                          className="font-semibold"
                          href={"/projects/" + p.id}
                        >
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
                      <td>
                        {days === null ? (
                          "—"
                        ) : (
                          <span
                            className={
                              "badge " +
                              (days <= 1
                                ? "badge-danger"
                                : days <= 7
                                  ? "badge-warning"
                                  : "")
                            }
                          >
                            {days < 0
                              ? "Overdue"
                              : days === 0
                                ? "Today"
                                : days + " days"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
            )}
          </section>
          <section className="card">
            <h2 className="font-semibold mb-3">Recent project activity</h2>
            {!data.activity.length ? (
              <p className="muted text-sm">
                Activity will appear as your team works on projects.
              </p>
            ) : (
              data.activity.map((a: any) => (
                <div className="flex justify-between py-3 text-sm" key={a.id}>
                  <span>
                    {a.action.replaceAll("_", " ")}{" "}
                    <span className="muted">· {a.user?.name || "System"}</span>
                  </span>
                  <time className="muted text-xs">
                    {new Date(a.createdAt).toLocaleString()}
                  </time>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </>
  );
}
