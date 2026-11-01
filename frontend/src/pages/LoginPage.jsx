import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { login } from "../services/api";

export default function LoginPage({ onLogin }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const requestedRole = params.get("role");

  const defaultUsername =
    requestedRole === "admin" || requestedRole === "consortium_admin"
      ? "nexusadmin"
      : "";

  const [username, setUsername] = useState(defaultUsername);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();

    const normalizedUsername = username.trim().toLowerCase();

    if (!normalizedUsername || !password) {
      setError("Username dan password wajib diisi.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const result = await login(normalizedUsername, password);

      if (!result.user) {
        throw new Error("Backend tidak mengembalikan data user.");
      }

      onLogin(result.user);
      navigate(`/${result.user.role}`, { replace: true });
    } catch (err) {
      setError(err.message || "Login gagal.");
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

      <p className="muted">
        Masuk menggunakan akun yang terdaftar di sistem NexusMed.
      </p>

      <form className="referral-form" onSubmit={handleSubmit}>
        <label>
          Username
          <input
            type="text"
            name="username"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              setError("");
            }}
            placeholder="Masukkan username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={100}
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            name="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setError("");
            }}
            placeholder="Masukkan password"
            autoComplete="current-password"
            required
          />
        </label>

        <button type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? "Memverifikasi..." : "Masuk ke Dashboard"}
        </button>
      </form>

      {error && (
        <div className="result error" role="alert">
          {error}
        </div>
      )}

      <p className="muted small-note">
        Akses dashboard ditentukan berdasarkan role dan izin akun. Gunakan data
        pasien sintetis selama pengujian.
      </p>
    </section>
  );
}
