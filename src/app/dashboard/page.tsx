"use client";

import { useEffect, useState } from "react";

type Project = {
  id: string;
  code: string;
  name: string;
  status: string;
  currency: string;
  client: { companyName: string };
  tenderDeadline: string | null;
};

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? []))
      .finally(() => setLoading(false));
  }, []);

  const byStatus = projects.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {["NEW", "BOQ_ANALYSIS", "PRICING", "SUBMITTED"].map((status) => (
          <div key={status} className="card">
            <div className="text-xs uppercase text-slate-500">{status.replace("_", " ")}</div>
            <div className="mt-1 text-2xl font-semibold">{byStatus[status] ?? 0}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Projects</h2>
        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : projects.length === 0 ? (
          <p className="text-sm text-slate-500">No projects yet. Run the seed script to load the demo project.</p>
        ) : (
          <table className="data-table w-full">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Client</th>
                <th>Status</th>
                <th>Deadline</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>{p.code}</td>
                  <td>{p.name}</td>
                  <td>{p.client?.companyName}</td>
                  <td>{p.status}</td>
                  <td>{p.tenderDeadline ? new Date(p.tenderDeadline).toLocaleDateString() : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
