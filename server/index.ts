import { timingSafeEqual } from "node:crypto";
import { FileLedger } from "./src/ledger.js";
import { exclusive } from "./src/generator/browser-lock.js";
import { llmsTxt, quickstartMd, errorsMd, robotsTxt, NAME_LINE, skillMd } from "./src/agent-docs.js";
import { MCPServer } from "mcp-use";
import { z } from "zod";
import { Wicket } from "./src/engine.js";
import { RuleBook } from "./src/rules.js";
import { FakeSchool, startingRules } from "./src/adapters/fake-school.js";
import { CompositeAdapter } from "./src/adapters/composite.js";
import { FormAdapter, HumanRequired, NoBrowser, NoSecret, NotAuthorized, type CompileSummary } from "./src/generator/form-adapter.js";
import { TableAdapter, type TableModel } from "./src/generator/tables.js";
import { RemoteWorker } from "./src/worker/remote.js";
import { split } from "./src/worker/split.js";
import type { Adapter } from "./src/types.js";
import { OWNER_PAGE } from "./src/owner-page.js";
import type { Op } from "./src/types.js";

// A failed browser action must never take the whole server down.
process.on("unhandledRejection", (e) => console.error("[aperture] unhandled rejection:", e instanceof Error ? e.message : e));

const server = new MCPServer({
  name: "aperture",
  title: "Aperture",
  version: "0.2.0",
  description: "A safe way for AI agents to work in web systems that have no API. Every change is previewed, checked, read back, and undoable.",
  instructions: [
    "Aperture is for changing records in a web admin portal or legacy business system that has no API: resident lists, user lists, customer or inventory screens, registrar pages.",
    "What it does that driving the page by hand does not: it turns the page into typed tools, shows what a change will affect before it happens (including records that go with it), reads the system back afterwards and compares it with the prediction, gives a receipt, and can undo.",
    "Reading is open: compile_site works on any public page without setup. Signing in and changing anything only happen on systems the operator listed, through the owner's authority.",
    "Start with find_systems (what you need, in plain words) or compile_site (a page address), then find to get exact keys, then delete or create with dry_run first. Compile every page whose records a change touches.",
    "Not for: systems that have a real API, sites you are not allowed to automate, or CAPTCHA and sign-in steps (a person does those).",
  ].join(" "),
});

// ---- the system under test and the engine ----
// Today this is a fake school system with invented data. The adapter is swappable: see contract.md.
const rules = new RuleBook();
const seedRules = () => { rules.clear(); for (const r of startingRules()) rules.set(r.kind, r.op, r.cascades, r.confirmed); };
seedRules();
// Where the browser lives. With WICKET_WORKER_URL set, it runs on another machine (an InstaBox desktop) and this
// server just calls it. Without it, the browser is in this process, which is how local development and the tests run.
interface FormsApi extends Adapter { compile(url: string): Promise<CompileSummary>; signIn(url: string, secret: string): Promise<{ signedIn: boolean; detail: string }>; open(url: string): Promise<void>; refresh(): Promise<CompileSummary>; summary(): CompileSummary | Promise<CompileSummary> }
interface TablesApi extends Adapter { attach(): Promise<TableModel[]>; summary(): TableModel[] | Promise<TableModel[]> }
let forms: FormsApi;
let tables: TablesApi;
let worker: RemoteWorker | null = null;
if (process.env.WICKET_WORKER_URL) {
  worker = new RemoteWorker(process.env.WICKET_WORKER_URL, process.env.WICKET_WORKER_TOKEN ?? "");
  forms = worker.forms; tables = worker.tables;
  // Optional second browser for public pages on an ordinary connection (see src/worker/split.ts). Without it, one worker does both.
  if (process.env.WICKET_PUBLIC_WORKER_URL) {
    const s = split(worker, new RemoteWorker(process.env.WICKET_PUBLIC_WORKER_URL, process.env.WICKET_PUBLIC_WORKER_TOKEN ?? ""));
    forms = s.forms; tables = s.tables;
  }
} else {
  const local = new FormAdapter();
  forms = local; tables = new TableAdapter(() => local.currentPage());
}
const wicket = new Wicket(new CompositeAdapter([...(process.env.WICKET_FAKE_SCHOOL === "1" ? [new FakeSchool()] : []), forms, tables]), { rules, ...(process.env.WICKET_LEDGER_PATH ? { ledger: new FileLedger(process.env.WICKET_LEDGER_PATH) } : {}) });

