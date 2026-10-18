//created by kinjal
import snapshot from "@/lib/mcp-tools.json";
import { site } from "@/lib/site";
import { origin } from "@/lib/url";

// The docs: one data model, rendered as the /docs page and as /docs.md, so the two cannot drift apart.
// Tool names, parameters, types and annotations come from a snapshot of the live server (lib/mcp-tools.json).
// What is written here by hand: the grouping, the one-line purpose, and the examples (taken from real eval runs).

type Schema = { type?: string; enum?: string[]; description?: string; items?: Schema; minItems?: number; maxItems?: number; minimum?: number; maximum?: number };
type Tool = (typeof snapshot.tools)[number];

export type Effect = "reads" | "changes" | "outside";
export const EFFECT_LABEL: Record<Effect, string> = { reads: "Reads only", changes: "Changes records", outside: "Reaches outside" };

export type Param = { name: string; type: string; required: boolean; description: string };
export type ToolDoc = {
  name: string;
  effect: Effect;
  purpose: string;
  description: string;
  params: Param[];
  example?: { call: string; result: string };
};

// Hand-written notes for parameters the server does not describe.
const PARAM_NOTES: Record<string, Record<string, string>> = {
  find: { limit: "Most items to return." },
  delete: { dry_run: "Preview only: what would be removed, the count change, and which rule applies. Nothing changes." },
  create: { dry_run: "Preview only. Nothing changes.", plan_id: "Commit a plan you already previewed." },
  publish: { plan_id: "Commit a send the owner has approved. Without it, publish previews and asks the owner." },
  apply: {
    op: "One of delete, create, update, publish.",
    kind: "Record kind, as compile_site or find_systems named it.",
    key: "The unique key from find. Never a name.",
    record: "For create: the fields of the new record, including its key.",
  },
  apply_batch: { ops: "Up to 50 operations, each shaped like an apply call.", stop_on_failure: "Stop at the first failed commit (the default)." },
  get_plan: { plan_id: "The plan id from a preview, apply or apply_batch." },
};

const PLAN: { name: string; effect: Effect; purpose: string; example?: ToolDoc["example"] }[] = [
  {
    name: "find_systems", effect: "reads", purpose: "Find the systems you may work in, from a plain-words need.",
    example: {
      call: `find_systems({ need: "remove a resident from the gate access system" })`,
      result: `{ "status": "found", "matches": [ { "name": "GateAdmin replica, residents (sign-in required)",
    "address": ".../Residents.aspx",
    "sign_in": "compile_site with login 'REPLICA', url '.../Login.aspx', then '.../Residents.aspx'" } ] }`,
    },
  },
  { name: "get_instructions", effect: "reads", purpose: "A short guide to the connected system: record kinds and rules. Read it once." },
  {
    name: "compile_site", effect: "reads", purpose: "Read a page and turn its lists and forms into typed record kinds. Signs in with a stored login when needed.",
    example: {
      call: `compile_site({ url: ".../Login.aspx", login: "REPLICA", then: ".../Residents.aspx" })`,
      result: `{ "status": "compiled", "tables": [ { "id": "residents", "key": "Dir", "rows": 91 },
    { "id": "vendors", "key": "Dir", "rows": 3 } ] }`,
    },
  },
  {
    name: "find", effect: "reads", purpose: "Look up records and get their unique keys. Names are not unique; act on the key.",
    example: {
      call: `find({ kind: "residents", query: "Dev Alder" })`,
      result: `{ "kind": "residents", "count": 2, "note": "Several matches. Names are not unique, use the key.",
  "items": [ { "key": "1004", "Resident": "Dev Alder", "Notes": "Unit 103D" },
             { "key": "1026", "Resident": "Dev Alder", "Notes": "Unit 125B" } ] }`,
    },
  },
  {
    name: "apply", effect: "changes", purpose: "The normal way to change one record: preview, rules, commit, read-back and receipt in one call.",
    example: {
      call: `apply({ op: "delete", kind: "residents", key: "1004" })`,
      result: `{ "status": "done", "receipt": "rcpt_7",
  "verified": { "ok": true, "subject_present": false, "matches_prediction": true,
                "counts_after": { "residents": 90, "devices": 166 } },
  "not_yet_live": "Recorded in this system. It also has a separate step ('Snd Data') that Aperture has not pressed...",
  "undo_until": "2026-10-19T10:10:57Z" }`,
    },
  },
  {
    name: "apply_batch", effect: "changes", purpose: "Many changes in one call, inside the rules. Dry-run shows the whole blast radius; canary checks the first few.",
    example: {
      call: `apply_batch({ ops: [ { op: "delete", kind: "residents", key: "1001" }, ... ], dry_run: true })`,
      result: `{ "would_remove": { "residents": 91, "devices": 168 },
  "refused": [ { "key": "1006", "error": "policy_denied", "detail": "Daily delete limit reached: 5 of 5.",
                 "next": ["escalate(reason) to ask the owner for more"] } ] }`,
    },
  },
  {
    name: "delete", effect: "changes", purpose: "Delete one record by key, in two steps: dry_run to preview, then plan_id to commit.",
    example: {
      call: `delete({ kind: "residents", key: "1004", dry_run: true })`,
      result: `{ "status": "previewed", "plan_id": "pln_23",
  "diff": ["- residents 1004", "- 2 devices",
           "(the devices above go with this residents automatically: do not delete them separately)"] }`,
    },
  },
  { name: "create", effect: "changes", purpose: "Create one record with a unique key, in two steps: dry_run, then plan_id." },
  {
    name: "undo", effect: "changes", purpose: "Reverse a committed change from the copy saved before it, and say what could not be put back.",
    example: {
      call: `undo({ receipt_id: "rcpt_9" })`,
      result: `{ "status": "undone", "restored": true, "fields_not_restored": ["Phone"],
  "verified": { "ok": true, "counts_after": { "residents": 91, "devices": 168 } } }`,
    },
  },
  {
    name: "get_plan", effect: "reads", purpose: "Wait for the owner's decision, or find out what really happened when an outcome is unknown.",
    example: {
      call: `get_plan({ plan_id: "pln_23", wait_seconds: 10 })`,
      result: `{ "plan_id": "pln_23", "status": "committed", "diff": ["- residents 1020", "- 1 devices"] }`,
    },
  },
  {
    name: "escalate", effect: "reads", purpose: "Ask the owner for help when a rule blocks you. One message goes out; keep working on other items.",
    example: {
      call: `escalate({ reason: "Daily delete limit reached after 5 of 91; need owner approval to continue." })`,
      result: `{ "status": "pending_human", "ticket": "esc_2", "agent_can_continue_with": ["find", "create", "other deletes inside the limit"] }`,
    },
  },
  {
    name: "publish", effect: "outside", purpose: "Send recorded changes to the outside world (for example, a gate controller). Always needs the owner. Cannot be undone.",
    example: {
      call: `publish({})`,
      result: `{ "status": "refused", "error": "send_needs_owner",
  "detail": "3 changes are recorded but not sent. The send step is 'Snd Data' on Accounts.aspx; only the owner sends." }`,
    },
  },
];

