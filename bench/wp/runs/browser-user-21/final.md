I deleted the `tester7` account and nothing else.

**What changed**
- The user `tester7` is gone. It was ID 28, display name "Test7 User", email tester7@example.test, with the Subscriber role.
- The total user count went from 24 to 23, and Subscribers went from 23 to 22. The one Administrator is unchanged.

**How I know**
- **Right account:** a search for `tester7` returned exactly one match (ID 28). WordPress's own confirmation screen then named "tester7 (ID #28)" as the only user to delete.
- **No content affected:** the confirmation screen said the user had no posts or other content, so I didn't need to reassign anything.
- **Deletion went through:** after I clicked Confirm Deletion, the Users page showed "User deleted." and the new counts above.
- **Nothing else was touched:** I searched for "tester" afterward. It lists 22 users, `tester1` through `tester24` with `tester7` missing (and tester5, 8 and 9 aren't in the list either). The 22 includes accounts that aren't named tester at all.

The search view can't prove that tester5, tester8 and tester9 were already missing before I started. The count change of exactly one, from 24 to 23, matches only `tester7` being deleted.

My first attempt at the delete link timed out, and the admin session then dropped. I logged in again as admin, and the earlier delete link returned a 403 because its security token was stale. I loaded a fresh link and used that. No change was made before the successful deletion.