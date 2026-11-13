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

import DepartmentMembershipManager from
  "../src/components/DepartmentMembershipManager";

import {
  assignDepartmentMembership,
  revokeDepartmentMembership,
} from "../src/services/adminApi";

vi.mock("../src/services/adminApi", () => ({
  assignDepartmentMembership: vi.fn(),
  revokeDepartmentMembership: vi.fn(),
}));

const users = [
  {
    id: "staff-org2",
    username: "receiver2",
    institution_id: "org2",
    status: "active",
    roles: "referral_receiver",
  },
  {
    id: "staff-org3",
    username: "receiver3",
    institution_id: "org3",
    status: "active",
    roles: "referral_receiver",
  },
];

const departments = [
  {
    id: "poli_umum_org2",
    name: "Poli Umum",
    institution_id: "org2",
    status: "active",
  },
  {
    id: "poli_bedah_org3",
    name: "Poli Bedah",
    institution_id: "org3",
    status: "active",
  },
];

const activeMembership = {
  assignment_id: "membership-001",
  user_id: "staff-org2",
  username: "receiver2",
  institution_id: "org2",
  department_id: "poli_umum_org2",
  department_name: "Poli Umum",
  can_receive_referral: true,
};

function setup(options = {}) {
  const onChanged =
    options.onChanged ?? vi.fn().mockResolvedValue(undefined);

  render(
    <DepartmentMembershipManager
      users={users}
      departments={departments}
      memberships={options.memberships ?? []}
      onChanged={onChanged}
    />
  );

  return { onChanged };
}

function chooseOrg2Membership() {
  fireEvent.change(screen.getByLabelText("Staf Penerima"), {
    target: { value: "staff-org2" },
  });

  fireEvent.change(screen.getByLabelText("Poli Tujuan"), {
    target: { value: "poli_umum_org2" },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("M14 DepartmentMembershipManager", () => {
  it("assigns membership and refreshes data", async () => {
    assignDepartmentMembership.mockResolvedValue({
      status: "success",
    });

    const { onChanged } = setup();

    chooseOrg2Membership();

    fireEvent.click(
      screen.getByRole("button", { name: "Assign Poli" })
    );

    await waitFor(() => {
      expect(assignDepartmentMembership).toHaveBeenCalledWith({
        userId: "staff-org2",
        departmentId: "poli_umum_org2",
      });
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    expect(
      await screen.findByText(
        "Membership poli berhasil diberikan."
      )
    ).toBeTruthy();
  });

  it("revokes membership only after confirmation", async () => {
    revokeDepartmentMembership.mockResolvedValue({
      status: "success",
    });

    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValue(false);

    const { onChanged } = setup({
      memberships: [activeMembership],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Revoke" })
    );

    expect(confirm).toHaveBeenCalledOnce();
    expect(revokeDepartmentMembership).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Revoke" })
    );

    await waitFor(() => {
      expect(revokeDepartmentMembership)
        .toHaveBeenCalledExactlyOnceWith("membership-001");
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
  });

  it("blocks duplicate assignment submissions", async () => {
    let finishMutation;

    assignDepartmentMembership.mockImplementation(
      () => new Promise((resolve) => {
        finishMutation = resolve;
      })
    );

    const { onChanged } = setup();

    chooseOrg2Membership();

    const button = screen.getByRole("button", {
      name: "Assign Poli",
    });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(assignDepartmentMembership).toHaveBeenCalledTimes(1);

    finishMutation({ status: "success" });

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
  });

  it("locks further mutations after failed refresh", async () => {
    assignDepartmentMembership.mockResolvedValue({
      status: "success",
    });

    const onChanged = vi.fn().mockRejectedValue(
      new Error("Refresh unavailable")
    );

    setup({ onChanged });
    chooseOrg2Membership();

    fireEvent.click(
      screen.getByRole("button", { name: "Assign Poli" })
    );

    expect(
      await screen.findByText(
        /Namun data terbaru gagal dimuat/
      )
    ).toBeTruthy();

    const button = screen.getByRole("button", {
      name: "Assign Poli",
    });

    expect(button.disabled).toBe(true);
    expect(assignDepartmentMembership).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("restricts departments to the selected institution", () => {
    setup();

    fireEvent.change(screen.getByLabelText("Staf Penerima"), {
      target: { value: "staff-org2" },
    });

    const departmentSelect =
      screen.getByLabelText("Poli Tujuan");

    const departmentIds = Array.from(
      departmentSelect.options,
      (option) => option.value
    );

    expect(departmentIds).toContain("poli_umum_org2");
    expect(departmentIds).not.toContain("poli_bedah_org3");
  });
});
