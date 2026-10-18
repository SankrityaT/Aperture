I deleted the `tester7` account (Test7 User, `tester7@example.test`, Subscriber, 0 posts) and nothing else.

**What I did**
1. I searched the users table for `tester7` and got exactly one match, with key `tester7`.
2. I ran a dry-run delete (plan `pln_1`). It listed one removal, `tester7`, and nothing else.
3. I committed that plan. The receipt is `rcpt_1`.

**How I know**
- The system's own read-back after the delete reported that `tester7` is no longer present. The user count went from 24 to 23, which matched the preview.
- I searched again for "tester" afterwards. It returns 22 accounts, `tester1` to `tester24` without `tester7`, and `tester7` is not among them. `admin` isn't in that search, so I didn't re-read it.
- `tester5` is also absent from that list. I never saw it in the list before the delete, so I can't prove it was already gone. The 24 to 23 count change shows only one account was removed.

**Notes**
- The receipt mentions a "Send password reset" step that I haven't run. It has nothing to do with deleting an account, so I didn't publish anything.
- You can undo this with `undo rcpt_1` until 2026-10-19 13:34 UTC. The restore recreates the account from a saved copy, so any ids the app assigns itself may differ.