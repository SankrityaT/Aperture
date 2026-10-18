"Test post 4" and "Test post 5" are now in the Trash. No other post was touched.

**What changed**
- **Test post 4** (post ID 7): moved from Published to Trash.
- **Test post 5** (post ID 8): moved from Published to Trash.

I did this with the Posts list's bulk action "Move to Trash" on those two rows only.

**How I know**
- Before acting, I searched the Posts list for "Test post". Each of the two titles appeared exactly once, so there was no ambiguity about which posts to trash.
- After the bulk action, WordPress redirected to a URL containing `trashed=2&ids=7,8`, meaning exactly those two IDs were trashed.
- The Trash view now lists post-8 ("Test post 5"), post-7 ("Test post 4"), and post-6 ("Test post 3").
- The main Posts list now shows 10 posts (IDs 15, 14, 13, 12, 11, 10, 9, 5, 4, 1). IDs 7 and 8 are gone from it.

**Things to know**
- **Test post 3** (post ID 6) was already in the Trash before I started. I did not touch it, and the request's ID list (7, 8) confirms that.
- I signed in with the admin / admin-pass-123 credentials you gave me, because the admin pages redirected to the login screen.
- Trashed posts are recoverable from the Trash until it is emptied.