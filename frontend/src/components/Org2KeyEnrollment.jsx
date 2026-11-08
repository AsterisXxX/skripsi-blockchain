import { useState } from "react";
import {
  enrollLegacyOrg2Key,
} from "../services/legacyKeyEnrollment";

export default function Org2KeyEnrollment({
  user,
  onKeyReady,
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  if (
    user?.role !== "org2" ||
    user?.institutionId !== "org2"
  ) {
    return null;
  }

  async function handleEnrollment() {
    if (busy) return;

    setBusy(true);
    setMessage("");
    setError("");

    try {
      const result = await enrollLegacyOrg2Key(user);

      switch (result.status) {
        case "recovered":
          setMessage(
            "Institutional key berhasil dihubungkan " +
            "dengan key legacy pada workstation ini."
          );
          onKeyReady?.();
          break;

        case "already_bound":
          setMessage(
            "Institutional key sudah terhubung dan terverifikasi."
          );
          onKeyReady?.();
          break;

        case "proof_verified_not_registered":
          setMessage(
            "Proof of Possession valid, tetapi registrasi " +
            "backend belum diaktifkan. Key legacy tetap aman."
          );
          break;

        default:
          throw new Error(
            "Status enrollment tidak dikenal."
          );
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="panel"
      aria-label="Institutional key enrollment"
    >
      <h3>Institutional Key — Org2</h3>

      <p className="muted">
        Hubungkan pasangan kunci ECDH P-256 yang sudah
        tersimpan pada workstation ini dengan registry
        institusi. Private key tidak dikirim ke backend.
      </p>

      <button
        type="button"
        onClick={handleEnrollment}
        disabled={busy}
      >
        {busy
          ? "Memverifikasi kunci..."
          : "Enroll Existing Org2 Key"}
      </button>

      {message && (
        <p role="status">{message}</p>
      )}

      {error && (
        <p role="alert" className="result error">
          {error}
        </p>
      )}
    </section>
  );
}
