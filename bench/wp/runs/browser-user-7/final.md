I deleted the tester7 account (Test7 User, tester7@example.test, user ID 8, Subscriber). That is the only change I made.

**What I did:** I logged in as admin and searched for "tester7". Exactly one account matched. WordPress's "Delete Users" confirmation page listed only "tester7 (ID #8): This user does not have any content," so there were no posts to reassign or delete. I clicked "Confirm Deletion."

**How I know it worked:**
- WordPress showed the "User deleted." notice.
- The user count dropped by exactly one: **All 24 → 23**, **Subscriber 23 → 22**. The Administrator count stayed at 1.
- Opening `user-edit.php?user_id=8` now returns "Invalid user ID."
- Page 1 of the user list has the same 20 accounts as before. Page 2 now shows tester6, tester8 and tester9.

**Something to know:** there is no tester5 account. Searching for it finds nothing, and user ID 6 (probably tester5, since IDs run one ahead of the tester number) returns "Invalid user ID." It was already gone before I started. Before the deletion there were 24 accounts: admin plus 23 testers, not 24. Nineteen of those testers were on page 1, so page 2 held four accounts, one of them tester7. After the deletion page 2 holds three, so my deletion removed exactly one account. I didn't open page 2 before deleting, so this comes from the counts, not from seeing it directly. If tester5 should exist, someone removed it earlier.