function typeOf(s: Schema): string {
  if (s.enum) return s.enum.map((e) => `"${e}"`).join(" | ");
  if (s.type === "array" && s.items) return `${typeOf(s.items)}[]`;
  return s.type ?? "any";
}

function toDoc(plan: (typeof PLAN)[number], t: Tool): ToolDoc {
  const schema = t.inputSchema as unknown as { properties?: Record<string, Schema>; required?: string[] };
  const params = Object.entries(schema.properties ?? {}).map(([name, s]) => ({
    name,
    type: name === "ops" ? "object[]" : typeOf(s),
    required: (schema.required ?? []).includes(name),
    description: s.description || PARAM_NOTES[t.name]?.[name] || "",
  }));
  return { name: t.name, effect: plan.effect, purpose: plan.purpose, description: t.description, params, example: plan.example };
}

export const tools: ToolDoc[] = PLAN.map((p) => {
  const t = snapshot.tools.find((x) => x.name === p.name);
  if (!t) throw new Error(`docs: ${p.name} is not in lib/mcp-tools.json; regenerate the snapshot`);
  return toDoc(p, t);
});
// Any tool on the server that the docs forgot still shows up, with its own description.
for (const t of snapshot.tools) if (!PLAN.some((p) => p.name === t.name)) tools.push(toDoc({ name: t.name, effect: "reads", purpose: t.description.split(". ")[0] + "." }, t));

