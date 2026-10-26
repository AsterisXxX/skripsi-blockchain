import { useState } from "react";
import { decryptFHIR } from "../services/cryptoService";
import { Link } from "react-router-dom";

export default function Org2Dashboard({ referrals, receiverPrivateKey }) {
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [record, setRecord] = useState(null);
  const [fhir, setFhir] = useState(null);

  async function handleSearch(event) {
    event.preventDefault();
    setError("");
    setRecord(null);
    setFhir(null);
    setBusy(true);
    try {
      const found = referrals[id.trim()];
      if (!found) throw new Error("Rujukan tidak ditemukan di sesi demo ini.");
      if (!receiverPrivateKey) throw new Error("Kunci privat Org2 belum siap.");
      const output = await decryptFHIR(
        found.payload,
        receiverPrivateKey,
        found.documentHash,
      );
      setRecord(found);
      setFhir(output);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const resources = fhir?.entry?.map(({ resource }) => resource) ?? [];
  const pick = (type) => resources.find((x) => x.resourceType === type);
  const patient = pick("Patient");
  const referral = pick("ServiceRequest");
  const condition = pick("Condition");
  const service = pick("HealthcareService");
  const procedures = pick("Procedure");
  const obs = resources.filter((x) => x.resourceType === "Observation");
  const complaint = obs.find((x) => x.code?.text?.startsWith("Keluhan"));
  const exam = obs.find((x) => x.code?.text?.startsWith("Temuan"));
  const value = (x) => x || "—";

  return (
    <section className="panel">
      <Link to="/" className="back-link">
        ← Kembali ke Beranda
      </Link>
      <h2>Cari Rujukan Pasien</h2>
      <p className="muted">
        Dekripsi FHIR sintetis pada sesi browser yang sama (bukan penerimaan
        klinis sungguhan).
      </p>
      <form className="referral-form" onSubmit={handleSearch}>
        <label>
          Nomor Rujukan
          <input
            required
            value={id}
            placeholder="REF-2026-001"
            onChange={(e) => setId(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Memeriksa..." : "Cari & Buka Rujukan (Demo)"}
        </button>
      </form>
      {error && (
        <div className="result error" role="alert">
          {error}
        </div>
      )}
      {record && fhir && (
        <div className="referral-detail" role="status">
          <div className="success-note result">
            Hash cocok dengan pembanding lokal dan dokumen berhasil didekripsi.
            Bukan verifikasi hash ledger Fabric.
          </div>
          <h3>Ringkasan Rujukan FHIR R4</h3>
          <dl className="detail-grid">
            <dt>Nomor rujukan</dt>
            <dd>{record.referralId}</dd>
            <dt>Nomor pasien</dt>
            <dd>{value(patient?.identifier?.[0]?.value)}</dd>
            <dt>Nama pasien</dt>
            <dd>{value(patient?.name?.[0]?.text)}</dd>
            <dt>Poli / layanan tujuan</dt>
            <dd>{value(service?.name)}</dd>
            <dt>Diagnosis kerja</dt>
            <dd>{value(condition?.code?.text)}</dd>
            <dt>Keluhan</dt>
            <dd>{value(complaint?.valueString)}</dd>
            <dt>Temuan pemeriksaan</dt>
            <dd>{value(exam?.valueString)}</dd>
            <dt>Tindakan awal</dt>
            <dd>{value(procedures?.code?.text)}</dd>
            <dt>Prioritas</dt>
            <dd>{referral?.priority === "urgent" ? "Mendesak" : "Biasa"}</dd>
            <dt>Alasan rujukan</dt>
            <dd>{value(referral?.reasonCode?.[0]?.text)}</dd>
          </dl>
        </div>
      )}
      <p className="muted small-note">
        Pencarian menggunakan state browser, bukan permintaan langsung ke
        MinIO/Fabric. Autentikasi MSP dan alur penerimaan rujukan nyata belum
        aktif.
      </p>
    </section>
  );
}
