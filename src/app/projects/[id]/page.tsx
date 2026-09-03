"use client";
import { use } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { requestJson } from "@/lib/client/request";
import {
  PageHeader,
  StatCard,
  DataTable,
  StatusBadge,
  LoadingSkeleton,
} from "@/components/ui";
import { useSession } from "next-auth/react";
import { hasPermission } from "@/lib/auth/permissions";
const stages = [
  "NEW",
  "UNDER_REVIEW",
  "BOQ_ANALYSIS",
  "ENGINEERING",
  "PRICING",
  "INTERNAL_REVIEW",
  "SUBMITTED",
  "NEGOTIATION",
  "WON",
  "LOST",
  "CANCELLED",
];
export default function Project({
  params: routeParams,
}: {
  params: Promise<{ id: string }>;
}) {
  const params = use(routeParams);
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { data: session } = useSession();
  useEffect(() => {
    requestJson("/api/projects/" + params.id)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [params.id]);
  async function status(value: string) {
    setBusy(true);
    try {
      await requestJson("/api/projects/" + params.id, {
        method: "PATCH",
        body: JSON.stringify({ status: value }),
      });
      setData(await requestJson("/api/projects/" + params.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return error ? <p className="error-box">{error}</p> : <LoadingSkeleton />;
  const p = data.project;
  return (
    <>
      <PageHeader
        eyebrow={p.code}
        title={p.name}
        description={
          p.client.companyName +
          (p.consultant ? " · " + p.consultant.companyName : "")
        }
      >
        <Link className="btn-secondary" href={"/boq?projectId=" + p.id}>
          Open BOQ
        </Link>
        <Link className="btn-primary" href={"/quotations?projectId=" + p.id}>
          Quotations
        </Link>
      </PageHeader>
      {error && <p className="error-box">{error}</p>}
      <div className="workflow mb-6">
        {stages
          .filter((s) => !["LOST", "CANCELLED"].includes(s))
          .map((s) => (
            <span className={p.status === s ? "current" : ""} key={s}>
              {s.replaceAll("_", " ")}
            </span>
          ))}
      </div>
      <div className="grid md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Client"
          value={<span className="text-base">{p.client.companyName}</span>}
        />
        <StatCard
          label="Submission deadline"
          value={
            <span className="text-base">
              {p.tenderDeadline
                ? new Date(p.tenderDeadline).toLocaleString()
                : "Not set"}
            </span>
          }
        />
        <StatCard
          label="BOQ items"
          value={p.boqs.reduce((n: number, b: any) => n + b._count.items, 0)}
        />
        <StatCard label="Panel assemblies" value={p._count.panels} />
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <section className="card space-y-4">
          <h2 className="font-semibold">Tender workspace</h2>
          <div className="flex gap-2 flex-wrap">
            <Link
              className="btn-secondary"
              href={"/documents?projectId=" + p.id}
            >
              Documents
            </Link>
            <Link className="btn-secondary" href="/panels">
              Panels
            </Link>
            <Link className="btn-secondary" href="/pricing">
              Supplier prices
            </Link>
            <Link className="btn-secondary" href="/costing">
              Costing
            </Link>
          </div>
          <label className="block">
            Project stage
            <select
              disabled={
                busy ||
                !hasPermission(session?.user.roles ?? [], "project.edit")
              }
              className="input"
              value={p.status}
              onChange={(e) => status(e.target.value)}
            >
              {stages.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <h3 className="font-medium">Bills of quantities</h3>
          {p.boqs.length ? (
            p.boqs.map((b: any) => (
              <Link
                className="block muted"
                key={b.id}
                href={"/boq?boqId=" + b.id}
              >
                {b.name} · {b._count.items} rows →
              </Link>
            ))
          ) : (
            <p className="muted">Upload your first BOQ to begin analysis.</p>
          )}
        </section>
        <section className="card">
          <h2 className="font-semibold mb-4">Quotations</h2>
          <DataTable headers={["Number", "Revision", "Status", "Value"]}>
            {data.quotes.map((q: any) => (
              <tr key={q.id}>
                <td>
                  <Link href={"/quotations/" + q.id}>{q.quoteNumber}</Link>
                </td>
                <td>{q.revision}</td>
                <td>
                  <StatusBadge status={q.status} />
                </td>
                <td>
                  {Number(q.totalSell).toLocaleString()} {q.currency}
                </td>
              </tr>
            ))}
          </DataTable>
        </section>
        <section className="card lg:col-span-2">
          <h2 className="font-semibold mb-4">Project activity</h2>
          {data.activity.map((a: any) => (
            <div
              key={a.id}
              className="flex gap-6 py-3 border-b"
              style={{ borderColor: "var(--border)" }}
            >
              <span className="muted text-xs">
                {new Date(a.createdAt).toLocaleString()}
              </span>
              <p className="text-sm">
                {a.action.replaceAll("_", " ")}{" "}
                <span className="muted">· {a.user?.name || "System"}</span>
              </p>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
