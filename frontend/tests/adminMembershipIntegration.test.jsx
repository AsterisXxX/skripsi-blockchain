// @vitest-environment jsdom

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { MemoryRouter } from "react-router-dom";
import AdminDashboard from "../src/pages/AdminDashboard";

import * as api from "../src/services/adminApi";

vi.mock("../src/services/adminApi", () => ({
  getInstitutions: vi.fn(),
  getUsers: vi.fn(),
  getDepartments: vi.fn(),
  getDepartmentMemberships: vi.fn(),
  getAuditLogs: vi.fn(),
  createDepartment: vi.fn(),
  assignDepartmentMembership: vi.fn(),
  revokeDepartmentMembership: vi.fn(),
  suspendUser: vi.fn(),
  reactivateUser: vi.fn(),
  revokeUserRole: vi.fn(),
  assignUserRole: vi.fn(),
}));

const user = {
  id: "staff-org2",
  username: "receiver2",
  institution_id: "org2",
  status: "active",
  roles: "referral_receiver",
};

const department = {
  id: "poli_umum_org2",
  name: "Poli Umum",
  institution_id: "org2",
  institution_name: "Rumah Sakit Org2",
  status: "active",
};

const membership = {
  assignment_id: "assignment-001",
  user_id: "staff-org2",
  username: "receiver2",
  institution_id: "org2",
  department_id: "poli_umum_org2",
  department_name: "Poli Umum",
  can_receive_referral: true,
};

beforeEach(() => {
  vi.resetAllMocks();

  api.getInstitutions.mockResolvedValue({
    institutions: [{
      id: "org2",
      name: "Rumah Sakit Org2",
      msp_id: "Org2MSP",
      status: "approved",
      can_send: 0,
      can_receive: 1,
    }],
  });

  api.getUsers.mockResolvedValue({
    users: [user],
  });

  api.getDepartments.mockResolvedValue({
    departments: [department],
  });

  api.getAuditLogs.mockResolvedValue({
    logs: [],
  });

  api.getDepartmentMemberships
    .mockResolvedValueOnce({ memberships: [] })
    .mockResolvedValue({
      memberships: [membership],
    });

  api.assignDepartmentMembership.mockResolvedValue({
    status: "success",
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("M14 Admin Dashboard membership integration", () => {
  it("assigns membership and refreshes admin data", async () => {
    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>
    );

    const userSelect = await screen.findByLabelText(
      "Staf Penerima"
    );

    await waitFor(() => {
      expect(
        Array.from(userSelect.options).some(
          (option) => option.value === "staff-org2"
        )
      ).toBe(true);
    });

    fireEvent.change(userSelect, {
      target: { value: "staff-org2" },
    });

    const departmentSelect = screen.getByLabelText(
      "Poli Tujuan"
    );

    await waitFor(() => {
      expect(
        Array.from(departmentSelect.options).some(
          (option) => option.value === "poli_umum_org2"
        )
      ).toBe(true);
    });

    fireEvent.change(departmentSelect, {
      target: { value: "poli_umum_org2" },
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Assign Poli",
      })
    );

    await waitFor(() => {
      expect(
        api.assignDepartmentMembership
      ).toHaveBeenCalledExactlyOnceWith({
        userId: "staff-org2",
        departmentId: "poli_umum_org2",
      });

      expect(
        api.getDepartmentMemberships
      ).toHaveBeenCalledTimes(2);

      expect(api.getUsers).toHaveBeenCalledTimes(2);
      expect(api.getAuditLogs).toHaveBeenCalledTimes(2);
    });

    expect(
      await screen.findByText(
        "Membership poli berhasil diberikan."
      )
    ).toBeTruthy();
  });
});
