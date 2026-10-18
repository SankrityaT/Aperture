I deleted the account `tester7` (Test7 User, tester7@example.test, Subscriber role, 0 posts) from the company website admin at `http://localhost:8082/wp-admin/users.php`. No other account was changed.

**What changed**
- One user record was removed: key `tester7`. Aperture's preview (plan `pln_1`) listed this as the only removal, and committing that plan produced receipt `rcpt_1`.
- The users table count after the change is 23.

**How I know**
- **Preview:** a dry run listed only `- table_ordered_by_username_ascend tester7` as the removed item.
- **Read-back in the receipt:** `verified.subject_present: false`, `counts_after: 23`, `matches_prediction: true`, `ok: true`.
- **My own check:** I searched the users table for "tester" afterward. `tester7` no longer appears. The other tester accounts I could see were still there, 22 results in total. I didn't record the full list before the delete, so I can't prove every other account is untouched beyond what the preview and receipt show. `tester5` is not in the results. I did not check whether it existed before.

**Not done, and still open**
- The change is recorded in the admin system, but Aperture has not sent the "Send password reset" step. That step is a separate action, and sending it needs the owner's approval through publish. If the account is reachable elsewhere, for example through a gate or another system, it may still be active there until that is handled.
- Undo is available until 2026-10-19 13:37 UTC via receipt `rcpt_1`.