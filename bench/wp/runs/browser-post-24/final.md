I moved "Test post 4" and "Test post 5" to the Trash. No other post was changed.

**What changed**
- "Test post 4" (ID 7) and "Test post 5" (ID 8) went from Published to Trash.
- I signed in as admin and opened each post's "Move to Trash" link from the Posts list.

**How I know**
- **Posts list:** the Published count dropped from 12 to 10. The remaining 10 are Test posts 1, 2, 6, 7, 8, 9, 10, 11 and 12, plus "Hello world!". Test posts 4 and 5 are not among them.
- **Trash list:** Trash went from 1 to 3 items, and IDs 7 and 8 are now in it.
- **Public site:** the homepage no longer mentions either title. `/?p=7` and `/?p=8` now return 404.

**One thing I didn't touch**
- Post ID 6 was already in the Trash before I started, so it was probably "Test post 3". I didn't check its title and left it alone.
- Nothing is permanently deleted, so both posts can be restored from the Trash view.