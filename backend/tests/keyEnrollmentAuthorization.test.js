import test from "node:test";
import assert from "node:assert/strict";

import {
  canEnrollInstitutionKey,
} from "../src/services/keyEnrollmentAuthorization.js";

const designatedUser = {
  userId: "authorized-receiver",
  role: "org2",
  permission: "referral_receiver",
  institutionId: "org2",
  institution: "Org2MSP",
};

const env = {
  NEXUSMED_KEY_ENROLLMENT_USER_ID: "authorized-receiver",
};

test("designated Org2 receiver allowed", () => {
  assert.equal(
    canEnrollInstitutionKey(designatedUser, env),
    true
  );
});

test("missing operator configuration fails closed", () => {
  assert.equal(
    canEnrollInstitutionKey(designatedUser, {}),
    false
  );
});

test("another receiver account is denied", () => {
  assert.equal(
    canEnrollInstitutionKey(
      { ...designatedUser, userId: "another-receiver" },
      env
    ),
    false
  );
});

test("wrong MSP or institution is denied", () => {
  assert.equal(
    canEnrollInstitutionKey(
      { ...designatedUser, institution: "Org3MSP" },
      env
    ),
    false
  );

  assert.equal(
    canEnrollInstitutionKey(
      { ...designatedUser, institutionId: "org3" },
      env
    ),
    false
  );
});

test("sender or incorrect permission denied", () => {
  assert.equal(
    canEnrollInstitutionKey(
      { ...designatedUser, role: "org1" },
      env
    ),
    false
  );

  assert.equal(
    canEnrollInstitutionKey(
      { ...designatedUser, permission: "referral_sender" },
      env
    ),
    false
  );
});
