import test, { mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const src = new URL("../src/", import.meta.url);

const users = {
  "u-admin": {
    id: "u-admin",
    status: "active",
    session_version: 1,
    institution_id: null,
  },
  "u-org1": {
    id: "u-org1",
    status: "active",
    session_version: 1,
    institution_id: "org1",
  },
  "u-org2": {
    id: "u-org2",
    status: "active",
    session_version: 1,
    institution_id: "org2",
  },
};

const institutions = {
  org1: {
    id: "org1",
    msp_id: "Org1MSP",
    status: "approved",
    can_send: 1,
    can_receive: 0,
  },
  org2: {
    id: "org2",
    msp_id: "Org2MSP",
    status: "approved",
    can_send: 0,
    can_receive: 1,
  },
};

const activeRoles = new Map([
  ["u-admin", new Set(["consortium_admin"])],
  ["u-org1", new Set(["referral_sender"])],
  ["u-org2", new Set(["referral_receiver"])],
]);

const fakeDb = {
  prepare(sql) {
    return {
      get(...args) {
        if (sql.includes("FROM users")) {
          return users[args[0]];
        }

        if (sql.includes("FROM institutions")) {
          return institutions[args[0]];
        }

        if (sql.includes("FROM role_assignments")) {
          const role = sql.includes("'consortium_admin'")
            ? "consortium_admin"
            : args[1];

          return activeRoles.get(args[0])?.has(role)
            ? { authorized: 1 }
            : undefined;
        }

        throw new Error("Unexpected SQL in isolated test");
      },
    };
  },
};

mock.module(
  new URL("config/database.js", src).href,
  { defaultExport: fakeDb }
);

mock.module(
  new URL("services/adminAuthService.js", src).href,
  {
    namedExports: {
      authenticateAdmin(username, password) {
        if (username !== "nexusadmin" || password !== "test-admin") {
          return null;
        }

        return {
          id: "u-admin",
          username,
          role: "consortium_admin",
          sessionVersion: 1,
        };
      },
    },
  }
);

mock.module(
  new URL("services/staffAuthService.js", src).href,
  {
    namedExports: {
      authenticateStaff(username, password) {
        if (password !== "test-staff") return null;

        if (username === "staff-org1") {
          return {
            id: "u-org1",
            username,
            role: "org1",
            institution: "Org1MSP",
            institutionId: "org1",
            permission: "referral_sender",
            sessionVersion: 1,
          };
        }

        if (username === "staff-org2") {
          return {
            id: "u-org2",
            username,
            role: "org2",
            institution: "Org2MSP",
            institutionId: "org2",
            permission: "referral_receiver",
            sessionVersion: 1,
          };
        }

        return null;
      },
    },
  }
);

let handlerCalls = 0;

const handler = (req, res) => {
  handlerCalls++;
  res.json({ status: "success", authorized: true });
};

mock.module(
  new URL("controllers/adminController.js", src).href,
  {
    namedExports: Object.fromEntries(
      [
        "getInstitutions",
        "getUsers",
        "getAuditLogs",
        "createUser",
        "suspendUser",
        "reactivateUser",
        "revokeUserRole",
        "assignUserRole",
        "getDepartments",
        "getDepartmentMemberships",
        "createDepartment",
      ].map(name => [name, handler])
    ),
  }
);

const { login } = await import(
  new URL("middleware/auth.js", src).href
);

const { default: adminRoutes } = await import(
  new URL("routes/adminRoutes.js", src).href
);

test("M14 admin department endpoints enforce HTTP RBAC", async () => {
  const app = express();
  app.use(express.json());

  app.post("/api/test-login", login);
  app.use("/api/admin", adminRoutes);

  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise(resolve => {
      if (server.listening) resolve();
      else server.once("listening", resolve);
    });

    const base = `http://127.0.0.1:${server.address().port}`;

    async function signIn(username, password) {
      const response = await fetch(`${base}/api/test-login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      assert.equal(response.status, 200);

      const cookie = response.headers.get("set-cookie");
      assert.ok(cookie?.includes("nexusmed_session="));

      return cookie.split(";")[0];
    }

    const adminCookie = await signIn(
      "nexusadmin", "test-admin"
    );

    const org1Cookie = await signIn(
      "staff-org1", "test-staff"
    );

    const org2Cookie = await signIn(
      "staff-org2", "test-staff"
    );

    const paths = [
      "/api/admin/departments",
      "/api/admin/department-memberships",
    ];

    for (const path of paths) {
      const start = handlerCalls;

      const anonymous = await fetch(base + path);
      assert.equal(anonymous.status, 401);
      assert.equal(handlerCalls, start);

      const org1 = await fetch(base + path, {
        headers: { cookie: org1Cookie },
      });
      assert.equal(org1.status, 403);
      assert.equal(handlerCalls, start);

      const org2 = await fetch(base + path, {
        headers: { cookie: org2Cookie },
      });
      assert.equal(org2.status, 403);
      assert.equal(handlerCalls, start);

      const admin = await fetch(base + path, {
        headers: { cookie: adminCookie },
      });
      assert.equal(admin.status, 200);
      assert.equal(handlerCalls, start + 1);

      const body = await admin.json();
      assert.equal(body.authorized, true);
    }

    // The write endpoint must enforce the same admin-only RBAC.
    const createPath = "/api/admin/departments";
    const proposed = JSON.stringify({
      id: "poli_jantung_org2",
      name: "Poli Jantung",
      institutionId: "org2",
    });

    for (const [label, cookie, expectedStatus] of [
      ["anonymous", null, 401],
      ["org1", org1Cookie, 403],
      ["org2", org2Cookie, 403],
      ["admin", adminCookie, 200],
    ]) {
      const before = handlerCalls;
      const headers = {
        "content-type": "application/json",
      };

      if (cookie) headers.cookie = cookie;

      const response = await fetch(base + createPath, {
        method: "POST",
        headers,
        body: proposed,
      });

      assert.equal(
        response.status,
        expectedStatus,
        `Unexpected POST status for ${label}`,
      );

      assert.equal(
        handlerCalls,
        before + (label === "admin" ? 1 : 0),
        `Controller access mismatch for ${label}`,
      );
    }

    // Revocation must invalidate the existing admin session.
    activeRoles.get("u-admin").delete("consortium_admin");

    const revoked = await fetch(base + paths[0], {
      headers: { cookie: adminCookie },
    });

    assert.equal(revoked.status, 401);

    console.log(
      "PASS: Anonymous 401, Org1 403, Org2 403, " +
      "Admin 200, revoked admin 401"
    );
  } finally {
    activeRoles.get("u-admin").add("consortium_admin");
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});
