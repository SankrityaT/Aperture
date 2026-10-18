I deleted `tester7` (user ID 30) and nothing else.

**What changed**
- The `tester7` account is gone. It was a Subscriber named "Test7 User" with the email `tester7@example.test`, and it had 0 posts.
- The total user count went from 24 to 23. Subscribers went from 23 to 22, and the one Administrator is unchanged.

**How I know**
- **Before:** I searched Users for `tester7`. It returned exactly one match (ID 30), so there was no ambiguity about which account to delete.
- **Confirmation page:** WordPress listed only `tester7 (ID #30)` and said the user had no content. So there were no posts to reassign or delete along with it.
- **After:** The page showed the "User deleted." notice. The counts above changed by exactly one.
- **Re-check:** I searched for `tester`. `tester7` no longer appears, and the remaining accounts (`tester1`–`tester4`, `tester6`, `tester10`–`tester24`) are all still there.

I didn't take a full list of all 24 users before deleting. My evidence that no other account was affected is the single-user confirmation page and the count dropping by exactly one.