/** Small on purpose: an agent pays for every token of this. */
const tableView = (t: TableModel) => ({ id: t.id, rows: t.rows, columns: t.columns, key: t.keyColumn ?? (t.keyParam ? `link param ${t.keyParam}` : "none found"), ...(t.keySource === "none" ? { writes: "refused: no column or link on this list identifies a row uniquely, so a change could hit the wrong record. Reading and previews are unavailable for the same reason." } : {}), actions: t.actions.map((a) => `${a.label} (${a.type})`), add: t.add, ...(t.paged ? { paged: true } : {}), ...(t.recoveryHints?.length ? { recovery_options_seen: t.recoveryHints, recovery_note: "The application offers these. Aperture has not used or tested them; ask the owner whether a reversible option (archive, deactivate) is enough before deleting." } : {}) });

/** Tables from the page just compiled come first and in full. Lists compiled earlier from other pages stay live; they are named so the agent knows. */
const thisPageTables = (all: TableModel[], pageUrl: string) => {
  const mine = all.filter((x) => x.url === pageUrl);
  const here = mine.length ? mine : all;
  const others = all.filter((x) => !here.includes(x)).map((x) => x.id);
  return { tables: here.map(tableView), ...(others.length ? { also_compiled_and_still_live: others } : {}) };
};
/** Some systems record a change in one place and only make it live when a separate step is pressed ("Send Data", "Sync"). We never press it for the agent, so a receipt must not read as "live". */
// Send steps seen on ANY page compiled in this server's life, with the page they live on: Send often sits on a different page from the records.
// Kept per system (host and port), so a send step on one system never shows up on another system's receipts.
const seenSendSteps = new Map<string, { label: string; url: string }>();
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return u; } };
const rememberSendSteps = (s: { url: string; send_steps?: string[] }) => { const l = s.send_steps?.[0]; if (l && !seenSendSteps.has(hostOf(s.url))) seenSendSteps.set(hostOf(s.url), { label: l, url: s.url }); };
const sendStep = async (): Promise<string | null> => {
  let here = "";
  try { const s = await forms.summary(); rememberSendSteps(s); here = hostOf(s.url); } catch { return null; }
  const found = seenSendSteps.get(here);
  return found ? `${found.label}' on ${found.url}` : null;
};
const replyWrite = async (obj: Record<string, unknown>) => {
  const wrote = typeof obj.receipt === "string" || (typeof obj.committed === "number" && obj.committed > 0);
  if (!wrote) return reply(obj);
  const step = await sendStep();
  return reply(step ? { ...obj, not_yet_live: `Recorded in this system. It also has a separate step ('${step}) that Aperture has not pressed, so the change may not be live elsewhere (for example at a gate or another system) until it is sent. Sending goes through publish and needs the owner.` } : obj);
};
const reply = (obj: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(obj) }],
  structuredContent: obj,
  isError: obj.status === "refused",
});

const kindDoc = "Record kind, as compile_site or find_systems named it (for example residents or devices). Call compile_site first if you have none.";
const keyDoc = "The unique key from find, like S014. Never a name.";

// ---- tools ----

server.tool(
  { name: "get_instructions", description: "Start here. Returns a short guide to this system, the record kinds, and the rules. Read it once.", inputSchema: z.object({}), annotations: { readOnlyHint: true, openWorldHint: false } },
  async () => reply(wicket.instructions()),
);

server.tool(
  {
    name: "find",
    description: "Look up records. Returns small typed items with their unique keys. Names are not unique: always act on the key. Free, nothing changes.",
    inputSchema: z.object({ kind: z.string().describe(kindDoc), query: z.string().optional().describe("Text to match in any field, like a name. Leave empty to list."), limit: z.number().int().min(1).max(100).optional() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ kind, query, limit }) => reply((await wicket.find(kind, query, limit)) as Record<string, unknown>),
);

server.tool(
  {
    name: "delete",
    description: "Delete one record by key. With dry_run: true it only previews: what is removed, the count change, which rule applies. Nothing changes. To commit, call again with the plan_id. For most jobs use apply, which does both when the rules allow.",
    inputSchema: z.object({ kind: z.string().describe(kindDoc), key: z.string().describe(keyDoc), dry_run: z.boolean().optional(), plan_id: z.string().optional().describe("Commit a plan you already previewed.") }),
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ kind, key, dry_run, plan_id }) => {
    if (plan_id) return replyWrite(wicket.present(await wicket.commit(plan_id)));
    const plan = await wicket.preview({ op: "delete", kind, key });
    return reply(wicket.present(plan));
  },
);

