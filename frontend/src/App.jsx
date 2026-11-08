import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";

import { checkBackend, getSession, logout } from "./services/api";

import { getOrCreateHospitalKeys } from "./services/keyStorage";
import { resolveSessionKeys } from "./services/sessionKeyResolver";

import LoginPage from "./pages/LoginPage";
import Org1Dashboard from "./pages/Org1Dashboard";
import Org2Dashboard from "./pages/Org2Dashboard";
import Org2KeyEnrollment from "./components/Org2KeyEnrollment";
import AdminDashboard from "./pages/AdminDashboard";

import "./App.css";
import "./dashboard-separation.css";

const ENABLE_LAB =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_LAB === "true";

const REGISTRY_MODE =
  import.meta.env.VITE_KEY_LIFECYCLE_MODE === "registry";

const ENABLE_KEY_ENROLLMENT =
  import.meta.env.VITE_ENABLE_KEY_ENROLLMENT === "true";

const RECEIVER_INSTITUTION_ID =
  import.meta.env.VITE_RECEIVER_INSTITUTION_ID || "";

const TestingDashboard = ENABLE_LAB
  ? lazy(() => import("./pages/TestingDashboard"))
  : null;

function ProtectedRoute({ user, loading, role, children }) {
  if (loading) {
    return <p className="muted">Memeriksa sesi login...</p>;
  }

  if (!user) {
    return <Navigate to={`/login?role=${role}`} replace />;
  }

  if (user.role !== role) {
    return <Navigate to={`/${user.role}`} replace />;
  }

  return children;
}

