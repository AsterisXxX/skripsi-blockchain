# NexusMed M15 — Offline Candidate Acceptance

Status: **Offline Candidate Validated — Production Cutover Blocked**

Baseline commit: `246a60deecb27262aa968bd6a6fd42477a623fa2`

## Scope

M15 develops an isolated, durable Fabric submission
candidate without deploying it to the production route.

The candidate includes:

- Durable referral admission.
- Atomic transaction ID ownership.
- Immutable pre-submit journal.
- Unified candidate submission coordinator.
- Fail-closed schema integrity checks.
- Canonical CREATE TABLE DDL verification.
- HTTP submission boundary.
- Multi-process concurrency and crash recovery tests.

All candidate components require controlled dependencies.
They must not automatically migrate a production database,
connect to a production Fabric Gateway, or authorize retries
or registry commits without verified evidence.

## Offline Acceptance Evidence

The clean snapshot was assembled from the baseline HEAD
plus 46 explicitly selected untracked source and test files.

Selected tests executed: 57
Selected tests passed: 57
Selected tests failed: 0
Test suites executed: 23

The snapshot used the existing local backend node_modules
through a symbolic link.

This validates the selected source snapshot against locally
installed dependencies. It is NOT a clean npm installation
or a complete cross-environment reproducibility test.

## Extended Worktree Evidence

Selected tests passed in the extended worktree: 79

The additional 22 tests belong to modifications in the
tracked M14 HTTP test and route workflow.

Those tracked modifications are not part of this offline
candidate checkpoint and must be reviewed separately.

## Production Cutover Blockers

The mandatory submission boundary suite currently reports
three failures:

1. The active M14 HTTP route still invokes the legacy
   createReferralOnFabric function directly.
2. The legacy Fabric service still exports a direct
   unguarded submission function.
3. The journal candidate still contains an independent
   transaction.submit call outside the unified coordinator.

These failures are intentional acceptance blockers,
not passing regression evidence.

Do not remove or weaken the assertions to make the
production cutover gate appear green.

## Production Isolation

The active server mounts:

`backend/src/routes/referralRoutes.js`

The offline candidate route:

`backend/src/routes/referralRoutesM15CandidateV3.js`

is not mounted by the active server.

This checkpoint does not authorize:

- Production deployment.
- Automatic SQLite migrations.
- Switching the active HTTP route.
- Automatic Fabric retry.
- Automatic registry commit.
- Mixed-version deployment without shared ownership policy.

## Known Limitations

- SQL schema validation checks a runtime snapshot and
  does not eliminate every possible preflight TOCTOU race.
- The canonical DDL allowlist must be maintained alongside
  reviewed future schema migrations.
- Clean installation of npm dependencies was not tested.
- The selected tests are not a complete security proof.
- Several adversarial HTTP test files duplicate large
  fixture sections. Refactoring is deferred to a
  separate maintainability change.

## Verification Commands

Run offline candidate tests explicitly with node --test
and node --experimental-test-module-mocks where required.

The backend's current npm test command is only a
placeholder and must not be treated as acceptance evidence.

Production cutover gate:

```bash
cd backend
node --experimental-test-module-mocks \
  --test \
  tests/fabricMandatorySubmissionBoundaryV3.test.js
```

Expected at this checkpoint: 3 failures, 0 passes.

## Acceptance Decision

**M15 offline candidate: validated for checkpointing.**

**M15 production cutover: BLOCKED.**

Production integration requires a separate reviewed
cutover plan, regression suite, concurrency validation,
and evidence-based reconciliation policy.
