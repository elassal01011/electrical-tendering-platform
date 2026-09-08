"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { hasPermission } from "@/lib/auth/permissions";
import { EntityManager } from "@/components/EntityManager";
import { ComponentUpload } from "./ComponentUpload";

const categories = [
  "MCCB", "MCB", "ACB", "RCCB", "RCBO", "CONTACTOR", "OVERLOAD_RELAY",
  "SWITCH_DISCONNECTOR", "FUSE", "SPD", "METER", "CT", "VFD", "SOFT_STARTER",
  "TERMINAL_BLOCK", "BUSBAR", "ENCLOSURE", "OTHER",
];
export function ComponentCatalogPage() {
  const { data: session } = useSession();
  const [upload, setUpload] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <>
      {upload && (
        <div className="mb-5">
          <ComponentUpload
            close={() => setUpload(false)}
            completed={() => {
              setUpload(false);
              setRefreshKey((value) => value + 1);
            }}
          />
        </div>
      )}
      <EntityManager
        title="Component Catalog"
        description="Verified specifications for safe preliminary component selection."
        endpoint="/api/components"
        resultKey="components"
        permission="catalog.edit"
        refreshKey={refreshKey}
        addLabel="+ Add Component"
        searchPlaceholder="Search Components..."
        headerActions={hasPermission(session?.user.roles ?? [], "catalog.edit") ? (
          <button className="btn-secondary" onClick={() => setUpload((value) => !value)}>
            {upload ? "Close Upload" : "Upload Excel"}
          </button>
        ) : null}
        summaryCards={[
          { key: "totalComponents", label: "Total Components" },
          { key: "manufacturers", label: "Manufacturers" },
          { key: "categories", label: "Categories" },
          { key: "verifiedComponents", label: "Verified Components" },
          { key: "needsReview", label: "Needs Review" },
        ]}
        defaults={{ listPriceCurrency: "EGP" }}
        fields={[
          { key: "manufacturer", label: "Manufacturer", required: true },
          { key: "partNumber", label: "Part number", required: true },
          { key: "description", label: "Description", required: true },
          { key: "category", label: "Category", options: categories.map((value) => ({ value, label: value })) },
          { key: "currentA", label: "Rated current (A)", type: "number" },
          { key: "voltageV", label: "Voltage (V)", type: "number" },
          { key: "poles", label: "Poles", type: "number" },
          { key: "breakingCapacityKA", label: "Breaking capacity (kA)", type: "number" },
          { key: "listPrice", label: "List price", type: "number" },
          { key: "listPriceCurrency", label: "Currency" },
        ]}
        columns={[
          { key: "manufacturer", label: "Manufacturer" },
          { key: "partNumber", label: "Part number" },
          { key: "description", label: "Description" },
          { key: "currentA", label: "Current A" },
          { key: "breakingCapacityKA", label: "kA" },
          { key: "listPrice", label: "List price" },
          { key: "listPriceCurrency", label: "Currency" },
        ]}
      />
    </>
  );
}
