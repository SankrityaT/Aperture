// The pages a coding agent finds first. Plain text, in the words someone with the problem would search for.

export const NAME_LINE = "Aperture here means this MCP server for operating legacy web systems safely. It is not the npm package `aperture` (macOS screen recording) and not Apple's discontinued Aperture photo software.";

export const llmsTxt = (origin: string) => `# Aperture

> An MCP server that lets an AI agent work safely in a web system that has no API: an old admin portal, an ERP screen, a registrar or property-management page. It reads the page, turns it into typed tools, and wraps every change in a preview, a read-back against the system's real state, a receipt and an undo.

${NAME_LINE}

Use it when: the system has no API or the API cannot do what the screen can; a mistaken delete or edit would be costly; you need proof of what changed; you need to undo.
Do not use it when: a real API exists for the task, or the site forbids automation.

## Start here
- [Quickstart](${origin}/quickstart.md): connect and finish a first change in six calls
- [Errors and next moves](${origin}/errors.md): every refusal and what to do next
- MCP endpoint: ${origin}/mcp (HTTP, no sign-in required)
- Shared profiles of systems other agents have learned: ${origin}/registry

## What it guarantees, and what it does not
- Every change is previewed first. A delete shows what else it removes once that is known.
- After a change it reads the system back and compares with what it predicted. A surprise is reported, not hidden.
- Undo restores from a copy saved before the change, and says what it could not restore (for example when the app issues a new ID).
- It refuses to guess: a name is not a key; a page with no unique key is refused for writes.
- It does not claim success from a message on the page. Unknown outcomes are reported as unknown and are never retried blindly.
- Not covered: effects in tables it has not read; systems behind a CAPTCHA (it stops and hands over to a person); anything outside the hosts the operator allowed.
- Changes the owner has not delegated wait for the owner. An agent cannot approve its own change.
`;

export const quickstartMd = (origin: string) => `# Aperture quickstart

${NAME_LINE}

## 1. Connect
Add this to your MCP client config (Claude Code: \`.mcp.json\`; Codex and Cursor take the same URL):

\`\`\`json
{ "mcpServers": { "aperture": { "type": "http", "url": "${origin}/mcp" } } }
\`\`\`

## 2. Do a first change (remove a record from a web list)
1. \`find_systems\` with what you need in plain words, for example \`{"need": "remove a student from the school list"}\`. It returns the systems you may work in and their addresses. It never searches the open web.
2. \`compile_site\` with that address. It reads the page once and returns typed tables, each with its key column.
3. \`find\` with the table's \`kind\` to get exact keys. Never use a name as a key.
4. \`delete\` with \`{"kind": "...", "key": "...", "dry_run": true}\`. You get a plan. If the owner has delegated this kind of change you will see no approval needed; otherwise it says awaiting_approval.
5. \`get_plan\` with \`wait_seconds: 25\` until it is approved, then \`delete\` again with the \`plan_id\`.
6. Read the result: \`verified\`, any \`surprise\`, and the \`receipt\`. To reverse it: \`undo\` with the receipt id.

## 3. Many changes at once
- \`apply_batch\` with \`dry_run: true\` shows the total blast radius and changes nothing.
- \`apply_batch\` or \`commit_batch\` with \`canary: 1\` runs the first item with a full check across every table it has read, and stops the rest if anything differs from the prediction.

## 4. If the server restarted mid-change
A commit may answer \`outcome_unknown\`. Call \`reconcile\` with the plan id. It reads the system and tells you whether the change happened. Never commit that plan again.

## Limits you should know
- Tickets and receipts are kept in a file on the server; a redeploy can clear it.
- The MCP endpoint itself has no sign-in. Writes are still gated by the owner's approval or delegation.
- Verification re-reads lists page by page, so a change on a long list takes seconds to tens of seconds.
`;

export const errorsMd = (origin: string) => `# Aperture errors and what to do next

Every refusal returns \`error\`, \`detail\` and a \`next\` list. These are the ones you will meet.

| error | meaning | next move |
|---|---|---|
| no_systems_registered | The operator listed no systems | Ask the operator; or use compile_site with an address they gave you |
| none_found | Nothing registered matches your words | Rephrase; see the \`registered\` names it returns |
| not_authorized | The host is not on the operator's allowlist | Do not look for a workaround; ask the operator |
| human_required | A CAPTCHA or similar needs a person | A person completes it; then call compile_site again |
| no_stored_login | The named login does not exist | Ask the operator to store it; never type a password into chat |
| not_found | No record with that key | Use \`find\` and pass the key, not the name; see \`did_you_mean\` |
| already_exists | A create would duplicate a key | Use a different key or find the existing record |
| awaiting_approval | The owner has not approved this change | \`get_plan\` with wait_seconds; do not retry commit in a loop |
| delegation_ended | The owner's delegation was revoked, paused or used up before commit | Poll \`get_plan\`; it now waits for the owner |
| changed_since_preview | The record changed after you previewed | Run a new preview |
| policy_denied | A cap such as deletes per day was reached | \`escalate\` with a reason |
| outcome_unknown | The server stopped while this change was running | \`reconcile\`; never commit it again |
| in_progress | This change is running now | Poll \`get_plan\` |
| undo_failed | The app refused to take the record back | The saved values are in the response; re-enter by hand and tell the owner |
| no_profile | Nobody has shared a profile for that site | Compile the site yourself, then \`share_profile\` |

A receipt can also say \`done_with_surprise\` (the system changed more than predicted; the extra items are reported), \`failed\` (the app refused or errored; the record's real state is reported), or carry \`fields_not_restored\` after an undo.

Endpoint: ${origin}/mcp
`;

export const robotsTxt = (origin: string) => `User-agent: *
Allow: /
Sitemap-ish: ${origin}/llms.txt
`;
