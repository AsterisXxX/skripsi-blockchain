import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

function mockResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const payload = {
  version: 1,
  algorithm: "AES-256-GCM + ECDH-P256 + HKDF-SHA256",
  ciphertext: "synthetic-ciphertext",
  documentHash: "synthetic-hash",
};

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DEV", false);
  vi.stubEnv("VITE_ENABLE_SYNTHETIC_REFERRALS", "false");
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("M13 synthetic referral API contract", () => {
  it("production OFF blocks upload and retrieval before fetch", async () => {
    const { uploadReferral, getVerifiedReferral } =
      await import("../src/services/api.js");

    await expect(
      uploadReferral(
        "REF-M13-TEST",
        payload,
        "PAT-M13-TEST",
        "poli_umum_org2"
      )
    ).rejects.toThrow();

    await expect(
      getVerifiedReferral("REF-M13-TEST")
    ).rejects.toThrow();

    expect(fetch).not.toHaveBeenCalled();
  });

  it("production ON uploads encrypted envelope and department", async () => {
    vi.stubEnv("VITE_ENABLE_SYNTHETIC_REFERRALS", "true");

    fetch.mockResolvedValue(
      mockResponse(201, {
        status: "stored_hybrid",
        documentHash: payload.documentHash,
      })
    );

    const { uploadReferral } =
      await import("../src/services/api.js");

    const result = await uploadReferral(
      "REF-M13-TEST",
      payload,
      "PAT-M13-TEST",
      "poli_umum_org2"
    );

    expect(result.status).toBe("stored_hybrid");

    expect(fetch).toHaveBeenCalledTimes(1);

    const [url, options] = fetch.mock.calls[0];
    const body = JSON.parse(options.body);

    expect(url).toBe("/api/referrals");
    expect(options.method).toBe("POST");
    expect(options.credentials).toBe("include");
    expect(options.headers["Content-Type"]).toBe(
      "application/json"
    );

    expect(body).toEqual({
      referralId: "REF-M13-TEST",
      patientId: "PAT-M13-TEST",
      payload,
      targetDepartmentId: "poli_umum_org2",
    });
  });

  it("production ON retrieves verified ciphertext", async () => {
    vi.stubEnv("VITE_ENABLE_SYNTHETIC_REFERRALS", "true");

    fetch.mockResolvedValue(
      mockResponse(200, {
        verified: true,
        status: "integrity_verified",
        payload,
      })
    );

    const { getVerifiedReferral } =
      await import("../src/services/api.js");

    const result = await getVerifiedReferral(
      "REF-M13-TEST"
    );

    expect(result.verified).toBe(true);
    expect(result.payload).toEqual(payload);

    expect(fetch.mock.calls[0][0]).toBe(
      "/api/referrals/REF-M13-TEST/verified"
    );
  });

  it("HTTP 202 remains pending, not stored_hybrid", async () => {
    vi.stubEnv("VITE_ENABLE_SYNTHETIC_REFERRALS", "true");

    fetch.mockResolvedValue(
      mockResponse(202, {
        status: "pending_ledger",
        documentHash: payload.documentHash,
      })
    );

    const { uploadReferral } =
      await import("../src/services/api.js");

    const result = await uploadReferral(
      "REF-M13-PENDING",
      payload,
      "PAT-M13-TEST",
      "poli_umum_org2"
    );

    expect(result.status).toBe("pending_ledger");
    expect(result.status).not.toBe("stored_hybrid");
  });

  it("HTTP 401 fails closed", async () => {
    vi.stubEnv("VITE_ENABLE_SYNTHETIC_REFERRALS", "true");

    fetch.mockResolvedValue(
      mockResponse(401, {
        error: "Sesi tidak valid.",
      })
    );

    const { uploadReferral } =
      await import("../src/services/api.js");

    await expect(
      uploadReferral(
        "REF-M13-TEST",
        payload,
        "PAT-M13-TEST",
        "poli_umum_org2"
      )
    ).rejects.toMatchObject({
      status: 401,
    });
  });
});
