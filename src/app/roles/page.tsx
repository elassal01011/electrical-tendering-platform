import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import { PageHeader, DataTable } from "@/components/ui";
export default function Roles() {
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Roles & permissions"
        description="Role policy is version controlled. Assign roles through User Management."
      />
      <div className="card">
        <DataTable headers={["Role", "Permission grants"]}>
          {Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => (
            <tr key={role}>
              <td>{role.replaceAll("_", " ")}</td>
              <td className="font-mono text-xs">
                {permissions.join(", ") || "No internal workspace access"}
              </td>
            </tr>
          ))}
        </DataTable>
      </div>
    </>
  );
}
