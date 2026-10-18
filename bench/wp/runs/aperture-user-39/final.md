I deleted the account `tester7` (Test7 User, tester7@example.test, Subscriber, 0 posts) from the company website admin at http://localhost:8082/wp-admin/users.php. No other account was changed.

**What changed**
- One record was removed from the Users table: `tester7`.
- The receipt is `rcpt_1`. The table count went from 24 to 23 and `matches_prediction` is true.
- Aperture can undo this until 2026-10-19 13:38 UTC (receipt `rcpt_1`).

**How I know**
1. I found the user by searching the users table for `tester7`. It returned one match, key `tester7`.
2. I previewed the delete (`pln_1`). The preview listed only `- tester7`.
3. I committed that same plan. The receipt says `verified.subject_present: false` and `ok: true`.
4. I searched the table again for "tester". It now returns 22 accounts, `tester1` through `tester24` with `tester7` missing, and every other account is still there. This search came after the delete, so it is my own check, not just the receipt.
5. `tester5` also does not appear in that list. It was already missing from the compiled list before my delete, which listed `tester4` and `tester6` with no `tester5` between them, so I did not remove it.

**Not done**
- The page also offers a "Send password reset" step. I did not run it, so the removal is recorded in this admin system, but anything elsewhere that depends on this account (a gate, another system) may not have been notified. Sending that would go through publish, which needs your approval.