import { useState } from "react";
import { Link } from "react-router-dom";
import { convertToFHIR } from "../utils/fhirConverter";
import { encryptFHIR } from "../services/cryptoService";
import { uploadReferral } from "../services/api";

const initial = {
  referralId: "",
  patientId: "",
  patientName: "",
  senderHospital: "Org1 - FKTP",
  receiverHospital: "Org2 - FKRTL",
  targetUnit: "",
  diagnosis: "",
  complaints: "",
  examination: "",
  treatment: "",
  priority: "routine",
  reason: "",
  consentConfirmed: false,
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
      // Preserve M06-A from commit 2b29b481: upload in Vite DEV only.
      if (import.meta.env.DEV) {
        const result = await uploadReferral(referralId, payload);
        if (result.documentHash !== payload.documentHash) {
          throw new Error("Hash respons server tidak sesuai.");
        }
      }
      onSend({
        referralId,
        payload,
        documentHash: payload.documentHash,
        createdAt: new Date().toISOString(),
      });
      setMessage(
        import.meta.env.DEV
          ? `Rujukan ${referralId} berhasil dienkripsi dan disimpan ke MinIO (belum ke Fabric).`
          : `Rujukan ${referralId} berhasil dienkripsi dalam sesi demo browser.`,
      );
      setForm(initial);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function input(label, field, placeholder = "", multiline = false) {
    return (
      <label key={field}>
        {label}
        {multiline ? (
          <textarea
            required
            rows={3}
            value={form[field]}
            placeholder={placeholder}
            onChange={(e) => update(field, e.target.value)}
          />
        ) : (
          <input
            required
            value={form[field]}
            placeholder={placeholder}
            onChange={(e) => update(field, e.target.value)}
          />
        )}
      </label>
    );
  }

  return (
    <section className="panel">
      <Link to="/" className="back-link">
        ← Kembali ke Beranda
      </Link>
      <h2>Buat Rujukan Pasien</h2>
      <p className="muted">
        Simulasi rujukan vertikal FKTP → FKRTL, rawat jalan non-gawat-darurat.
        Data sintetis dikonversi ke HL7 FHIR R4 dan dienkripsi di browser.
      </p>
      <form className="referral-form" onSubmit={handleSubmit}>
        <h3>Identitas Pasien — Simulasi</h3>
        {input("Nomor pasien (dummy)", "patientId", "PAT-001")}
        {input("Nama pasien (dummy)", "patientName", "Pasien Simulasi")}
        <h3>Tujuan Rujukan</h3>
        {input("Nomor rujukan", "referralId", "REF-2026-001")}
        <label>
          Faskes pengirim <input value={form.senderHospital} readOnly />
        </label>
        <label>
          Faskes penerima <input value={form.receiverHospital} readOnly />
        </label>
        {input(
          "Unit layanan / poli tujuan",
          "targetUnit",
          "Poli Penyakit Dalam",
        )}
        <h3>Informasi Klinis (Data Sintetis)</h3>
        {input(
          "Diagnosis kerja / dugaan diagnosis",
          "diagnosis",
          "Hipertensi (simulasi)",
        )}
        {input(
          "Keluhan utama",
          "complaints",
          "Keluhan sejak tiga hari lalu (simulasi)",
          true,
        )}
        {input(
          "Temuan pemeriksaan",
          "examination",
          "Ringkasan pemeriksaan (simulasi)",
          true,
        )}
        {input(
          "Tindakan yang sudah diberikan",
          "treatment",
          "Pemeriksaan fisik awal (simulasi)",
          true,
        )}
        <h3>Permintaan Rujukan</h3>
        <label>
          Prioritas
          <select
            value={form.priority}
            onChange={(e) => update("priority", e.target.value)}
          >
            <option value="routine">Biasa</option>
            <option value="urgent">Mendesak (bukan alur IGD)</option>
          </select>
        </label>
        {input(
          "Alasan rujukan",
          "reason",
          "Memerlukan evaluasi dokter spesialis",
          true,
        )}
        <label
          style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}
        >
          <input
            type="checkbox"
            checked={form.consentConfirmed}
            onChange={(e) => update("consentConfirmed", e.target.checked)}
            style={{ width: "auto", marginTop: "0.25rem" }}
          />
          Saya mengonfirmasi bahwa persetujuan rujukan pada skenario simulasi
          telah dipenuhi.
        </label>
        <p className="muted small-note">
          Checkbox ini bukan bukti informed consent klinis dan tidak disimpan
          sebagai resource FHIR Consent.
        </p>
        <button type="submit" disabled={busy || !receiverPublicKey}>
          {busy ? "Mengenkripsi & menyimpan..." : "Kirim Rujukan (Simulasi)"}
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
        Mode development mengunggah ciphertext ke MinIO; mode web statis
        menyimpan data hanya di browser. Verifikasi ledger Fabric belum
        terintegrasi.
      </p>
    </section>
  );
}
