// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../src/services/api.js", () => ({
  getVerifiedReferral: vi.fn(),
}));

vi.mock("../src/services/cryptoService.js", () => ({
  decryptFHIR: vi.fn(),
}));

import { getVerifiedReferral } from "../src/services/api.js";
import { decryptFHIR } from "../src/services/cryptoService.js";
import Org2Dashboard from "../src/pages/Org2Dashboard.jsx";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDashboard(privateKey) {
  return render(
    <MemoryRouter>
      <Org2Dashboard receiverPrivateKey={privateKey} />
    </MemoryRouter>
  );
}

describe("M07-D5 Org2 Key Guard", () => {
  it("Disables search without private key", () => {
    renderDashboard(null);

    const button = screen.getByRole("button", {
      name: /Cari & Buka Rujukan/i,
    });

    expect(button.disabled).toBe(true);

    expect(
      screen.getByText(/Kunci privat penerima belum tersedia/i)
    ).toBeTruthy();

    expect(getVerifiedReferral).not.toHaveBeenCalled();
    expect(decryptFHIR).not.toHaveBeenCalled();
  });

  it("Enables search with private key", () => {
    renderDashboard({ type: "private" });

    const button = screen.getByRole("button", {
      name: /Cari & Buka Rujukan/i,
    });

    expect(button.disabled).toBe(false);

    expect(
      screen.queryByText(/Kunci privat penerima belum tersedia/i)
    ).toBeNull();
  });
});
