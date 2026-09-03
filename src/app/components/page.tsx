import { EntityManager } from "@/components/EntityManager";
export default function Page() {
  return (
    <EntityManager
      title="Component catalog"
      description="Verified specifications for safe preliminary component selection."
      endpoint="/api/components"
      resultKey="components"
      permission="catalog.edit"
      defaults={{ listPriceCurrency: "EGP" }}
      fields={[
        { key: "manufacturer", label: "Manufacturer", required: true },
        { key: "partNumber", label: "Part number", required: true },
        { key: "description", label: "Description", required: true },
        {
          key: "category",
          label: "Category",
          options: [
            "MCCB",
            "MCB",
            "ACB",
            "RCCB",
            "RCBO",
            "CONTACTOR",
            "OVERLOAD_RELAY",
            "SWITCH_DISCONNECTOR",
            "FUSE",
            "SPD",
            "METER",
            "CT",
            "VFD",
            "SOFT_STARTER",
            "TERMINAL_BLOCK",
            "BUSBAR",
            "ENCLOSURE",
            "OTHER",
          ].map((value) => ({ value, label: value })),
        },
        { key: "currentA", label: "Rated current (A)", type: "number" },
        { key: "voltageV", label: "Voltage (V)", type: "number" },
        { key: "poles", label: "Poles", type: "number" },
        {
          key: "breakingCapacityKA",
          label: "Breaking capacity (kA)",
          type: "number",
        },
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
  );
}
