import { useState } from "react";

export default function Org2Dashboard() {
  const [referralId, setReferralId] = useState("");
  const [status, setStatus] = useState("");

  function handleSearch(e) {
    e.preventDefault();

    if (!referralId.trim()) {
      setStatus("Masukkan Referral ID terlebih dahulu.");
      return;
    }

    setStatus(
      `Referral ID ${referralId} siap dicari. ` +
      "Integrasi query Hyperledger Fabric belum tersedia."
    );
  }

  return (
    <section className="panel">
      <h2>Org2 — FKRTL / RS Penerima</h2>
      <p className="muted">
        Pencarian, verifikasi, dan penerimaan dokumen rujukan.
      </p>

      <form onSubmit={handleSearch} className="referral-form">
        <label>
          Referral ID
          <input
            type="text"
            placeholder="Masukkan ID rujukan"
            value={referralId}
            onChange={(e) => setReferralId(e.target.value)}
            required
          />
        </label>

        <button type="submit">Cari Rujukan</button>
      </form>

      {status && <div className="result">{status}</div>}

      <h3>Alur Penerimaan</h3>
      <ol>
        <li>Query metadata dan hash dari Hyperledger Fabric</li>
        <li>Unduh ciphertext dari Cloud Storage</li>
        <li>Verifikasi SHA-256 dengan ledger</li>
        <li>Dekripsi ECC dan AES di client-side</li>
        <li>Tampilkan dokumen HL7 FHIR</li>
      </ol>

      <p className="muted">
        Pencarian blockchain dan dekripsi belum diaktifkan.
      </p>
    </section>
  );
}
