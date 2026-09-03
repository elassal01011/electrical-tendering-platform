"use client";
import { use } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { hasPermission } from "@/lib/auth/permissions";
import { requestJson } from "@/lib/client/request";
import { PageHeader, LoadingSkeleton, DataTable } from "@/components/ui";
import { QuotationDocument } from "@/components/quotes/QuotationDocument";
import { QuoteBuilder } from "@/components/quotes/QuoteBuilder";
export default function Quote({
  params: routeParams,
}: {
  params: Promise<{ id: string }>;
}) {
  const params = use(routeParams);
  const router = useRouter(),
    { data: session } = useSession();
  const [data, setData] = useState<any>(null),
    [internal, setInternal] = useState(false),
    [edit, setEdit] = useState(false),
    [busy, setBusy] = useState(false),
    [comment, setComment] = useState(""),
    [error, setError] = useState("");
  const can = (p: string) => hasPermission(session?.user.roles ?? [], p);
  async function load() {
    const d = await requestJson(
      "/api/quotes/" + params.id + (internal ? "?view=internal" : ""),
    );
    setData(d);
  }
  useEffect(() => {
    setData(null);
    load().catch((e) => setError(e.message));
  }, [params.id, internal]);
  async function action(action: string) {
    setBusy(true);
    setError("");
    try {
      if (action === "revise") {
        const d = await requestJson("/api/quotes/" + params.id, {
          method: "POST",
        });
        router.push("/quotations/" + d.quote.id);
      } else {
        await requestJson("/api/quotes/" + params.id + "/approve", {
          method: "POST",
          body: JSON.stringify({ action, comment }),
        });
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return error ? <p className="error-box">{error}</p> : <LoadingSkeleton />;
  const q = data.quote;
  return (
    <>
      <div className="no-print">
        <PageHeader
          eyebrow="COMMERCIAL QUOTATION"
          title={q.quoteNumber + " · Revision " + q.revision}
          description="Customer documents contain commercial selling prices only."
        >
          <button
            className="btn-secondary"
            disabled={internal}
            onClick={() => window.print()}
          >
            Print / Save PDF
          </button>
          <a
            className="btn-secondary"
            href={
              "/api/quotes/" +
              q.id +
              "/export" +
              (internal ? "?view=internal" : "")
            }
          >
            Export Excel
          </a>
          {can("quote.cost.view") && (
            <button
              className="btn-secondary"
              onClick={() => {
                setEdit(false);
                setInternal(!internal);
              }}
            >
              {internal ? "Customer quotation" : "Internal cost view"}
            </button>
          )}
        </PageHeader>
        {error && (
          <p className="error-box mb-4" role="alert">
            {error}
          </p>
        )}
        <div className="card mb-5 space-y-3">
          <div className="flex gap-2 flex-wrap">
            {q.status === "DRAFT" && can("quote.submit") && (
              <button
                disabled={busy}
                className="btn-primary"
                onClick={() => action("submit")}
              >
                Submit for approval
              </button>
            )}
            {q.status === "DRAFT" && internal && can("quote.create") && (
              <button className="btn-secondary" onClick={() => setEdit(!edit)}>
                Edit draft
              </button>
            )}
            {can("quote.create") && can("quote.cost.view") && (
              <button
                disabled={busy}
                className="btn-secondary"
                onClick={() => action("revise")}
              >
                Create new revision
              </button>
            )}
            {q.status === "INTERNAL_REVIEW" &&
              can("quote.approve") &&
              ["approve", "changes", "reject"].map((a) => (
                <button
                  disabled={busy}
                  key={a}
                  className={a === "approve" ? "btn-primary" : "btn-secondary"}
                  onClick={() => action(a)}
                >
                  {a === "changes"
                    ? "Request changes"
                    : a === "approve"
                      ? "Approve"
                      : "Reject"}
                </button>
              ))}
            {q.status === "APPROVED" && can("quote.send") && (
              <button
                disabled={busy}
                className="btn-primary"
                onClick={() => action("send")}
              >
                Mark as submitted
              </button>
            )}
          </div>
          {q.status === "INTERNAL_REVIEW" && can("quote.approve") && (
            <label className="block">
              Decision comment
              <input
                className="input"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Required for rejection, changes, or low-margin override"
              />
            </label>
          )}
          <p className="muted text-xs">
            Approved quotations are immutable. A new revision starts as a draft
            and requires fresh approval.
          </p>
          <div className="flex gap-3 text-xs">
            {data.revisions.map((r: any) => (
              <Link key={r.id} href={"/quotations/" + r.id}>
                Rev {r.revision} · {Number(r.totalSell).toLocaleString()}{" "}
                {q.currency}
              </Link>
            ))}
          </div>
        </div>
      </div>
      {edit ? (
        <QuoteBuilder
          initial={q}
          onCancel={() => {
            setEdit(false);
            load();
          }}
        />
      ) : internal ? (
        <section className="card no-print">
          <h2 className="font-semibold mb-4">
            Internal cost sheet · Confidential
          </h2>
          <DataTable
            headers={[
              "Description",
              "Qty",
              "Unit cost",
              "Total cost",
              "Unit sell",
              "Line sell",
            ]}
          >
            {q.items.map((i: any) => (
              <tr key={i.id}>
                <td>{i.description}</td>
                <td>{Number(i.quantity)}</td>
                <td>{Number(i.unitCost).toFixed(2)}</td>
                <td>{(Number(i.quantity) * Number(i.unitCost)).toFixed(2)}</td>
                <td>{Number(i.unitSell).toFixed(2)}</td>
                <td>{Number(i.lineTotal).toFixed(2)}</td>
              </tr>
            ))}
          </DataTable>
          <div className="grid grid-cols-3 gap-4 mt-6">
            {[
              ["Total cost", data.totals.totalCost],
              ["Gross profit", data.totals.profit],
              ["Gross margin %", data.totals.marginPct],
            ].map(([k, v]) => (
              <div key={k}>
                <p className="muted text-xs">{k}</p>
                <strong className="text-xl">
                  {Number(v).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <QuotationDocument quote={q} totals={data.totals} />
      )}
    </>
  );
}
