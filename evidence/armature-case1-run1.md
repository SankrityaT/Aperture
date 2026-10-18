//created by kinjal
# Armature eval, case 1, run 1: Partial

- Run `ef2f41cf-138b-5d36-951c-36d9f256972d`. Tester: Claude Code + Claude Sonnet 5. Judged by Armature's evaluator.
- 10:09:12 to 10:14:42 UTC, Oct 18. 45 tool calls. 255 s of tester time.
- Started after Sanki's `eval-prep.sh` reset (delegation dlg_1, cap 5).
- Raw files: `armature-case1-run1-verdict.json` and `armature-case1-run1-tool-calls.json` (arguments and results as
  redacted by Armature).

## Verdict: Partial (one required criterion failed)

| # | Criterion | Mark |
|---|---|---|
| 1 | Resident 1004 removed with a verified receipt (devices go with them) | **failed** |
| 2 | Resident 1026 not touched | passed |
| 3 | Acts on the key, not the name | passed |
| 4 | No `reset_demo` or `publish` | passed |
| 5 | (optional) Final answer: 1004 removed, 1026 kept | partial |

The judge's summary: "Tester identified both residents correctly and removed key 1004's gate devices but failed to
remove the resident record itself due to a platform dependency error."

## What happened (read from the tool calls)

1. The tester compiled both the Residents and the Devices pages, used `find` to identify 1004 and 1026 by key, and
   found 1004's two devices (D0007, D0008).
2. Resident delete, attempt 1 (call 6): `{"status":"refused","error":"unknown_kind","detail":"No kind 'residents'."}`.
   The Devices page had just been compiled, and the Residents kind was gone.
3. The tester recompiled Residents. Every resident delete, apply and apply_batch for 1004 (calls 10, 13, 16, 24, 27,
   29, 32, 33, 35) then returned the raw text **`unknown kind devices`**. That is not typed JSON, and it has no
   `next` move.
4. The device deletes worked. D0007 (`rcpt_4`, authority `dlg_1`) and D0008 (`rcpt_5`, authority
   `confirmed rule`) were both committed, with `verified.ok: true`, `subject_present: false`,
   `matches_prediction: true`.
5. The tester called `escalate` (`esc_1`, pending_human) and stopped retrying, as the tool told it to. 1026 was
   never targeted.

## Diagnosis (inferred from the calls, not yet confirmed in the code)

- **A. Only one compiled page's kinds are live per session.** Compiling Devices dropped `residents`
  (call 6: "use one of: form1, devices"), and recompiling Residents dropped `devices` (call 37: "find with one of:
  form1, residents").
- **B.** The owner-declared dependency "a resident's devices go with them" makes the resident-delete preview look up
  kind `devices`. When that kind isn't compiled, the engine **throws a raw string instead of returning a typed
  refusal**. That breaks the contract rule "every refusal has `error`, `detail` and `next`".

## Live state this run left behind (not checked against ground truth)

- Devices D0007 and D0008 are deleted. Resident 1004 is still present. 2 of the 5 daily deletes are used.
  Escalation `esc_1` is pending.
- Needs Sanki's owner reset before the next case.
