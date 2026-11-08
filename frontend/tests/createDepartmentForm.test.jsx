// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import CreateDepartmentForm from "../src/components/CreateDepartmentForm";
import { createDepartment } from "../src/services/adminApi";

vi.mock("../src/services/adminApi", () => ({
  createDepartment: vi.fn(),
}));

const institutions = [
  {
    id: "org1",
    name: "FKTP Pengirim",
    status: "approved",
    can_receive: 0,
  },
  {
    id: "org2",
    name: "FKRTL Penerima",
    status: "approved",
    can_receive: 1,
  },
];

const payload = {
  id: "poli_jantung_org2",
  name: "Poli Jantung",
  institutionId: "org2",
};

const created = {
  status: "success",
  department: {
    id: payload.id,
    name: payload.name,
    institution_id: "org2",
    status: "active",
  },
};

function fillForm() {
  fireEvent.change(screen.getByLabelText("Institusi Penerima"), {
    target: { value: "org2" },
  });
  fireEvent.change(screen.getByLabelText("ID Poli"), {
    target: { value: payload.id },
  });
  fireEvent.change(screen.getByLabelText("Nama Poli"), {
    target: { value: payload.name },
  });
}

function submitForm() {
  fireEvent.click(screen.getByRole("button", {
    name: "Tambah Poli",
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("M14 CreateDepartmentForm", () => {
  it("only offers approved receiver institutions", () => {
    render(
      <CreateDepartmentForm
        institutions={institutions}
        onCreated={vi.fn()}
      />
    );

    expect(screen.getByRole("option", {
      name: "FKRTL Penerima",
    })).toBeTruthy();

    expect(screen.queryByRole("option", {
      name: "FKTP Pengirim",
    })).toBeNull();
  });

  it("submits once and refreshes after successful creation", async () => {
    createDepartment.mockResolvedValue(created);
    const onCreated = vi.fn().mockResolvedValue();

    render(
      <CreateDepartmentForm
        institutions={institutions}
        onCreated={onCreated}
      />
    );

    fillForm();
    submitForm();

    await waitFor(() => {
      expect(createDepartment).toHaveBeenCalledTimes(1);
      expect(onCreated).toHaveBeenCalledWith(created.department);
      expect(screen.getByRole("status").textContent)
        .toContain("berhasil didaftarkan");
    });

    expect(createDepartment).toHaveBeenCalledWith(payload);

    expect(screen.getByLabelText("ID Poli").value).toBe("");
    expect(screen.getByLabelText("Nama Poli").value).toBe("");
  });

  it("prevents duplicate submissions while pending", async () => {
    let resolveRequest;

    createDepartment.mockImplementation(
      () => new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    const onCreated = vi.fn().mockResolvedValue();

    render(
      <CreateDepartmentForm
        institutions={institutions}
        onCreated={onCreated}
      />
    );

    fillForm();
    submitForm();

    await waitFor(() => {
      expect(createDepartment).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", {
        name: "Mendaftarkan...",
      }).disabled).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", {
      name: "Mendaftarkan...",
    }));

    expect(createDepartment).toHaveBeenCalledTimes(1);

    resolveRequest(created);

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
    });
  });

  it("shows API failure without reporting success", async () => {
    createDepartment.mockRejectedValue(
      new Error("ID poli sudah terdaftar.")
    );

    const onCreated = vi.fn();

    render(
      <CreateDepartmentForm
        institutions={institutions}
        onCreated={onCreated}
      />
    );

    fillForm();
    submitForm();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent)
        .toContain("ID poli sudah terdaftar.");
    });

    expect(onCreated).not.toHaveBeenCalled();
  });

  it("does not retry POST when registry refresh fails", async () => {
    createDepartment.mockResolvedValue(created);

    const onCreated = vi.fn().mockRejectedValue(
      new Error("Simulated registry failure")
    );

    render(
      <CreateDepartmentForm
        institutions={institutions}
        onCreated={onCreated}
      />
    );

    fillForm();
    submitForm();

    await waitFor(() => {
      expect(screen.getByRole("status").textContent)
        .toContain("jangan kirim ulang formulir");
    });

    expect(createDepartment).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledTimes(1);

    const button = screen.getByRole("button", {
      name: "Tambah Poli",
    });

    expect(button.disabled).toBe(true);
    fireEvent.click(button);

    expect(createDepartment).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
