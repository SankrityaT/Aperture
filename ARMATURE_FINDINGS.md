//created by kinjal
# Armature findings: answers to ARMATURE_ASK.md

From Kinjal's Claude Code, Oct 18 about 2:40 AM PT. Research only. The only requests made to the live server
were read-only GETs of `/`, `/llms.txt`, `/robots.txt`, `/registry`, `/mcp`, `/.well-known/mcp.json` and `/README.md`.
No tools were called, `reset_demo` included.

Every claim below carries a source. **Verified** means read on the source today. **Inferred** is my reasoning.

## Update, 2:55 AM: the track is about usability, and it is judged with Armature Evals

Kinjal has the track description: *"Agents can use your product through a dedicated Agent-Facing Interface (MCP, CLI).
Build the best experience for them!"* So the track is about **use**, not choice. The likely proof is Wicket passing an
Armature Eval suite. Sections 1 to 4 below cover "choice". The experiment in section 3 is now optional; this section
comes first.

How Armature Evals work, verified from [H] https://docs.armature.tech/evaluation/overview.md,
[I] https://docs.armature.tech/evaluation/eval-cases.md, [J] https://docs.armature.tech/evaluation/suites-and-runs.md
and [K] https://docs.armature.tech/evaluation/ci.md:
- **Each case is a user goal plus criteria.** A tester agent (a Claude model in Claude Code, or a GPT model in Codex)
  connects to the *deployed* MCP over HTTP and works toward the goal on its own. [H][I]
- **The judge never talks to the server.** "It only reads what the tester did." It marks each criterion pass, partial,
  fail or not applicable, with evidence. Score 0–5: 4–5 Passed, 2–3 Partial, 0–1 Failed. [J]
- **Criteria must be checkable from the outside:** "The export contains 3 invoices" works, "communicates clearly"
  does not. Name the side effects the tester must avoid and the evidence you expect, and use test-scoped data names. [I]
- **Free plan:** 1 target per case, 100 finished runs a month, no schedules. Starter allows 2 targets, so Claude Code
  and Codex can both run on the same case. [H]
- **Evaluation is switched on per workspace during rollout.** If it is not there, email contact@armature.tech. [H]
  **Ask the Armature team at the venue to switch it on.**
- **Register the server** in MCP Setup with its URL, plus credentials if it needs them. Point it at a deployed server,
  not a laptop. [H]
- **Runs can be started three ways:** the dashboard, `POST https://app.armature.tech/api/armature/v1/workflows/<case_id>/runs`
  with a bearer key, or `run_eval_suite` on the Armature MCP at https://mcp.armature.tech/mcp. [K]

**Why Wicket fits (inferred).** The judge only sees the trace. A typical MCP says "done", and the judge has to take
it on trust. Wicket's receipts carry `verified` from a read-back, plus refusals with `next` moves and
`fields_not_restored`. The outcome is therefore evidence *in the trace*, which is exactly what the judge needs.
Pitch line: **Wicket is built to be judged.**

**Proposed suite, about 5 cases.** Each criterion can be checked from tool results in the trace. All run against the
gate-portal scenario.
1. *"Resident <name> moved out, remove them."* Two residents share that name.
   - Required: the agent did not delete by name alone; it resolved an ambiguity refusal or used a key.
   - Required: the commit receipt shows `verified: true`.
   - Required: the other resident with the same name still exists in a later read.
2. *"Add these two new residents and their gate devices."*
   - Required: both create receipts show verified.
   - Required: no other record changed (predicted vs actual shows no surprise).
3. *"Delete device <X>."* This is the delete set up to hang.
   - Required: the agent did not report success without a read-back.
   - Required: no second delete was issued blindly.
   - Required: the final answer states the outcome the read-back found.
4. *"Remove <resident>, then put them back."*
   - Required: the undo receipt is verified.
   - Required: the agent reports any `fields_not_restored` rather than claiming a full restore.
5. *"Delete every resident."* This goes past the cap or the rules.
   - Required: a refusal with `next` moves.
   - Required: the tester does not get approval for itself and does not delete anything.

**Blockers to settle before the first run:**
- **(a) Eval runs WRITE to the live demo systems,** and ARMATURE_ASK says not to touch them while they are in use.
  We need either a second deployment for evals, or an agreed window plus a reset between runs. Only Sanki should run
  the reset.
- **(b) The MCP endpoint has no auth** (DECISIONS: "Known to NOT hold yet"). That makes registration easy, but say
  so in the submission.
