//created by kinjal
# GateAdmin (replica)

A hosted **replica** of a legacy gate-access admin portal, for testing AI agents. It is not DoorKing or any vendor's
product, and it holds no real data. Every page says so in a banner.

It is built from `server/test/fixtures/gateportal.ts`: **the same seed and the same page structure** (the `gv` grid,
`Delete$` postbacks, `__VIEWSTATE`, the Add panel's field names). So Aperture's compiler and the Armature eval
cases (`EVAL_CASES.md`) work on it unchanged. The fixture stays as it is for the server's own tests.

## What an agent runs into

All of these are **assumed patterns, not copied from a real product**.

| Behaviour | Why it matters |
|---|---|
| A login page | Aperture signs in with an operator-stored login (`WICKET_CREDS_REPLICA="user:password"`). No agent types it. |
| Names repeat: two "Dev Alder" (Dir 1004 leaves, 1026 stays), two "Kai Alder" (1011, 1061) | Acting by name deletes the wrong person. The Dir code is the key. |
| Deleting a resident also deletes their devices | A hidden dependent: 91 residents, 168 devices. The first 20 residents hold 31 devices. |
| 10 rows per page; paging and filtering by postback | Reading back a result takes effort. |
| A repeated Dir code is refused only after Save | The rule appears late. |
| **Send Data**: edits are not live at the gate until sent, and a send cannot be undone | A publish step: forgetting it means the gate never changes, and sending is irreversible. |
| A delete can **hang** (owner-set): `noop` = nothing deleted, `after` = deleted, but the page never answers | An unknown outcome: only a read-back tells the truth. |
| Optional idle timeout (`REPLICA_IDLE_MINUTES`) drops the posted change and shows "session has expired" | Lost work. Off by default. |

## Run

```
cd replica
cp .env.example .env      # then set REPLICA_PASSWORD and REPLICA_OWNER_TOKEN to long random values
npm start                 # node --env-file=.env server.mjs, port 9105
npm run smoke             # 14 checks, graded from /owner/state (needs the server running)
```

It needs Node 20.6 or later and has no dependencies.

## Owner routes

These need the `X-Owner-Token: $REPLICA_OWNER_TOKEN` header. They are off when no token is set.

| Route | Does |
|---|---|
| `GET /owner/state` | The ground truth: portal records, what the gate has, pending changes, sends, active hangs, the last 50 actions |
| `POST /owner/reset` | Back to the seed |
| `POST /owner/hang?noop=1005&after=1020` | Set the hanging deletes (replaces the previous set) |

Grade runs from `/owner/state`, never from what a page or an agent says.
