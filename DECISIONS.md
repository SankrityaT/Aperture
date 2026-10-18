# Wicket: decisions, inputs, and what is still open

Running ledger. Every piece of outside feedback is recorded here with what we did about it.
Last updated: night of Oct 17-18, 2026, before the 10 AM PT submission.

## What Wicket is now

A transaction and verification layer for agent actions on systems that have no API.
The page compiler is one way to reach those systems. The guarantees below are the product.

One line: *an agent can work in a legacy web system, and every consequential change is previewed, bounded, read back, and recoverable, with honest reporting when it is not.*

## What Wicket guarantees, and the test that shows it

The question to hold ourselves to: what can Wicket guarantee that a browser agent, a generated integration (Pomerado), or a vendor API cannot? Only claims with a test are listed. Whether others also do these is **not established**; no comparison has been run.

| Guarantee | Test or evidence | Status |
|---|---|---|
| A plan goes stale if the record changed after preview; commit refuses | engine test "a plan goes stale if the record changes after the preview" | tested |
| Two writes on one record: one wins, nothing deleted twice | engine test "two writes at once on the same record" | tested |
| Predicted vs actual change is compared after commit; a surprise is flagged, learned, and (under a full copy) undoable | engine test "unconfirmed class delete ... surprise ... undone" | tested |
| Canary: first N items run with a full copy and a check across all compiled tables; any surprise or failure halts the rest | engine tests "canary" (2) | tested |
| A name is never accepted as a key; ambiguous identity is refused with suggestions | engine test + live guardrail check | tested |
| No safe key on a page means writes are refused, said plainly | OrangeHRM held-out run (documented in the brief) | observed, no unit test yet |
| Undo reports what it could not restore (`fields_not_restored`) | cold run 2 (S2 came back as S6) | observed live, no unit test yet |
| After an app error or hang, the engine reads the system back before reporting; it never retries blindly | gate-scenario (replica with a hanging delete) | being verified |
| Approval cannot be given by an agent: owner routes need a secret token | checked live (no token 403, wrong 403, right 200) | verified |

Known to NOT hold yet: durable ledger (memory only), crash recovery, authenticated MCP endpoint, per-tenant isolation, replay-proof approvals, signed shared profiles, effects outside compiled tables.

## Inputs received and what each changed

| Input | What we took from it | Action |
|---|---|---|
| Karpathy: "give me the thing I can copy paste to my agent" | The paste-able object is the point | `/registry/<site>` page with a copy snippet; profiles |
| Levie essay "Building for trillions of agents" | Governance, audit, strict controls are named needs | Used as the why-now quote; tickets, receipts, undo |
| Two "what agents want" answers | Dry run, undo, reliability, honest errors ranked first | Dry run, canary, receipts, `next` moves in every error |
| Three red-team verdicts | Reliability, security, persistence, baseline are the weak spots | Weakness table in the brief; owner-route fix; held-out runs; backlog below |
| Policy vs approval | Per-item human approval is supervised automation, not autonomy | **Delegation** designed (below), not yet built |
| Pomerado overlap (YC F26, compiles sites into APIs) | Do not demo "generate an invoice". Demo failure detection and proof | Scenario built around failure; QuickBooks only if we can instrument ground truth |
| Armature framing | We must show agents *choosing* it, not only able to use it | Free-choice experiment designed (below); cold runs are labelled "can use" |
| Paper "Beyond the Sum" (2501.10388) | Discovery, identity, interfaces, payments are the four gaps; delegated authorization over per-action approval | Supports delegation; Wicket as one backend behind a wider capability interface |
| DoorKing work order | The flagship task: 20 residents, 31 devices, 2 adds, duplicates, hang | `test/fixtures/gateportal.ts` replica + `test/gate-scenario.ts`; real access only if authorized |
| Stress test (10 attacks, WicketBench, go/pivot/stop) | Concrete attack list and falsification criteria | Attack list in the brief; WicketBench is future work |


## Pomerado, read from its source (HEAD 8f204aa, nothing run)

Read by a read-only agent with file and line citations. Confidence is CONFIRMED where the code was read.

Stronger than us: a model agent explores unseen sites in a real browser (20 min budget), sign-in with 2FA, a write-uncertainty taxonomy (`not_sent`/`sent`/`confirmed`, fail-closed `outcome_unknown` with `retry: never`), durable keyed idempotency (atomic, cross-process), 133 unit test files, a second model (Guardian) reviewing every browser call at build time.

At run time of a saved write (CONFIRMED by reading `context.ts`, `operation.ts`, `run-outcome.ts`, `run-report.ts`, `mcp-jobs.ts`): the runtime does not independently verify the outcome; it checks that the model-written script called `verified()`. No receipt on success. No undo or compensation. No cascade or side-effect detection (authoring guidance only). No standing permission, no caps, no per-run approval. Guardian does not review runs. No end-to-end evals; their "more reliable than computer use" claim has no data in the repo. Commit marks are saved only when a job settles, so a mid-write crash leaves nothing durable.

What we take: the idea that the agent proposes and the host validates; the fail-closed "unknown, never retry" stance (we now persist `executing` plus the undo copy before acting and require `reconcile` after a restart). What we do NOT claim: that we are more reliable than them. They adapt to sites we cannot read, and we have no comparison.

## Designs agreed but not built

**Delegation (replaces default approval).** The owner, through the owner page and never an agent tool, grants a bounded authority once: kinds, operations, a per-day cap, an expiry. Inside it, operations run without per-item approval, always with a full copy and a canary. Outside it, or on any surprise, ambiguous key, unknown outcome or cap hit, the engine halts and escalates. Success measure: autonomous completion with zero unauthorized actions, not fewer approval screens.

**Free-choice experiment (Armature).** Fresh agent sessions get a realistic goal with no mention of Wicket and no "be careful". Tools available: a plain browser tool, a generic integration, and Wicket, each with neutral descriptions and equal discoverability. Measure discovery, selection, verified outcome, time, cost, and whether the agent picks it again on a second task. A control arm without Wicket. Report every trial, including ignored ones. Requires at least 20 sessions to say anything; today we have 3 runs with Wicket as the only server, which show usability and nothing about preference.

**Three-way baseline.** Browser agent, browser agent plus the same policy text, Wicket, on the same injected failures: UI says done but nothing changed, an unexpected side effect, an undo that comes back with a new ID. Graded from the system's own state.

## Backlog, in order

1. DoorKing-shaped scenario passes honestly end to end (running now).
2. Delegation (owner-granted, bounded, canary always on).
3. Durable ledger: plans, approvals, receipts, undo copies survive a restart; an uncertain execution is reconciled before any retry.
4. Authentication on the MCP endpoint; approvals bound to operation and state, non-replayable.
5. Free-choice and three-way experiments, code frozen before the final run.
6. Manufact readiness checklist and a second client (Codex or Cursor).
7. Signed, versioned shared profiles.
8. Recording and submission.

## Claims we will not make

Works on any legacy system. A network effect. Better than Pomerado or a browser agent. That agents prefer Wicket. Cross-system transactions. A success rate from the held-out sites (n = 3, hand-picked).
