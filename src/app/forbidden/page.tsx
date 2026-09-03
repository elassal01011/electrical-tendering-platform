import Link from "next/link";
export default function Forbidden() {
  return (
    <div className="empty-state">
      <p className="eyebrow">403 · ACCESS RESTRICTED</p>
      <h1 className="text-2xl font-semibold">
        You do not have access to this workspace.
      </h1>
      <p className="muted my-4">
        Contact your administrator if you need a different role.
      </p>
      <Link className="btn-primary" href="/account">
        Open your account
      </Link>
    </div>
  );
}
