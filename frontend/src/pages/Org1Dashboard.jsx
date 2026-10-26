import { useState } from "react";
import { convertToFHIR } from "../utils/fhirConverter";
import { encryptFHIR } from "../services/cryptoService";
import { uploadReferral } from "../services/api";
import { Link } from "react-router-dom";

const initial = {
  referralId: "",
  patientId: "",
  patientName: "",
  senderHospital: "Org1 - FKTP",
  receiverHospital: "Org2 - FKRTL",
  priority: "routine",
  reason: "",
};

export default function Org1Dashboard({
  receiverPublicKey,
  onSend,
  keyStatus,
}) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setMessage("");
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    setBusy(true);
    try {
      if (!receiverPublicKey) throw new Error("Kunci publik Org2 belum siap.");
      const fhir = convertToFHIR(form);
      const payload = await encryptFHIR(fhir, receiverPublicKey);

      const referralId = form.referralId.trim();

      if (import.meta.env.DEV) {
        const result = await uploadReferral(referralId, payload);

        if (result.documentHash !== payload.documentHash) {
          throw new Error("Hash respons server tidak sesuai.");
        }
      }

      onSend({
        referralId: form.referralId.trim(),
        payload,
        documentHash: payload.documentHash, // Hanya ledger tiruan di memori.
        createdAt: new Date().toISOString(),
      });
      setMessage(
        import.meta.env.DEV
          ? `Rujukan ${referralId} berhasil dienkripsi dan disimpan ke MinIO.`
          : `Rujukan ${referralId} berhasil dienkripsi dalam sesi demo browser.`,
      );
      setForm(initial);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <Link to="/" className="back-link">
        ← Kembali ke Beranda
      </Link>
      <h2>Buat Rujukan Pasien</h2>
      <p className="muted">
        Isi data pasien simulasi. Konversi FHIR dan enkripsi berlangsung
        otomatis di browser.
      </p>
      <form className="referral-form" onSubmit={handleSubmit}>
        <h3>Data Pasien</h3>
        <label>
          Nomor Pasien (dummy)
          <input
            required
            value={form.patientId}
            placeholder="PAT-001"
            onChange={(e) => update("patientId", e.target.value)}
          />
        </label>
        <label>
          Nama Pasien (dummy)
          <input
            required
            value={form.patientName}
            placeholder="Budi Santoso"
            onChange={(e) => update("patientName", e.target.value)}
          />
        </label>
        <h3>Data Rujukan</h3>
        <label>
          Nomor Rujukan
          <input
            required
            value={form.referralId}
            placeholder="REF-2026-001"
            onChange={(e) => update("referralId", e.target.value)}
          />
        </label>
        <label>
          Faskes Pengirim <input value={form.senderHospital} readOnly />
        </label>
        <label>
          Faskes Tujuan <input value={form.receiverHospital} readOnly />
        </label>
        <label>
          Prioritas
          <select
            value={form.priority}
            onChange={(e) => update("priority", e.target.value)}
          >
            <option value="routine">Biasa</option>
            <option value="urgent">Mendesak</option>
          </select>
        </label>
        <label>
          Alasan Rujukan
          <textarea
            required
            rows={4}
            value={form.reason}
            placeholder="Alasan pasien dirujuk..."
            onChange={(e) => update("reason", e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy || !receiverPublicKey}>
          {busy ? "Menyiapkan rujukan..." : "Siapkan & Kirim Rujukan (Demo)"}
        </button>
      </form>
      {!receiverPublicKey && (
        <p className="muted" role="status">
          {keyStatus}
        </p>
      )}
      {message && (
        <div className="result success-note" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="result error" role="alert">
          {error}
        </div>
      )}
      <p className="muted small-note">
        Belum terhubung ke MinIO atau Hyperledger Fabric. Pengiriman saat ini
        hanya antarhalaman dalam satu sesi browser.
      </p>
    </section>
  );
}
