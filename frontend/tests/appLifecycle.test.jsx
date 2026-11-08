// @vitest-environment jsdom

import React from "react";
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkBackend: vi.fn(),
  logout: vi.fn(),
  resolveSessionKeys: vi.fn(),
  getOrCreateHospitalKeys: vi.fn(),
}));

vi.mock("../src/services/api.js", () => ({
  getSession: mocks.getSession,
  checkBackend: mocks.checkBackend,
  logout: mocks.logout,
}));

vi.mock("../src/services/sessionKeyResolver.js", () => ({
  resolveSessionKeys: mocks.resolveSessionKeys,
}));

vi.mock("../src/services/keyStorage.js", () => ({
  getOrCreateHospitalKeys: mocks.getOrCreateHospitalKeys,
}));

vi.mock("../src/pages/LoginPage.jsx", () => ({
  default: ({ onLogin }) =>
    React.createElement(
      React.Fragment,
      null,
      ...["A", "B"].map((account) =>
        React.createElement(
          "button",
          {
            key: account,
            onClick: () =>
              onLogin({
                role: "org2",
                userId: `synthetic-user-${account}`,
                institutionId: `synthetic-org2-${account}`,
                username: `synthetic-receiver-${account}`,
                institution: `Synthetic Hospital ${account}`,
              }),
          },
          account === "A" ? "Simulate Login" : "Simulate Login B"
        )
      )
    ),
}));

vi.mock("../src/pages/Org1Dashboard.jsx", () => ({
  default: () =>
    React.createElement("p", null, "Org1 Dashboard"),
}));

vi.mock("../src/pages/Org2Dashboard.jsx", () => ({
  default: ({ receiverPrivateKey }) =>
    React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "p",
        null,
        receiverPrivateKey
          ? "Receiver Key Available"
          : "Receiver Key Unavailable"
      ),
      receiverPrivateKey &&
        React.createElement(
          "span",
          { "data-testid": "receiver-key-owner" },
          receiverPrivateKey.owner ?? "unknown"
        )
    ),
}));

vi.mock("../src/components/Org2KeyEnrollment.jsx", () => ({
  default: () =>
    React.createElement(
      "div",
      { "data-testid": "org2-enrollment-panel" },
      "Institutional Key Enrollment"
    ),
}));

vi.mock("../src/pages/AdminDashboard.jsx", () => ({
  default: () =>
    React.createElement("p", null, "Admin Dashboard"),
}));

let App;

beforeAll(async () => {
  vi.stubEnv("VITE_KEY_LIFECYCLE_MODE", "registry");
  vi.stubEnv("VITE_RECEIVER_INSTITUTION_ID", "synthetic-org2");
  vi.stubEnv("VITE_ENABLE_KEY_ENROLLMENT", "true");

  ({ default: App } = await import("../src/App.jsx"));
});

beforeEach(() => {
  vi.clearAllMocks();

  mocks.getSession.mockResolvedValue({ user: null });
  mocks.checkBackend.mockResolvedValue({ status: "ok" });
  mocks.logout.mockResolvedValue({ success: true });

  mocks.resolveSessionKeys.mockResolvedValue({
    mode: "registry",
    role: "org2",
    institutionId: "synthetic-org2",
    keyId: "synthetic-key-001",
    publicKey: { type: "public" },
    privateKey: { type: "private" },
  });
});

afterEach(() => {
  cleanup();
});

