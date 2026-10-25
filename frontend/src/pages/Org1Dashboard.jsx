
import { useState } from "react";
import { convertToFHIR } from "../utils/fhirConverter";

const initialForm = {
  referralId: "",
  patientId: "",
  patientName: "",
  senderHospital: "Org1 - FKTP",
  receiverHospital: "Org2 - FKRTL",
  priority: "routine",
  reason: ""
};

export default function Org1Dashboard() {
  const [form, setForm] = useState(initialForm);
  const [fhirData, setFhirData] = useState(null);
  const [error, setError] = useState("");
  const [showTechnical, setShowTechnical] = useState(false);

  function updateField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
    setFhirData(null);
    setError("");
  }

  function handleSubmit(e) {
    e.preventDefault();

    try {
      const result = convertToFHIR(form);
      setFhirData(result);
      setError("");
    } catch (err) {
      setError(err.message);
      setFhirData(null);
    }
  }

  function downloadFHIR() {
    if (!fhirData) return;

    const blob = new Blob(
      [JSON.stringify(fhirData, null, 2)],
      { type: "application/fhir+json" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${form.referralId}.json`;
    link.click();

    URL.revokeObjectURL(url);
  }

  return (
    <section className="panel">
      <h2>Buat Rujukan Pasien</h2>
      <p className="muted">
        Isi informasi berikut untuk menyiapkan rujukan.
        Gunakan data pasien simulasi.
      </p>

      <form onSubmit={handleSubmit} className="referral-form">
        <h3>Informasi Pasien</h3>

        <label>
          Nomor Pasien
          <input
            value={form.patientId}
            onChange={e =>
              updateField("patientId", e.target.value)
            }
            placeholder="Contoh: PAT-001"
            required
          />
        </label>

        <label>
          Nama Pasien
          <input
            value={form.patientName}
            onChange={e =>
              updateField("patientName", e.target.value)
            }
            placeholder="Nama pasien dummy"
            required
          />
        </label>

        <h3>Informasi Rujukan</h3>

        <label>
          Nomor Rujukan
          <input
            value={form.referralId}
            onChange={e =>
              updateField("referralId", e.target.value)
            }
            placeholder="Contoh: REF-001"
            required
          />
        </label>

        <label>
          Faskes Pengirim
          <input
            value={form.senderHospital}
            readOnly
          />
        </label>

        <label>
          Faskes Tujuan
          <input
            value={form.receiverHospital}
            readOnly
          />
        </label>

        <label>
          Prioritas Rujukan
          <select
            value={form.priority}
            onChange={e =>
              updateField("priority", e.target.value)
            }
          >
            <option value="routine">Biasa — Penanganan terjadwal</option>
            <option value="urgent">Mendesak — Perlu penanganan segera</option>
          </select>
        </label>

        <label>
          Alasan Rujukan
          <textarea
            value={form.reason}
            onChange={e =>
              updateField("reason", e.target.value)
            }
            placeholder="Jelaskan alasan pasien dirujuk..."
            rows={4}
            required
          />
        </label>

        <button type="submit">
          Siapkan Data Rujukan
        </button>
      </form>

      {error && (
        <div className="result error">
          {error}
        </div>
      )}

      {fhirData && (
        <div className="result">
          <h3>Data Rujukan Siap</h3>
          <p>
            Informasi berhasil diubah menjadi
            struktur HL7 FHIR JSON.
          </p>

          <p className="muted">
            Rujukan belum dikirim. Enkripsi,
            penyimpanan cloud, dan pencatatan
            blockchain belum dijalankan.
          </p>

          <button
            type="button"
            className="secondary-button"
            onClick={downloadFHIR}
          >
            Unduh JSON FHIR
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              setShowTechnical(!showTechnical)
            }
          >
            {showTechnical
              ? "Sembunyikan Detail Teknis"
              : "Lihat Detail Teknis"}
          </button>

          {showTechnical && (
            <pre className="json-preview">
              {JSON.stringify(fhirData, null, 2)}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
