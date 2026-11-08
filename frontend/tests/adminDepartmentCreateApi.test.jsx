import {
  afterEach, describe, expect, it, vi,
} from "vitest";
import { createDepartment } from "../src/services/adminApi";

afterEach(() => vi.unstubAllGlobals());

describe("M14 Create Department API", () => {
  it("sends an authenticated POST", async () => {
    const payload = {
      id: "poli_jantung_org2",
      name: "Poli Jantung",
      institutionId: "org2",
    };

    const result = {
      status: "success",
      department: { id: payload.id },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => result,
    });

    vi.stubGlobal("fetch", fetchMock);

    expect(await createDepartment(payload)).toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/departments",
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );
  });

  it("rejects duplicate departments", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "ID poli sudah terdaftar.",
      }),
    }));

    await expect(createDepartment({})).rejects.toThrow(
      "ID poli sudah terdaftar."
    );
  });

  it("rejects forbidden requests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: "Akses ditolak untuk role ini.",
      }),
    }));

    await expect(createDepartment({})).rejects.toThrow(
      "Akses ditolak untuk role ini."
    );
  });
});
