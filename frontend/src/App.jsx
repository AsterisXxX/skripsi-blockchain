
import { useEffect, useState } from "react";
import { checkBackend } from "./services/api";
import Org1Dashboard from "./pages/Org1Dashboard";
import Org2Dashboard from "./pages/Org2Dashboard";
import "./App.css";

export default function App() {
  const [activeOrg, setActiveOrg] = useState("org1");
  const [backendStatus, setBackendStatus] = useState("Checking...");

  useEffect(() => {
    checkBackend()
      .then(() => setBackendStatus("Connected"))
      .catch(() => setBackendStatus("Disconnected"));
  }, []);

  return (
    <div className="app-layout">
      <header className="app-header">
        <div>
          <h1>MedReferral</h1>
          <p>Hybrid Blockchain-Cloud Medical Referral System</p>
        </div>

        <span className="backend-status">
          API: {backendStatus}
        </span>
      </header>

      <main className="app-main">
        <div className="intro">
          <h2>Medical Referral Dashboard</h2>
          <p>
            Proof of Concept — HL7 FHIR, AES-ECC,
            Hyperledger Fabric
          </p>
        </div>

        <nav className="org-navigation">
          <button
            className={activeOrg === "org1" ? "active" : ""}
            onClick={() => setActiveOrg("org1")}
          >
            Org1 — Pengirim
          </button>

          <button
            className={activeOrg === "org2" ? "active" : ""}
            onClick={() => setActiveOrg("org2")}
          >
            Org2 — Penerima
          </button>
        </nav>

        {activeOrg === "org1"
          ? <Org1Dashboard />
          : <Org2Dashboard />}
      </main>
    </div>
  );
}
