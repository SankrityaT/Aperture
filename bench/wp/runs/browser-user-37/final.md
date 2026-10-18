The `tester7` account is deleted.

**What changed:**
- Deleted WordPress user `tester7` (ID 36, display name "Test7 User", email tester7@example.test, role Subscriber, 0 posts).
- The Users list went from All (24) to All (23), and Subscriber from 23 to 22. Administrator stayed at 1.

**How I know:**
- Before deleting, the search for `tester7` returned exactly one row, ID 36, and I deleted from that row's Delete link.
- WordPress's confirmation page listed only "tester7 (ID #36): This user does not have any content." I confirmed that.
- After confirming, the search for `tester7` shows "No users found." and the counts above dropped by one, matching a single deletion.

**What I didn't touch:** No other accounts. The only write was the single delete. I signed in as `admin` with the password you gave me, which I used only for this login.