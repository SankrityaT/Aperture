//created by kinjal
# Held-out run on public government demo systems

Kinjal's request (Oct 18, 4 AM PT): try public permitting and e-government demos as held-out apps.
1. Start read-only.
2. Confirm automation permissions before any test write.
3. Have Wicket compile an unfamiliar multi-step workflow without site-specific code.
4. Compare Wicket with a plain browser agent.
5. Measure completion, time, cost, tool calls and verified outcomes.
6. Run a separate free-choice experiment.
7. No compiler tuning for the site, and no success claimed unless the app's own observable state confirms it.

## Candidates (checked read-only, Oct 18, 3:40–4:05 AM PT)

| Site | What it is | Login | Writes | Verdict |
|---|---|---|---|---|
| GovStack Sandbox, Social Cash Transfer (`usct.sandbox.govstack.global/driver-poc/login`) | GIZ-run demo: an enrollment officer and a payment officer. It has a log viewer showing the building blocks at work | Persona IDs and passwords **published on the demo page** | "All demo actions are for testing purposes only" | **Primary target** |
| GovStack Construction Permit (`ux-demo.sandbox.govstack.global`) | A click-through UI mockup, "conceptual level only" | none | no backend, so nothing to verify | Not usable for verified writes |
| CitizenLink, ADG Vantage (`demo.citizenlink.app/permits`) | A legacy-style permits portal for "City of ADGVille", server-rendered on Apache | Public search needs none. A contractor login is issued by ADG by email, "within 1 working day" | Writes are out: no login in time, and there are payment pages | Read-only only. The data is very thin (searching "main" returns 2 parcels) |
| DIGIT Sandbox, eGov (`sandbox.digit.org`) | A self-service sandbox. Only Complaints and Employee Management are on | Sign-up with username and email (a human must do it) | "try out, build, test" | Backup if Kinjal signs up |

Permission evidence: **none of the three sites publishes terms of use or an automation policy.** The GovStack GitBook says
it is "a demonstration and learning tool" and "not intended for building, deploying live systems". DIGIT calls itself
"a self-service platform to rapidly try out, build, test". CitizenLink has no robots.txt (it returns 404). We take
the GovStack wording as permission for test actions on its demo personas. We do not claim explicit permission for
automation.

## Rules for this experiment

- **No agent types a password.** Kinjal logs in once in a visible browser and saves the session
  (`playwright-cli state-save`). Browser-arm agents load that file. Wicket logs in through its own scripted,
  owner-configured login (Sanki's side).
- **Test data uses run-scoped names,** such as `WKT-TEST-<run>-<n>`, so our records are easy to tell apart on a shared
  sandbox.
- **No change to Wicket's compiler** for this site. If something fails, it fails and gets reported.
- **Success is judged outside the agent.** A run counts only if the app's own state shows the record (read through
  the app's UI, API or log viewer by the grader, not by the agent under test).

## Arms (fresh `claude -p` sessions, same model, same frozen prompt)

| Arm | Tools | Runs |
|---|---|---|
| W | Wicket MCP only | 3 |
| B | Browser only: `playwright-cli` with the saved session | 3 |
| C (free choice) | Both, with neutral one-line descriptions, listed in random order; the prompt never mentions Wicket | 6 or more |

Recorded per run, from the `claude -p` JSON output and the tool stream: completed (verified by grader), wall time,
`total_cost_usd`, number of turns, tool calls by tool, which tool did the first write (arm C), and whether a human was
needed. Every run is reported, including failures. With these sample sizes this is a pilot, not a benchmark.

## Open items

1. Kinjal logs in to USCT once and saves the session (instructions in chat).
2. Sanki: can Wicket log in to USCT through owner config? If not, arm W cannot run.
3. Pick the workflow after a read-only look at the logged-in app (enroll a test beneficiary, then pay them, is the
   likely one).
