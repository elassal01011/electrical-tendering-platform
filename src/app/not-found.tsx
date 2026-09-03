import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty-state">
      <p className="eyebrow">404 · PAGE NOT FOUND</p>
      <h1 className="text-2xl font-semibold">We could not find that page.</h1>
      <Link className="btn-primary mt-5" href="/dashboard">
        Back to dashboard
      </Link>
    </div>
  );
}
