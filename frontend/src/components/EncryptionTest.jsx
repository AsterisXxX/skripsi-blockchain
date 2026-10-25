import { useState } from "react";

import {
  generateHospitalKeys,
  encryptFHIR,
  decryptFHIR,
} from "../services/cryptoService";

export default function EncryptionTest({ fhirData }) {
  const [keys, setKeys] = useState(null);
  const [payload, setPayload] = useState(null);
  const [ledgerHash, setLedgerHash] = useState("");
  const [decrypted, setDecrypted] = useState(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action) {
    setBusy(true);
    setStatus("");

    try {
      await action();
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  function setupKeys() {
    run(async () => {
      const pair = await generateHospitalKeys();

      setKeys(pair);
      setPayload(null);
      setLedgerHash("");
      setDecrypted(null);
      setStatus("Kunci ECC Org2 berhasil dibuat.");
    });
  }

  function encrypt() {
    run(async () => {
      if (!keys) throw new Error("Buat kunci Org2 dulu.");

      const result = await encryptFHIR(fhirData, keys.publicKey);

      setPayload(result);
      setLedgerHash(result.documentHash);
      setDecrypted(null);

      setStatus(
        "Enkripsi AES-ECC berhasil. " + "Ciphertext sudah dibuat di browser.",
      );
    });
  }

  function decrypt() {
    run(async () => {
      if (!payload || !keys) {
        throw new Error("Ciphertext belum tersedia.");
      }

      const result = await decryptFHIR(payload, keys.privateKey, ledgerHash);

      setDecrypted(result);
      setStatus("Verifikasi hash dan dekripsi berhasil.");
    });
  }

  function tamper() {
    if (!payload) return;

    const bytes = Uint8Array.from(atob(payload.ciphertext), (char) =>
      char.charCodeAt(0),
    );

    bytes[0] ^= 1;

    const modified = btoa(
      Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""),
    );

    setPayload({
      ...payload,
      ciphertext: modified,
    });

    setDecrypted(null);
    setStatus("Simulasi manipulasi: ciphertext telah diubah 1 bit.");
  }

  return (
    <div className="crypto-test">
      <h3>Pengujian Enkripsi AES-ECC</h3>

      <p className="muted">
        Simulasi lokal pengirim dan penerima. Tidak ada dokumen yang dikirim ke
        backend.
      </p>

      <div className="crypto-actions">
        <button type="button" onClick={setupKeys} disabled={busy}>
          1. Generate ECC Org2
        </button>

        <button type="button" onClick={encrypt} disabled={busy || !keys}>
          2. Enkripsi FHIR
        </button>

        <button type="button" onClick={decrypt} disabled={busy || !payload}>
          3. Verifikasi & Dekripsi
        </button>

        <button type="button" onClick={tamper} disabled={busy || !payload}>
          4. Simulasi Manipulasi
        </button>
      </div>

      {status && <p className="crypto-status">{status}</p>}

      {payload && (
        <div className="crypto-output">
          <h4>Hasil Enkripsi</h4>

          <p>
            <strong>Algoritma:</strong> {payload.algorithm}
          </p>

          <p>
            <strong>SHA-256 ciphertext:</strong>
          </p>
          <code className="hash-value">{ledgerHash}</code>

          <details>
            <summary>Lihat Payload Terenkripsi</summary>
            <pre className="json-preview">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {decrypted && (
        <div className="crypto-output">
          <h4>Dokumen Berhasil Didekripsi</h4>

          <p>
            <strong>Resource:</strong> {decrypted.resourceType}
          </p>

          <p>
            <strong>Jumlah entry:</strong> {decrypted.entry?.length ?? 0}
          </p>

          <details>
            <summary>Lihat Dokumen Asli</summary>
            <pre className="json-preview">
              {JSON.stringify(decrypted, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
