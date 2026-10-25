import { useState } from "react";
import { decryptFHIR } from "../services/cryptoService";

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
      // Hash adalah acuan simulasi terpisah dari payload, belum ledger tepercaya.
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
  const patient = resources.find((item) => item.resourceType === "Patient");
  const referral = resources.find(
    (item) => item.resourceType === "ServiceRequest",
  );

  return (
    <section className="panel">
      <h2>Cari Rujukan Pasien</h2>
      <p className="muted">
        Masukkan nomor rujukan dari Org1 untuk melihat hasil verifikasi dan data
        pasien simulasi.
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
            Dokumen berhasil diverifikasi dan didekripsi.
          </div>
          <h3>Ringkasan Rujukan</h3>
          <dl className="detail-grid">
            <dt>Nomor Rujukan</dt>
            <dd>{record.referralId}</dd>
            <dt>Nomor Pasien</dt>
            <dd>{patient?.identifier?.[0]?.value || "—"}</dd>
            <dt>Nama Pasien</dt>
            <dd>{patient?.name?.[0]?.text || "—"}</dd>
            <dt>Prioritas</dt>
            <dd>{referral?.priority === "urgent" ? "Mendesak" : "Biasa"}</dd>
            <dt>Alasan Rujukan</dt>
            <dd>{referral?.reasonCode?.[0]?.text || "—"}</dd>
          </dl>
        </div>
      )}
      <p className="muted small-note">
        Saat ini pencarian hanya membaca data demo dalam memori aplikasi.
        Otorisasi MSP, ledger Fabric, dan penyimpanan cloud belum diaktifkan.
      </p>
    </section>
  );
}
