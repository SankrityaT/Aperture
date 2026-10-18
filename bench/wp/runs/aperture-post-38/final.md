Both posts are moved to the trash, and no other post was touched.

**What changed**
- "Test post 4" (key 7) moved to the trash. Receipt `rcpt_1`.
- "Test post 5" (key 8) moved to the trash. Receipt `rcpt_2`.

**How I know**
- Each delete was previewed first. Each preview showed exactly one row removed: `- table_ordered_by_date_descending 7` and `... 8`.
- Each receipt's read-back reported `subject_present: false` and `matches_prediction: true`.
- A fresh listing of "Test post" items now shows 9 entries: Test posts 1, 2, 6, 7, 8, 9, 10, 11 and 12. Posts 4 and 5 are gone, and the rest are unchanged.
- The "Hello world!" and "admin" entries were not in my filter, so I didn't re-check them. I didn't act on them either.

**Undo:** Both receipts can be reversed with `undo` until 2026-10-19 at 13:37 UTC (`rcpt_1`) and 13:38 UTC (`rcpt_2`). The system's own recovery note says Aperture hasn't tested its trash restore. Check the trash before relying on undo.