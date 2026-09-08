"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { hasPermission } from "@/lib/auth/permissions";
import { requestJson } from "@/lib/client/request";
import {
  DataTable,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  PageHeader,
} from "./ui";
export type Field = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
};
export function EntityManager({
  title,
  description,
  endpoint,
  fields,
  columns,
  permission,
  defaults = {},
  resultKey = "rows",
  refreshKey = 0,
  headerActions,
  addLabel = "+ Add record",
  searchPlaceholder = "Search…",
  summaryCards = [],
}: {
  title: string;
  description: string;
  endpoint: string;
  fields: Field[];
  columns: { key: string; label: string }[];
  permission: string;
  defaults?: Record<string, unknown>;
  resultKey?: string;
  refreshKey?: number;
  headerActions?: ReactNode;
  addLabel?: string;
  searchPlaceholder?: string;
  summaryCards?: { key: string; label: string }[];
}) {
  const [rows, setRows] = useState<Record<string, any>[]>([]),
    [q, setQ] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [summary, setSummary] = useState<Record<string, unknown>>({});
  const { data: session } = useSession();
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      requestJson(
        endpoint +
          (endpoint.includes("?") ? "&" : "?") +
          "q=" +
          encodeURIComponent(q),
        { signal: controller.signal },
      )
        .then((d) => {
          setRows(d[resultKey] ?? []);
          setSummary(d.summary ?? {});
          setError("");
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [endpoint, q, resultKey, refreshKey]);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = e.currentTarget;
    const data: Record<string, unknown> = { ...defaults };
    const fd = new FormData(form);
    fields.forEach((f) => {
      const value = String(fd.get(f.key) ?? "");
      if (value) data[f.key] = f.type === "number" ? Number(value) : value;
    });
    try {
      await requestJson(endpoint, {
        method: "POST",
        body: JSON.stringify(data),
      });
      const result = await requestJson(endpoint);
      setRows(result[resultKey] ?? []);
      setSummary(result.summary ?? {});
      setCreating(false);
      setNotice("Saved successfully.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader eyebrow="WORKSPACE" title={title} description={description}>
        {headerActions}
        {hasPermission(session?.user.roles ?? [], permission) && (
          <button
            className="btn-primary"
            onClick={() => setCreating(!creating)}
          >
            {creating ? "Close form" : addLabel}
          </button>
        )}
      </PageHeader>
      {!!summaryCards.length && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {summaryCards.map((card) => (
            <div className="card" key={card.key}>
              <p className="muted text-xs">{card.label}</p>
              <p className="text-2xl font-semibold">
                {String(summary[card.key] ?? 0)}
              </p>
            </div>
          ))}
        </div>
      )}
      {error && <ErrorState message={error} />}
      {notice && (
        <p role="status" className="success-box mb-4">
          {notice}
        </p>
      )}
      {creating && (
        <form onSubmit={save} className="card mb-5">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {fields.map((f) => (
              <label key={f.key}>
                {f.label}
                {f.options ? (
                  <select name={f.key} required={f.required} className="input">
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    name={f.key}
                    className="input"
                    type={f.type || "text"}
                    required={f.required}
                    step={f.type === "number" ? "any" : undefined}
                    defaultValue={String(defaults[f.key] ?? "")}
                  />
                )}
              </label>
            ))}
          </div>
          <button className="btn-primary mt-5" disabled={busy}>
            {busy ? "Saving…" : "Save record"}
          </button>
        </form>
      )}
      <div className="card">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-semibold">{title} directory</h2>
          <input
            className="input max-w-xs"
            aria-label={"Search " + title}
            placeholder={searchPlaceholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {loading ? (
          <LoadingSkeleton />
        ) : !rows.length ? (
          <EmptyState
            title={"No " + title.toLowerCase() + " yet."}
            detail="Add a record to start building your workspace."
          />
        ) : (
          <>
            <DataTable headers={columns.map((c) => c.label)}>
              {rows.map((r, i) => (
                <tr key={r.id ?? i}>
                  {columns.map((c) => (
                    <td key={c.key}>
                      {String(
                        c.key.split(".").reduce((v, k) => v?.[k], r) ?? "—",
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </DataTable>
            <p className="muted mt-3 text-xs">
              Showing up to 100 records. Refine search to find a specific
              record.
            </p>
          </>
        )}
      </div>
    </>
  );
}
