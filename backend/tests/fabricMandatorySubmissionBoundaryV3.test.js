import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(
    new URL(path, import.meta.url),
    "utf8"
  );
}

test(
  "HTTP route must not invoke legacy submission directly",
  () => {
    const code = source(
      "../src/routes/referralRoutes.js"
    );

    assert.doesNotMatch(
      code,
      /\bcreateReferralOnFabric\s*\(/,
      "HTTP route still bypasses unified coordinator"
    );
  }
);

test(
  "legacy Fabric service must not expose unguarded submit",
  () => {
    const code = source(
      "../src/services/fabricService.js"
    );

    assert.doesNotMatch(
      code,
      /export\s+async\s+function\s+createReferralOnFabric\s*\(/,
      "Legacy raw submission remains publicly exported"
    );
  }
);

test(
  "journal candidate must not submit independently",
  () => {
    const code = source(
      "../src/services/fabricJournalSubmitCandidateV3.js"
    );

    assert.doesNotMatch(
      code,
      /\btransaction\.submit\s*\(/,
      "Journal still has independent submission boundary"
    );
  }
);
