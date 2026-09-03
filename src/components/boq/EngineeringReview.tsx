"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/client/request";
import { StatusBadge } from "@/components/ui";
export function EngineeringReview({
  itemId,
  onClose,
  onSaved,
}: {
  itemId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<any>(null),
    [q, setQ] = useState(""),
    [notes, setNotes] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    const t = setTimeout(
      () =>
        requestJson(
          "/api/boq/items/" + itemId + "?q=" + encodeURIComponent(q),
          { signal: c.signal },
        )
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
  }, [q, itemId]);
  async function select(id: string) {
    setBusy(true);
    try {
      await requestJson("/api/boq/items/" + itemId, {
        method: "PATCH",
        body: JSON.stringify({ componentId: id, notes }),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card space-y-4">
      <div className="flex justify-between">
        <h2 className="font-semibold">Engineering review</h2>
        <button className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="notice">
        Preliminary Selection — Requires Engineer Verification
      </p>
      {data && (
        <>
          <p>{data.item.rawDescription}</p>
          <pre className="muted text-xs whitespace-pre-wrap">
            {JSON.stringify(data.item.parsedSpec, null, 2)}
          </pre>
        </>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        <label>
          Search alternatives
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Part number or manufacturer"
          />
        </label>
        <label>
          Engineer verification notes
          <input
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Record your engineering assessment"
          />
        </label>
      </div>
      {error && <p className="error-box">{error}</p>}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Component</th>
              <th>Rating</th>
              <th>Confidence</th>
              <th>Safety checks</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {data?.candidates.map((c: any) => (
              <tr key={c.componentId}>
                <td>
                  {c.component.manufacturer}
                  <div className="font-semibold">{c.component.partNumber}</div>
                </td>
                <td>
                  {c.component.currentA || "?"} A · {c.component.poles || "?"} P
                  · {c.component.breakingCapacityKA || "?"} kA ·{" "}
                  {c.component.voltageV || "?"} V
                </td>
                <td>
                  <StatusBadge
                    status={
                      c.score >= 95
                        ? "EXCELLENT"
                        : c.score >= 80
                          ? "RECOMMENDED"
                          : c.score >= 60
                            ? "ENGINEER_REVIEW"
                            : "NO_MATCH"
                    }
                  />
                  <p className="text-xs mt-1">{c.score}%</p>
                </td>
                <td>
                  <details>
                    <summary>
                      {c.safe
                        ? "No rating shortfall detected"
                        : "Selection blocked"}
                    </summary>
                    <p className="text-xs">{c.reasons.join(" · ")}</p>
                  </details>
                </td>
                <td>
                  <button
                    className="btn-primary"
                    disabled={!c.safe || !notes.trim() || busy}
                    onClick={() => select(c.componentId)}
                  >
                    Verify & select
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
