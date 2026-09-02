"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@tendering.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", { redirect: false, email, password });
    setLoading(false);
    if (res?.error) {
      setError("Invalid email or password.");
      return;
    }
    router.push("/dashboard");
  }

  return (
    <div className="mx-auto mt-24 max-w-sm">
      <div className="card">
        <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
        <p className="mb-4 text-sm text-slate-400">Electrical Tendering & CPQ Platform</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button className="btn-primary w-full" disabled={loading} type="submit">
            {loading ? "Signing in..." : "Sign in"}
          </button>
          <p className="text-xs text-slate-500">Seeded admin password: see README.md / prisma/seed.ts</p>
        </form>
      </div>
    </div>
  );
}
