import {
  describe,
  it,
  expect,
  vi,
  afterEach,
} from "vitest";

import {
  getDepartments,
  getDepartmentMemberships,
} from "../src/services/adminApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("M14 Admin Department API", () => {
  it("reads departments with session credentials", async () => {
    const payload = {
      status: "success",
      total: 1,
      departments: [{
        id: "poli_umum_org2",
        name: "Poli Umum",
        institution_id: "org2",
        status: "active",
      }],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });

    vi.stubGlobal("fetch", fetchMock);

    expect(await getDepartments()).toEqual(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/departments",
      {
        method: "GET",
        credentials: "include",
      }
    );
  });

  it("reads actual user department memberships", async () => {
    const payload = {
      status: "success",
      total: 1,
      memberships: [{
        assignment_id: "test-assignment",
        user_id: "test-user",
        department_id: "poli_umum_org2",
        can_receive_referral: 1,
      }],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });

    vi.stubGlobal("fetch", fetchMock);

    expect(
      await getDepartmentMemberships()
    ).toEqual(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/department-memberships",
      {
        method: "GET",
        credentials: "include",
      }
    );
  });

  it("rejects department API forbidden response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          error: "Akses ditolak untuk role ini.",
        }),
      })
    );

    await expect(getDepartments()).rejects.toThrow(
      "Akses ditolak untuk role ini."
    );
  });

  it("rejects membership API unauthorized response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: "Login diperlukan.",
        }),
      })
    );

    await expect(
      getDepartmentMemberships()
    ).rejects.toThrow("Login diperlukan.");
  });
});
