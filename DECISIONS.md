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


## Measured results (night of Oct 17-18; each is reproducible from the repo)

### Speed of one verified cascading delete (replica gate portal, 91 residents / 168 devices; `test/bench-delete.ts`, one run each, same machine)
| Version | Time | Page loads |
|---|---|---|
| `baseline-v1` (tag) | 27.8 s | 128 |
| now (scan reuse inside one operation, early-exit read, counts reuse a recent scan, adapters invalidated after every write) | about 15 s | 66 |
A faster version (40 loads, 9 s) was caught giving a FALSE surprise: one adapter's cache was not cleared by a write through another adapter. That bug is fixed (engine tells every adapter to invalidate after a write); the honest cost is about 15 s. Single runs, not a statistic. Armature's per-call timeout is 30 s.

### When the site changes under a compiled capability (`test/drift-compare.ts`, graded from the replica's own state, one engine at a time, fresh browser per scenario)
| Scenario | Old compiler | New engine |
|---|---|---|
| a non-key column renamed | worked, deleted correctly | worked, deleted correctly (noted) |
| the KEY column renamed | kept working (re-detected the key) | stopped in 0.4 s: capability_changed; repair is tested against earlier records and re-enables |
| Delete becomes Archive (meaning changed) | find said 91, delete failed after 13 s | stopped in 0.5 s with the reason; repair REFUSED (delete no longer means delete), owner told |
| a decoy table inserted before the real one | worked | worked |
| signed out | find returned "0 records" as if true | signed_out, not disabled |
| Delete button no longer deletes | failed (read-back) | failed (read-back) |
| smaller pages | worked | worked |
| keys reused: same key now names someone else | (not run on the old compiler with the identity check; see below) | stopped: capability_changed, nobody deleted |
No false success and no wrong-record delete in any scenario for either version, EXCEPT the reused-keys case, which only the identity check catches (before it was added, both engines acted on the wrong person; that run is the reason the check exists). Trade-off to state plainly: on the renamed-key case the old compiler kept going correctly and the new one halts until a repair; the new one is safer where the old one could silently change which column identifies a person, and less available.
Not measured: a normal AI browser agent as a third arm; cost in money; shared repairs across agents; scheduled health checks; a model-based repairer (the repair is deterministic re-learning plus tests, not a model).

### Held-out public apps (read-only, `test/heldout.ts`; fixed after seeing failures, so re-checks are NOT independent)
OpenEMR demo: worked first try. Moodle sandbox: missed, then worked after two generic fixes (a name linking to a profile page was thrown away as an "actions" column; blank placeholder rows defeated key detection). OrangeHRM demo: signs in after a fix, and correctly refuses writes (no unique key).

### Bugs found by Armature's first live run, fixed
(A) compiling a second page wiped the first; now pages add to each other. (B) a declared dependency on an uncompiled page threw a raw string; now a typed refusal, and no tool answers with bare text. Both are in the live suite (18/18). Found by running the real flow, not by unit tests.

### Recovery (Wicket Recovery Planner idea)
Built: every plan and receipt names its recovery strategy and how exact it is expected to be; what undo failed to restore is remembered per kind and warned about in the next preview; the application's own recovery controls (archive, restore, deactivate, history, export, import, duplicate) are listed when a page is compiled, seen and never used. Designed, NOT built: choosing a reversible alternative automatically, using native restore or import, testing reversibility on synthetic records in a sandbox, the 100-operation recovery benchmark. Exact, functionally-equivalent, partial and irreversible are not yet scored over many operations; the only undo evidence is a handful of runs.


## Later the same night (05:00-05:25 PT)

- Product renamed to Aperture (server name, title, docs, install snippet; internal env names unchanged).
- Pilot benchmark (bench/, 16 runs with shell tools removed): all four arms 4/4 complete, 0 unsafe. Aperture-only: 18 calls, 77 s, $0.11 mean; browser arms 38-48 calls, 145-180 s, $0.24-0.31. Free choice chose Aperture 0/4 until the server usage note was added, then 4/4 (16 calls, 59 s, $0.11). The note is ours, written after the 0/4, and describes this kind of task: possibly fitted.
- Fan-out test (bench/fanout, five lists, "maximize parallel searches"): both arms got all five counts right (2 runs each). Browser: 51-57 s, $0.27-0.32, parallel tabs inside one code call, and it opened Add forms on two lists while exploring (saved nothing). Aperture: 24-26 s, $0.12-0.13, serialized behind one browser.
- Real WordPress: 9/10 after generic fixes (5/9 first). Fails: undo of a deleted user (honest refusal).
- Kinjal's GateAdmin replica (sign-in, pending vs sent to the gate) deployed on the box; write and undo verified live; receipts now say when a separate send step has not been pressed.
- GateAdmin32 restyle tested locally, NOT deployed: breaks kind names, reads icon toolbars as lists, undo refused (Add in toolbar), send step on another page hides the not-yet-sent note. Recommended after submission.
- Withdrawn: the webERP "says cannot delete, deletes anyway" claim did not reproduce.

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