function HomePage({ user }) {
  return (
    <section className="panel">
      <h2>NexusMed</h2>

      <p className="muted">
        Sistem Rujukan Medis Digital Berbasis Hybrid Blockchain-Cloud
      </p>

      <h3>Pilih Fasilitas Kesehatan</h3>

      <div className="portal-grid">
        <Link
          to={!user ? "/login?role=org1" : "/org1"}
          className="portal-card"
        >
          <h3>FKTP — Pengirim</h3>
          <p>Membuat dan mengirim rujukan pasien.</p>
          <span>Masuk Dashboard →</span>
        </Link>

        <Link
          to={!user ? "/login?role=org2" : "/org2"}
          className="portal-card"
        >
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
  const [backendStatus, setBackendStatus] = useState(
    "Checking...",
  );

  const [user, setUser] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const [logoutPending, setLogoutPending] = useState(false);
  const logoutInFlight = useRef(false);

  const [keyResolution, setKeyResolution] = useState(null);

  function handleLogin(nextUser) {
    setKeyResolution(null);
    setSessionGeneration((previous) => previous + 1);
    setUser(nextUser);
    setReferrals({});
  }

  // Key hanya boleh digunakan oleh identitas sesi yang memuatnya.
  const sessionIdentity = user
    ? JSON.stringify([
        user.role,
        user.userId ?? null,
        user.institutionId ?? null,
        user.username ?? null,
        sessionGeneration,
      ])
    : null;

  const activeKeyResolution =
    !sessionLoading &&
    !logoutPending &&
    sessionIdentity &&
    keyResolution?.sessionIdentity === sessionIdentity
      ? keyResolution
      : null;

  const receiverKeys = activeKeyResolution?.keys ?? null;
  const keyStatus =
    activeKeyResolution?.status ?? "Menunggu kunci sesi aktif...";

  const [referrals, setReferrals] = useState({});

  useEffect(() => {
    let active = true;

    {
      checkBackend()
        .then(() => {
          if (active) setBackendStatus("Connected");
        })
        .catch(() => {
          if (active) setBackendStatus("Disconnected");
        });

      getSession()
        .then((result) => {
          if (active) setUser(result.user ?? null);
        })
        .catch(() => {
          if (active) setUser(null);
        })
        .finally(() => {
          if (active) setSessionLoading(false);
        });
    }

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    // Tidak membuka penyimpanan kunci selama pemeriksaan sesi.
    if (sessionLoading || !user || logoutPending) {
      return () => {
        active = false;
      };
    }

    if (!REGISTRY_MODE) {
      getOrCreateHospitalKeys()
        .then(({ keys, source }) => {
          if (!active) return;

          setKeyResolution({
            sessionIdentity,
            keys,
            status:
              source === "indexeddb"
                ? "Kunci demo dimuat dari IndexedDB"
                : "Kunci demo baru disimpan ke IndexedDB",
          });
        })
        .catch((error) => {
          if (!active) return;

          setKeyResolution({
            sessionIdentity,
            keys: null,
            status: `Kunci demo gagal dimuat: ${error.message}`,
          });
        });
    } else {
      resolveSessionKeys(user, {
        receiverInstitutionId: RECEIVER_INSTITUTION_ID,
      })
        .then((keys) => {
          if (!active) return;

          setKeyResolution({
            sessionIdentity,
            keys,
            status: `Registry key aktif: ${keys.keyId}`,
          });
        })
        .catch((error) => {
          if (!active) return;

          setKeyResolution({
            sessionIdentity,
            keys: null,
            status: `Registry key tidak tersedia: ${error.message}`,
          });
        });
    }

    return () => {
      active = false;
    };
  }, [user, sessionLoading, sessionIdentity, logoutPending]);

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

  async function handleLogout() {
    if (logoutInFlight.current) return;

    logoutInFlight.current = true;
    setLogoutPending(true);

    // Putuskan akses key sebelum memulai request logout.
    setKeyResolution(null);
    setSessionGeneration((previous) => previous + 1);
    setReferrals({});

    try {
      await logout();
      setUser(null);
    } catch (error) {
      // Jangan memulihkan key lama jika logout gagal.
      // Sesi harus diverifikasi ulang sebelum key dapat digunakan.
      setUser(null);
      alert(`Logout gagal: ${error.message}. Silakan login kembali.`);
    } finally {
      logoutInFlight.current = false;
      setLogoutPending(false);
    }
  }

  return (
    <div className="app-layout">
      <header className="app-header">
        <div>
          <h1>NexusMed</h1>
          <p>Hybrid Blockchain-Cloud Medical Referral</p>
        </div>

        <div className="header-status">
          <span className="backend-status">API: {backendStatus}</span>

          <span className="demo-badge">
            DATA SINTETIS · {import.meta.env.DEV ? "DEMO LOKAL" : "DEMO WEB"}
          </span>

          {user && (
            <div className="auth-user">
              <span>
                {user.institution} · {user.username}
              </span>
              <button
                type="button"
                className="auth-logout"
                onClick={handleLogout}
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage user={user} />} />

          <Route
            path="/login"
            element={
              sessionLoading ? (
                <p className="muted">Memeriksa sesi login...</p>
              ) : user ? (
                <Navigate to={`/${user.role}`} replace />
              ) : (
                <LoginPage onLogin={handleLogin} />
              )
            }
          />

          <Route
            path="/org1"
            element={
              <ProtectedRoute user={user} loading={sessionLoading} role="org1">
                <Org1Dashboard
                  receiverPublicKey={receiverKeys?.publicKey}
                  onSend={saveReferral}
                  keyStatus={keyStatus}
                />
              </ProtectedRoute>
            }
          />

          <Route
            path="/org2"
            element={
              <ProtectedRoute user={user} loading={sessionLoading} role="org2">
                <>
                  {REGISTRY_MODE &&
                      ENABLE_KEY_ENROLLMENT &&
                      Boolean(activeKeyResolution) &&
                      !receiverKeys?.privateKey && (
                    <Org2KeyEnrollment
                      user={user}
                      onKeyReady={() =>
                        setSessionGeneration((previous) => previous + 1)
                      }
                    />
                  )}
                  <Org2Dashboard
                    receiverPrivateKey={receiverKeys?.privateKey}
                  />
                </>
              </ProtectedRoute>
            }
          />

          {ENABLE_LAB && TestingDashboard && (
            <Route
              path="/dev"
              element={
                <ProtectedRoute
                  user={user}
                  loading={sessionLoading}
                  role="org2"
                >
                  <Suspense fallback={<p>Memuat Developer Lab...</p>}>
                    <TestingDashboard
                      referrals={referrals}
                      receiverKeys={receiverKeys}
                      keyStatus={keyStatus}
                    />
                  </Suspense>
                </ProtectedRoute>
              }
            />
          )}

          {(
            <Route
              path="/consortium_admin"
              element={
                <ProtectedRoute
                  user={user}
                  loading={sessionLoading}
                  role="consortium_admin"
                >
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
          )}

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