server.tool(
  {
    name: "create",
    description: "Create one record. The record needs a unique key. With dry_run: true it only previews. To commit, call again with the plan_id.",
    inputSchema: z.object({ kind: z.string().describe(kindDoc), record: z.record(z.string(), z.unknown()).describe("Fields of the new record. Must include a unique key."), dry_run: z.boolean().optional(), plan_id: z.string().optional() }),
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ kind, record, plan_id }) => {
    if (plan_id) return replyWrite(wicket.present(await wicket.commit(plan_id)));
    const plan = await wicket.preview({ op: "create", kind, record: record as Op["record"] });
    return reply(wicket.present(plan));
  },
);

server.tool(
  {
    name: "publish",
    description: "Send staged changes to the outside world (for example to devices, a gate, or another system). It always needs the owner. Without plan_id it previews and asks the owner. It cannot be undone.",
    inputSchema: z.object({ plan_id: z.string().optional() }),
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  async ({ plan_id }) => {
    if (plan_id) return reply(wicket.present(await wicket.commit(plan_id)));
    const r = (await wicket.apply({ op: "publish" })) as Record<string, unknown>;
    // Some systems record changes on one page and send them from another ("Send Data" on an accounts page). Aperture does not press that
    // step; the owner does. Say so, with the count, instead of "nothing staged", which would contradict the receipts' not_yet_live.
    if (r.error === "nothing_to_publish") {
      const step = await sendStep();
      const recorded = [...wicket.receipts.values()].filter((x) => (x.status === "done" || x.status === "done_with_surprise") && x.op.op !== "publish").length;
      if (step && recorded > 0) return reply({ status: "refused", error: "send_needs_owner", detail: `${recorded} change(s) are recorded in this system but not sent. Sending is a separate step ('${step}) that reaches the outside world (for example the gate), and only the owner does it.`, changes_recorded_not_sent: recorded, next: ["tell the owner the changes are ready to send", "report the change as recorded, not as live"] });
    }
    return reply(r);
  },
);

const opSchema = z.object({ op: z.enum(["delete", "create", "update", "publish"]), kind: z.string().optional(), key: z.string().optional(), record: z.record(z.string(), z.unknown()).optional(), patch: z.record(z.string(), z.unknown()).optional().describe("For update: the fields to change, like { city: 'Leeds' }.") });

// ---- compiling a web system on demand (the generator) ----

const compileFail = (e: unknown) => {
  if (e instanceof NotAuthorized) return reply({ status: "refused", error: "not_authorized", detail: e.message, next: ["to read: use a public address (internal and private addresses are never browsed)", "to sign in or change something: only on systems the operator listed; ask the operator to list it", "never try to get around this"] });
  if (e instanceof NoSecret) return reply({ status: "refused", error: "no_stored_login", detail: e.message, next: ["ask the operator to store the login on the server", "never ask a person to paste a password into the chat"] });
  if (e instanceof HumanRequired) return reply({ status: "refused", error: "human_required", detail: e.message, next: ["a person must complete this step, then call compile_site again"] });
  if (e instanceof NoBrowser) return reply({ status: "refused", error: "no_browser", detail: e.message, next: ["run the worker on a machine with a browser (see BRIEF.md)"] });
  return reply({ status: "refused", error: "compile_failed", detail: String((e as Error).message).split("\n")[0], next: ["check the address loads in a normal browser", "try compile_site again"] });
};

server.tool(
  {
    name: "compile_site",
    description: "Point Aperture at a web page and it reads the page's forms, read-only, and turns each one into a typed record you can fill. Only works on hosts the operator has authorized. It never submits anything and never tries to get past a CAPTCHA: a person does that. Returns each form's id, fields (label, type, required, allowed values) and submit button.",
    inputSchema: z.object({
      url: z.string().optional().describe("The page address. With login set, this is the sign-in page. Leave it out to read the current page again (after a submit, or when a page changed)."),
      login: z.string().optional().describe("Name of a login the operator stored on the server. You never see the password."),
      then: z.string().optional().describe("With login: the page to compile after signing in."),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  // Compiling is several steps on one page (sign in, read the forms, read the tables). Two compiles in parallel must not interleave.
  ({ url, login, then }) => exclusive(async () => {
    try {
      if (login) {
        if (!url) return reply({ status: "refused", error: "missing_url", detail: "With login, give the sign-in page as url.", next: ["call compile_site with url (the sign-in page), login and then (the page you want)"] });
        const r = await forms.signIn(url, login);
        if (!r.signedIn) return reply({ status: "refused", error: "login_failed", detail: r.detail, next: ["ask the operator to check the stored login"] });
        if (then) await forms.open(then);
      }
      const s = login || !url ? await forms.refresh() : await forms.compile(url);
      for (const f of s.forms) rules.set(f.id, "update", [], true); // filling fields is a reversible draft
      rememberSendSteps(s);
      const t = await tables.attach();
      wicket.flush();
      return reply({ status: "compiled", ...s, ...(t.length ? thisPageTables(t, s.url) : {}), next: ["item cards (search results, product grids): find(kind) with the items kind; read-only", "records in a table: find(kind), then apply({op:'delete'|'create', kind, key})", "fill a form with apply({op:'update', kind:<form id>, key:'current', patch:{...}})", "submit with publish (always needs the owner)", "a delete or create this system has never done asks the owner the first time"] });
    } catch (e) { return compileFail(e); }
  }),
);




server.tool(
  {
    name: "apply",
    description: "The normal way to make a change. Previews inside the server. If the rules allow it, it commits at once and returns a receipt with a read-back. If a person must decide, it returns awaiting_approval with a plan_id to poll with get_plan.",
    inputSchema: opSchema,
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async (args) => replyWrite((await wicket.apply(args as Op)) as Record<string, unknown>),
);

server.tool(
  {
    name: "apply_batch",
    description: "Apply many changes in one call. Everything inside the rules commits. Items that need the owner are listed with plan_ids. Refusals are listed with next moves. Stops at the first failed commit. Returns one summary, so you do not need many round trips.",
    inputSchema: z.object({ ops: z.array(opSchema).min(1).max(50).optional(), plan_ids: z.array(z.string()).min(1).max(50).optional().describe("Instead of ops: commit plans the owner already approved, in order, with the first `canary` checked first."), stop_on_failure: z.boolean().optional(), dry_run: z.boolean().optional().describe("Change nothing. Returns the total blast radius: everything that would be removed, dependents included."), canary: z.number().int().min(1).max(10).optional().describe("Commit only the first N, check they did exactly what was predicted, and halt the rest if any surprised or failed.") }),
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ ops, plan_ids, stop_on_failure, dry_run, canary }) => {
    if (plan_ids?.length) return replyWrite(await wicket.commitBatch(plan_ids, canary ?? 1));
    if (!ops?.length) return reply({ status: "refused", error: "nothing_to_do", detail: "Give ops (changes to make) or plan_ids (approved plans to commit).", next: ["apply_batch with ops: [{op, kind, key}]"] });
    return replyWrite(await wicket.applyBatch(ops as Op[], stop_on_failure ?? true, { dryRun: dry_run, canary }));
  },
);


// ---- shared profiles: what one agent learned about a system, for the next agent ----
// Structure and learned rules only. Never records, never credentials. Held in memory: a restart empties it.

interface Profile { site: string; shared_at: string; tables: ReturnType<typeof tableView>[]; rules: { kind: string; op: string; cascades: { kind: string; by: string }[]; vouched: boolean }[] }
const registry = new Map<string, Profile>();
const siteKey = (s: string) => { try { return new URL(s.includes("://") ? s : `http://${s}`).host.toLowerCase(); } catch { return s.toLowerCase(); } };

// ---- discovery: which systems can I work in? The operator lists them; the agent describes what it needs ----
// WICKET_SYSTEMS is a JSON list on the server: [{"name","url","about"}]. An agent can only be pointed at systems on it
// (the worker's host allowlist still decides what it may actually open).

interface SystemEntry { name: string; url: string; about: string; login?: string; sign_in_url?: string }
const systems: SystemEntry[] = (() => { try { const v = JSON.parse(process.env.WICKET_SYSTEMS ?? "[]"); return Array.isArray(v) ? v.filter((x) => x?.name && x?.url) : []; } catch { return []; } })();
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2).map((w) => w.replace(/(ies|es|s)$/, "")));

server.tool(
  {
    name: "find_systems",
    description: "Start here when you are not given an address. Describe what you need to do in plain words (for example 'remove a resident from the access list' or 'update a customer record'). Returns the systems you are allowed to work in that match, with the address to compile and any profile other agents shared. It never searches the open web.",
    inputSchema: z.object({ need: z.string().describe("What you need to do or find, in plain words.") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ need }) => {
    const want = words(need);
    const scored = systems.map((sy) => {
      const host = siteKey(sy.url);
      const prof = registry.get(host);
      const text = `${sy.name} ${sy.about} ${prof ? prof.tables.map((t) => `${t.id} ${t.columns.join(" ")}`).join(" ") : ""}`;
      const have = words(text);
      const hits = [...want].filter((w) => have.has(w));
      return { sy, host, prof, hits, score: hits.length };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
    if (!systems.length) return reply({ status: "refused", error: "no_systems_registered", detail: "The operator has not listed any systems for agents to work in.", next: ["to read a public site: call compile_site with its address", "to change records: ask the operator to register the system"] });
    if (!scored.length) return reply({ status: "none_found", detail: "Nothing the operator registered matches that description.", registered: systems.map((x) => x.name), next: ["describe it with different words", "to read a public site: call compile_site with its address", "to change records somewhere else: ask the operator to register it"] });
    return reply({ status: "found", matches: scored.map((x) => ({ name: x.sy.name, address: x.sy.url, about: x.sy.about, ...(x.sy.login ? { sign_in: `needs the operator's stored login '${x.sy.login}': compile_site with login '${x.sy.login}', url '${x.sy.sign_in_url ?? x.sy.url}', then '${x.sy.url}'. You never see or type the password.` } : {}), matched_on: x.hits, shared_profile: x.prof ? { dependents_known: x.prof.rules.filter((r) => r.cascades.length).length, shared_at: x.prof.shared_at } : null })), next: ["compile_site with the address of the best match", "if it has a shared profile, call use_profile with its host before changing anything"] });
  },
);



const esc = (x: string) => x.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
server.get("/registry/:site", (c) => {
  const p = registry.get(siteKey(c.req.param("site")));
  if (!p) return c.html("<h1>No profile</h1><p>Nobody has shared this one yet.</p>", 404);
  const base = new URL(c.req.url).origin;
  const snippet = `Use the Aperture MCP server at ${base}/mcp to work in ${p.site}. Call compile_site on the page you need, then use_profile with site "${p.site}" before you change anything.`;
  const rules = p.rules.map((r) => `<li><b>${esc(r.kind)} ${esc(r.op)}</b> also affects: ${r.cascades.length ? r.cascades.map((x) => `${esc(x.kind)} (by ${esc(x.by)})`).join(", ") : "nothing seen"} ${r.vouched ? "<i>(a real run matched this)</i>" : "<i>(seen once, not yet confirmed)</i>"}</li>`).join("");
  return c.html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.site)} - Aperture profile</title><body style="font:16px/1.5 system-ui;max-width:42rem;margin:2rem auto;padding:0 1rem"><h1>${esc(p.site)}</h1><p>What agents have learned about this system. Structure and rules only: no records, no logins.</p><h2>Copy this to your agent</h2><pre style="white-space:pre-wrap;background:#f4f4f5;padding:1rem;border-radius:8px">${esc(snippet)}</pre><h2>Tables</h2><ul>${p.tables.map((t) => `<li><b>${esc(t.id)}</b>: key ${esc(String(t.key))}; ${t.columns.length} columns; actions: ${esc(t.actions.join(", ") || "none")}</li>`).join("")}</ul><h2>What deleting affects</h2><ul>${rules || "<li>Nothing learned yet.</li>"}</ul><p style="color:#666">Shared ${esc(p.shared_at)}. Held in memory; a server restart empties it.</p></body>`);
});

server.get("/registry", (c) => c.json({ note: "Shared profiles: structure and learned rules only. In memory; a restart empties it.", profiles: [...registry.values()] }));




server.tool(
  {
    name: "get_plan",
    description: "Check a plan: awaiting_approval, approved, expired, committed. Use it to wait for the owner's decision instead of retrying. If the outcome of a change is unknown (the server stopped while it ran), this reads the system and says what really happened; it never runs the change again.",
    inputSchema: z.object({ plan_id: z.string(), wait_seconds: z.number().int().min(0).max(25).optional().describe("Wait up to this long for the owner to decide, so you do not burn turns polling.") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ plan_id, wait_seconds }) => {
    let plan = wicket.getPlan(plan_id) as Record<string, unknown>;
    // A plan whose outcome is unknown (the server stopped mid-change) is resolved here by reading the system. It is never re-run.
    if (plan.status === "unknown") return reply((await wicket.reconcile(plan_id)) as Record<string, unknown>);
    const until = Date.now() + (wait_seconds ?? 0) * 1000;
    while (plan.status === "awaiting_approval" && Date.now() < until) { await new Promise((r) => setTimeout(r, 1000)); plan = wicket.getPlan(plan_id) as Record<string, unknown>; }
    return reply(plan);
  },
);

server.tool(
  {
    name: "undo",
    description: "Reverse a committed change using the copy saved before it. Reads the system back to verify. Works within the undo window. Published changes cannot be recalled.",
    inputSchema: z.object({ receipt_id: z.string().describe("The receipt id from the commit result.") }),
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ receipt_id }) => reply((await wicket.undo(receipt_id)) as Record<string, unknown>),
);

server.tool(
  {
    name: "escalate",
    description: "Ask the owner for help when a rule blocks you, like the daily limit. One message goes out. Keep working on other items. Do not retry the blocked one.",
    inputSchema: z.object({ reason: z.string().describe("One sentence on what you need and why.") }),
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ reason }) => reply(wicket.escalate(reason)),
);


server.prompt(
  { name: "safe-batch-job", description: "How to run a multi-step job safely and finish it without a human watching.", schema: z.object({ task: z.string().describe("What needs doing, in one or two sentences.") }) },
  async ({ task }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Do this job with the Aperture tools: ${task}\n\n1. Call get_instructions once.\n2. Use find to get exact keys. Names are not unique.\n3. Use apply_batch for many changes, or apply for one.\n4. If something is awaiting_approval, keep working on the rest and poll get_plan.\n5. Report only what the receipts verified. If verified.ok is false, say so.\n6. If you made a mistake, call undo with the receipt id.` } }],
  }),
);

