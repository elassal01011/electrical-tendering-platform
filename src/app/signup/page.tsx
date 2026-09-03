"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Brand } from "@/components/Brand";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { signupSchema } from "@/lib/auth/signupPolicy";
import { finishSignup } from "@/lib/client/signup";
export default function SignupPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [show, setShow] = useState(false),
    [password, setPassword] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [fields, setFields] = useState<Record<string, string[] | undefined>>(
    {},
  );
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    setFields({});
    const parsed = signupSchema.safeParse(
      Object.fromEntries(new FormData(e.currentTarget)),
    );
    if (!parsed.success) {
      setFields(parsed.error.flatten().fieldErrors);
      setError("Please check the highlighted fields.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const result = await response.json();
      if (!response.ok) {
        setFields(result.fields || {});
        throw new Error(result.error || "Unable to create your account.");
      }
      setNotice(
        result.pendingApproval
          ? result.message
          : "Account created successfully. Signing you in…",
      );
      const destination = await finishSignup(
        result,
        parsed.data.email,
        parsed.data.password,
        signIn,
      );
      router.replace(destination);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create your account. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-layout" id="main-content">
      <section className="login-brand-panel">
        <Brand />
        <div>
          <p className="eyebrow" style={{ color: "#9cbcdc" }}>
            YOUR NEXT PROJECT STARTS HERE
          </p>
          <h1>
            Built for engineers.
            <br />
            <span>Ready for your team.</span>
          </h1>
          <p className="mt-6 text-sm leading-7" style={{ color: "#a9bfd5" }}>
            Bring your tender analysis, component selection and commercial work
            into one connected workspace.
          </p>
        </div>
        <p className="login-caption">E-SOLUTIONS · TENDERING & ENGINEERING</p>
      </section>
      <section className="login-main">
        <form onSubmit={submit} className="space-y-4 w-full" aria-busy={busy}>
          <div>
            <p className="eyebrow">JOIN YOUR WORKSPACE</p>
            <h2>Create your account</h2>
            <p className="muted text-sm mt-2">
              Start working with E-SOLUTIONS.
            </p>
          </div>
          <GoogleButton disabled={busy} />
          <p className="muted text-xs text-center">
            or register with your email
          </p>
          {[
            ["name", "Full name", "text", "name"],
            ["username", "Username", "text", "username"],
            ["email", "Email", "email", "email"],
            [
              "password",
              "Password",
              show ? "text" : "password",
              "new-password",
            ],
            [
              "confirmPassword",
              "Confirm password",
              show ? "text" : "password",
              "new-password",
            ],
          ].map(([name, label, type, autocomplete]) => (
            <label className="block text-sm" key={name}>
              {label}
              <input
                className="input"
                required
                name={name}
                type={type}
                autoComplete={autocomplete}
                disabled={busy}
                maxLength={
                  name === "name"
                    ? 100
                    : name === "username"
                      ? 30
                      : name === "email"
                        ? 254
                        : 72
                }
                onChange={
                  name === "password"
                    ? (e) => setPassword(e.target.value)
                    : undefined
                }
                aria-invalid={!!fields[name]}
                aria-describedby={fields[name] ? `${name}-error` : undefined}
              />
              {fields[name] && (
                <span id={`${name}-error`} className="text-red-600 text-xs">
                  {fields[name]?.join(" ")}
                </span>
              )}
            </label>
          ))}
          <div className="flex items-center justify-between gap-4">
            <p className="muted text-xs" aria-live="polite">
              {password.length >= 12 ? "✓" : "○"} At least 12 characters
              <br />
              {new TextEncoder().encode(password).length <= 72 ? "✓" : "○"} At
              most 72 UTF-8 bytes
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShow(!show)}
              aria-pressed={show}
            >
              {show ? "Hide passwords" : "Show passwords"}
            </button>
          </div>
          {error && (
            <p className="error-box" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="success-box" role="status">
              {notice}
            </p>
          )}
          <button className="btn-primary w-full py-3" disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
          </button>
          <p className="text-center text-sm muted">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold">
              Sign in
            </Link>
          </p>
        </form>
      </section>
    </main>
  );
}
