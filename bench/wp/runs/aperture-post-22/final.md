I removed "Test post 4" and "Test post 5" from the posts list, and no other post changed.

**What changed**
- "Test post 4" (key 7) was deleted. Receipt: `rcpt_1`.
- "Test post 5" (key 8) was deleted. Receipt: `rcpt_2`.

**How I know**
- **Before:** the admin posts list had 12 rows. The keys were 15, 14, 13, 12, 11, 10, 9, 8, 7, 5, 4 and 1. I picked the two posts by title and then acted only on their keys, 7 and 8.
- **Preview:** I ran a dry run for each delete first. Each one showed only that single record being removed.
- **Read-back:** Aperture re-read the system after each delete. Each receipt says the post is gone, matches the prediction and is verified. The row count went from 12 to 11 to 10.
- **My own check:** I listed the table again afterward. It has 10 rows: Test posts 12, 11, 10, 9, 8, 7, 6, 2 and 1, plus "Hello world!". Keys 7 and 8 are no longer there.

**Caveats**
- **Trash or permanent:** Aperture's receipts don't say whether WordPress put the posts in Trash or deleted them permanently. The page offers a "Trash" action, so it was probably the trash, but I haven't confirmed that. If you want to be sure, check the Trash view in WordPress.
- **Undo:** both deletes can be undone until 2026-10-19 13:31 UTC, using `undo` with `rcpt_1` or `rcpt_2`. The restore recreates each post from a saved copy, so its ID or links may differ.
- **No "Test post 3":** the site had no post with that title before I started, so there was nothing to touch there.