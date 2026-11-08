import test from "node:test";
import assert from "node:assert/strict";

import {
  isKeyRegistrationEnabled,
} from "../src/services/keyRegistrationPolicy.js";

test("production defaults to disabled", () => {
  assert.equal(
    isKeyRegistrationEnabled({ NODE_ENV: "production" }),
    false
  );
});

test("production requires explicit opt-in", () => {
  assert.equal(
    isKeyRegistrationEnabled({
      NODE_ENV: "production",
      NEXUSMED_KEY_REGISTRATION_ENABLED: "true",
    }),
    true
  );
});

test("test mode supports controlled registration", () => {
  assert.equal(
    isKeyRegistrationEnabled({
      NODE_ENV: "test",
      NEXUSMED_KEY_REGISTRATION_ENABLED: "true",
    }),
    true
  );
});

test("development cannot silently register keys", () => {
  assert.equal(
    isKeyRegistrationEnabled({
      NODE_ENV: "development",
      NEXUSMED_KEY_REGISTRATION_ENABLED: "true",
    }),
    false
  );
});

test("false-like values do not enable registration", () => {
  for (const value of ["false", "1", "TRUE", ""]) {
    assert.equal(
      isKeyRegistrationEnabled({
        NODE_ENV: "production",
        NEXUSMED_KEY_REGISTRATION_ENABLED: value,
      }),
      false
    );
  }
});