// ---- owner side: a plain web page, never an agent tool ----

const OWNER_TOKEN = process.env.OWNER_TOKEN;
// Closed unless a token is set. Approval must never be reachable by an agent, so there is no open default (WICKET_OPEN_OWNER=1 is for local development only).
const sameToken = (given: string | undefined) => { if (!OWNER_TOKEN || !given) return false; const a = Buffer.from(given), b = Buffer.from(OWNER_TOKEN); return a.length === b.length && timingSafeEqual(a, b); };
const allowed = (c: { req: { query: (k: string) => string | undefined } }) => (OWNER_TOKEN ? sameToken(c.req.query("token")) : process.env.WICKET_OPEN_OWNER === "1");

// Demo control: owner only, never a tool. An agent being tested cannot wipe the systems it is working in.
server.post("/owner/demo", async (c) => {
  if (!allowed(c)) return c.json({ error: "not allowed" }, 403);
  const b = (await c.req.json().catch(() => ({}))) as { action?: string; noop?: string[]; after?: string[] };
  if (b.action === "reset") { await wicket.resetDemo(); seedRules(); await worker?.resetDemo().catch(() => undefined); return c.json({ status: "reset" }); }
  if (b.action === "hang" && worker) { await worker.call("demo", "hang", [b.noop ?? [], b.after ?? []]); return c.json({ status: "hang set", noop: b.noop ?? [], after: b.after ?? [] }); }
  return c.json({ error: "action must be reset or hang" }, 400);
});

