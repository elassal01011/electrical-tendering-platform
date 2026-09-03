"use client";
import Link from "next/link";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [show, setShow] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [help, setHelp] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.has("pending"))
      setNotice(
        "Your E-SOLUTIONS account has been created and is awaiting administrator approval.",
      );
    else if (query.has("registered"))
      setNotice("Account created successfully. Please sign in.");
    if (query.has("error"))
      setError(
        "Unable to sign in. Check your account access or try another sign-in method.",
      );
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await signIn("credentials", {
        redirect: false,
        identifier: email.trim().toLowerCase(),
        password,
      });
      if (!result?.ok)
        setError(
          "Incorrect email or password, inactive account, or too many attempts. Please try again later or contact your administrator.",
        );
      else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError(
        "Unable to connect to the authentication service. Please try again.",
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
            PRECISION FROM TENDER TO DELIVERY
          </p>
          <h1>
            Engineering confidence.
            <br />
            <span>Commercial clarity.</span>
          </h1>
          <p
            className="mt-6 max-w-sm text-sm leading-7"
            style={{ color: "#a9bfd5" }}
          >
            One connected workspace for electrical tendering, panel engineering
            and confident commercial decisions.
          </p>
          <svg
            viewBox="0 0 400 130"
            className="engineering-lines"
            fill="none"
            stroke="currentColor"
          >
            <path d="M0 30h400M65 30v25m0 20v40h270V75m0-20V30M200 30v25m0 20v40M50 55h30v20H50zM185 55h30v20h-30zM320 55h30v20h-30z" />
            <circle cx="65" cy="30" r="4" />
            <circle cx="200" cy="30" r="4" />
            <circle cx="335" cy="30" r="4" />
          </svg>
          <div className="flex gap-6 text-xs" style={{ color: "#a9bfd5" }}>
            <span>Electrical Tendering</span>
            <span>CPQ</span>
            <span>Panel Engineering</span>
          </div>
        </div>
        <p className="login-caption">
          BUILT FOR ENGINEERING. DESIGNED FOR BUSINESS.
        </p>
      </section>
      <section className="login-main">
        <form onSubmit={submit} className="space-y-5" aria-busy={busy}>
          <div className="mb-8">
            <p className="eyebrow">YOUR WORKSPACE AWAITS</p>
            <h2>Welcome back</h2>
            <p className="muted mt-2 text-sm">
              Sign in to continue to your tendering workspace.
            </p>
          </div>
          <label className="block">
            Email or username
            <input
              className="input"
              type="text"
              autoComplete="username"
              required
              disabled={busy}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address or username"
            />
          </label>
          <label className="block">
            Password
            <div className="flex gap-2">
              <input
                className="input"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                required
                disabled={busy}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary mt-1"
                onClick={() => setShow(!show)}
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </label>
          <button
            type="button"
            className="text-sm muted"
            onClick={() => setHelp(!help)}
          >
            Forgot password?
          </button>
          {help && (
            <p className="notice">
              Contact your company administrator to reset your account password.
            </p>
          )}
          {notice && (
            <p className="success-box" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="error-box" role="alert">
              {error}
            </p>
          )}
          <button className="btn-primary w-full py-3" disabled={busy}>
            {busy ? "Signing in…" : "Sign in to workspace →"}
          </button>
          <GoogleButton disabled={busy} />
          <p className="text-center text-sm muted">
            New to E-SOLUTIONS?{" "}
            <Link href="/signup" className="font-semibold">
              Create account
            </Link>
          </p>
          <p className="muted pt-5 text-center text-xs">
            Secure access for your engineering and commercial teams.
          </p>
        </form>
      </section>
    </main>
  );
}
