I moved "Test post 4" (post ID 7) and "Test post 5" (post ID 8) to the Trash. No other post was changed.

**What I did**
- I signed in to `/wp-admin/` as admin.
- I searched the Posts list for "Test post". Each title appeared exactly once, so there was no ambiguity about which posts to pick.
- I ticked only the checkboxes for IDs 7 and 8 and ran the bulk "Move to Trash" action. Before submitting, I confirmed those were the only two boxes checked.

**How I know it worked**
- WordPress showed "2 posts moved to the Trash."
- The Published count is now 10, and the Trash count is 3.
- The Trash list contains IDs 8, 7 and 6. The list showed no titles, so I identified 7 and 8 by ID.
- The remaining list shows Test post 1, 2, 6, 7, 8, 9, 10, 11 and 12, all still published.
- A search of the public site for "Test post" returns neither "Test post 4" nor "Test post 5".

**Already in the Trash**
Post ID 6 was already in the Trash before I started, which is why the count is 3 and not 2. I didn't touch it and don't know its title.

The two posts can be restored from Trash if needed.