// What a coding agent finds first.
const originOf = (c: { req: { url: string; header: (k: string) => string | undefined } }) => { const h = c.req.header("x-forwarded-host") ?? c.req.header("host"); const proto = c.req.header("x-forwarded-proto") ?? "https"; return h ? `${proto}://${h}` : new URL(c.req.url).origin; };
server.get("/llms.txt", (c) => c.text(llmsTxt(originOf(c))));
server.get("/quickstart.md", (c) => c.text(quickstartMd(originOf(c))));
server.get("/errors.md", (c) => c.text(errorsMd(originOf(c))));
server.get("/skill.md", (c) => c.text(skillMd));
server.get("/robots.txt", (c) => c.text(robotsTxt(originOf(c))));
server.get("/", (c) => c.text(`Aperture\n\n${NAME_LINE}\n\nAn MCP server for working safely in web systems that have no API.\nMCP endpoint: ${originOf(c)}/mcp\nStart: ${originOf(c)}/llms.txt\n`));

// Access to the MCP endpoint. With APERTURE_ACCESS_KEYS set, every call needs one of the keys: an Authorization: Bearer header,
// an x-aperture-key header, or ?key= on the URL (for clients that cannot send headers). The docs pages stay public.
// Without the setting the endpoint is open (local development only).
const ACCESS_KEYS = (process.env.APERTURE_ACCESS_KEYS ?? "").split(",").map((k) => k.trim()).filter((k) => k.length >= 16);
const keyOk = (given: string | undefined) => !!given && ACCESS_KEYS.some((k) => { const a = Buffer.from(given), b = Buffer.from(k); return a.length === b.length && timingSafeEqual(a, b); });
server.use("/mcp", async (c, next) => {
  if (!ACCESS_KEYS.length) return next();
  const given = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "") || c.req.header("x-aperture-key") || c.req.query("key");
  if (keyOk(given)) return next();
  return c.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Aperture needs an access key. Send Authorization: Bearer <key>, or add ?key=<key> to the server URL. Ask the operator for a key." } }, 401);
});