describe("M07-C4 App Session Lifecycle", () => {
  it("Anonymous session does not load receiver keys", async () => {
    render(
      <MemoryRouter initialEntries={["/login?role=org2"]}>
        <App />
      </MemoryRouter>
    );

    expect(
      await screen.findByText("Simulate Login")
    ).toBeTruthy();

    expect(mocks.resolveSessionKeys).not.toHaveBeenCalled();
    expect(mocks.getOrCreateHospitalKeys).not.toHaveBeenCalled();
  });

  it("Org2 login and logout clear active key access", async () => {
    render(
      <MemoryRouter initialEntries={["/login?role=org2"]}>
        <App />
      </MemoryRouter>
    );

    fireEvent.click(
      await screen.findByText("Simulate Login")
    );

    expect(
      await screen.findByText("Receiver Key Available")
    ).toBeTruthy();

    expect(mocks.resolveSessionKeys).toHaveBeenCalledTimes(1);
    expect(mocks.getOrCreateHospitalKeys).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Logout"));

    await waitFor(() => {
      expect(mocks.logout).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText("Simulate Login")
      ).toBeTruthy();
    });

    expect(
      screen.queryByText("Receiver Key Available")
    ).toBeNull();
  });
  it("Late key resolution cannot reactivate key after logout", async () => {
    let completeResolution;

    mocks.resolveSessionKeys.mockImplementationOnce(
      () => new Promise((resolve) => {
        completeResolution = resolve;
      })
    );

    render(
      <MemoryRouter initialEntries={["/login?role=org2"]}>
        <App />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByText("Simulate Login"));

    await waitFor(() => {
      expect(mocks.resolveSessionKeys).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText("Receiver Key Unavailable")).toBeTruthy();

    fireEvent.click(screen.getByText("Logout"));

    await screen.findByText("Simulate Login");

    completeResolution({
      mode: "registry",
      role: "org2",
      institutionId: "synthetic-org2",
      keyId: "late-key",
      publicKey: { type: "public" },
      privateKey: { type: "private" },
    });

    await waitFor(() => {
      expect(
        screen.queryByText("Receiver Key Available")
      ).toBeNull();
      expect(mocks.getOrCreateHospitalKeys).not.toHaveBeenCalled();
    });
  });

  it("Registry failure does not fall back to legacy demo key", async () => {
    mocks.resolveSessionKeys.mockRejectedValueOnce(
      new Error("Registry unavailable")
    );

    render(
      <MemoryRouter initialEntries={["/login?role=org2"]}>
        <App />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByText("Simulate Login"));

    await waitFor(() => {
      expect(mocks.resolveSessionKeys).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText("Receiver Key Unavailable")
      ).toBeTruthy();
    });

    expect(mocks.getOrCreateHospitalKeys).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Receiver Key Available")
    ).toBeNull();
  });

  it("Same account re-login resolves a fresh session key", async () => {
    render(
      <MemoryRouter initialEntries={["/login?role=org2"]}>
        <App />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByText("Simulate Login"));

    await screen.findByText("Receiver Key Available");

    expect(mocks.resolveSessionKeys).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Logout"));

    await screen.findByText("Simulate Login");

    fireEvent.click(screen.getByText("Simulate Login"));

    await waitFor(() => {
      expect(mocks.resolveSessionKeys).toHaveBeenCalledTimes(2);
    });

    expect(
      screen.getByText("Receiver Key Available")
    ).toBeTruthy();
  });

  it("Org2-A to Org2-B never reuses Org2-A key", async () => {
    let completeB;

    mocks.resolveSessionKeys
      .mockResolvedValueOnce({
        role: "org2",
        institutionId: "synthetic-org2-A",
        keyId: "key-A",
        publicKey: { type: "public" },
        privateKey: { type: "private", owner: "A" },
      })
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          completeB = resolve;
        })
      );

    render(
      <MemoryRouter initialEntries={["/login?role=org2"]}>
        <App />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByText("Simulate Login"));

    await screen.findByText("Receiver Key Available");

    fireEvent.click(screen.getByText("Logout"));

    await screen.findByText("Simulate Login B");

    fireEvent.click(screen.getByText("Simulate Login B"));

    await waitFor(() => {
      expect(mocks.resolveSessionKeys).toHaveBeenCalledTimes(2);
    });

    // Key A tidak boleh muncul selama resolusi B belum selesai.
    expect(
      screen.getByText("Receiver Key Unavailable")
    ).toBeTruthy();

    completeB({
      role: "org2",
      institutionId: "synthetic-org2-B",
      keyId: "key-B",
      publicKey: { type: "public" },
      privateKey: { type: "private", owner: "B" },
    });

    await screen.findByText("Receiver Key Available");

    expect(
      screen.getByTestId("receiver-key-owner").textContent
    ).toBe("B");
  });

  it("Logout pending immediately hides receiver key", async () => {
    let completeLogout;

    mocks.logout.mockImplementationOnce(
      () => new Promise((resolve) => {
        completeLogout = resolve;
      })
    );

    render(
      <MemoryRouter initialEntries={["/login?role=org2"]}>
        <App />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByText("Simulate Login"));

    await screen.findByText("Receiver Key Available");

    expect(mocks.resolveSessionKeys).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Logout"));

    await waitFor(() => {
      expect(mocks.logout).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText("Receiver Key Unavailable")
      ).toBeTruthy();
    });

    // Selama logout tertahan, jangan ada resolusi key tambahan.
    expect(mocks.resolveSessionKeys).toHaveBeenCalledTimes(1);

    completeLogout({ success: true });

    await screen.findByText("Simulate Login");

    expect(
      screen.queryByText("Receiver Key Available")
    ).toBeNull();
  });

  it("Failed logout does not restore previous receiver key", async () => {
    mocks.logout.mockRejectedValueOnce(
      new Error("Synthetic network failure")
    );

    const alertSpy = vi
      .spyOn(window, "alert")
      .mockImplementation(() => {});

    try {
      render(
        <MemoryRouter initialEntries={["/login?role=org2"]}>
          <App />
        </MemoryRouter>
      );

      fireEvent.click(await screen.findByText("Simulate Login"));

      await screen.findByText("Receiver Key Available");

      fireEvent.click(screen.getByText("Logout"));

      await screen.findByText("Simulate Login");

      expect(
        screen.queryByText("Receiver Key Available")
      ).toBeNull();

      expect(mocks.resolveSessionKeys).toHaveBeenCalledTimes(1);
      expect(alertSpy).toHaveBeenCalledTimes(1);
    } finally {
      alertSpy.mockRestore();
    }
  });

});


