# 🏥 NexusMed — Aplikasi Rujukan Medis Digital Berbasis Hybrid Blockchain–Cloud

> **Status: Proof of Concept (PoC), dalam pengembangan — terakhir diaudit 26 Oktober 2026.** Seluruh contoh menggunakan **data pasien sintetis**, bukan data klinis nyata. **Belum aman untuk deployment klinis/produksi.** Status implementasi, hasil pengujian, dan rencana dibedakan dengan sengaja.

NexusMed memodelkan pengiriman rujukan dari **FKTP (Org1)** ke **FKRTL (Org2)**. Data rujukan berbentuk **FHIR R4 Bundle sintetis**, dienkripsi di browser menggunakan **AES-256-GCM**; kunci AES dibungkus dengan kunci turunan **ECDH P-256 + HKDF-SHA256**. Ciphertext disimpan **off-chain di MinIO**, sedangkan metadata rujukan dan **hash SHA-256 dari _ciphertext_** dicatat **on-chain di Hyperledger Fabric**.

- **GitHub:** https://github.com/AsterisXxX/skripsi-blockchain
- **Notion — Milestones & Evidence:** https://app.notion.com/p/4046a2b0c93081c2badbede083a112e8
- **Demo frontend statis:** https://test.nexusmed.my.id _(ketersediaan saat ini tidak diverifikasi dalam audit; akses dapat dibatasi)_
- **Commit acuan audit:** [`e40142f106b450892c9fa840236d3057664e0474`](https://github.com/AsterisXxX/skripsi-blockchain/commit/e40142f106b450892c9fa840236d3057664e0474) (`feat: indexedDB implementation`)

## 1. Ringkasan status dan batasan

**Sudah diimplementasikan:**

- React/Vite dengan `/org1`, `/org2`, dan Developer Lab `/dev`; form rujukan sintetis + converter FHIR Bundle.
- Web Crypto browser: AES-256-GCM, ECDH P-256/HKDF-SHA256, pembungkusan kunci AES, SHA-256 ciphertext.
- Express: upload ciphertext; MinIO menyimpan dokumen terenkripsi; Fabric menyimpan hash + metadata.
- SDK Fabric Node.js untuk `CreateReferral` dan `GetReferral` pada `referralchannel`, chaincode `rujukan`.
- Endpoint `GET /api/referrals/:id/verified` membandingkan hash ciphertext aktual di MinIO dengan hash yang dibaca dari ledger Fabric. Payload dikirim ke Org2 hanya jika integritas cocok pada endpoint ini.
- Dashboard Org2 mengambil payload terverifikasi dahulu, baru memanggil `decryptFHIR()`.
- Pasangan kunci ECDH demo Org2 disimpan sebagai `CryptoKey` non-extractable dalam IndexedDB (`nexusmed-keys` → `hospital-keys` → `org2-demo`).

**Sudah ada hasil pengujian yang dibagikan:**

- Chaincode: **6/6 skenario CLI PASS**, termasuk Org1 create/read, validitas commit, penolakan Org2 untuk create, duplicate dan invalid hash.
- SDK Node: Fabric write/read berhasil pada data sintetis.
- Rujukan **`REF-HYBRID-003`**: SHA-256 ciphertext MinIO cocok dengan hash ledger Fabric.
- Endpoint verified merespons `integrity_verified`, `verified: true` dan mengembalikan ciphertext untuk `REF-HYBRID-003`.
- Pengguna melaporkan panel verifikasi Testing Dashboard berhasil; screenshot akhir masih perlu ditautkan sebagai evidence.

**Belum dibuktikan/selesai:**

- Dekripsi Org2 untuk rujukan sama **setelah refresh browser** (kode IndexedDB ada; acceptance test perlu hasil log/screenshot).
- Otentikasi pengguna, session management, RBAC Express, isolasi kunci per user/institusi, dan distribusi/pemulihan kunci lintas browser/perangkat.
- Otorisasi pembacaan Fabric `GetReferral` untuk identitas yang tidak berwenang.
- Rekonsiliasi proses `pending_ledger` jika object MinIO sudah tersimpan tetapi commit Fabric gagal/tidak terkonfirmasi.
- Pengujian manipulasi object MinIO dan envelope metadata enkripsi, negative test menyeluruh, FHIR R4 validator formal, dan benchmark Hyperledger Caliper.
- Dokumentasi validasi host Cloudflare Access dan pengujian end-to-end antar browser.

**Batas deployment:** Backend Express, Fabric, dan MinIO berjalan lokal pada PoC; domain demo didesain untuk frontend statis. API lokal **tidak boleh dibuka ke internet** sebelum autentikasi, otorisasi, pengamanan jaringan, dan tinjauan keamanan lengkap.

## 2. Arsitektur aktual PoC lokal

```text
Org1 (React browser)                           Org2 (React browser)
Form rujukan sintetis                           Input Referral ID
        |                                              |
FHIR R4 Bundle                                  GET /api/referrals/:id/verified
        |                                              |
AES-256-GCM + ECDH P-256 / HKDF                 Express fetch MinIO ciphertext
        |                                              |
SHA-256 ciphertext                              Express fetch hash Fabric ledger
        |                                              |
POST /api/referrals                             Recompute SHA-256 & compare
        |                                              |
Express backend                                 verified=true + encrypted payload
        |                                              |
        +--> MinIO: referrals/<id>.json                 |
        |                                               v
        +--> Hyperledger Fabric:                   decryptFHIR() in Org2 browser
             Referral metadata, ciphertext SHA-256     (private key from IndexedDB)
```

Dokumen medis plaintext tidak dicatat di blockchain. **Hash yang dicatat adalah hash byte ciphertext**, bukan seluruh JSON payload/encryption envelope, sehingga pemeriksaan metadata lain masih perlu penguatan. SHA-256 membuktikan kesetaraan byte yang diperiksa dengan hash ledger; **tidak menggantikan autentikasi/otorisasi**.

Chaincode saat ini memuat atribut seperti `referralId`, `patientId`, `senderHospitalId`, `receiverHospitalId`, `recordHash`, `timestamp`, `status`. Operasi utama adalah `CreateReferral` (dibatasi Org1MSP) dan `GetReferral`. Backend saat ini menggunakan kredensial admin Org1 untuk koneksi Fabric; ini **bukan** autentikasi petugas aplikasi atau pemetaan kredensial Org2 yang siap produksi.

## 3. Stack

| Lapisan               | Teknologi                                            | Catatan                                                             |
| --------------------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| Frontend              | React 19, Vite 8, React Router                       | Dashboard FKTP, FKRTL, Developer Lab                                |
| Format data           | HL7 FHIR R4 JSON Bundle                              | Converter awal; belum lulus validator formal                        |
| Crypto browser        | Web Crypto API, AES-256-GCM, ECDH P-256, HKDF-SHA256 | Tidak menggunakan CP-ABE                                            |
| Private key demo      | `CryptoKey` non-extractable + IndexedDB              | Tetap lokal per origin/browser profile; bukan cross-device          |
| Backend               | Node.js 22, Express 5                                | API tanpa user login/RBAC saat audit                                |
| Off-chain storage     | MinIO S3-compatible                                  | Private bucket `medical-referrals`; verifikasi ACL belum diarsipkan |
| On-chain              | Hyperledger Fabric + chaincode Go                    | Channel `referralchannel`, chaincode `rujukan`                      |
| Frontend demo hosting | Nginx Docker + Cloudflare Tunnel                     | Setup host di luar repository                                       |

## 4. Struktur repository penting

```text
skripsi-blockchain/
├── chaincode-rujukan/
│   └── referral.go
├── backend/
│   └── src/
│       ├── config/minio.js
│       ├── routes/referralRoutes.js
│       ├── services/fabricService.js
│       └── scripts/
│           ├── testFabricConnection.js
│           ├── testFabricWrite.js
│           └── testHybridIntegrity.js
├── frontend/
│   └── src/
│       ├── App.jsx
│       ├── pages/Org1Dashboard.jsx
│       ├── pages/Org2Dashboard.jsx
│       ├── pages/TestingDashboard.jsx
│       ├── services/api.js
│       ├── services/cryptoService.js
│       ├── services/keyStorage.js
│       └── utils/fhirConverter.js
├── minio/docker-compose.yml
├── install-fabric.sh
└── README.md
```

`fabric-samples/`, kredensial backend dan konfigurasi host deployment tidak disimpan dalam repository ini. Jangan commit `.env`, private key, token Cloudflare, volume MinIO, atau data pasien nyata.

## 5. Setup dan menjalankan lokal

### Prasyarat

- Linux/WSL2 Ubuntu, Docker dan Docker Compose.
- Node.js 22, npm, Go, Git, curl, dan distribusi Hyperledger Fabric yang kompatibel.
- Browser modern dengan Web Crypto dan IndexedDB (`localhost` atau HTTPS).

### 5.1 Clone repository

```bash
git clone https://github.com/AsterisXxX/skripsi-blockchain.git
cd skripsi-blockchain
```

### 5.2 Fabric test-network

```bash
chmod +x install-fabric.sh
./install-fabric.sh docker samples binary
cd fabric-samples/test-network
./network.sh up createChannel -c referralchannel
./network.sh deployCC -ccn rujukan -ccp ../../chaincode-rujukan -ccl go -c referralchannel -ccs 1
cd ../..
```

Gunakan sequence `-ccs` sesuai _chaincode lifecycle_ pada jaringan aktual saat redeploy; `1` hanya untuk deployment pertama. Backend membutuhkan artefak identitas Org1 pada jalur standar `fabric-samples/test-network/organizations/...`.

### 5.3 MinIO

Buat file lokal `minio/.env`:

```dotenv
MINIO_ROOT_USER=your_local_username
MINIO_ROOT_PASSWORD=your_strong_local_password
```

```bash
cd minio
docker compose up -d
docker compose ps
cd ..
```

Gunakan bucket `medical-referrals` dengan akses privat. **Catatan:** Compose saat audit memakai image komunitas `dappros/minio:RELEASE.2025-09-07T16-13-09Z`; provenance/patch keamanan perlu diaudit sebelum ada deployment lebih serius.

### 5.4 Backend Express

```bash
cd backend
npm install
```

Buat `backend/.env` (contoh lokal, jangan commit):

```dotenv
PORT=3001
MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_BUCKET=medical-referrals
MINIO_ACCESS_KEY=your_local_username
MINIO_SECRET_KEY=your_strong_local_password
```

```bash
npm run dev
```

### 5.5 Frontend

Di terminal lain:

```bash
cd frontend
npm install
npm run dev
```

Buka alamat yang ditampilkan Vite (umumnya `http://localhost:5173`). Untuk pengujian IndexedDB, gunakan **origin/browser profile yang sama** sebelum dan setelah refresh.

## 6. Endpoint API (development lokal)

| Method | Endpoint                      | Fungsi                                                                                                                                    |
| ------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`                 | Status backend Express                                                                                                                    |
| GET    | `/api/storage/health`         | Koneksi dan bucket MinIO                                                                                                                  |
| POST   | `/api/referrals`              | Simpan ciphertext di MinIO, submit hash ke Fabric; `201 stored_hybrid` bila terkonfirmasi                                                 |
| GET    | `/api/referrals/:id/verified` | Hitung ulang hash MinIO vs Fabric, lalu kembalikan payload hanya jika cocok (`200 integrity_verified`); mismatch → `409 integrity_failed` |
| GET    | `/api/referrals/:id`          | Ambil payload tersimpan secara langsung; **jalur legacy yang belum terautentikasi, tidak boleh untuk deployment publik**                  |

Jika commit Fabric belum terkonfirmasi setelah penyimpanan MinIO, POST dapat mengembalikan `202 pending_ledger`; **jangan melakukan retry buta** karena objek mungkin sudah ada dan transaksi blockchain mungkin tetap ter-commit. Rekonsiliasi transaksi belum diimplementasikan.

Contoh pemeriksaan (backend dan jaringan aktif):

```bash
curl -i http://127.0.0.1:3001/api/health
curl -i http://127.0.0.1:3001/api/storage/health
curl -i http://127.0.0.1:3001/api/referrals/REF-HYBRID-003/verified
```

ID `REF-HYBRID-003` hanya tersedia pada storage/ledger lokal yang sebelumnya mengandung record pengujian tersebut; clone baru tidak otomatis memilikinya.

## 7. Alur uji dan hasil yang sudah dilaporkan

| ID                  | Pengujian                                                                       | Hasil / status                      | Evidence atau keterbatasan                                              |
| ------------------- | ------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| TC-FAB-01..06       | Chaincode create/read, duplikat, Org2 create ditolak, invalid hash, record lama | PASS pada output CLI yang dibagikan | Checkout SHA terminal belum diarsipkan                                  |
| TC-FAB-SDK-01       | Node Fabric SDK write/read                                                      | PASS                                | Script `testFabricWrite.js`                                             |
| TC-HYBRID-001       | Download ciphertext dari MinIO dan bandingkan SHA-256 dengan Fabric             | PASS                                | `REF-HYBRID-003`                                                        |
| TC-HYBRID-UI-01     | Testing Dashboard `integrity_verified`                                          | User melaporkan sukses              | Screenshot masih pending                                                |
| TC-M07-A-CODE       | IndexedDB key persistence                                                       | Implemented pada commit `e40142f`   | Uji dekripsi setelah F5 pending                                         |
| TC-M07-A-REFRESH    | Org2 decrypt sesudah refresh browser                                            | **Belum terkonfirmasi**             | Buat referral baru setelah kunci tersimpan, lalu uji sebelum/sesudah F5 |
| TC-SEC-MINIO-TAMPER | Modifikasi ciphertext MinIO dan blok dekripsi                                   | **Belum diuji**                     | Jangan klaim PASS                                                       |
| TC-AUTH-401-403     | Endpoint tanpa session / role tidak sah                                         | **Belum diuji**                     | Auth/RBAC belum diimplementasikan                                       |
| TC-CALIPER          | Throughput/latency Fabric                                                       | **Belum diuji**                     | Benchmark M09 pending                                                   |

**Hash uji yang pernah diverifikasi (`REF-HYBRID-003`):**

```text
5e8db78607d3c85aaf5eb73ab589c0706aab9df948d76c91d67f70ddbcd13722
```

Jangan menggunakan hash sintetis ini sebagai indikator keamanan untuk record lain.

## 8. Tracker milestone (26 Oktober 2026)

Persentase di bawah adalah **estimasi pekerjaan**, bukan persentase lulus uji atau kelayakan klinis.

| Milestone                        | Status      | Progres estimasi | Belum selesai                                                     |
| -------------------------------- | ----------- | ---------------: | ----------------------------------------------------------------- |
| M01 — Environment & Chaincode    | Testing     |              65% | Evidence lingkungan lengkap dan read authorization                |
| M02 — Frontend, Backend & FHIR   | Testing     |              75% | Validator FHIR formal, cakupan negative inputs                    |
| M03 — AES-ECC & SHA-256          | Testing     |              70% | Verifikasi seluruh envelope, key lifecycle dan uji lintas browser |
| M04 — MinIO & Express            | Testing     |              75% | Auth, ACL screenshot, failure handling                            |
| M05 — Demo frontend online       | Testing     |              80% | Runtime/access policy bukti, /api isolation, reboot recovery      |
| M06 — Full hybrid integration    | Testing     |              80% | Org2 decrypt acceptance, pending_ledger reconciliation, tamper    |
| M07 — Auth, MSP & Key Management | In Progress |              25% | Login, RBAC, key management cross-device, IndexedDB refresh test  |
| M08 — Security & failure tests   | In Progress |              10% | Tampering cloud, wrong key/MSP, failure tests                     |
| M09 — Caliper benchmark          | Planned     |               0% | 100/10TPS, 500/50TPS, 1000/100TPS                                 |
| M10 — Bab 4–5 & final validation | Planned     |               0% | Traceability hasil dan validasi akhir                             |

Progres resmi dan penautan screenshot disimpan di [Milestone Tracker dan Evidence Repository Notion](https://app.notion.com/p/4046a2b0c93081c2badbede083a112e8), bukan hanya README ini.

## 9. Risiko, keputusan, dan prioritas berikutnya

- **R-01 — API tanpa auth/RBAC (high):** jangan mengekspos backend. Implementasikan session, role FKTP/FKRTL, dan validasi izin akses di setiap endpoint termasuk GET legacy.
- **R-02 — Kunci browser lokal (high):** IndexedDB dapat menjaga key pada origin/profile yang sama, bukan lintas perangkat atau identitas pengguna. Butuh registrasi public key, lifecycle, recovery, dan rotasi yang aman.
- **R-03 — Hash hanya ciphertext (high):** metadata `iv`, `salt`, `wrappedKey`, `wrapIv`, `ephemeralPublicKey` belum semuanya terikat pada bukti integritas ledger. Perlu rancangan authenticated envelope/canonical manifest.
- **R-04 — Partial MinIO/Fabric failure (high):** status `pending_ledger` memerlukan mekanisme reconcile/idempotency.
- **R-05 — Fabric Org1 admin identity (high):** identity SDK backend tidak membuktikan role user Org2; perlu pemisahan principal dan evaluasi read policy.
- **R-06 — MinIO image komunitas (medium/high):** tinjau keamanan image dan maintenance.
- **D-01 — SHA-256 atas ciphertext:** keputusan implementasi, perlu konsistensi Bab 3 dan persetujuan dosbing.
- **D-02 — Data sintetis dan localhost-only untuk hybrid:** boundary PoC sementara.
- **D-03 — IndexedDB non-extractable demo key:** dipilih untuk persistensi browser sebelum tahap auth; bukan solusi cross-device.
- **D-04 — Pisahkan Fabric latency dan end-to-end latency:** untuk evaluasi Caliper dan Bab 4.

**Next recommended sprint:** (1) uji refresh+decrypt dengan ID baru; (2) autentikasi dan RBAC backend; (3) tamper/integrity envelope dan reconciliation; (4) validator FHIR; (5) Caliper; (6) dokumentasi Bab 4/5.

## 10. Frontend build & keamanan deployment

```bash
cd frontend
npm run build
```

Flag `VITE_ENABLE_LAB=true` hanya mengatur tampilan Developer Lab, **bukan mekanisme keamanan**. Konfigurasi Nginx, Cloudflare Tunnel, dan credential host berada di luar repo. Portal statis yang dapat diakses publik **tidak membuktikan** bahwa backend hybrid bisa dipakai publik; hal itu disengaja sampai akses backend aman.

## 11. Metodologi dokumentasi evidence

Untuk setiap evidence Notion, catat: _tanggal, commit/ref, environment, test ID, input sintetis, expected, actual, PASS/FAIL, limitations_. Pengguna akan mengisi screenshot/log pada kolom **File or Link**. Saat belum ada screenshot atau hasil tes yang valid, tandai **Collected** (bukti kode/log teridentifikasi) atau **To Collect** (belum ada bukti), **bukan Verified**.

---

**Tugas Akhir — Telkom University Jakarta (2026).** NexusMed masih PoC penelitian dan tidak boleh memproses data pasien nyata.
