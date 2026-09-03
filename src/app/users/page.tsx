"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/client/request";
import { PageHeader, DataTable, LoadingSkeleton } from "@/components/ui";
import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";
export default function Users() {
  const [rows, setRows] = useState<any[] | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState<any>(null),
    [add, setAdd] = useState(false),
    [busy, setBusy] = useState(false);
  async function load() {
    setRows((await requestJson("/api/users")).rows);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = Object.fromEntries(new FormData(e.currentTarget));
      await requestJson("/api/users", {
        method: selected ? "PATCH" : "POST",
        body: JSON.stringify({
          ...data,
          ...(selected
            ? {
                id: selected.id,
                active: data.active === "true",
                password: data.password || undefined,
              }
            : {}),
        }),
      });
      setSelected(null);
      setAdd(false);
      await load();
      setNotice(
        "User access saved. Existing sessions are revoked when access changes.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Users"
        description="Manage team access, account status and password resets."
      >
        <button
          className="btn-primary"
          onClick={() => {
            setAdd(!add);
            setSelected(null);
          }}
        >
          + Add user
        </button>
      </PageHeader>
      {error && <p className="error-box mb-4">{error}</p>}
      {notice && (
        <p className="success-box mb-4" role="status">
          {notice}
        </p>
      )}
      {(add || selected) && (
        <form
          className="card mb-5 space-y-4"
          onSubmit={save}
          key={selected?.id || "new"}
        >
          <h2 className="font-semibold">
            {selected ? "Edit " + selected.name : "New team member"}
          </h2>
          <div className="grid md:grid-cols-3 gap-4">
            {!selected && (
              <>
                <label>
                  Name
                  <input required name="name" className="input" />
                </label>
                <label>
                  Email
                  <input required type="email" name="email" className="input" />
                </label>
              </>
            )}
            <label>
              {selected
                ? "Reset password (optional, 12–72 UTF-8 bytes)"
                : "Initial password (12–72 UTF-8 bytes)"}
              <input
                type="password"
                name="password"
                className="input"
                minLength={1}
                maxLength={72}
                required={!selected}
                autoComplete="new-password"
              />
            </label>
            <label>
              Role
              <select
                name="role"
                className="input"
                defaultValue={
                  selected?.roles[0]?.role.name || "TENDERING_ENGINEER"
                }
              >
                {Object.keys(ROLE_PERMISSIONS).map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            {selected && (
              <label>
                Account status
                <select
                  className="input"
                  name="active"
                  defaultValue={String(selected.active)}
                >
                  <option value="true">Active</option>
                  <option value="false">Disabled</option>
                </select>
              </label>
            )}
          </div>
          <button disabled={busy} className="btn-primary">
            Save user
          </button>
          <button
            type="button"
            className="btn-secondary ml-2"
            onClick={() => {
              setSelected(null);
              setAdd(false);
            }}
          >
            Cancel
          </button>
        </form>
      )}
      {!rows ? (
        <LoadingSkeleton />
      ) : (
        <div className="card">
          <DataTable headers={["Name", "Email", "Roles", "Status", ""]}>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.roles.map((r: any) => r.role.name).join(", ")}</td>
                <td>{u.active ? "Active" : "Disabled"}</td>
                <td>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setSelected(u);
                      setAdd(false);
                    }}
                  >
                    Edit access
                  </button>
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </>
  );
}
