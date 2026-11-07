// @vitest-environment jsdom

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkBackend: vi.fn(),
  logout: vi.fn(),
  getVerifiedReferral: vi.fn(),
  resolveSessionKeys: vi.fn(),
  decryptFHIR: vi.fn(),
  getOrCreateHospitalKeys: vi.fn(),
}));

vi.mock("../src/services/api.js", () => ({
  getSession: mocks.getSession,
  checkBackend: mocks.checkBackend,
  logout: mocks.logout,
  getVerifiedReferral: mocks.getVerifiedReferral,
}));

vi.mock("../src/services/sessionKeyResolver.js", () => ({
  resolveSessionKeys: mocks.resolveSessionKeys,
}));

vi.mock("../src/services/keyStorage.js", () => ({
  getOrCreateHospitalKeys: mocks.getOrCreateHospitalKeys,
}));

vi.mock("../src/services/cryptoService.js", () => ({
  decryptFHIR: mocks.decryptFHIR,
}));

vi.mock("../src/pages/LoginPage.jsx", () => ({
  default: ({ onLogin }) => (
    <button
      type="button"
      onClick={() =>
        onLogin({
          userId: "synthetic-user-org2",
          username: "synthetic-org2",
          role: "org2",
          institutionId: "synthetic-fkrtl",
          institution: "Synthetic FKRTL",
        })
      }
    >
      Synthetic Login
    </button>
  ),
}));

vi.mock("../src/pages/Org1Dashboard.jsx", () => ({
  default: () => <p>Org1 Mock</p>,
}));

vi.mock("../src/pages/AdminDashboard.jsx", () => ({
  default: () => <p>Admin Mock</p>,
}));

let App;

beforeAll(async () => {
  vi.stubEnv("VITE_KEY_LIFECYCLE_MODE", "registry");
  vi.stubEnv("VITE_RECEIVER_INSTITUTION_ID", "synthetic-fkrtl");

  ({ default: App } = await import("../src/App.jsx"));
});

beforeEach(() => {
  vi.resetAllMocks();

  mocks.getSession.mockResolvedValue({ user: null });
  mocks.checkBackend.mockResolvedValue({ status: "ok" });
  mocks.logout.mockResolvedValue({ success: true });

  mocks.resolveSessionKeys.mockResolvedValue({
    mode: "registry",
    role: "org2",
    institutionId: "synthetic-fkrtl",
    keyId: "synthetic-key-001",
    publicKey: { type: "public" },
    privateKey: { type: "private" },
  });
});

afterEach(() => {
  cleanup();
});

describe("M07-D7.5 Actual App logout integration", () => {
  it("Rejects stale verification after logout and re-login", async () => {
    let finishVerification;

    const verification = new Promise((resolve) => {
      finishVerification = resolve;
    });

    mocks.getVerifiedReferral.mockReturnValue(verification);

    render(
      <MemoryRouter initialEntries={["/login?role=org2"]}>
        <App />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByText("Synthetic Login"));

    const searchButton = await screen.findByRole("button", {
      name: /Cari & Buka Rujukan/i,
    });

    await waitFor(() => {
      expect(searchButton.disabled).toBe(false);
    });

    fireEvent.change(
      screen.getByRole("textbox", { name: /Nomor Rujukan/i }),
      { target: { value: "REF-M07-D7-LOGIN-001" } }
    );

    fireEvent.click(searchButton);

    await waitFor(() => {
      expect(mocks.getVerifiedReferral).toHaveBeenCalledTimes(1);
    });

    // Klik tombol Logout asli pada App.
    fireEvent.click(screen.getByRole("button", {
      name: "Logout",
    }));

    await waitFor(() => {
      expect(mocks.logout).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Synthetic Login")).toBeTruthy();
    });

    // Respons request lama tiba setelah logout.
    await act(async () => {
      finishVerification({
        status: "verified",
        referralId: "REF-M07-D7-LOGIN-001",
        payload: { synthetic: true },
        ledgerHash: "synthetic-hash",
      });

      await verification;
    });

    expect(mocks.decryptFHIR).not.toHaveBeenCalled();

    // Login ulang dengan identitas yang sama.
    fireEvent.click(screen.getByText("Synthetic Login"));

    await waitFor(() => {
      expect(mocks.resolveSessionKeys).toHaveBeenCalledTimes(2);
    });

    expect(
      screen.queryByText("Ringkasan Rujukan FHIR R4")
    ).toBeNull();

    expect(
      screen.queryByText("REF-M07-D7-LOGIN-001")
    ).toBeNull();

    expect(mocks.getOrCreateHospitalKeys).not.toHaveBeenCalled();
  });

  it("Does not publish late decrypted FHIR after logout and re-login", async () => {
    let finishDecryption;

    const decryption = new Promise((resolve) => {
      finishDecryption = resolve;
    });

    mocks.getVerifiedReferral.mockResolvedValue({
      status: "verified",
      referralId: "REF-M07-D7-DECRYPT-001",
      payload: { synthetic: true },
      ledgerHash: "synthetic-hash",
    });

    mocks.decryptFHIR.mockReturnValue(decryption);

    render(
      <MemoryRouter initialEntries={["/login?role=org2"]}>
        <App />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByText("Synthetic Login"));

    const searchButton = await screen.findByRole("button", {
      name: /Cari & Buka Rujukan/i,
    });

    await waitFor(() => {
      expect(searchButton.disabled).toBe(false);
    });

    fireEvent.change(
      screen.getByRole("textbox", { name: /Nomor Rujukan/i }),
      { target: { value: "REF-M07-D7-DECRYPT-001" } }
    );

    fireEvent.click(searchButton);

    await waitFor(() => {
      expect(mocks.decryptFHIR).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Logout" })
    );

    await screen.findByText("Synthetic Login");

    // Login ulang sebelum dekripsi lama selesai.
    fireEvent.click(screen.getByText("Synthetic Login"));

    await waitFor(() => {
      expect(mocks.resolveSessionKeys).toHaveBeenCalledTimes(2);
      expect(
        screen.getByRole("button", {
          name: /Cari & Buka Rujukan/i,
        }).disabled
      ).toBe(false);
    });

    // Hasil dari operasi sesi pertama tiba terlambat.
    await act(async () => {
      finishDecryption({
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "Patient",
              name: [{ text: "Synthetic Stale Patient" }],
            },
          },
        ],
      });

      await decryption;
    });

    expect(mocks.decryptFHIR).toHaveBeenCalledTimes(1);

    expect(
      screen.queryByText("Ringkasan Rujukan FHIR R4")
    ).toBeNull();

    expect(
      screen.queryByText("Synthetic Stale Patient")
    ).toBeNull();

    expect(
      screen.queryByText("REF-M07-D7-DECRYPT-001")
    ).toBeNull();
  });

});
