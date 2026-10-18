I deleted the `tester7` account (Test7 User, tester7@example.test, Subscriber, 0 posts) and changed nothing else.

**How I know**
- **Single match:** Before deleting, I searched for `tester7`. Exactly one record matched, and I used its key, not the name.
- **Preview:** A dry run showed one removal, `- tester7`, and nothing else.
- **Receipt:** After the delete, Aperture read the Users page back. It reported `subject_present: false` and a user count of 23, which matched the preview (`matches_prediction: true`, `ok: true`). The receipt is `rcpt_1`.
- **My own check:** A second search for `tester7` returned 0 results.

**What I didn't do**
- I did not press the page's "Send password reset" step. It isn't part of a delete, and Aperture says it needs your approval.
- I did not touch any other accounts, including tester1 through tester24, which are still listed.

**Undo:** You can undo this with `undo(rcpt_1)` until 2026-10-19 13:32 UTC. It would recreate the account from a saved copy, so its values come back but any WordPress-assigned IDs or links may differ.

**Check this yourself:** Aperture's read-back came from the compiled Users page. I didn't open the admin screen in a browser.