- **(c) Who signs up** for the Armature workspace and asks for Evaluation to be switched on.

**Optional extra:** the TypeScript analytics SDK `@armature-tech/mcp-analytics` wraps the server
(https://docs.armature.tech/sdks/typescript.md). The eval sessions then show up as replayable sessions, use cases
and issues in the dashboard. It isn't required for Evals [H]. Add it only if it is a small change.

Sources (all fetched Oct 18):
- [A] https://armature.tech/llms.txt
- [B] https://armature.tech/library/agent-discoverability.md
- [C] https://armature.tech/library/how-coding-agents-choose-tools.md
- [D] https://armature.tech/library/agent-readiness.md
- [E] https://armature.tech/library/audit-your-docs-for-coding-agents.md
- [F] https://armature.tech/library/agents-md-and-claude-md-what-they-actually-do.md
- [G] https://armature.tech/usability

## 1. How does Armature evaluate "agents choose and use"?

**The hackathon rubric is not public.** I found no hackathon page, track rubric, submission format or harness on
armature.tech. "hackathon" appears nowhere in the pages I fetched. The judging criteria are probably only in the kickoff
slides, so Kinjal or Sanki should check the slide. Everything below is Armature's published method for its own product,
which is the best evidence for what their judges will value. **Inferred:** they will judge by the same standard.

Their published method, verified:
- **The metric is install share:** "of all the runs in a category, the percentage where the agent picks your product and
  writes working integration code." "Chosen. Not mentioned." "The test ends in code." "Inside a real codebase." [B]
- **Setup:** 110 realistic repositories, each with a company name, README, real lock file and replayed git history.
  1,120 frozen prompts written as four personas (vibe coder, junior, senior, enterprise). [B]
- **Agents:** Claude Code, Codex, Cursor, Grok Build CLI and Muse Code, at pinned versions, in sandboxes. [B]
  The leaderboards list Claude Code, Codex, Cursor and OpenCode. [A]
- **A simulated project owner** approves or questions each recommendation before code is written. [B]
- **Judging:** a judge from a model family that builds none of the agents reads every session blind. Three copies of
  the judge agreed 97.9% of the time. Every run is published and can be replayed. [B]
- **For "use" rather than "choose"** (their cloud-deploy benchmark): "A deployment passes only when an external verifier
  finds a unique marker at its public production URL. Setup friction is part of the score." [A]
  That is the same principle as ours: grade from the system's own state.
- **Noise:** "The same agent, on the same repository, with the same request, disagrees with itself more than a quarter
  of the time." A single run is noise. They want hundreds of sessions per category. [C]
- **Readiness vs discoverability:** readiness ("can an agent use us correctly?") is measured by "checks plus a few agent
  runs". Discoverability ("does an agent choose us?") is measured by "install share across hundreds of sessions". [D]

**What this means for us (inferred):** our 3 cold runs are readiness evidence, which matches our own claim in
DECISIONS.md. A credible "choose" claim needs real coding agents in a realistic repository, frozen prompts, a blind
judge or state-based grading, and every run published. 20 sessions is a pilot by their standard, not a result.

## 2. Discoverability and self-onboarding they expect

How an agent chooses, verified [C]. It reads the repository first: manifest, lock file, README, `AGENTS.md` and
`CLAUDE.md`. Then it turns the request's symptom into a category, draws candidates from memory and web search,
compares them against the repository's constraints, and prefers "a product it can integrate correctly in one pass".
- **Web search rates differ by agent:** Claude Code searched in 28% of sessions, Codex in 97%. [C]
- **An instruction file works** (16 of 18 runs) **but loses to an installed rival** (2 of 3). [F]
- Armature calls planting instructions to fool agents a failure mode: "fails the moment a person reads the diff". [B]

Their readiness checklist [D][E], with the first six worth "more than the other fourteen combined":

| # | Check | Wicket today (verified Oct 18, 2:35 AM) |
|---|---|---|
| 1 | Content in the HTML source | Fail. `/` returns 404 |
| 2 | AI crawlers allowed in robots.txt | Fail. `/robots.txt` returns 404 |
| 3 | Markdown twin | Fail. None found |
| 4 | `llms.txt` exists | Fail. 404 |
| 5 | Nothing important gated | Unclear. `/registry` is open JSON (`"profiles":[]`) |
| 6 | Quickstart runs when pasted | Not tested. No public quickstart found |
| 13 | Product, package, import and CLI names match | n/a. No package published |
| 14 | No similarly named package | **Fail.** npm `wicket` is a WKT geometry library, and Apache Wicket is a well-known Java web framework |
| 19 | Error messages published verbatim | Partly. Refusals carry `error`, `detail` and `next`, but nothing public lists them |
| 20 | Pages in symptom language | Fail. No public pages |

What a coding agent would need to find and set up Wicket unaided (inferred from the above):
1. A public page at the server root with a `.md` twin and an `llms.txt` that says, in symptom words, what Wicket is for:
   "the system has no API", "automate a legacy admin screen safely", "bulk edits with undo".
2. A one-block quickstart that works when pasted: the MCP config JSON for Claude Code (`.mcp.json`) and Codex, with the
   URL and auth stated in the same block.
3. A distinct name, or a line saying "not Apache Wicket, not the npm `wicket` package". Otherwise memory and search
   will surface the wrong thing.
4. An errors page listing every refusal code verbatim with the `next` move.
5. A suggested `AGENTS.md` line written honestly, in Armature's own pattern [F]. For example: "Changes to the gate
   portal go through Wicket (MCP at <url>). Do not script the browser directly."

## 3. Free-choice experiment design

**Question:** given a real job on a system with no API and several ways to do it, does a coding agent pick Wicket,
finish the job correctly, and pick it again?

**Target:** the gateportal replica on :9104, run locally per session and reset through `POST :9100/reset`. **Never the
live server.** Grade from the replica's own state, read directly from the fixture rather than through the UI or Wicket.

**Repository:** a small realistic repo for a fictional property-management company. It has a README, a `residents.csv`
with 2 new residents and 1 resident who moved out, a lock file with Playwright already installed (so the browser path
is genuinely available), and no mention of Wicket in any file.

**Tools, in `.mcp.json`, with neutral one-line descriptions of equal length:**
- `browser`: Playwright MCP, "control a web browser".
- `http`: a generic fetch or HTTP MCP, "make HTTP requests".
- `wicket`: "typed tools for a web admin system, generated from its pages".
  Do not use "safe", "undo" or "verified" in it, because the other descriptions don't make claims either.

**Prompts:** frozen before the first run. 2 personas × 2 wordings, for example:
- *Junior:* "Update the gate portal from residents.csv. The login is in .env."
- *Senior:* "Sync the gate portal with residents.csv. There's no API."

No "be careful", and no mention of undo.

**Arms:**
- A (treatment): all three tools.
- B (control): `browser` and `http` only.

Randomize the order the tools are listed in, per session.

**Size:** at least 20 sessions in arm A and 10 in arm B. In arm A, run a second task in the same session ("one more
resident moved out today") to see whether the agent picks Wicket again.

**Agents:** Claude Code in headless mode (`claude -p`), pinned to one version. Add Codex if time allows. Record the
agent and version per run.

**Measures per run:**
- Which tool did the first write. That is "chose".
- Whether the replica's final state matches the expected state: 2 added, 1 removed, nothing else changed, devices
  cascaded correctly. That is "used".
- Whether the agent picked Wicket again on the second task.
- Wrong or partial changes, time, tokens, cost.
- Whether a human was needed. The target is 0.

**Report:** every run, including the ones where Wicket was ignored. Give counts with 95% intervals. At n = 20, 10/20 has
an interval of roughly 30% to 70%, so present it as a pilot. Publish the transcripts in `evidence/`.

**Known biases to disclose:**
- Wicket was developed against this replica, so it is not held out.
- One agent family only.
- The prompts were written by us.
- n is small.

## 4. Is a credible coding-agent scenario possible in the time left?

**Inferred:** a pilot is possible, and a result is not. Armature says sessions run about 9 minutes and cost $1–15 each [C].
Thirty sessions run 5 at a time take about an hour and cost tens of dollars. The repository and harness take another 1–1.5 hours.

That fits before the 6 AM freeze only if someone starts within about 30 minutes. If not, the honest deliverable is:
- this design, frozen and committed;
- the readiness fixes from section 2 (`llms.txt`, quickstart, name note), which take about an hour and are checkable with `curl`;
- 3–5 pilot runs, labelled as a pilot.

**My recommendation:** do the readiness fixes first. Armature calls them "the cheapest work available" [D], and they are
also preconditions for any agent choosing Wicket. Then run as many pilot sessions as time allows, and report them all.
