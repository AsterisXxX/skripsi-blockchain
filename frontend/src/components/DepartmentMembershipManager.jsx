import { useRef, useState } from "react";

import {
  assignDepartmentMembership,
  revokeDepartmentMembership,
} from "../services/adminApi";

function hasReceiverRole(roles) {
  return typeof roles === "string" &&
    roles.split(",").some(
      (role) => role.trim() === "referral_receiver"
    );
}

export default function DepartmentMembershipManager({
  users = [],
  departments = [],
  memberships = [],
  loading = false,
  error = "",
  onChanged,
}) {
  const [userId, setUserId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [refreshRequired, setRefreshRequired] = useState(false);

  // Prevent a second mutation before React processes the state update.
  const mutationInFlight = useRef(false);

  const eligibleUsers = users.filter(
    (user) =>
      user.status === "active" &&
      Boolean(user.institution_id) &&
      hasReceiverRole(user.roles)
  );

  const selectedUser = eligibleUsers.find(
    (user) => user.id === userId
  );

  const availableDepartments = departments.filter(
    (department) =>
      selectedUser &&
      department.institution_id === selectedUser.institution_id &&
      department.status === "active" &&
      !memberships.some(
        (membership) =>
          membership.user_id === selectedUser.id &&
          membership.department_id === department.id
      )
  );

  const selectedDepartmentValid = availableDepartments.some(
    (department) => department.id === departmentId
  );

  const blocked = Boolean(
    busyId ||
    refreshRequired ||
    loading ||
    error
  );

  async function refreshAfterMutation(successMessage) {
    // A successful write must never be silently retried.
    setRefreshRequired(true);
    setMessage(
      `${successMessage} Memperbarui daftar membership...`
    );

    try {
      if (typeof onChanged !== "function") {
        throw new Error("Refresh handler tidak tersedia.");
      }

      await onChanged();

      setUserId("");
      setDepartmentId("");
      setRefreshRequired(false);
      setMessage(successMessage);
    } catch {
      setMessage(
        `${successMessage} Namun data terbaru gagal dimuat. ` +
        "Muat ulang halaman sebelum melakukan perubahan lain."
      );
    }
  }

  async function handleAssign(event) {
    event.preventDefault();

    if (
      mutationInFlight.current ||
      blocked ||
      !selectedUser ||
      !selectedDepartmentValid
    ) {
      return;
    }

    mutationInFlight.current = true;
    setBusyId("assign");
    setActionError("");
    setMessage("");

    try {
      await assignDepartmentMembership({
        userId: selectedUser.id,
        departmentId,
      });

      await refreshAfterMutation(
        "Membership poli berhasil diberikan."
      );
    } catch (err) {
      setActionError(
        err.message || "Gagal memberikan membership poli."
      );
    } finally {
      mutationInFlight.current = false;
      setBusyId(null);
    }
  }

  async function handleRevoke(membership) {
    if (
      mutationInFlight.current ||
      blocked ||
      !membership.assignment_id
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Cabut akses poli ${membership.department_name} ` +
      `dari ${membership.username}? ` +
      "Pengguna tidak dapat lagi menerima rujukan " +
      "untuk poli ini setelah pencabutan."
    );

    if (!confirmed) return;

    mutationInFlight.current = true;
    setBusyId(membership.assignment_id);
    setActionError("");
    setMessage("");

    try {
      await revokeDepartmentMembership(
        membership.assignment_id
      );

      await refreshAfterMutation(
        "Membership poli berhasil dicabut."
      );
    } catch (err) {
      setActionError(
        err.message || "Gagal mencabut membership poli."
      );
    } finally {
      mutationInFlight.current = false;
      setBusyId(null);
    }
  }

  return (
    <section
      className="portal-card"
      aria-label="Department membership management"
      style={{ marginBottom: "24px" }}
    >
      <h3>Kelola Membership Poli</h3>

      <p className="muted">
        Berikan atau cabut akses staf penerima pada poli
        di institusinya. Semua perubahan divalidasi
        oleh backend dan dicatat dalam audit log.
      </p>

      {error && <p role="alert">{error}</p>}

      {actionError && (
        <div className="result error" role="alert">
          {actionError}
        </div>
      )}

      {message && <p role="status">{message}</p>}

      {refreshRequired && (
        <p className="muted">
          Operasi berikutnya dinonaktifkan sampai halaman
          dimuat ulang agar status membership tidak keliru.
        </p>
      )}

      <form onSubmit={handleAssign}>
        <div>
          <label htmlFor="membership-user">
            Staf Penerima
          </label>

          <select
            id="membership-user"
            value={userId}
            onChange={(event) => {
              setUserId(event.target.value);
              setDepartmentId("");
            }}
            disabled={blocked}
            required
          >
            <option value="">Pilih staf aktif</option>

            {eligibleUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.username} — {user.institution_id}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="membership-department">
            Poli Tujuan
          </label>

          <select
            id="membership-department"
            value={departmentId}
            onChange={(event) =>
              setDepartmentId(event.target.value)
            }
            disabled={blocked || !selectedUser}
            required
          >
            <option value="">Pilih poli tersedia</option>

            {availableDepartments.map((department) => (
              <option
                key={department.id}
                value={department.id}
              >
                {department.name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={
            blocked ||
            !selectedUser ||
            !selectedDepartmentValid
          }
        >
          {busyId === "assign"
            ? "Memberikan akses..."
            : "Assign Poli"}
        </button>
      </form>

      <h4>Membership Aktif</h4>

      {loading && (
        <p className="muted">Memuat membership...</p>
      )}

      {!loading && !error && (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Staf</th>
                <th>Institusi</th>
                <th>Poli</th>
                <th>Izin Efektif</th>
                <th>Aksi</th>
              </tr>
            </thead>

            <tbody>
              {memberships.map((membership) => (
                <tr key={membership.assignment_id}>
                  <td>{membership.username}</td>
                  <td>{membership.institution_id}</td>
                  <td>{membership.department_name}</td>

                  <td>
                    {membership.can_receive_referral
                      ? "Diizinkan"
                      : "Tidak diizinkan"}
                  </td>

                  <td>
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() =>
                        handleRevoke(membership)
                      }
                    >
                      {busyId === membership.assignment_id
                        ? "Mencabut..."
                        : "Revoke"}
                    </button>
                  </td>
                </tr>
              ))}

              {memberships.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    Belum ada membership aktif.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
