# contract.md: the interface between the product and the system under test

Both sides build to this. The product (Sanki) can develop against an in-memory fake today.
The system under test (Kinjal, Gibbon on InstaBox) gets an adapter that satisfies it later.

## Adapter interface (what the product calls)

```
read(key)        -> record | null          // read-only, never changes anything
list(filter?)    -> record[]               // read-only
create(record)   -> record                 // write
delete(key)      -> void                   // write
publish()        -> void                   // optional: pushes staged changes to the outside world
reset()          -> void                   // back to the seed state (demo and tests only)
```

Rules for every adapter:
- `key` is the system's unique identifier, never a name. Names are not unique.
- `read` after `delete(key)` must return null, otherwise the read-back marks the commit FAILED.
- An adapter never decides policy. It only reads and writes.
- Any call may hang or fail. The caller sets a timeout and treats a timeout as "unknown, verify by read".

## Operation kinds (what the product knows how to treat)

| kind | meaning | behavior |
|---|---|---|
| read | changes nothing | free, no ticket |
| write | changes records | preview, snapshot first, read-back, undo through the inverse operation |
| publish | pushes changes to the real world | always needs approval, has its own preview |

Every write names its inverse: `create` undoes `delete`, `delete` undoes `create`.

## Ticket lifecycle

```
proposed -> previewed -> [needs approval] -> approved -> committed -> (undone)
                     \-> refused (always carries the next valid move)
```

- `dry_run: true` returns a plan: `{plan_id, diff, rule_result, expires}`. Nothing is touched.
- A plan stores the record as read, a hash of it, and the expected state after.
- `commit(plan_id)`: check not expired, check approved if required, re-read and compare the hash
  (if it changed, refuse and re-preview), snapshot the record, run the write, read back and compare to
  expected. Return a receipt with `verified` set only from the read-back.
- `undo(receipt_id)`: recreate from the snapshot, read back, return a receipt.

## Tool surface (MCP)

```
get_instructions()                       // short guide written for agents
find(kind, query)                        // read
delete(key, dry_run?, plan_id?)          // write: preview, or commit a previewed plan
create(record, dry_run?, plan_id?)       // write
publish(dry_run?, plan_id?)              // publish
apply(op, args)                          // preview + commit in one call when the rules allow it
apply_batch(ops[])                       // preview all, commit the ones inside the mandate, summarize the rest
undo(receipt_id)
```

### apply and apply_batch (the autonomous path)
- `apply` runs the preview inside the server. If every rule passes and no approval is required, it commits
  immediately and returns the receipt. Otherwise it stops and returns the plan with `status: awaiting_approval`
  or a refusal with `next`.
- `publish` never auto-commits. It always needs approval.
- `apply_batch` previews every item first. It commits only items inside the mandate, stops at the first failed
  commit (never continues blind), and returns ONE summary: committed, refused, awaiting approval.
  The human only sees the exceptions.
- All safeguards still run on every commit: re-read and hash check, snapshot, read-back, receipt, undo.
- Mandate limits (for example max deletes per day) apply across the whole batch, not per item.

Responses are small typed JSON. Every refusal has `error`, `detail`, and `next` (the valid next moves).

## Seed requirements for the demo system (Kinjal)
- at least 30 fake students
- two students with the same name
- one class with enrolled students (to show the cascade on delete)
- one action that can be made to hang on purpose
- `reset.sh` restores this state in one command

## Measure, do not guess
Record for every demo run: tool calls, estimated tokens (characters / 4), human interruptions,
mistakes caught, whether the read-back matched. Run the same task with a plain browser agent for the baseline.
