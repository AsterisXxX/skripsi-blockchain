# 🏥 NexusMed — Aplikasi Rujukan Medis Digital Hybrid Blockchain-Cloud

> **Status: Proof of Concept (PoC) — dalam pengembangan.** Proyek ini menggunakan **data medis sintetis**, bukan data pasien sungguhan. Tidak dirancang untuk deployment klinis atau penggunaan produksi.

**NexusMed** adalah purwarupa sistem rujukan satu arah dari **FKTP (Org1)** ke **FKRTL (Org2)**, berdasarkan arsitektur **Hybrid Blockchain-Cloud**. Dokumen rujukan disiapkan sebagai **HL7 FHIR JSON**, dienkripsi di browser, lalu direncanakan disimpan **off-chain** di object storage. **Hyperledger Fabric** berperan menyimpan metadata dan bukti integritas berupa SHA-256 **on-chain**, bukan rekam medis lengkap.

- 🌐 **Demo frontend:** [test.nexusmed.my.id](https://test.nexusmed.my.id) — dapat dibatasi oleh Cloudflare Access.
- 📋 **Progress & evidence:** [NexusMed Thesis Development & Research Hub (Notion)](https://app.notion.com/p/4046a2b0c93081c2badbede083a112e8).
- 🔗 **Repository:** [AsterisXxX/skripsi-blockchain](https://github.com/AsterisXxX/skripsi-blockchain).

> **Batas demo online:** Yang dipublikasikan saat ini adalah **frontend statis** melalui Nginx + Cloudflare Tunnel. Backend Express, MinIO, dan Hyperledger Fabric tetap lokal. Pengiriman rujukan end-to-end melalui Fabric **belum terintegrasi**.

## 🏗️ Rancangan Arsitektur

```text
Org1 / FKTP (Browser)                      Org2 / FKRTL (Browser)
  Form rujukan sintetis                       Input ID rujukan
    ↓                                           ↓
  HL7 FHIR Bundle                            Baca hash dari ledger
    ↓                                           ↓
  AES-256-GCM + ECDH P-256/HKDF             Ambil ciphertext dari cloud
    ↓                                           ↓
  SHA-256 dari ciphertext                    SHA-256 ciphertext unduhan
    ↓                                           ↓
  Express API (lokal)                        Bandingkan hash on-chain
    ├── MinIO: ciphertext                      ↓ jika valid
    └── Fabric: metadata + SHA-256           Dekripsi dengan private key Org2
```

**Diagram merupakan alur target penelitian, bukan status implementasi yang telah selesai.** Saat ini data rujukan dan pasangan kunci Org2 pada dashboard demo masih berada di **state/memory React**. API MinIO sudah diuji **terpisah** dengan encrypted-payload sintetis.

### Tech Stack

| Komponen | Teknologi | Kegunaan |
| --- | --- | --- |
| Frontend | React 19, Vite 8, React Router | Form rujukan, dashboard Org1/Org2, Developer Lab |
| Interoperabilitas | HL7 FHIR JSON Bundle | Struktur dokumen rujukan sintetis |
| Kriptografi browser | Web Crypto API, AES-256-GCM, ECDH P-256 + HKDF-SHA256 | Enkripsi/dekripsi dan perlindungan kunci sesi AES |
| Hash | SHA-256 ciphertext | Fingerprint dokumen untuk integritas |
| Backend | Node.js 22, Express 5 | REST API off-chain |
| Off-chain | MinIO (S3-compatible) | Penyimpanan objek terenkripsi |
| On-chain | Hyperledger Fabric, chaincode Go | Metadata, hash, identitas MSP |
| Deployment frontend | Docker Nginx, Cloudflare Tunnel | Penyajian website statis melalui HTTPS |

**Koreksi penting terhadap README lama:** sistem **tidak menggunakan CP-ABE**. Implementasi saat ini memakai **ECDH P-256 + HKDF-SHA256** untuk membentuk wrapping key, yang melindungi kunci sesi AES; enkripsi data dilakukan dengan **AES-256-GCM di browser**, bukan Node.js server.

## 📌 Status Milestone

| Milestone | Capaian | Status |
| --- | --- | --- |
| M01 — Environment & Smart Contract | Setup WSL2/Docker/Fabric dan chaincode Go `CreateReferral`/`GetReferral` | Implementasi awal; validasi akses & transaksi lengkap pending |
| M02 — Frontend, Backend, FHIR | Dashboard Org1, Org2, Developer Lab, REST backend, FHIR converter awal | Berjalan; validasi FHIR formal pending |
| M03 — AES-ECC & SHA-256 | Encrypt, decrypt, tamper/mismatch lokal | Lolos pengujian modul; E2EE lintas sesi pending |
| M04 — MinIO Off-chain | Private bucket, POST HTTP 201, GET payload sintetis | Uji REST/storage berhasil; belum dari UI |
| M05 — Frontend Online | Vite build → Nginx Docker → Cloudflare Tunnel | Frontend dapat diakses dari jaringan luar |
| M06 — Integrasi FE–BE–MinIO–Fabric | Pengiriman/penerimaan dan hash on-chain | Belum selesai |
| M07 — Auth, MSP & Key Management | Login aplikasi, RBAC, kunci lintas perangkat | Belum selesai |
| M08 — Security Evaluation | Tamper lokal berhasil; tamper object cloud | Pengujian sistem belum selesai |
| M09 — Hyperledger Caliper | Throughput & latency | Belum dimulai |
| M10 — Bab 4–5 & Validasi | Analisis hasil berdasarkan Bab 3 | Dalam perencanaan |

[Lihat checklist lengkap dan evidence milestone di Notion](https://app.notion.com/p/e2ff2f0957654f04b20939c20fc90564).

## 📂 Struktur Repository

```text
skripsi-blockchain/
├── frontend/              # React/Vite, FHIR converter, Web Crypto, dashboards
├── backend/               # Express API dan koneksi MinIO
├── chaincode-rujukan/     # Smart contract Go
├── minio/                 # Docker Compose object storage
├── install-fabric.sh      # Instalasi Fabric
├── .gitignore
└── README.md
```

Folder `fabric-samples/` diabaikan Git dan perlu disiapkan pada mesin baru. Konfigurasi deployment PC kantor tersimpan **di luar repository** pada `~/medreferral-host/`.

## 📋 Prasyarat

- Linux / WSL2 Ubuntu dan Docker Desktop dengan WSL integration
- Docker Engine + Docker Compose
- Node.js 22 dan npm
- Go dan toolkit Hyperledger Fabric yang **versinya kompatibel**
- Git, cURL
- Browser mendukung Web Crypto API (**localhost** atau **HTTPS**)

## 🚀 Setup Lokal

### 1. Clone Repository

```bash
git clone https://github.com/AsterisXxX/skripsi-blockchain.git
cd skripsi-blockchain
```

### 2. Hyperledger Fabric (on-chain)

```bash
chmod +x install-fabric.sh
./install-fabric.sh docker samples binary
cd fabric-samples/test-network
./network.sh up createChannel -c referralchannel
./network.sh deployCC -ccn rujukan -ccp ../../chaincode-rujukan -ccl go -c referralchannel -ccs 1
```

> Untuk upgrade chaincode, sesuaikan `-ccs` berdasarkan sequence definisi chaincode yang sudah ter-deploy. Jangan mengganti sequence tanpa memperhatikan lifecycle Fabric. Chaincode di repo menyediakan `CreateReferral` dan `GetReferral`, tetapi pengujian autentikasi/otorisasi pembacaan dan integrasi API masih perlu diselesaikan.

### 3. MinIO Off-chain Storage

Dari root repository, buat `minio/.env` (file rahasia, tidak boleh di-commit):

```dotenv
MINIO_ROOT_USER=username_lokal
MINIO_ROOT_PASSWORD=password_kuat_lokal
```

Lalu jalankan:

```bash
cd minio
docker compose up -d
docker compose ps
```

- **S3 API:** `http://127.0.0.1:9000`
- **Object Browser:** `http://127.0.0.1:9001`
- Buat bucket **`medical-referrals`** dengan akses **PRIVATE**.

**Catatan image:** Docker Compose saat ini menggunakan image **komunitas** `dappros/minio:RELEASE.2025-09-07T16-13-09Z` untuk PoC lokal karena distribusi MinIO OSS lama mengalami kendala ketersediaan. Ini bukan jaminan update keamanan atau distribusi resmi yang terpelihara. Jangan gunakan untuk data klinis nyata.

### 4. Backend Express

Dari root repository:

```bash
cd backend
npm install
```

Buat `backend/.env`:

```dotenv
PORT=3001
MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_BUCKET=medical-referrals
MINIO_ACCESS_KEY=username_lokal
MINIO_SECRET_KEY=password_kuat_lokal
```

Jalankan:

```bash
npm run dev
```

Endpoint backend pada `http://127.0.0.1:3001`:

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| GET | `/api/health` | Health check Express |
| GET | `/api/storage/health` | Koneksi MinIO dan keberadaan bucket |
| POST | `/api/referrals` | Simpan payload terenkripsi |
| GET | `/api/referrals/:id` | Ambil payload dari MinIO |

Contoh verifikasi:

```bash
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1:3001/api/storage/health
```

**Peringatan:** API rujukan belum punya login dan RBAC; **jangan buka port 3001 ke internet**. Data yang dikirim harus data sintetis.

### 5. Frontend React

Dari root repository, pada terminal terpisah:

```bash
cd frontend
npm install
npm run dev
```

Buka `http://localhost:5173`.

| Route | Halaman |
| --- | --- |
| `/` | Home / pilih fasilitas kesehatan |
| `/org1` | FKTP — pengirim |
| `/org2` | FKRTL — penerima |
| `/dev` | Developer Lab (development atau demo build dengan feature flag) |

**Alur saat ini:** Org1 membuat rujukan dummy → FHIR → encrypted payload → penyimpanan di **React memory** → Org2 mendekripsi menggunakan kunci demo pada sesi yang sama. Ini **belum** mengunggah ciphertext dari dashboard ke MinIO maupun merekamnya di Fabric.

### 6. Build Frontend dan Demo Hosting

```bash
cd frontend      # dari root repo
npm run build
```

Build menghasilkan `frontend/dist/`. Jika ingin menyertakan Developer Lab untuk presentasi **tertutup**, buat `frontend/.env.demo` **lokal**:

```dotenv
VITE_ENABLE_LAB=true
```

Build demo:

```bash
npm run build -- --mode demo
```

> `VITE_ENABLE_LAB` hanyalah feature flag, **bukan autentikasi**. Untuk deployment, gunakan Cloudflare Access atau pembatasan yang setara, data dummy, dan jangan mengirimkan kunci privat/tokens ke bundle frontend.

Di host penelitian, hasil build dipisahkan dari repo menjadi `~/medreferral-host/frontend-dist/`, kemudian disajikan menggunakan Nginx Docker dan Cloudflare Tunnel. **Hanya frontend statis** yang dipublikasikan; tidak ada reverse proxy `/api` ke Express. Konfigurasi tunnel dan token tidak disertakan di repositori.

## 🧪 Pengujian Awal

| Pengujian | Hasil | Batasan |
| --- | --- | --- |
| FHIR converter | Bundle JSON awal terbentuk | Belum menjalani FHIR validator formal |
| Enkripsi/dekripsi AES-ECC | Berhasil pada demo lokal | Kunci Org2 transient dalam browser |
| Deteksi manipulasi | SHA-256 mismatch pada pengujian lokal | Belum terhadap nilai hash Fabric |
| Storage POST | `201 Created`, `stored_offchain`, object key `referrals/REF-TEST-001.json` | Payload sintetis pengujian storage terpisah dari frontend |
| Storage GET | Object uji berhasil diunduh | Belum alur penerima lintas browser |
| Nginx/Cloudflare Tunnel | HTTP 200 dari Docker network; frontend tersedia online | Hanya frontend statis |

**SHA-256 payload yang diunduh belum dianggap bukti integritas on-chain** apabila sumber pembanding hanya berada dalam object cloud yang sama. Verifikasi terhadap hash yang didapat dari Fabric masih bagian dari milestone integrasi.

## 🔒 Keamanan dan Keterbatasan

- **Data sintetis saja.** Tidak terintegrasi BPJS/SATUSEHAT atau modul pembayaran, asuransi, dan manajemen kamar.
- Jangan commit `.env`, token Cloudflare, private key, data pasien asli, atau volume storage.
- API, MinIO, dan Fabric tidak diekspos melalui hostname frontend publik.
- Cloudflare Access bukan pengganti autentikasi petugas, otorisasi backend, atau identitas MSP Fabric.
- Pembatasan MSP pada fungsi **pembacaan** chaincode perlu disempurnakan.
- Kunci penerima belum persisten secara aman lintas browser atau perangkat.
- Tidak ada klaim bahwa sistem aman untuk produksi atau E2EE lintas institusi telah selesai.

## 🗺️ Roadmap

1. Hubungkan form Org1 dengan Express dan MinIO memakai ciphertext FHIR sungguhan.
2. Hubungkan backend dengan `CreateReferral` / `GetReferral` Hyperledger Fabric.
3. Pada Org2, **ambil hash tepercaya dari ledger dan cocokkan sebelum dekripsi**.
4. Implementasikan authentication, authorization (FKTP/FKRTL, MSP), dan manajemen kunci ECC lintas perangkat.
5. Uji tamper ciphertext langsung di MinIO, salah tujuan, format FHIR invalid, dan kegagalan layanan.
6. Benchmark Hyperledger Caliper: **100 transaksi / target 10 TPS**, **500 / 50 TPS**, **1.000 / 100 TPS**; ukur throughput aktual, latency dan error rate.
7. Dokumentasikan hasil sebagai **Bab 4 (implementasi dan evaluasi)** dan **Bab 5 (kesimpulan dan saran)** yang menjawab rancangan/metode **Bab 3**.

---

**Tugas Akhir — Telkom University Jakarta (2026).**
