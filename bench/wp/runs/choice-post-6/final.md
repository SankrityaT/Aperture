I moved "Test post 4" and "Test post 5" to the Trash. No other post was changed.

**What changed**
- "Test post 4" (post ID 7) and "Test post 5" (post ID 8) went from Published to Trash. I selected only those two checkboxes and used the bulk action "Move to Trash".
- Nothing was deleted permanently. You can restore either post from Posts → Trash.

**How I know**
- **Published count:** before, 12 posts were published. Afterwards the published list has 10: Test post 1, 2, 6, 7, 8, 9, 10, 11 and 12, plus "Hello world!". Posts 4 and 5 are gone from it, and every other title is still there.
- **Trash:** it now holds post IDs 6, 7 and 8. IDs 7 and 8 are the two I moved. ID 6 was already in the Trash before I started (the list showed Trash (1) and no "Test post 3"). It's presumably Test post 3, but I didn't open it to confirm the title.
- **Public site:** the front-end addresses for posts 4 and 5 (`/?p=7` and `/?p=8`) now return 404, so they're no longer visible. As a control, the address for Test post 6 (`/?p=9`) still returns 200.

I signed in with the admin login you gave me. I used the WordPress admin through the browser, not Aperture, because Aperture's record types (students, classes and similar) don't cover WordPress posts.