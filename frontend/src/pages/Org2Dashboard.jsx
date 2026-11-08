import { useLayoutEffect, useRef, useState } from "react";
import { decryptFHIR } from "../services/cryptoService";
import { Link } from "react-router-dom";
import { getVerifiedReferral } from "../services/api";

export default function Org2Dashboard({ receiverPrivateKey }) {
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [record, setRecord] = useState(null);
  const [fhir, setFhir] = useState(null);

  const lifecycle = useRef({
    key: receiverPrivateKey,
    generation: 0,
    mounted: true,
  });

  useLayoutEffect(() => {
    if (lifecycle.current.key !== receiverPrivateKey) {
      lifecycle.current.key = receiverPrivateKey;
      lifecycle.current.generation += 1;
      setRecord(null);
      setFhir(null);
      setBusy(false);
      setError("");
    }
  }, [receiverPrivateKey]);

  useLayoutEffect(() => {
    const currentLifecycle = lifecycle.current;
    currentLifecycle.mounted = true;

    return () => {
      currentLifecycle.mounted = false;
      currentLifecycle.generation += 1;
    };
  }, []);

  async function handleSearch(event) {
    event.preventDefault();

    setError("");
    setRecord(null);
    setFhir(null);
    setBusy(true);

    const generation = ++lifecycle.current.generation;
    const isCurrent = () =>
      lifecycle.current.mounted &&
      lifecycle.current.generation === generation &&
      lifecycle.current.key === receiverPrivateKey &&
      Boolean(receiverPrivateKey);

    try {
      if (!receiverPrivateKey) {
        throw new Error("Kunci privat Org2 belum siap.");
      }

      const referralId = id.trim();

      // Ambil ciphertext yang sudah diverifikasi
      // terhadap ledger Hyperledger Fabric.
      console.log("[Org2] Memulai verifikasi:", referralId);

      const verified = await getVerifiedReferral(referralId);

      if (!isCurrent()) return;

      console.log("[Org2] Verifikasi selesai:", verified.status);

      console.log("[Org2] Memulai dekripsi...");

      const output = await decryptFHIR(
        verified.payload,
        receiverPrivateKey,
        verified.ledgerHash,
      );

      if (!isCurrent()) return;

        console.log("[Org2] Dekripsi berhasil!");

      setRecord({
        referralId: verified.referralId,
        payload: verified.payload,
        documentHash: verified.ledgerHash,
      });

      setFhir(output);
    } catch (error) {
      if (isCurrent()) setError(error.message);
    } finally {
      if (isCurrent()) setBusy(false);
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
        Verifikasi integritas rujukan sintetis melalui API sebelum dekripsi lokal menggunakan private key institusi.
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
        <button type="submit" disabled={busy || !receiverPrivateKey}>
          {busy ? "Memeriksa..." : "Cari & Buka Rujukan (Demo)"}
        </button>
      </form>
        {!receiverPrivateKey && (
          <p className="muted" role="status">
            Kunci privat penerima belum tersedia atau belum
            terverifikasi. Pencarian rujukan dinonaktifkan.
          </p>
        )}
        {error && (
          <div className="result error" role="alert">
            {error}
          </div>
        )}
      {record && fhir && (
        <div className="referral-detail" role="status">
          <p className="muted small-note">
            Integritas ciphertext diperiksa terhadap MinIO dan Hyperledger Fabric sebelum dekripsi lokal. Private key institusi tetap tersimpan pada browser workstation yang telah diotorisasi.
          </p>
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
        Mode pengujian menggunakan data sintetis. Penerimaan klinis dengan data pasien nyata belum diaktifkan.
      </p>
    </section>
  );
}
