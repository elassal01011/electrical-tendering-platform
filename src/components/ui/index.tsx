import Link from "next/link";
export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="muted mt-1 text-sm">{description}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </header>
  );
}
export function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
}) {
  return (
    <div className="card metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small className="muted">{detail}</small>}
    </div>
  );
}
export function EmptyState({
  title,
  detail,
  href,
  action,
}: {
  title: string;
  detail?: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">◇</div>
      <h3>{title}</h3>
      <p className="muted text-sm">{detail}</p>
      {href && (
        <Link className="btn-primary mt-4 inline-block" href={href}>
          {action}
        </Link>
      )}
    </div>
  );
}
export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={
        "badge " +
        (/APPROVED|WON|MATCHED|ACCEPTED/.test(status)
          ? "badge-success"
          : /REJECTED|LOST/.test(status)
            ? "badge-danger"
            : /REVIEW|SUGGESTED/.test(status)
              ? "badge-warning"
              : "")
      }
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}
export function LoadingSkeleton() {
  return (
    <div role="status" aria-label="Loading content" className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="skeleton h-20 rounded-lg" />
      ))}
    </div>
  );
}
export function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert" className="error-box">
      {message}
    </div>
  );
}
export function DataTable({
  headers,
  children,
}: {
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