server.get("/owner", (c) => c.html(OWNER_PAGE));
server.get("/owner/state", (c) => (allowed(c) ? c.json(wicket.ownerState()) : c.json({ error: "not allowed" }, 403)));
server.post("/owner/approve", async (c) => {
  if (!allowed(c)) return c.json({ error: "not allowed" }, 403);
  const b = (await c.req.json()) as { plan_id: string };
  return c.json(wicket.approve(b.plan_id));
});
server.post("/owner/delegate", async (c) => {
  if (!allowed(c)) return c.json({ error: "not allowed" }, 403);
  const b = (await c.req.json()) as { kinds?: string[]; ops?: string[]; limit?: number; hours?: number; note?: string };
  const ops = (b.ops ?? []).filter((o): o is "create" | "update" | "delete" => o === "create" || o === "update" || o === "delete");
  if (!ops.length || !b.limit || b.limit < 1) return c.json({ error: "give ops (create, update, delete) and a limit of at least 1" }, 400);
  return c.json(wicket.delegate({ kinds: b.kinds?.length ? b.kinds : ["*"], ops, limit: b.limit, ttlMs: Math.min(Math.max(b.hours ?? 4, 0.05), 72) * 3_600_000, note: b.note }));
});
server.post("/owner/dependency", async (c) => {
  if (!allowed(c)) return c.json({ error: "not allowed" }, 403);
  const b = (await c.req.json()) as { kind?: string; cascade_kind?: string; by?: string };
  if (!b.kind || !b.cascade_kind || !b.by) return c.json({ error: "give kind, cascade_kind and by" }, 400);
  wicket.declareDependency(b.kind, { kind: b.cascade_kind, by: b.by });
  return c.json({ status: "declared", kind: b.kind, also_removes: b.cascade_kind, matched_on: b.by });
});
server.post("/owner/delegation/revoke", async (c) => { if (!allowed(c)) return c.json({ error: "not allowed" }, 403); return c.json(wicket.revokeDelegation(((await c.req.json()) as { id: string }).id)); });
server.post("/owner/delegation/resume", async (c) => { if (!allowed(c)) return c.json({ error: "not allowed" }, 403); return c.json(wicket.resumeDelegation(((await c.req.json()) as { id: string }).id)); });
server.post("/owner/reject", async (c) => {
  if (!allowed(c)) return c.json({ error: "not allowed" }, 403);
  const b = (await c.req.json()) as { plan_id: string };
  return c.json(wicket.reject(b.plan_id));
});
server.post("/owner/cap", async (c) => {
  if (!allowed(c)) return c.json({ error: "not allowed" }, 403);
  const b = (await c.req.json()) as { max: number };
  return c.json(wicket.raiseCap(Math.max(1, Math.min(500, Number(b.max) || 5))));
});

export default server;
