# Aperture

Aperture is an MCP server that lets AI agents work in web systems that have no API. It compiles a page into typed tools (forms, tables, item and product cards), then wraps every change in a preview, the owner's authority, a read-back from the real system, a receipt, and an undo.

Note on the name: this is not the npm package `aperture` (macOS screen recording) and not Apple's discontinued Aperture photo software. The repo was renamed from `wicket-build`; some code, environment variables and bench files still say "Wicket".

All numbers below were measured on Oct 18, 2026 and are reproducible from `bench/` and `server/test/`. Samples are small and stated. No real customer or resident data is in this repo.

## Try it in 1 minute

A live server runs on Manufact Cloud (mcp-use):

```
https://calm-steel-d31rh.run.mcp-use.com/mcp
```

Connect in Claude Code:

```bash
claude mcp add --transport http aperture https://calm-steel-d31rh.run.mcp-use.com/mcp
```

Then ask the agent to call `get_instructions`, and make one read-only call (`find_systems`, or `compile_site` on a public page). Change nothing until you have read the preview.

Agent-facing docs are served by the same host: `/llms.txt`, `/quickstart.md`, `/errors.md`, and `/skill.md` (an Agent Skill; for Claude Code save it as `.claude/skills/aperture/SKILL.md`).

## How a change works

Every change an agent makes goes through the same steps:

1. **Preview.** `dry_run` returns a plan that shows the records that go with the change (for example the devices that belong to a resident). Nothing is touched.
2. **Owner authority.** The change commits at once if the owner gave a standing delegation (kinds, operations, a limit, an expiry). Otherwise it waits for approval. Approval is never an agent tool: an agent cannot approve its own change.
3. **Commit.** Run with the `plan_id` from the preview.
4. **Read-back.** Aperture reads the real system again and compares.
5. **Receipt.** The receipt says `verified` (from the read-back, not from the click), any `surprise`, and `not_yet_live` when the system has a separate send step that has not run. `verified.scope` states which tables were compared and that tables Aperture has not compiled are not checked.
6. **Undo.** Per record. It says exactly what it could not restore.

If a worker call hangs during a commit, the outcome is recorded as `outcome_unknown` and `get_plan` reads the system to say what happened. It does not retry the write.

## Permissions

- **Reading public pages is open.** Internal and private addresses, cloud metadata addresses, `.gov` and `.mil` hosts, and an operator deny list are blocked, including through redirects.
- **Signing in and every change happen only on systems the operator listed.** Logins are stored by name on the worker; agents pass the name and never see a password.
- **CAPTCHAs are never bypassed.** A person does those steps.

## Tools

12 tools. The surface was cut from 22 because agents used only 8 of them across 20 runs.

| Tool | What it is for |
|---|---|
| `get_instructions` | Short guide written for agents |
| `find_systems` | Find a listed system from a need in plain words |
| `compile_site` | Read a page, read-only, and compile it into typed tools; pages add to each other |
| `find` | Look up records and their exact keys (names are not unique) |
| `delete` | Delete a record (preview with `dry_run`, then commit) |
| `create` | Create a record (preview with `dry_run`, then commit) |
| `apply` | The normal way to make a change: previews, then commits at once if the rules allow, else returns `awaiting_approval` |
| `apply_batch` | Many changes in one call; items that need the owner are listed with plan ids |
| `get_plan` | Read a plan's state; after an unknown outcome, reads the system |
| `undo` | Undo a committed change, per record |
| `escalate` | Ask the owner for help when a rule blocks you (for example a daily limit) |
| `publish` | Send staged changes to the outside world; always needs the owner and cannot be undone |

## Results

