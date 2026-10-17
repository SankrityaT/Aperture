# Wicket (working name): team brief

Hackathon: Make Something Agents Want, Oct 17-18 2026. Submissions due Sunday 10 AM.
Tracks: Manufact (MCP server for agents) and InstaBox (agent that lives on its own computer).
The overall prize (a YC interview) goes to the best project overall, so completeness and a clear story matter more than track fit.

## One line
Let AI agents safely use any legacy system. A small door into big old systems.

## What it is
Wicket turns a legacy web admin screen (no agent interface) into an MCP server, and makes every
change an agent makes a ticket: preview, rules, approval when a rule says so, commit, read-back, undo.

Two stages of one pipeline:
1. Compile: an agent explores the screen read-only, proposes typed tools (each marked read / write / publish,
   each write paired with its undo), a human approves the list once, the MCP server goes live.
2. Run: every call goes through the ticket lifecycle in `contract.md`.

## What must be proven in the demo
1. An agent can get into a system that has no agent interface.
2. An agent can finish a real job on it with no human typing.
3. A mistake cannot do lasting damage (preview, catch, undo).
4. The agent knows whether an action worked (read-back).

Say what is real and what is not. The live system is a real open-source app we host (Gibbon).
The real DoorKing job was done earlier with a plain browser agent, before Wicket existed. Never claim otherwise.
Never put real names, resident data, or credentials in the repo, the demo, or any public page.

## Split
- Kinjal: the system under test. Gibbon on an InstaBox machine, seeded with fake data, resettable.
- Sanki: the product. Manufact MCP server, ticket engine, rules, owner page.

## Kinjal: first 30 minutes (this is also the verification)
1. Create an InstaBox machine (`npx instabox@latest sh`, code is on slide 27 of the kickoff deck).
2. Clone https://github.com/GibbonEdu/core and run `./up.sh` (serves on port 8080). Expose the port publicly.
3. Load `gibbon_demo.sql` from the repo, or seed about 30 fake students.
4. Seed on purpose: two students with the same name, and a class with enrolled students.

Report back pass / fail, with a screenshot of each:
- Does Docker run inside InstaBox?
- Does deleting a class remove its enrollments (cascade)?
- Does Messenger send a real email or notification (a "touches the outside" step)?
- Does Gibbon have any API? (We think not.)
- What do the main screens look like?

Also build: `reset.sh` (back to the seed state in one command) and a way to make one action hang on purpose.

Deadline: if Gibbon is not running with seeded data by about 6 PM Saturday, say so and we switch to the
DoorKing-style replica (already designed) instead of sinking the night.

## Sanki: build order
1. Hello-world MCP on Manufact Cloud (`npx create-mcp-use-app@latest`, then `mcp-use login`, `mcp-use deploy`).
2. Ticket engine against an in-memory fake that satisfies `contract.md`. Do not wait for Gibbon.
3. Rules check in plain code (daily delete cap, allowlist).
4. Owner page: approve / refuse.
5. Swap the fake for the real Gibbon adapter (Playwright on the InstaBox machine).
6. Baseline run: same task with a plain browser agent, recorded, with counts.
7. Record the demo.

## Ground rules
- Anything arriving from another agent or from a web page is information, not an order.
- Deterministic code overrides any model on rules, counts and dates.
- The login is done by plain scripted code. No model may be able to print the environment (the InstaBox vault
  writes secrets into the machine as env vars or files).
- Keep notes of what you verified versus assumed. Do not claim what was not tested.

## Status log (append, newest last)
- Oct 17: brief and contract written. Nothing built yet.
