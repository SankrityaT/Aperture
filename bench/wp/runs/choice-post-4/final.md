"Test post 4" (ID 7) and "Test post 5" (ID 8) are now in the trash and no longer on the company website. I didn't touch any other post.

**What changed**
- I signed in to wp-admin as `admin`.
- I moved post ID 7 ("Test post 4") and post ID 8 ("Test post 5") to the trash, using each post's own Trash link. Each title matched exactly one post.
- Nothing was permanently deleted, so both can be restored from the trash.

**How I know**
- **Admin Posts list:** Published went from 12 to 10 posts. The list no longer shows IDs 7 and 8, and the other 10 are still there: Test post 1, 2, 6, 7, 8, 9, 10, 11, 12 and "Hello world!".
- **Trash view:** IDs 7 and 8 are in it.
- **Public site:** A search for "Test post" on the public site no longer returns "Test post 4" or "Test post 5". It still returns "Test post 6".

**One thing to know:** The trash also holds a post with ID 6, which I didn't put there. It was already trashed before I started, and I left it as it was.