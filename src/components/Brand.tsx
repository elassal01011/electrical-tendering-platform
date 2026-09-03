"use client";
import { createContext, useContext, useEffect, useState } from "react";
const defaults = {
  companyName: "E-SOLUTIONS",
  productName: "E-SOLUTIONS Tendering",
  logo: null as string | null,
};
const BrandContext = createContext(defaults);
export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brand, setBrand] = useState(defaults);
  useEffect(() => {
    const load = () =>
      fetch("/api/company")
        .then((r) => (r.ok ? r.json() : defaults))
        .then(setBrand)
        .catch(() => {});
    load();
    window.addEventListener("company-updated", load);
    return () => window.removeEventListener("company-updated", load);
  }, []);
  useEffect(() => {
    document.title = brand.productName;
  }, [brand]);
  return (
    <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>
  );
}
export function useBrand() {
  return useContext(BrandContext);
}
export function Brand({ compact = false }: { compact?: boolean }) {
  const b = useBrand();
  return (
    <div className="brand">
      {b.logo ? (
        <img src={b.logo} alt={b.companyName} className="brand-logo" />
      ) : (
        <span className="monogram" aria-hidden="true">
          E<span>∕</span>
        </span>
      )}
      {!compact && (
        <div>
          <strong>{b.companyName}</strong>
          <small>Tendering & Engineering</small>
        </div>
      )}
    </div>
  );
}
