I moved "Test post 4" and "Test post 5" to the trash. No other post was changed.

**What changed**
- **Test post 4** (post ID 7) moved from Published to Trash.
- **Test post 5** (post ID 8) moved from Published to Trash.

**How I know**
- Before acting, I checked the Posts list. Each title appeared once, so the IDs were unambiguous.
- Before applying the bulk action, I checked the page's checkboxes in the DOM. Only post 7 and post 8 were checked.
- After the action, the Trash list shows `post-8` (Test post 5) and `post-7` (Test post 4) with "Restore / Delete Permanently" links. Their dates show a Last Modified time of 10:58 am.
- The Published list went from 12 to 10 posts. Post 7 and post 8 are gone. The remaining IDs are 1, 4, 5, 9–15.
- Trash went from 1 to 3 posts. The one that was already there, post 6 ("Test post 3"), was in the trash before I started. I did not touch it.

**Notes**
- The login page appeared, so I signed in as `admin` with the password you gave me.
- I didn't open the content of the two posts. I went by your statement that they're out of date.
- Nothing was permanently deleted. Both posts can be restored from the Trash.