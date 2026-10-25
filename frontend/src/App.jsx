import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";

import { checkBackend } from "./services/api";
import { generateHospitalKeys } from "./services/cryptoService";

import Org1Dashboard from "./pages/Org1Dashboard";
import Org2Dashboard from "./pages/Org2Dashboard";
import TestingDashboard from "./pages/TestingDashboard";

import "./App.css";
import "./dashboard-separation.css";

function HomePage() {
  return (
    <section className="panel">
      <h2>MedReferral</h2>
      <p className="muted">
        Sistem Rujukan Medis Digital Berbasis Hybrid Blockchain-Cloud
      </p>

      <h3>Pilih Fasilitas Kesehatan</h3>

      <div className="portal-grid">
        <Link to="/org1" className="portal-card">
          <h3>FKTP — Pengirim</h3>
          <p>Membuat dan mengirim rujukan pasien.</p>
          <span>Masuk Dashboard →</span>
        </Link>

        <Link to="/org2" className="portal-card">
          <h3>FKRTL — Penerima</h3>
          <p>Mencari dan menerima dokumen rujukan.</p>
          <span>Masuk Dashboard →</span>
        </Link>
      </div>

      <p className="muted small-note">
        Mode simulasi menggunakan data pasien sintetis.
      </p>
    </section>
  );
}

export default function App() {
  const [backendStatus, setBackendStatus] = useState("Checking...");
  const [receiverKeys, setReceiverKeys] = useState(null);
  const [keyStatus, setKeyStatus] = useState("Menyiapkan kunci sesi demo...");
  const [referrals, setReferrals] = useState({});

  useEffect(() => {
    let active = true;

    checkBackend()
      .then(() => {
        if (active) setBackendStatus("Connected");
      })
      .catch(() => {
        if (active) setBackendStatus("Disconnected");
      });

    generateHospitalKeys()
      .then((pair) => {
        if (!active) return;

        setReceiverKeys(pair);
        setKeyStatus("Kunci demo Org2 siap");
      })
      .catch((error) => {
        if (active) {
          setKeyStatus(`Gagal menyiapkan kunci: ${error.message}`);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  function saveReferral({ referralId, payload, documentHash, createdAt }) {
    if (referrals[referralId]) {
      throw new Error("Nomor rujukan sudah digunakan dalam sesi demo ini.");
    }

    setReferrals((prev) => ({
      ...prev,
      [referralId]: {
        referralId,
        payload,
        documentHash,
        createdAt,
      },
    }));
  }

  return (
    <div className="app-layout">
      <header className="app-header">
        <div>
          <h1>MedReferral</h1>
          <p>Hybrid Blockchain-Cloud Medical Referral</p>
        </div>

        <div className="header-status">
          <span className="backend-status">API: {backendStatus}</span>

          <span className="demo-badge">DATA SINTETIS · DEMO LOKAL</span>
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage />} />

          <Route
            path="/org1"
            element={
              <Org1Dashboard
                receiverPublicKey={receiverKeys?.publicKey}
                onSend={saveReferral}
                keyStatus={keyStatus}
              />
            }
          />

          <Route
            path="/org2"
            element={
              <Org2Dashboard
                referrals={referrals}
                receiverPrivateKey={receiverKeys?.privateKey}
              />
            }
          />

          <Route
            path="/dev"
            element={
              <TestingDashboard
                referrals={referrals}
                receiverKeys={receiverKeys}
                keyStatus={keyStatus}
              />
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