describe("M13 Org2 enrollment visibility", () => {
  it("hides enrollment when institutional key is ready", async () => {
    mocks.getSession.mockResolvedValue({
      user: {
        role: "org2",
        userId: "receiver-test",
        institutionId: "synthetic-org2",
        username: "receiver-test",
        institution: "Synthetic Hospital",
      },
    });

    render(
      <MemoryRouter initialEntries={["/org2"]}>
        <App />
      </MemoryRouter>
    );

    await screen.findByText("Receiver Key Available");

    expect(
      screen.queryByTestId("org2-enrollment-panel")
    ).toBeNull();
  });

  it("shows enrollment only after missing key is confirmed", async () => {
    mocks.getSession.mockResolvedValue({
      user: {
        role: "org2",
        userId: "receiver-test",
        institutionId: "synthetic-org2",
        username: "receiver-test",
        institution: "Synthetic Hospital",
      },
    });

    let rejectResolution;

    mocks.resolveSessionKeys.mockImplementationOnce(
      () => new Promise((resolve, reject) => {
        rejectResolution = reject;
      })
    );

    render(
      <MemoryRouter initialEntries={["/org2"]}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mocks.resolveSessionKeys).toHaveBeenCalledTimes(1);
    });

    expect(
      screen.queryByTestId("org2-enrollment-panel")
    ).toBeNull();

    rejectResolution(new Error("Synthetic missing key"));

    expect(
      await screen.findByTestId("org2-enrollment-panel")
    ).toBeTruthy();

    expect(
      screen.getByText("Receiver Key Unavailable")
    ).toBeTruthy();
  });

  it("never shows Org2 enrollment to an Org1 session", async () => {
    mocks.getSession.mockResolvedValue({
      user: {
        role: "org1",
        userId: "sender-test",
        institutionId: "synthetic-org1",
        username: "sender-test",
        institution: "Synthetic Clinic",
      },
    });

    render(
      <MemoryRouter initialEntries={["/org1"]}>
        <App />
      </MemoryRouter>
    );

    await screen.findByText("Org1 Dashboard");

    expect(
      screen.queryByTestId("org2-enrollment-panel")
    ).toBeNull();
  });
});
