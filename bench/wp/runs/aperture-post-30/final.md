I removed "Test post 4" and "Test post 5" from the posts list on the company website. I didn't change any other post.

**What changed**
- **Test post 4** (post ID 7) was removed, receipt `rcpt_1`.
- **Test post 5** (post ID 8) was removed, receipt `rcpt_2`.

**How I know**
- Before the change, I listed the posts and matched each title to its ID, since titles aren't unique. The list had 12 posts.
- I previewed each delete first. Each preview showed exactly one record going away.
- After each delete, Aperture read the site back. It confirmed the post was gone and that the result matched the prediction. The count went from 12 to 11 to 10.
- I then listed all posts again. 10 remain: Test posts 1, 2, 6, 7, 8, 9, 10, 11 and 12, plus "Hello world!". Every one of them was in the original list and is unchanged.

**Caveats**
- Aperture's receipts don't say whether WordPress moved the posts to Trash or deleted them permanently. I didn't open the Trash view to check. If you need to know, look at Posts → Trash in wp-admin.
- Both deletes can be undone until 2026-10-19 13:34 UTC. Undo recreates a post from a saved copy. The post would have the same content, but WordPress may assign it a different ID or link.