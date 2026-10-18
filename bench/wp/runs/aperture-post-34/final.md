Both posts are moved to the trash: "Test post 4" and "Test post 5" are gone from the company website's post list. No other post was changed.

**What changed**
- **"Test post 4"** (key 7, published 2026/10/18 at 10:58 am, category Uncategorized) was moved to the trash. Receipt `rcpt_1`.
- **"Test post 5"** (key 8, published 2026/10/18 at 10:58 am, category Uncategorized) was moved to the trash. Receipt `rcpt_2`.
- The post list went from 12 to 10 entries.

**How I know**
- I signed in with the stored `WP` login and read the Posts admin page at `localhost:8082/wp-admin/edit.php`.
- Before committing, I previewed each deletion. Each preview listed only that one row.
- Each commit returned `verified.subject_present: false` and `matches_prediction: true`, which means a read-back of the site confirmed the post was gone and the count matched.
- A follow-up search for "Test post" returned 9 entries: Test posts 1, 2, and 6 through 12. Test posts 4 and 5 are absent, and the others are untouched.

**Undo**
- Either change can be reversed with `undo` on its receipt until 2026-10-19 13:36 UTC (about 24 hours from now). Aperture's note says the posts would be recreated from a saved copy, so the IDs or links may differ.
- I did not verify the undo path myself. The app's own Trash recovery is untested by Aperture.

I took your word that the two posts are out of date. I did not check their content.