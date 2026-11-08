// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Org1Dashboard from "../src/pages/Org1Dashboard.jsx";

const mocks = vi.hoisted(() => ({
  uploadReferral: vi.fn(),
  encryptFHIR: vi.fn(),
  convertToFHIR: vi.fn(),
}));

vi.mock("../src/services/api", () => ({
  uploadReferral: mocks.uploadReferral,
}));

vi.mock("../src/services/cryptoService", () => ({
  encryptFHIR: mocks.encryptFHIR,
}));

vi.mock("../src/utils/fhirConverter", () => ({
  convertToFHIR: mocks.convertToFHIR,
}));

const payload = {
  ciphertext: "synthetic-only",
  documentHash: "synthetic-document-hash",
};

function setup() {
  const onSend = vi.fn();

  const view = render(
    <MemoryRouter>
      <Org1Dashboard
        receiverPublicKey={{}}
        onSend={onSend}
        keyStatus={{ status: "ready" }}
      />
    </MemoryRouter>
  );

  fireEvent.change(
    screen.getByPlaceholderText("REF-2026-001"),
    { target: { value: "REF-M13-UI-TEST" } }
  );

  fireEvent.change(
    screen.getByPlaceholderText("PAT-001"),
    { target: { value: "PAT-M13-TEST" } }
  );

  fireEvent.submit(view.container.querySelector("form"));

  return { onSend };
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.convertToFHIR.mockReturnValue({
    resourceType: "Bundle",
  });

  mocks.encryptFHIR.mockResolvedValue(payload);
});

afterEach(() => {
  cleanup();
});

describe("M13 Org1 referral submission safety", () => {
  for (const pendingStatus of [
    "pending_storage",
    "pending_ledger",
  ]) {
    it(`${pendingStatus} must not publish success`, async () => {
      mocks.uploadReferral.mockResolvedValue({
        status: pendingStatus,
        documentHash: payload.documentHash,
      });

      const { onSend } = setup();

      const expectedMessage =
        pendingStatus === "pending_storage"
          ? /Penyimpanan ciphertext belum terkonfirmasi/
          : /Ciphertext tersimpan, tetapi ledger belum terkonfirmasi/;

      expect(
        await screen.findByText(expectedMessage)
      ).toBeTruthy();

      expect(onSend).not.toHaveBeenCalled();

      expect(mocks.uploadReferral).toHaveBeenCalledWith(
        "REF-M13-UI-TEST",
        payload,
        "PAT-M13-TEST",
        "poli_umum_org2"
      );
    });
  }

  it("HTTP 401 must not publish success", async () => {
    mocks.uploadReferral.mockRejectedValue(
      new Error("Sesi tidak valid.")
    );

    const { onSend } = setup();

    expect(
      await screen.findByText("Sesi tidak valid.")
    ).toBeTruthy();

    expect(onSend).not.toHaveBeenCalled();
  });

  it("confirmed hybrid commit publishes success once", async () => {
    mocks.uploadReferral.mockResolvedValue({
      status: "stored_hybrid",
      documentHash: payload.documentHash,
    });

    const { onSend } = setup();

    expect(
      await screen.findByText(
        /berhasil disimpan ke MinIO dan dicatat di Fabric/
      )
    ).toBeTruthy();

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        referralId: "REF-M13-UI-TEST",
        documentHash: payload.documentHash,
      })
    );
  });
});
