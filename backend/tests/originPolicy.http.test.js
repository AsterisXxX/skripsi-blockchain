import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import {
  allowedOrigins,
  requireAllowedOrigin,
} from "../src/middleware/originPolicy.js";

test("M14: production Origin middleware enforces mutation policy", async () => {
  const app = express();
  let handlerCalls = 0;

  app.use(requireAllowedOrigin);

  app.all("/probe", (req, res) => {
    handlerCalls++;
    res.json({ status: "accepted" });
  });

  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise(resolve => {
      if (server.listening) resolve();
      else server.once("listening", resolve);
    });

    const base = `http://127.0.0.1:${server.address().port}`;

    assert.deepEqual([...allowedOrigins], [
      "http://localhost:5173",
      "http://localhost:8080",
      "https://nexusmed.my.id",
    ]);

    async function probe(method, origin, expected) {
      const before = handlerCalls;

      const headers = {};
      if (origin !== null) {
        headers.origin = origin;
      }

      const response = await fetch(`${base}/probe`, {
        method,
        headers,
      });

      assert.equal(
        response.status,
        expected,
        `${method}, Origin=${origin}`
      );

      assert.equal(
        handlerCalls,
        before + (expected === 200 ? 1 : 0),
        "Rejected request reached handler"
      );

      return response;
    }

    for (const method of [
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
    ]) {
      const missing = await probe(method, null, 403);
      assert.equal(
        (await missing.json()).error,
        "Origin tidak diizinkan."
      );

      await probe(method, "https://evil.example", 403);

      for (const allowed of allowedOrigins) {
        await probe(method, allowed, 200);
      }

      console.log(`${method}: origin policy PASS`);
    }

    // GET requests must remain readable without an Origin.
    await probe("GET", null, 200);
    await probe("GET", "https://evil.example", 200);

    console.log("GET behavior: PRESERVED");
    console.log("Rejected requests reached handler: ZERO");
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error =>
        error ? reject(error) : resolve()
      );
    });
  }
});
