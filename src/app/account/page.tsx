"use client";
import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { requestJson } from "@/lib/client/request";
import { PageHeader } from "@/components/ui";
export default function Account() {
  const { data: session } = useSession();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function change(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    if (data.get("newPassword") !== data.get("confirmation")) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/account/password", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(data)),
      });
      await signOut({ callbackUrl: "/login" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="YOUR ACCOUNT"
        title={session?.user.name || "Profile"}
        description={session?.user.email || ""}
      />
      <form className="card max-w-lg space-y-4" onSubmit={change}>
        <h2 className="font-semibold">Change password</h2>
        <p className="muted text-sm">
          Use 12–72 characters. You will sign in again after saving.
        </p>
        {[
          ["currentPassword", "Current password"],
          ["newPassword", "New password"],
          ["confirmation", "Confirm new password"],
        ].map(([name, label]) => (
          <label className="block" key={name}>
            {label}
            <input
              className="input"
              name={name}
              type="password"
              required
              minLength={name === "currentPassword" ? 1 : 12}
              maxLength={72}
              autoComplete={
                name === "currentPassword" ? "current-password" : "new-password"
              }
            />
          </label>
        ))}
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        <button disabled={busy} className="btn-primary">
          {busy ? "Saving…" : "Change password"}
        </button>
      </form>
    </>
  );
}
