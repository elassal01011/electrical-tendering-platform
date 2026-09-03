"use client";
import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { requestJson } from "@/lib/client/request";
import { PageHeader, LoadingSkeleton } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import type { getAccount } from "@/lib/auth/account";
type Profile = Awaited<ReturnType<typeof getAccount>>;
export default function Account() {
  const { update } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    requestJson("/api/account")
      .then(setProfile)
      .catch((e) => setError(e.message));
  }, []);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      setProfile(
        await requestJson("/api/account", {
          method: "PATCH",
          body: JSON.stringify(data),
        }),
      );
      await update();
      setNotice("Profile updated.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function change(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    if (data.get("newPassword") !== data.get("confirmation")) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
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
        title="Profile & security"
        description="Manage your personal details and sign-in methods."
      />
      {error && (
        <p role="alert" className="error-box mb-4">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="success-box mb-4">
          {notice}
        </p>
      )}
      {!profile ? (
        <LoadingSkeleton />
      ) : (
        <>
          <div className="card mb-6 flex flex-wrap items-center gap-6">
            <Avatar name={profile.name} image={profile.image} />
            <div>
              <h2 className="font-semibold">{profile.name}</h2>
              <p className="muted text-sm">{profile.email}</p>
              <p className="text-sm">
                @{profile.username || "Choose a username below"}
              </p>
            </div>
            <dl className="text-sm space-y-1">
              <div>
                <dt className="inline muted">Role: </dt>
                <dd className="inline">
                  {profile.roles.map((r) => r.role.name).join(", ")}
                </dd>
              </div>
              <div>
                <dt className="inline muted">Status: </dt>
                <dd className="inline">
                  {profile.active ? "Active" : "Inactive"}
                </dd>
              </div>
              <div>
                <dt className="inline muted">Sign-in method: </dt>
                <dd className="inline">{profile.authMethod}</dd>
              </div>
            </dl>
          </div>
          <div className="grid lg:grid-cols-2 gap-6">
            <form
              className="card space-y-4"
              onSubmit={save}
              key={profile.username}
            >
              <h2 className="font-semibold">Personal details</h2>
              <label className="block">
                Full name
                <input
                  className="input"
                  name="name"
                  required
                  minLength={2}
                  maxLength={100}
                  defaultValue={profile.name}
                  disabled={busy}
                />
              </label>
              <label className="block">
                Username
                <input
                  className="input"
                  name="username"
                  required
                  minLength={3}
                  maxLength={30}
                  pattern="[A-Za-z0-9_.]+"
                  defaultValue={profile.username || ""}
                  disabled={busy}
                />
              </label>
              <p className="muted text-xs">
                Use 3�30 letters, numbers, underscores or dots.
              </p>
              <button disabled={busy} className="btn-primary">
                {busy ? "Saving�" : "Save profile"}
              </button>
            </form>
            <form className="card space-y-4" onSubmit={change}>
              <h2 className="font-semibold">
                {profile.hasPassword
                  ? "Change password"
                  : "Set a local password"}
              </h2>
              <p className="muted text-sm">
                Use at least 12 characters and no more than 72 UTF-8 bytes. You
                will sign in again after saving.
              </p>
              {!profile.hasPassword && (
                <p className="notice">
                  You currently sign in with Google. You can also set a password
                  to sign in with your email or username.
                </p>
              )}
              {(profile.hasPassword
                ? [
                    ["currentPassword", "Current password"],
                    ["newPassword", "New password"],
                    ["confirmation", "Confirm new password"],
                  ]
                : [
                    ["newPassword", "New password"],
                    ["confirmation", "Confirm new password"],
                  ]
              ).map(([name, label]) => (
                <label className="block" key={name}>
                  {label}
                  <input
                    className="input"
                    name={name}
                    type="password"
                    required
                    minLength={name === "currentPassword" ? 1 : 12}
                    maxLength={72}
                    disabled={busy}
                    autoComplete={
                      name === "currentPassword"
                        ? "current-password"
                        : "new-password"
                    }
                  />
                </label>
              ))}
              <button disabled={busy} className="btn-primary">
                {busy
                  ? "Saving�"
                  : profile.hasPassword
                    ? "Change password"
                    : "Set password"}
              </button>
            </form>
          </div>
        </>
      )}
    </>
  );
}
