import { useState } from "react";
import { createDepartment } from "../services/adminApi";

const VALID_ID = /^[a-z][a-z0-9_]{2,79}$/;

export default function CreateDepartmentForm({
  institutions,
  onCreated,
}) {
  const [institutionId, setInstitutionId] = useState("");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshFailedAfterCreate, setRefreshFailedAfterCreate] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const receivers = institutions.filter(
    (institution) =>
      institution.status === "approved" &&
      Number(institution.can_receive) === 1
  );

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving || refreshFailedAfterCreate) return;

    setError("");
    setMessage("");

    const cleanId = id.trim();
    const cleanName = name.trim();

    if (
      !receivers.some((institution) =>
        institution.id === institutionId
      ) ||
      !VALID_ID.test(cleanId) ||
      !cleanName ||
      cleanName.length > 100
    ) {
      setError("Periksa institusi, ID, dan nama poli.");
      return;
    }

    setSaving(true);

    try {
      const result = await createDepartment({
        id: cleanId,
        name: cleanName,
        institutionId,
      });

      // POST succeeded. Do not retry it if refresh fails.
      try {
        await onCreated(result.department);
        setId("");
        setName("");
        setMessage(
          `Poli ${result.department.name} berhasil didaftarkan. ` +
          "Membership staf tidak diberikan otomatis."
        );
      } catch {
        setRefreshFailedAfterCreate(true);
        setMessage(
          "Poli berhasil dibuat, tetapi daftar gagal diperbarui. " +
          "Muat ulang halaman; jangan kirim ulang formulir."
        );
      }
    } catch (err) {
      setError(err.message || "Gagal mendaftarkan poli.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="portal-card"
      aria-label="Create department"
      style={{ marginBottom: "24px" }}
    >
      <h3>Tambah Poli</h3>
      <p className="muted">
        Poli baru tidak otomatis memberikan akses kepada staf.
      </p>

      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="department-institution">
            Institusi Penerima
          </label>
          <select
            id="department-institution"
            value={institutionId}
            onChange={(event) =>
              setInstitutionId(event.target.value)
            }
            disabled={saving}
            required
          >
            <option value="">Pilih institusi</option>
            {receivers.map((institution) => (
              <option key={institution.id} value={institution.id}>
                {institution.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="department-id">ID Poli</label>
          <input
            id="department-id"
            value={id}
            onChange={(event) => setId(event.target.value)}
            placeholder="poli_jantung_org2"
            pattern="[a-z][a-z0-9_]{2,79}"
            maxLength={80}
            disabled={saving}
            required
          />
        </div>

        <div>
          <label htmlFor="department-name">Nama Poli</label>
          <input
            id="department-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Poli Jantung"
            maxLength={100}
            disabled={saving}
            required
          />
        </div>

        <button
          type="submit"
          disabled={saving || refreshFailedAfterCreate || receivers.length === 0}
        >
          {saving ? "Mendaftarkan..." : "Tambah Poli"}
        </button>
      </form>

      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
