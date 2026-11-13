import {
  describe,
  it,
  expect,
  vi,
  afterEach,
} from "vitest";

import {
  assignDepartmentMembership,
  revokeDepartmentMembership,
} from "../src/services/adminApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("M14 Membership Mutation API", () => {
  it("assigns membership using authenticated POST", async () => {
    const payload = {
      status: "success",
      membership: {
        id: "assignment-123",
        user_id: "user-123",
        department_id: "poli_jantung_org2",
        active: true,
      },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => payload,
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await assignDepartmentMembership({
      userId: "user-123",
      departmentId: "poli_jantung_org2",
    });

    expect(result).toEqual(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/department-memberships",
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: "user-123",
          departmentId: "poli_jantung_org2",
        }),
      }
    );
  });

  it("revokes membership using authenticated PATCH", async () => {
    const payload = {
      status: "success",
      membership: {
        id: "assignment-123",
        active: false,
      },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload,
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await revokeDepartmentMembership(
      "assignment-123"
    );

    expect(result).toEqual(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/department-memberships/assignment-123/revoke",
      {
        method: "PATCH",
        credentials: "include",
      }
    );
  });

  it("safely encodes assignment ID in revoke URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "success" }),
    });

    vi.stubGlobal("fetch", fetchMock);

    await revokeDepartmentMembership("a/b?c");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/admin/department-memberships/a%2Fb%3Fc/revoke"
    );
  });

  it("propagates duplicate assignment 409 error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: "Membership poli sudah aktif.",
        }),
      })
    );

    await expect(
      assignDepartmentMembership({
        userId: "user-123",
        departmentId: "poli_jantung_org2",
      })
    ).rejects.toThrow("Membership poli sudah aktif.");
  });

  it("propagates forbidden revoke 403 error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          error: "Akses administrator tidak valid.",
        }),
      })
    );

    await expect(
      revokeDepartmentMembership("assignment-123")
    ).rejects.toThrow("Akses administrator tidak valid.");
  });

  it("uses a fallback message on failed assignment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      })
    );

    await expect(
      assignDepartmentMembership({
        userId: "user-123",
        departmentId: "poli_jantung_org2",
      })
    ).rejects.toThrow("Gagal memberikan membership poli.");
  });

  it("uses a fallback message on failed revoke", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      })
    );

    await expect(
      revokeDepartmentMembership("assignment-123")
    ).rejects.toThrow("Gagal mencabut membership poli.");
  });
});