export const docs = {
  server: snapshot.server,
  intro: snapshot.instructions,
  connect: {
    claudeCode: `claude mcp add --transport http "${site.slug}" '${site.mcpUrl}'`,
    json: JSON.stringify({ mcpServers: { [site.slug]: { type: "http", url: site.mcpUrl } } }, null, 2),
  },
  lifecycle: [
    { name: "Identify", text: "find returns unique keys. Names repeat, so every change takes a key, never a name." },
    { name: "Preview", text: "A dry run shows what will change, including records that go with it (a resident's devices)." },
    { name: "Rules", text: "Owner limits apply. Inside them it commits; outside them it waits for the owner (awaiting_approval) or refuses with next moves." },
    { name: "Commit", text: "The change runs once. A page that hangs is replaced after 17 s; the outcome is then read, never retried blindly." },
    { name: "Read back", text: "The system is read again and compared with the prediction. The receipt says verified, and what was checked." },
    { name: "Undo", text: "A committed change can be reversed from the saved copy. Fields that could not be put back are listed." },
  ],
  rules: [
    "Act on keys from find, never on names.",
    "Compile every page whose records a change touches (for example residents and devices), or the preview refuses with dependency_not_compiled.",
    "Prefer apply and apply_batch: they preview, check the rules and commit in one call.",
    "On awaiting_approval, wait with get_plan(wait_seconds). Do not retry a commit in a loop.",
    "On policy_denied, call escalate once and continue with other items.",
    "A receipt with not_yet_live means the change is recorded but not sent anywhere. Only the owner publishes.",
    "Aperture never types a password and never passes a CAPTCHA. A person does those.",
  ],
  errors: [
    ["not_authorized", "A sign-in or change on a system the operator did not list, or an internal address.", "Read public pages freely; for changes ask the operator. Never look for a workaround."],
    ["human_required", "A CAPTCHA or similar needs a person.", "A person completes it, then call compile_site again."],
    ["no_stored_login", "The named login does not exist.", "Ask the operator to store it. Never type a password into chat."],
    ["not_found", "No record with that key.", "Use find and pass the key, not the name; see did_you_mean."],
    ["already_exists", "A create would duplicate a key.", "Use a different key or find the existing record."],
    ["dependency_not_compiled", "The change affects a page that has not been compiled.", "compile_site that page (find_systems lists it), then try again."],
    ["awaiting_approval", "The owner has not approved this change.", "get_plan with wait_seconds. Do not retry the commit."],
    ["delegation_ended", "The owner's delegation ended before the commit.", "Poll get_plan; it now waits for the owner."],
    ["changed_since_preview", "The record changed after the preview.", "Run a new preview."],
    ["capability_changed", "The page changed and Aperture could not prove a re-learned version.", "Nothing changed. Do not retry; tell the owner."],
    ["policy_denied", "A cap such as deletes per day was reached.", "escalate with a reason."],
    ["send_needs_owner", "Recorded changes wait for a send step only the owner can take.", "Tell the user the change is not live yet."],
    ["outcome_unknown", "The server stopped while the change ran.", "get_plan reads the system. Never commit it again."],
    ["worker_busy", "The browser was busy, or a page hung and was replaced.", "Retry a read after a few seconds; for a change, get_plan first."],
    ["undo_failed", "The app refused to take the record back.", "The saved values are in the response; re-enter by hand and tell the owner."],
  ] as [string, string, string][],
  receipts: "A receipt can also say done_with_surprise (the system changed more than predicted; the extra items are listed), failed (the app refused or errored; the real state is reported), or carry fields_not_restored after an undo. verified.scope says which tables were compared; tables Aperture has not compiled are not checked.",
  limits: [
    "One browser per worker, so calls to one system run one at a time.",
    "Product and search grids are read as read-only items; they cannot be changed.",
    "Effects in tables Aperture never compiled are not checked (stated in every receipt's scope).",
    "Sites with bot checks or CAPTCHAs need a person.",
  ],
};

const code = (s: string) => "```\n" + s + "\n```";

// The whole docs page as markdown, for /docs.md, the copy button, and agents that ask /docs for text/markdown.
export function docsMarkdown(): string {
  const n = site.name;
  const out: string[] = [
    `# ${n} docs`,
    "",
    `> ${docs.server.description}`,
    "",
    `- MCP endpoint: ${site.mcpUrl} (streamable HTTP)`,
    `- Server: ${docs.server.name} ${docs.server.version}, ${tools.length} tools`,
    `- This page: ${origin}/docs (markdown: ${origin}/docs.md)`,
    `- Error reference on the server: ${site.mcpUrl.replace(/\/mcp$/, "")}/errors.md`,
    "",
    "## What it is for",
    "",
    docs.intro,
    "",
    "## Connect",
    "",
    "Claude Code:",
    "",
    code(docs.connect.claudeCode),
    "",
    "Any MCP client (JSON config):",
    "",
    code(docs.connect.json),
    "",
    "## How a change works",
    "",
    ...docs.lifecycle.map((s, i) => `${i + 1}. **${s.name}.** ${s.text}`),
    "",
    "## Rules for agents",
    "",
    ...docs.rules.map((r) => `- ${r}`),
    "",
    "## Tools",
    "",
    "| Tool | Effect | Purpose |",
    "| --- | --- | --- |",
    ...tools.map((t) => `| \`${t.name}\` | ${EFFECT_LABEL[t.effect]} | ${t.purpose} |`),
    "",
  ];
  for (const t of tools) {
    out.push(`### ${t.name}`, "", `**${EFFECT_LABEL[t.effect]}.** ${t.description}`, "");
    if (t.params.length) {
      out.push("| Parameter | Type | Required | Description |", "| --- | --- | --- | --- |");
      for (const p of t.params) out.push(`| \`${p.name}\` | ${p.type.replace(/\|/g, "\\|")} | ${p.required ? "yes" : "no"} | ${p.description.replace(/\|/g, "\\|")} |`);
      out.push("");
    } else out.push("No parameters.", "");
    if (t.example) out.push("Example:", "", code(`${t.example.call}\n\n${t.example.result}`), "");
  }
  out.push(
    "## Errors",
    "",
    "Every refusal returns `error`, `detail` and a `next` list of valid next moves.",
    "",
    "| error | meaning | next move |",
    "| --- | --- | --- |",
    ...docs.errors.map(([e, m, x]) => `| \`${e}\` | ${m} | ${x} |`),
    "",
    docs.receipts,
    "",
    "## Limits",
    "",
    ...docs.limits.map((l) => `- ${l}`),
    "",
  );
  return out.join("\n");
}
