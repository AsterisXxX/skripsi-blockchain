# 🏥 Aplikasi Rujukan Medis Digital: Hybrid Blockchain-Cloud

Repositori ini berisi purwarupa (Proof of Concept) dari sistem rujukan medis digital lintas fasilitas kesehatan menggunakan arsitektur **Hybrid Blockchain-Cloud**. Sistem ini menggunakan **Hyperledger Fabric** untuk pencatatan _on-chain_ (menjamin integritas data) dan **Node.js** untuk pengamanan _off-chain_ menggunakan _End-to-End Encryption_ (E2EE) berbasis Hybrid Kriptografi (AES-256-GCM & CP-ABE).

## 📋 Prasyarat (Prerequisites)

Pastikan sistem operasi (direkomendasikan Linux/WSL2 Ubuntu) sudah terinstal:

1. **Docker & Docker Compose** (Untuk menjalankan node jaringan Fabric)
2. **Go (Golang)** (minimal v1.19 - untuk Smart Contract)
3. **Node.js & npm** (minimal v18 - untuk mesin kriptografi sisi klien)
4. **Git & cURL**

---

## 🚀 Langkah 1: Instalasi & Persiapan Lingkungan

Karena _folder_ `fabric-samples` berukuran sangat besar dan memiliki repositori bawaan, _folder_ tersebut tidak diunggah ke GitHub. Lakukan instalasi ulang _binaries_ Fabric di mesin baru:

```bash
# 1. Clone repositori ini
git clone https://github.com/USERNAME/tugas-akhir-blockchain.git
cd tugas-akhir-blockchain

# 2. Unduh Hyperledger Fabric Binaries & Docker Images
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh && chmod +x install-fabric.sh
./install-fabric.sh docker samples binary
```

---

## 🔗 Langkah 2: Menjalankan Jaringan Blockchain (On-Chain)

Kita akan menyalakan jaringan simulasi (`test-network`) yang terdiri dari Orderer, Org1 (RS Pengirim), dan Org2 (RS Penerima), lalu membuat sebuah saluran privat bernama `referralchannel`.

```bash
cd fabric-samples/test-network

# Bersihkan sisa jaringan sebelumnya (jika ada)
./network.sh down

# Nyalakan jaringan dan buat channel rujukan
./network.sh up createChannel -c referralchannel
```

---

## 📜 Langkah 3: Deploy Smart Contract (Chaincode)

_Smart Contract_ yang digunakan ditulis dalam bahasa Go dan terletak di dalam folder `chaincode-rujukan`.

```bash
# Pastikan posisi masih di fabric-samples/test-network
# Deploy chaincode dengan nama 'rujukan'
./network.sh deployCC -ccn rujukan -ccp ../../chaincode-rujukan -ccl go -c referralchannel -ccs 1
```

_(Catatan: Jika ada update pada kode Go di masa depan, ubah argumen `-ccs 1` menjadi `-ccs 2` dan seterusnya)._

---

## 🔐 Langkah 4: Setup Sisi Klien (Off-Chain / Kriptografi)

Pindah ke folder `client-app` untuk mempersiapkan generator data medis berstandar HL7 FHIR dan mesin enkripsi E2EE.

```bash
cd ../../client-app

# Instal dependensi Node.js
npm install
```

---

## 🧪 Langkah 5: Simulasi Skenario Rujukan (End-to-End)

### A. Sisi Org1 (RS Pengirim)

1. **Bangkitkan Data Medis (HL7 FHIR)**

   ```bash
   node generate_dummy.js
   ```

   _Output: Menghasilkan `dummy_rekam_medis_fhir.json` dan mencetak Hash SHA-256 dokumen._

2. **Enkripsi File sebelum ke Cloud**

   ```bash
   node encrypt_e2ee.js
   ```

   _Output: Menghasilkan `cloud_payload_terenkripsi.json` (Ciphertext) dan mencetak **Kunci AES Asli** di terminal. Simpan kunci ini!_

3. **Catat Rujukan ke Blockchain (Write/Invoke)**
   Gunakan terminal lain, masuk ke `fabric-samples/test-network`, dan jalankan transaksi ke _ledger_ menggunakan identitas Org1:

   ```bash
   export PATH=${PWD}/../bin:$PATH
   export FABRIC_CFG_PATH=$PWD/../config/
   export CORE_PEER_TLS_ENABLED=true
   export CORE_PEER_LOCALMSPID="Org1MSP"
   export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
   export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
   export CORE_PEER_ADDRESS=localhost:7051

   peer chaincode invoke -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls --cafile "${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" -C referralchannel -n rujukan --peerAddresses localhost:7051 --tlsRootCertFiles "${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" --peerAddresses localhost:9051 --tlsRootCertFiles "${PWD}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt" -c '{"function":"CreateReferral","Args":["ID_RUJUKAN", "ID_PASIEN", "Org2MSP", "HASH_DARI_LANGKAH_1", "WAKTU_SAAT_INI"]}'
   ```

### B. Sisi Org2 (RS Penerima)

1. **Tarik Data dari Blockchain (Read/Query)**
   Set identitas terminal ke Org2 dan lakukan _query_:

   ```bash
   export CORE_PEER_LOCALMSPID="Org2MSP"
   export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt
   export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp
   export CORE_PEER_ADDRESS=localhost:9051

   peer chaincode query -C referralchannel -n rujukan -c '{"Args":["GetReferral","ID_RUJUKAN"]}'
   ```

2. **Dekripsi Data dari Cloud**
   Kembali ke folder `client-app`, lalu gunakan kunci AES yang disimpan pada Langkah A.2 untuk membuka file:
   ```bash
   node decrypt_e2ee.js <KUNCI_AES_ANDA>
   ```
   _Output: Menghasilkan `hasil_dekripsi_org2.json` yang isinya 100% otentik seperti dokumen asli._

---

_Dibuat untuk keperluan Tugas Akhir Universitas Telkom (2026)._
