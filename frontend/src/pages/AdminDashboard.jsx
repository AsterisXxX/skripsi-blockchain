import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getInstitutions,
  getUsers,
  getAuditLogs,
  suspendUser,
  reactivateUser,
  revokeUserRole,
  assignUserRole,
} from "../services/adminApi";
export default function AdminDashboard() {
  const [institutions, setInstitutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState("");

  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState("");

  const [actionUserId, setActionUserId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const [roleActionUserId, setRoleActionUserId] = useState(null);
  const [roleActionError, setRoleActionError] = useState("");
  const [roleActionMessage, setRoleActionMessage] = useState("");

  useEffect(() => {
    let active = true;

    getInstitutions()
      .then((data) => {
        if (active) {
          setInstitutions(data.institutions);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    getUsers()
      .then((data) => {
        if (active) {
          setUsers(data.users);
        }
      })
      .catch((err) => {
        if (active) {
          setUsersError(err.message);
        }
      })
      .finally(() => {
        if (active) {
          setUsersLoading(false);
        }
      });

    getAuditLogs()
      .then((data) => {
        if (active) {
          setAuditLogs(data.logs);
        }
      })
      .catch((err) => {
        if (active) {
          setAuditError(err.message);
        }
      })
      .finally(() => {
        if (active) {
          setAuditLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleUserStatus(user) {
    if (actionUserId) return;

    const isSuspending = user.status === "active";

    const confirmed = window.confirm(
      isSuspending
        ? `Suspend akun ${user.username}? Session aktifnya akan dibatalkan.`
        : `Aktifkan kembali akun ${user.username}?`,
    );

    if (!confirmed) return;

    setActionUserId(user.id);
    setActionError("");
    setActionMessage("");

    try {
      if (isSuspending) {
        await suspendUser(user.id);
      } else {
        await reactivateUser(user.id);
      }

      const latestUsers = await getUsers();
      setUsers(latestUsers.users);
      setUsersError("");

      const latestAudit = await getAuditLogs();
      setAuditLogs(latestAudit.logs);
      setAuditError("");

      setActionMessage(
        isSuspending
          ? `${user.username} berhasil disuspend.`
          : `${user.username} berhasil diaktifkan kembali.`,
      );
    } catch (err) {
      setActionError(err.message || "Operasi gagal.");

      try {
        const latestUsers = await getUsers();
        setUsers(latestUsers.users);
      } catch {
        setUsersError("Gagal memperbarui daftar pengguna.");
      }
    } finally {
      setActionUserId(null);
    }
  }

  async function handleRoleAction(user) {
    if (roleActionUserId || actionUserId) return;

    const hasRole = Boolean(user.roles);
    const action = hasRole ? "cabut" : "berikan kembali";

    const confirmed = window.confirm(
      `Yakin ingin ${action} role untuk ${user.username}?`,
    );

    if (!confirmed) return;

    setRoleActionUserId(user.id);
    setRoleActionError("");
    setRoleActionMessage("");

    try {
      if (hasRole) {
        await revokeUserRole(user.id);
      } else {
        await assignUserRole(user.id);
      }

      const latestUsers = await getUsers();
      setUsers(latestUsers.users);
      setUsersError("");

      const latestAudit = await getAuditLogs();
      setAuditLogs(latestAudit.logs);
      setAuditError("");

      setRoleActionMessage(
        hasRole
          ? `Role ${user.username} berhasil dicabut.`
          : `Role ${user.username} berhasil diberikan kembali.`,
      );
    } catch (err) {
      setRoleActionError(err.message || "Operasi role gagal.");

      try {
        const latestUsers = await getUsers();
        setUsers(latestUsers.users);
      } catch {
        setUsersError("Gagal memperbarui daftar pengguna.");
      }
    } finally {
      setRoleActionUserId(null);
    }
  }

  return (
    <section className="panel admin-dashboard">
      <Link to="/" className="back-link">
        ← Kembali ke Beranda
      </Link>

      <h2>NexusMed — Consortium Authority</h2>

      <p className="muted">
        Panel administrasi konsorsium untuk mengelola institusi, pengguna, dan
        hak akses.
      </p>

      <h3>Institution Registry</h3>

      {loading && <p className="muted">Memuat data institusi...</p>}

      {error && (
        <div className="result error" role="alert">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <p className="muted">Total institusi: {institutions.length}</p>

          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Institusi</th>
                  <th>MSP</th>
                  <th>Status</th>
                  <th>Kirim</th>
                  <th>Terima</th>
                </tr>
              </thead>
              <tbody>
                {institutions.map((institution) => (
                  <tr key={institution.id}>
                    <td>{institution.name}</td>
                    <td>{institution.msp_id}</td>
                    <td>{institution.status}</td>
                    <td>{institution.can_send ? "Ya" : "Tidak"}</td>
                    <td>{institution.can_receive ? "Ya" : "Tidak"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="portal-grid admin-grid">
        <div className="portal-card">
          <h3>User Management</h3>

          {usersLoading && <p>Memuat data pengguna...</p>}

          {usersError && <p role="alert">{usersError}</p>}

          {actionError && (
            <div className="result error" role="alert">
              {actionError}
            </div>
          )}

          {actionMessage && <p role="status">{actionMessage}</p>}

          {!usersLoading && !usersError && (
            <>
              <p>Total pengguna: {users.length}</p>

              {users.map((user) => (
                <div
                  key={user.id}
                  style={{
                    borderBottom: "1px solid #ccc",
                    paddingBottom: "12px",
                    marginBottom: "12px",
                  }}
                >
                  <strong>{user.username}</strong>
                  <p>Role: {user.roles || "Belum ada"}</p>
                  <p>Institusi: {user.institution_id || "Konsorsium"}</p>
                  <p>Status: {user.status}</p>

                  {user.institution_id &&
                    ["active", "suspended"].includes(user.status) && (
                      <button
                        type="button"
                        disabled={actionUserId !== null}
                        onClick={() => handleUserStatus(user)}
                      >
                        {actionUserId === user.id
                          ? "Memproses..."
                          : user.status === "active"
                            ? "Suspend User"
                            : "Reactivate User"}
                      </button>
                    )}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="portal-card">
          <h3>Role Management</h3>

          <p className="muted">
            Pemberian dan pencabutan role pengguna institusi.
          </p>

          {roleActionError && (
            <div className="result error" role="alert">
              {roleActionError}
            </div>
          )}

          {roleActionMessage && <p role="status">{roleActionMessage}</p>}

          {usersLoading && <p>Memuat data role...</p>}

          {!usersLoading &&
            !usersError &&
            users
              .filter((user) => ["org1", "org2"].includes(user.institution_id))
              .map((user) => (
                <div
                  key={user.id}
                  style={{
                    borderBottom: "1px solid #ccc",
                    paddingBottom: "12px",
                    marginBottom: "12px",
                  }}
                >
                  <strong>{user.username}</strong>

                  <p>Role: {user.roles || "Tidak ada role aktif"}</p>

                  <p>Institusi: {user.institution_id}</p>
                  <p>Status: {user.status}</p>

                  <button
                    type="button"
                    disabled={
                      user.status !== "active" ||
                      roleActionUserId !== null ||
                      actionUserId !== null
                    }
                    onClick={() => handleRoleAction(user)}
                  >
                    {roleActionUserId === user.id
                      ? "Memproses..."
                      : user.roles
                        ? "Revoke Role"
                        : "Assign Role"}
                  </button>
                </div>
              ))}
        </div>

        <div className="portal-card">
          <h3>Audit Logs</h3>

          {auditLoading && <p className="muted">Memuat audit logs...</p>}

          {auditError && <p role="alert">{auditError}</p>}

          {!auditLoading && !auditError && (
            <>
              <p>Total event: {auditLogs.length}</p>

              {auditLogs.length === 0 && (
                <p className="muted">Belum ada aktivitas tercatat.</p>
              )}

              {auditLogs.map((log) => (
                <div key={log.id}>
                  <strong>{log.action}</strong>
                  <p>Actor: {log.actor}</p>
                  <p>Result: {log.result}</p>
                  <p>Waktu: {log.createdAt}</p>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <p className="muted small-note">
        Data institusi dibaca dari SQLite melalui Admin API. Administrator tidak
        memiliki akses otomatis ke private key E2EE ataupun konfigurasi Fabric.
      </p>
    </section>
  );
}
