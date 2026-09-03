import { EntityManager } from "./EntityManager";
export function PartiesPage({
  type,
}: {
  type: "CLIENT" | "CONSULTANT" | "SUPPLIER";
}) {
  const title =
    type === "CLIENT"
      ? "Clients"
      : type === "CONSULTANT"
        ? "Consultants"
        : "Suppliers";
  return (
    <EntityManager
      title={title}
      description="Company contacts and commercial relationships."
      endpoint={"/api/parties?type=" + type}
      permission={type === "SUPPLIER" ? "supplier.edit" : "project.create"}
      defaults={{ type, preferredCurrency: "EGP" }}
      fields={[
        { key: "companyName", label: "Company name", required: true },
        { key: "contactName", label: "Contact name" },
        { key: "email", label: "Email", type: "email" },
        { key: "phone", label: "Phone" },
        { key: "address", label: "Address" },
        { key: "preferredCurrency", label: "Currency" },
        { key: "notes", label: "Notes" },
      ]}
      columns={[
        { key: "companyName", label: "Company" },
        { key: "contactName", label: "Contact" },
        { key: "email", label: "Email" },
        { key: "phone", label: "Phone" },
        { key: "preferredCurrency", label: "Currency" },
      ]}
    />
  );
}
