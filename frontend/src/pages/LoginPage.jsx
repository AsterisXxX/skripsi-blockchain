import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { login } from "../services/api";

export default function LoginPage({ onLogin }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const requestedRole = params.get("role");
  const defaultRole = requestedRole === "org2" ? "org2" : "org1";

  const [username, setUsername] = useState(defaultRole);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const result = await login(username, password);

      if (!result.user) {
        throw new Error("Backend tidak mengembalikan data user.");
      }

      onLogin(result.user);
      navigate(`/${result.user.role}`, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel auth-panel">
      <Link to="/" className="back-link">
        ← Kembali ke Beranda
      </Link>

      <h2>Login NexusMed</h2>
      <p className="muted">Masuk menggunakan akun institusi yang terdaftar.</p>

      <form className="referral-form" onSubmit={handleSubmit}>
        <label>
          Akun Institusi
          <select
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              setPassword("");
              setError("");
            }}
          >
            <option value="org1">Org1 — FKTP Pengirim</option>
            <option value="org2">Org2 — FKRTL Penerima</option>
          </select>
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Masukkan password"
            autoComplete="current-password"
            required
          />
        </label>

        <button type="submit" disabled={busy || !password}>
          {busy ? "Memverifikasi..." : "Masuk ke Dashboard"}
        </button>
      </form>

      {error && (
        <div className="result error" role="alert">
          {error}
        </div>
      )}

      <p className="muted small-note">
        Autentikasi ini untuk lingkungan pengembangan lokal. Gunakan data pasien
        sintetis.
      </p>
    </section>
  );
}
