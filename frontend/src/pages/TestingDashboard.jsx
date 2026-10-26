import { useState } from "react";
import { convertToFHIR } from "../utils/fhirConverter";
import EncryptionTest from "../components/EncryptionTest";

const dummy = {
  referralId: "REF-DEMO-001",
  patientId: "PAT-DEMO-001",
  patientName: "Pasien Simulasi",
  senderHospital: "Org1 - FKTP",
  receiverHospital: "Org2 - FKRTL",
  targetUnit: "Poli Penyakit Dalam",
  diagnosis: "Hipertensi (simulasi)",
  complaints: "Pusing berulang (simulasi)",
  examination: "Pemeriksaan tekanan darah dilakukan (simulasi)",
  treatment: "Pemeriksaan awal telah dilakukan (simulasi)",
  priority: "routine",
  reason: "Evaluasi dokter spesialis (simulasi)",
  consentConfirmed: true,
};

export default function TestingDashboard({
  referrals,
  receiverKeys,
  keyStatus,
}) {
  const [sample, setSample] = useState(null);
  const [error, setError] = useState("");
  const [showPlain, setShowPlain] = useState(false);
  function generateSample() {
    try {
      setSample(convertToFHIR(dummy));
      setError("");
      setShowPlain(false);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <section className="panel">
      <div className="lab-heading">
        <div>
          <h2>Lab Pengujian — Developer</h2>
          <p className="muted">
            Mode teknis untuk FHIR R4, ciphertext, hash, dan manipulasi lokal.
          </p>
        </div>
        <span className="demo-badge">HANYA DATA DUMMY</span>
      </div>
      <div className="result warning-note">
        Data dan persetujuan hanya simulasi. Jangan gunakan data pasien nyata.
      </div>
      <div className="lab-toolbar">
        <button className="lab-button" type="button" onClick={generateSample}>
          Buat FHIR Dummy
        </button>
        {sample && (
          <button
            className="lab-button neutral"
            type="button"
            onClick={() => setShowPlain((v) => !v)}
          >
            {showPlain ? "Sembunyikan Plaintext" : "Lihat Plaintext JSON"}
          </button>
        )}
      </div>
      {error && <p className="result error">{error}</p>}
      {showPlain && sample && (
        <pre className="json-preview">{JSON.stringify(sample, null, 2)}</pre>
      )}
      {sample && (
        <EncryptionTest key={sample.entry?.[0]?.fullUrl} fhirData={sample} />
      )}
      <h3>Ledger Simulasi (Memori Browser)</h3>
      <p className="muted">
        Pembanding hash di sini bukan data dari Hyperledger Fabric.
      </p>
      {Object.values(referrals).length === 0 ? (
        <p className="muted">Belum ada rujukan dalam sesi ini.</p>
      ) : (
        <div className="lab-records">
          {Object.values(referrals).map((item) => (
            <details key={item.referralId}>
              <summary>{item.referralId} — ciphertext & hash</summary>
              <pre className="json-preview">
                {JSON.stringify(item, null, 2)}
              </pre>
            </details>
          ))}
        </div>
      )}
      <p className="muted small-note">
        {receiverKeys ? "Kunci sesi demo Org2 siap." : keyStatus}
      </p>
    </section>
  );
}
