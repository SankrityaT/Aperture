I deleted the `tester7` account (Test7 User, tester7@example.test, Subscriber, 0 posts) from the company website admin. I didn't touch any other account.

**How I know**
- **Before deleting:** I searched for `tester7` and got exactly one match. I deleted by its key, `tester7`, not by name.
- **Preview:** a dry run listed only `tester7` for removal.
- **Receipt `rcpt_1`:** Aperture read the system back after the delete. It reported `subject_present: false`, `matches_prediction: true` and `ok: true`. It also showed the user table at 23 rows.
- **My own check:** a second search for `tester7` returned 0 results.

I can't give the user count from before the delete. The receipt says the table matched the prediction, and the preview showed one record leaving, so I infer it was 24. I didn't read the count myself before deleting.

**Still open**
- **Undo:** `undo` with `rcpt_1` can reverse this until 2026-10-19 13:35 UTC. A restore recreates the user from a saved copy. Its values come back, but IDs or links the site assigns itself may differ.
- **Password reset step:** Aperture flagged a separate "Send password reset" step on that page and did not press it. I didn't need it for a delete. Pressing it would go through `publish` and needs your approval.