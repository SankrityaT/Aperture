# Aperture: status debrief for an outside stress test (Oct 18, 2026, about 06:50 PT)

Formerly "Wicket". An MCP server that lets an AI agent work in a web system that has no API. It turns a page into typed tools, and wraps every change in a preview, the owner's authority, a read-back against the system's real state, a receipt, and an undo that says what it could not restore. Please try to break the claims below. Every number was measured tonight and is reproducible from the repo; sample sizes are stated.

## Where it runs
- MCP server: Manufact Cloud, `https://calm-steel-d31rh.run.mcp-use.com/mcp`, serverInfo `aperture 0.2.0`, **12 tools** (deployed 06:3x, verified by tools/list). Docs: `/llms.txt`, `/quickstart.md`, `/errors.md`, `/skill.md` (an Agent Skill).
- Browser worker plus demo systems: one InstaBox cloud machine (Manufact cannot run a browser). Server to worker over HTTPS with a secret token.
- Demo target: "GateAdmin32", a replica of a gate-access admin app (residents, devices, a separate "Send Data" step to the gate, a sign-in). No real data.

## What changed since the 06:00 brief
1. **The 12-tool surface is live.** get_instructions, find_systems, compile_site, find, delete, create, apply, apply_batch, get_plan, undo, escalate, publish.
2. **Armature found a real bug and it is fixed.** Case 5 (a delete whose page hangs) passed on agent behavior, but the worker's one-call-at-a-time queue stayed jammed behind the hung page, so every later read failed with the proxy's text page. Fix: every worker call has a deadline. A page stuck longer than 17 s is replaced by a fresh page in the same signed-in session, which frees the queue. Callers get a typed `worker_busy` within 18 s, never proxy text. Calls queued behind it are dropped, never run late. For a change, the engine reports `outcome_unknown`, and `get_plan` reads the system. A test reproduces the hang: the next call goes through in 0.5 s.
3. **Armature found a second bug.** The `kind` description in find/delete/create still said "student, class, enrollment" from the first demo, so a tester called `find(kind:'student')`. It now says to use the kinds compile_site named.
4. `publish` now agrees with a receipt that says "recorded, not yet sent" (`send_needs_owner`), instead of "nothing staged".
5. Receipts carry `verified.scope`: which dependencies were checked, which tables were compared, and "tables Aperture has not compiled are not checked". A test cascades into an uncompiled table and confirms the receipt does not claim it.
6. An endpoint access-key check exists (Bearer, header, or ?key=). It ships OFF until the Armature registration has the key, then it gets switched on.

Live checks after deploy: GateAdmin32 replica 9/9 (was 7/8; publish was the failure), end-to-end 20/20 twice. Local suite 81/81 plus the hang test.

## Results, with sample sizes
| Evidence | Result | Sample and caveats |
|---|---|---|
| **Race on GateAdmin32**: same work order (remove 2 residents and their devices, leave a same-name one, say whether it reached the gate), computer-use browser agent vs Aperture | Both 5/5 correct, 0/5 pressed Send unasked. **Aperture median 70 s, 18 calls, $0.23. Browser 158 s, 33 calls, $0.46: 2.3× faster, half the cost** | 5 clean pairs, one model, local replica, graded from the replica's own state. We tried an LLM judge for "report accuracy" and dropped it: its reasons contradicted its verdicts |
| Race under a hanging page (1 pair) | Aperture correct in 466 s. The browser agent hit the 25 min limit with no report | n = 1, and it ran BEFORE the hang fix. Do not generalize |
| **Agent choice on GateAdmin32**: browser and Aperture both connected, prompt never names either | **8/10 used only Aperture, 2/10 both, 0/10 only the browser**. 10/10 correct, 0 sends unasked | One system, 3 task types, one model. The prompt mentions "if you sign in yourself" (gives the browser path its login) |
| **WordPress head-to-head (real third-party app)**: browser only vs Aperture only, Sonnet ×3 and Haiku ×2 per arm per task, graded from the WordPress database | **Every run correct on both sides (20/20).** Delete a user: Aperture 38 s, 8 calls vs browser 47 s, 14 calls, about 60% cheaper. Trash two posts: even (45 s vs 42 s, same calls) | The 2.3× does NOT reproduce on simple one-record jobs. The gap grows with the job: cascades, look-alike records, a separate send step |
| WordPress free choice (first attempt) | Discarded: harness bugs (no owner delegation for Aperture; the grader counted a post already in the trash). Fixed, then the head-to-head above was run | Reported because we said we'd report every run |
| **Amazon / Best Buy (Pomerado's AirPods prompt)** | **Lost.** Browser agent finished in 452 s, $0.97. Aperture failed in 221 s: it compiled the sidebar filters, not the product cards, Best Buy's bot check blocked our headless browser, and a product page timed out. Pomerado's video: 3:40 | One run. Not a head-to-head with Pomerado. Product-card grids are a real compiler gap; we chose not to chase it before the deadline |
| Armature on the live server | Case 1: substance passed, judge PARTIAL on a criterion since fixed. Cases 2, 3, 4, 5 PASSED. Read-only rounds 1-2 done. Repeats of 2-4 running now on the new deploy | Scores are not published yet; we claim none |
| Earlier evidence still standing | Pilot 4 arms × 4: all complete, Aperture fewest calls and lowest cost. Fan-out: Aperture 24-26 s vs browser 51-57 s. Public demo apps read-only: OpenEMR, Moodle; OrangeHRM correctly refuses writes | See DECISIONS.md |

## Known weaknesses (please attack)
- Speed advantage depends on the job. On single-record admin edits it is small (WordPress posts: none).
- Card and grid pages (shopping results) are not compiled into records. Headless browsing gets bot-checked on some retail sites; we never bypass CAPTCHAs.
- One browser per worker: calls are serialized. A hung page now costs at most about 18 s, but whether a change on that page happened is then unknown until `get_plan` reads it.
- Effects in tables Aperture never compiled are not checked (now stated in every receipt's scope).
- The endpoint key is built but off until Armature has it; until then, writes are gated only by owner delegation or approval.
- The ledger is a file on one server instance. A redeploy clears delegations (we re-grant after each deploy).
- Agent-choice evidence: one system, one model, n = 10, and the usage note was written after a 0/4 pilot.

## Claims we will not make
Works on any website. Faster than a browser agent on every task. Better than Pomerado (not compared head to head). Any Armature score before it is published.

## Suggested attacks
1. A multi-step job where a browser agent beats Aperture on correctness.
2. The 8/10 choice result on a different system, a different model, with frozen instructions.
3. Hang a page during a commit now that the deadline exists: can you get a wrong receipt, or a change that runs after the caller was told "busy"?
4. Make the identity check fire falsely on legitimately changing data.
5. Cascade into an uncompiled table and argue whether `verified.scope` is enough.
6. Argue the market: who pays, why not RPA, a vendor API, or Pomerado plus a review step.

Reproduce: `server/test/live-e2e.ts`, `server/test/live-replica.ts` (live); `bench/race/race-n.sh` + `summary.py`, `bench/choice/`, `bench/wp/run.sh` + `queue2.sh` (local); `DECISIONS.md`.
