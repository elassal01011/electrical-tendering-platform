"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty-state">
      <h1 className="text-2xl font-semibold">Something went wrong.</h1>
      <p className="muted my-4">
        Please retry. If the problem continues, contact your administrator.
      </p>
      <button className="btn-primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
