// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
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
  getVerifiedReferral: vi.fn(),
  decryptFHIR: vi.fn(),
}));

vi.mock("../src/services/api.js", () => ({
  getVerifiedReferral: mocks.getVerifiedReferral,
}));

vi.mock("../src/services/cryptoService.js", () => ({
  decryptFHIR: mocks.decryptFHIR,
}));

import Org2Dashboard from "../src/pages/Org2Dashboard.jsx";

function deferred() {
  let resolve;

  const promise = new Promise((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

function renderOrg2(key) {
  const view = (receiverPrivateKey) => (
    <MemoryRouter>
      <Org2Dashboard receiverPrivateKey={receiverPrivateKey} />
    </MemoryRouter>
  );

  const result = render(view(key));

  return {
    revokeKey: () => result.rerender(view(null)),
  };
}

function startSearch() {
  fireEvent.change(
    screen.getByRole("textbox", { name: /Nomor Rujukan/i }),
    { target: { value: "REF-M07-D7-001" } }
  );

  fireEvent.click(
    screen.getByRole("button", { name: /Cari & Buka Rujukan/i })
  );
}

const verified = {
  status: "verified",
  referralId: "REF-M07-D7-001",
  payload: { synthetic: true },
  ledgerHash: "synthetic-hash",
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("M07-D7 Org2 asynchronous key revocation", () => {
  it("Must not decrypt when key is revoked during verification", async () => {
    const pendingVerification = deferred();

    mocks.getVerifiedReferral.mockReturnValue(
      pendingVerification.promise
    );

    const { revokeKey } = renderOrg2({
      type: "private",
    });

    startSearch();

    await waitFor(() => {
      expect(mocks.getVerifiedReferral).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      revokeKey();
    });

    await act(async () => {
      pendingVerification.resolve(verified);
      await pendingVerification.promise;
    });

    expect(mocks.decryptFHIR).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Ringkasan Rujukan FHIR R4")
    ).toBeNull();
  });

  it("Must not publish FHIR after key revocation during decryption", async () => {
    const pendingDecryption = deferred();

    mocks.getVerifiedReferral.mockResolvedValue(verified);
    mocks.decryptFHIR.mockReturnValue(
      pendingDecryption.promise
    );

    const { revokeKey } = renderOrg2({
      type: "private",
    });

    startSearch();

    await waitFor(() => {
      expect(mocks.decryptFHIR).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      revokeKey();
    });

    await act(async () => {
      pendingDecryption.resolve({
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "Patient",
              name: [{ text: "Synthetic D7 Patient" }],
            },
          },
        ],
      });

      await pendingDecryption.promise;
    });

    expect(
      screen.queryByText("Ringkasan Rujukan FHIR R4")
    ).toBeNull();

    expect(
      screen.queryByText("Synthetic D7 Patient")
    ).toBeNull();
  });
});
