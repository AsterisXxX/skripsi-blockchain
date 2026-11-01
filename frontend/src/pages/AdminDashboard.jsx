import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getInstitutions, getUsers, getAuditLogs } from "../services/adminApi";

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

  return (
    <section className="panel">
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

      <div className="portal-grid">
        <div className="portal-card">
          <h3>User Management</h3>

          {usersLoading && <p>Memuat data pengguna...</p>}

          {usersError && <p role="alert">{usersError}</p>}

          {!usersLoading && !usersError && (
            <>
              <p>Total pengguna: {users.length}</p>

              {users.map((user) => (
                <div key={user.id}>
                  <strong>{user.username}</strong>
                  <p>Role: {user.roles || "Belum ada"}</p>
                  <p>Institusi: {user.institution_id || "Konsorsium"}</p>
                  <p>Status: {user.status}</p>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="portal-card">
          <h3>Role Management</h3>
          <p>Pemberian dan pencabutan role pengguna.</p>
          <span>API belum tersedia</span>
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
