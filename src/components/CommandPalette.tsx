"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { hasPermission } from "@/lib/auth/permissions";
import { requestJson } from "@/lib/client/request";
export function CommandPalette({ close }: { close: () => void }) {
  const [q, setQ] = useState(""),
    [rows, setRows] = useState<
      { group: string; label: string; href: string }[]
    >([]),
    [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const { data: session } = useSession();
  useEffect(() => {
    const c = new AbortController();
    const timer = setTimeout(() => {
      if (q.length < 2) {
        setRows([]);
        return;
      }
      requestJson("/api/search?q=" + encodeURIComponent(q), {
        signal: c.signal,
      })
        .then((d) => {
          setRows(d.results);
          setError("");
        })
        .catch((e) => {
          if (!c.signal.aborted) setError(e.message);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [q]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    return () => previous?.focus();
  }, []);
  const actions = [
    ["Create project", "/projects", "project.create"],
    ["Upload BOQ", "/boq", "boq.import"],
    ["Create quotation", "/quotations", "quote.create"],
    ["Add supplier", "/suppliers", "supplier.edit"],
    ["Add component", "/components", "catalog.edit"],
    ["Open settings", "/settings", "settings.edit"],
  ]
    .filter(
      (a) =>
        hasPermission(session?.user.roles ?? [], a[2]) &&
        a[0].toLowerCase().includes(q.toLowerCase()),
    )
    .map((a) => ({ group: "Commands", label: a[0], href: a[1] }));
  return (
    <div className="modal-overlay" onClick={close}>
      <div
        ref={ref}
        className="command-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          const targets = Array.from(
            ref.current?.querySelectorAll<HTMLElement>("input,a,button") ?? [],
          );
          const index = targets.indexOf(document.activeElement as HTMLElement);
          if (["ArrowDown", "ArrowUp", "Tab"].includes(e.key)) {
            e.preventDefault();
            targets[
              (index +
                (e.key === "ArrowUp" || e.shiftKey ? -1 : 1) +
                targets.length) %
                targets.length
            ]?.focus();
          }
        }}
      >
        <header className="flex gap-2">
          <input
            autoFocus
            aria-label="Search workspace"
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a project, quotation, part number…"
          />
          <button className="btn-secondary" onClick={close}>
            Esc
          </button>
        </header>
        {error && <p className="error-box">{error}</p>}
        {[...rows, ...actions].map((r, i) => (
          <Link key={r.href + i} href={r.href} onClick={close}>
            <span>{r.label}</span>
            <small className="muted">{r.group}</small>
          </Link>
        ))}
        {q.length >= 2 && !rows.length && !actions.length && (
          <p className="empty-state muted">No results found.</p>
        )}
      </div>
    </div>
  );
}