| Test | Result | Sample |
|---|---|---|
| **Race on GateAdmin32** (a replica of a gate-access admin app): remove 2 residents and their devices, leave a same-name one, report whether it reached the gate. Aperture vs a Playwright browser agent | Both 7/7 correct. Aperture median 75 s, 18 calls, $0.23. Browser agent 158 s, 35 calls, $0.49. That is 2.1x faster at half the cost | 7 pairs, one model, local replica. A further pair is excluded: its grading step failed. Two runs with a hanging page (before the hang fix): both correct, the browser agent hit the 25-minute limit both times, Aperture took about 8 minutes |
| **Agent choice**: fresh sessions with both tools connected; the prompt names neither | 8 used only Aperture, 2 used both, 0 used only the browser. 10/10 correct | 10 sessions |
| **WordPress head-to-head**: browser only vs Aperture only, Sonnet and Haiku | Every run correct on both sides. Deleting a user: 38 s vs 47 s, 8 vs 14 calls, about 60% cheaper. Trashing two posts: even | 20 runs |
| **Armature evals** on the live server | 36 of 39 judged runs passed (13 cases x 3 rounds). All 5 write cases passed every run after round 1. The evals found 3 bugs; all are fixed | 39 judged runs |
| **Automated tests** | 81/81 | |

Raw runs and harnesses are in `bench/` (`race`, `choice`, `wp`, `amazon`). `DEBRIEF.md` has the full table, including a lost run on Amazon and Best Buy.

## Architecture

```
agent --MCP--> Aperture server (Manufact Cloud, no browser there)
                  |
                  +--HTTPS + token--> browser worker (Playwright/Chromium)
                  |                   on an InstaBox cloud machine, for listed systems
                  |
                  +--HTTPS + token--> optional read-only public worker
                                      on an ordinary connection, for public sites that
                                      block datacenter addresses (WICKET_PUBLIC_WORKER_URL)
```

- One browser lock per worker, so calls on a worker are serialized.
- Every worker call has a deadline. A page that hangs longer than 17 s is replaced by a fresh page, and callers get a typed `worker_busy` instead of waiting.
- A durable file ledger records plans and receipts. A change that was running during a crash becomes `outcome_unknown`, and `get_plan` reads the system instead of retrying.

## Run locally

```bash
cd server
npm install
npx mcp-use dev          # serves on port 3000
```

Tests (`CHROME_PATH` points at a Chrome or Chromium binary):

```bash
cd server
CHROME_PATH=<chrome> npx tsx --test test/*.test.ts
```

Browser worker:

```bash
cd server
WICKET_WORKER_TOKEN=... npx tsx src/worker/server.ts
```

Environment variables (names only; set the values yourself):

| Name | Where | Purpose |
|---|---|---|
| `WICKET_WORKER_URL`, `WICKET_WORKER_TOKEN` | server and worker | Browser worker for listed systems |
| `WICKET_PUBLIC_WORKER_URL`, `WICKET_PUBLIC_WORKER_TOKEN` | server and worker | Optional read-only worker for public sites |
| `WICKET_ALLOWED_HOSTS` | server | Systems where sign-in and changes are allowed |
| `WICKET_PUBLIC_WEB` | server | Set to `0` to turn public reading off |
| `WICKET_DENY_HOSTS` | server | Operator deny list for public reading |
| `WICKET_CREDS_<NAME>` | worker | Stored login as `"user:pass"`, referred to by name |
| `WICKET_SYSTEMS` | server | JSON list that `find_systems` returns |
| `OWNER_TOKEN` | server | Protects the owner routes |
| `APERTURE_ACCESS_KEYS` | server | Endpoint access keys |

## Limits

- The speed gain is small on simple one-record jobs (WordPress post trashing: none). The gap grows with cascades, look-alike records and a separate send step.
- One browser per worker, so calls are serialized.
- Effects in tables that were never compiled are not checked. Receipts say so in `verified.scope`.
- The endpoint access key exists but is off by default (`APERTURE_ACCESS_KEYS`). Until it is set, writes are gated only by owner delegation or approval.
- Product-card pages can be a compiler gap, and some retail sites bot-check headless browsers. Aperture does not bypass CAPTCHAs.

## Repo layout

```
server/      MCP server, engine, generator, worker, tests
landing/     Next.js landing page
bench/       race, choice, wp, amazon harnesses and raw runs
targets/     local WordPress and Dolibarr setups
BRIEF.md     original team brief
contract.md  adapter interface and ticket lifecycle
DEBRIEF.md   status debrief with results, sample sizes and known weaknesses
```

The agent skill is served by the live server at `/skill.md` (source: `server/src/agent-docs.ts`).
