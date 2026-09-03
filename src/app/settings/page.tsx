"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/client/request";
import { DEFAULT_COMPANY } from "@/lib/companyDefaults";
import { PageHeader, LoadingSkeleton, ErrorState } from "@/components/ui";
const labels: Record<string, string> = {
  companyName: "Company name",
  productName: "Product name",
  email: "Email",
  phone: "Phone",
  website: "Website",
  address: "Address",
  taxNumber: "Tax number",
  commercialRegistration: "Commercial registration",
  currency: "Default currency",
  country: "Country",
  quotationPrefix: "Quotation prefix",
  minimumMarginPct: "Minimum gross margin (%)",
  vatPct: "Default VAT (%)",
};
export default function Settings() {
  const [company, setCompany] = useState({ ...DEFAULT_COMPANY }),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    requestJson("/api/settings")
      .then((d) => setCompany(d.company))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/settings", {
        method: "PUT",
        body: JSON.stringify(company),
      });
      window.dispatchEvent(new Event("company-updated"));
      setNotice("Company settings saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logo(file?: File) {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 280000
    ) {
      setError("Choose a PNG, JPEG or WebP logo below 280 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setCompany((c) => ({ ...c, logo: String(reader.result) }));
    reader.readAsDataURL(file);
  }
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Company settings"
        description="Your brand and commercial defaults, in one place."
      />
      {error && <ErrorState message={error} />}
      {notice && (
        <p className="success-box mb-5" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <LoadingSkeleton />
      ) : (
        <form className="card space-y-6" onSubmit={save}>
          <div>
            <h2 className="font-semibold">Brand identity</h2>
            <p className="muted text-sm mb-4">
              Logo appears in the workspace and new quotations.
            </p>
            {company.logo && (
              <img
                alt="Company logo"
                src={company.logo}
                className="h-16 mb-4 object-contain"
              />
            )}
            <label>
              Company logo
              <input
                className="input max-w-md"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => logo(e.target.files?.[0])}
              />
            </label>
            {company.logo && (
              <button
                type="button"
                className="btn-secondary mt-2"
                onClick={() => setCompany({ ...company, logo: null })}
              >
                Remove logo
              </button>
            )}
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {Object.entries(labels).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  className="input"
                  type={key.endsWith("Pct") ? "number" : "text"}
                  step="0.001"
                  value={String(company[key as keyof typeof company] ?? "")}
                  onChange={(e) =>
                    setCompany({
                      ...company,
                      [key]: key.endsWith("Pct")
                        ? Number(e.target.value)
                        : e.target.value,
                    })
                  }
                />
              </label>
            ))}
          </div>
          <button disabled={busy} className="btn-primary">
            {busy ? "Saving…" : "Save company settings"}
          </button>
        </form>
      )}
    </>
  );
}
