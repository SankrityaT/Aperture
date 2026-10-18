import { timingSafeEqual } from "node:crypto";
import { FileLedger } from "./src/ledger.js";
import { exclusive } from "./src/generator/browser-lock.js";
import { llmsTxt, quickstartMd, errorsMd, robotsTxt, NAME_LINE } from "./src/agent-docs.js";
import { MCPServer } from "mcp-use";
import { z } from "zod";
import { Wicket } from "./src/engine.js";
import { RuleBook } from "./src/rules.js";
import { FakeSchool, startingRules } from "./src/adapters/fake-school.js";
import { CompositeAdapter } from "./src/adapters/composite.js";
import { FormAdapter, HumanRequired, NoBrowser, NoSecret, NotAuthorized, type CompileSummary } from "./src/generator/form-adapter.js";
import { TableAdapter, type TableModel } from "./src/generator/tables.js";
import { RemoteWorker } from "./src/worker/remote.js";
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
const reply = (obj: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(obj) }],
  structuredContent: obj,
  isError: obj.status === "refused",
});

const kindDoc = "Record kind: student, class, enrollment, timetable or guardian.";
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
    if (plan_id) return reply(wicket.present(await wicket.commit(plan_id)));
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
    if (plan_id) return reply(wicket.present(await wicket.commit(plan_id)));
    const plan = await wicket.preview({ op: "create", kind, record: record as Op["record"] });
    return reply(wicket.present(plan));
  },
);

server.tool(
  {
    name: "publish",
    description: "Push all staged changes to the outside world (for example notifying families). It always needs the owner. Without plan_id it previews and asks the owner. It cannot be undone.",
    inputSchema: z.object({ plan_id: z.string().optional() }),
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  async ({ plan_id }) => {
    if (plan_id) return reply(wicket.present(await wicket.commit(plan_id)));
    return reply(await wicket.apply({ op: "publish" }));
  },
);

const opSchema = z.object({ op: z.enum(["delete", "create", "update", "publish"]), kind: z.string().optional(), key: z.string().optional(), record: z.record(z.string(), z.unknown()).optional(), patch: z.record(z.string(), z.unknown()).optional().describe("For update: the fields to change, like { city: 'Leeds' }.") });

// ---- compiling a web system on demand (the generator) ----

const compileFail = (e: unknown) => {
  if (e instanceof NotAuthorized) return reply({ status: "refused", error: "not_authorized", detail: e.message, next: ["ask the operator to add the host they own or have permission to use", "never try to get around this"] });
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
      url: z.string().describe("The page address, like http://host/signup. With login set, this is the login page."),
      login: z.string().optional().describe("Name of a login the operator stored on the server. You never see the password."),
      then: z.string().optional().describe("With login: the page to compile after signing in."),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  // Compiling is several steps on one page (sign in, read the forms, read the tables). Two compiles in parallel must not interleave.
  ({ url, login, then }) => exclusive(async () => {
    try {
      if (login) {
        const r = await forms.signIn(url, login);
        if (!r.signedIn) return reply({ status: "refused", error: "login_failed", detail: r.detail, next: ["ask the operator to check the stored login"] });
        if (then) await forms.open(then);
      }
      const s = login ? await forms.refresh() : await forms.compile(url);
      for (const f of s.forms) rules.set(f.id, "update", [], true); // filling fields is a reversible draft
      const t = await tables.attach();
      wicket.flush();
      return reply({ status: "compiled", ...s, ...(t.length ? thisPageTables(t, s.url) : {}), next: ["records in a table: find(kind), then apply({op:'delete'|'create', kind, key})", "fill a form with apply({op:'update', kind:<form id>, key:'current', patch:{...}})", "submit with publish (always needs the owner)", "a delete or create this system has never done asks the owner the first time"] });
    } catch (e) { return compileFail(e); }
  }),
);

server.tool(
  { name: "describe_forms", description: "List the compiled forms again: ids, fields, types, allowed values, hints. Use it when you are unsure what a field accepts.", inputSchema: z.object({}), annotations: { readOnlyHint: true, openWorldHint: false } },
  async () => { try { return reply({ status: "ok", ...(await forms.summary()) }); } catch (e) { return compileFail(e); } },
);

server.tool(
  { name: "refresh_forms", description: "Read the current page again, for example after a submit moved to the next page. Read-only.", inputSchema: z.object({}), annotations: { readOnlyHint: true, openWorldHint: true } },
  () => exclusive(async () => {
    try {
      const s = await forms.refresh();
      for (const f of s.forms) rules.set(f.id, "update", [], true);
      const t = await tables.attach();
      wicket.flush();
      return reply({ status: "refreshed", ...s, ...(t.length ? thisPageTables(t, s.url) : {}) });
    } catch (e) { return compileFail(e); }
  }),
);

server.tool(
  {
    name: "update",
    description: "Change fields on one record, or fill a compiled form (kind is the form id, key is 'current'). With dry_run: true it previews old -> new for each field and checks the values. Commit with plan_id. For most jobs use apply with op 'update'. Filling a form never submits it.",
    inputSchema: z.object({ kind: z.string().describe(kindDoc), key: z.string().default("current").describe(keyDoc), patch: z.record(z.string(), z.unknown()), dry_run: z.boolean().optional(), plan_id: z.string().optional() }),
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ kind, key, patch, plan_id }) => {
    if (plan_id) return reply(wicket.present(await wicket.commit(plan_id)));
    return reply(wicket.present(await wicket.preview({ op: "update", kind, key, patch })));
  },
);

server.tool(
  {
    name: "apply",
    description: "The normal way to make a change. Previews inside the server. If the rules allow it, it commits at once and returns a receipt with a read-back. If a person must decide, it returns awaiting_approval with a plan_id to poll with get_plan.",
    inputSchema: opSchema,
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async (args) => reply(await wicket.apply(args as Op)),
);

server.tool(
  {
    name: "apply_batch",
    description: "Apply many changes in one call. Everything inside the rules commits. Items that need the owner are listed with plan_ids. Refusals are listed with next moves. Stops at the first failed commit. Returns one summary, so you do not need many round trips.",
    inputSchema: z.object({ ops: z.array(opSchema).min(1).max(50), stop_on_failure: z.boolean().optional(), dry_run: z.boolean().optional().describe("Change nothing. Returns the total blast radius: everything that would be removed, dependents included."), canary: z.number().int().min(1).max(10).optional().describe("Commit only the first N, check they did exactly what was predicted, and halt the rest if any surprised or failed.") }),
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ ops, stop_on_failure, dry_run, canary }) => reply(await wicket.applyBatch(ops as Op[], stop_on_failure ?? true, { dryRun: dry_run, canary })),
);

server.tool(
  {
    name: "commit_batch",
    description: "Commit several plans the owner has approved, in order. The first `canary` ones run carefully and are checked against the prediction; if any surprises, the rest are not touched and you get the receipt to undo.",
    inputSchema: z.object({ plan_ids: z.array(z.string()).min(1).max(50), canary: z.number().int().min(1).max(10).optional() }),
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ plan_ids, canary }) => reply(await wicket.commitBatch(plan_ids, canary ?? 1)),
);

// ---- shared profiles: what one agent learned about a system, for the next agent ----
// Structure and learned rules only. Never records, never credentials. Held in memory: a restart empties it.

interface Profile { site: string; shared_at: string; tables: ReturnType<typeof tableView>[]; rules: { kind: string; op: string; cascades: { kind: string; by: string }[]; vouched: boolean }[] }
const registry = new Map<string, Profile>();
const siteKey = (s: string) => { try { return new URL(s.includes("://") ? s : `http://${s}`).host.toLowerCase(); } catch { return s.toLowerCase(); } };

// ---- discovery: which systems can I work in? The operator lists them; the agent describes what it needs ----
// WICKET_SYSTEMS is a JSON list on the server: [{"name","url","about"}]. An agent can only be pointed at systems on it
// (the worker's host allowlist still decides what it may actually open).

interface SystemEntry { name: string; url: string; about: string }
const systems: SystemEntry[] = (() => { try { const v = JSON.parse(process.env.WICKET_SYSTEMS ?? "[]"); return Array.isArray(v) ? v.filter((x) => x?.name && x?.url) : []; } catch { return []; } })();
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2).map((w) => w.replace(/(ies|es|s)$/, "")));

server.tool(
  {
    name: "find_systems",
    description: "Start here when you are not given an address. Describe what you need to do in plain words (for example 'remove a student from the school list' or 'send an invoice'). Returns the systems you are allowed to work in that match, with the address to compile and any profile other agents shared. It never searches the open web.",
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
    if (!systems.length) return reply({ status: "refused", error: "no_systems_registered", detail: "The operator has not listed any systems for agents to work in.", next: ["ask the operator to set WICKET_SYSTEMS", "or call compile_site with an address they gave you"] });
    if (!scored.length) return reply({ status: "none_found", detail: "Nothing the operator registered matches that description.", registered: systems.map((x) => x.name), next: ["describe it with different words", "ask the operator to register the system you need"] });
    return reply({ status: "found", matches: scored.map((x) => ({ name: x.sy.name, address: x.sy.url, about: x.sy.about, matched_on: x.hits, shared_profile: x.prof ? { dependents_known: x.prof.rules.filter((r) => r.cascades.length).length, shared_at: x.prof.shared_at } : null })), next: ["compile_site with the address of the best match", "if it has a shared profile, call use_profile with its host before changing anything"] });
  },
);

server.tool(
  {
    name: "share_profile",
    description: "Publish what you learned about the system you compiled, for other agents: its tables, keys, and the dependents you saw when deletes did more than predicted. Structure and rules only; no records, no logins. Other agents load it with use_profile.",
    inputSchema: z.object({ site: z.string().describe("The site's host, like crm.example.com. It is the profile's name.") }),
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ site }) => {
    const t = await tables.summary();
    if (!t.length) return reply({ status: "refused", error: "nothing_compiled", detail: "No tables are compiled yet, so there is nothing to share.", next: ["compile_site first"] });
    const kinds = new Set(t.map((x) => x.id));
    const rules = wicket.rules.exportRules().filter((r) => kinds.has(r.kind) && (r.cascades.length || r.vouched));
    const profile: Profile = { site: siteKey(site), shared_at: new Date().toISOString(), tables: t.map(tableView), rules };
    registry.set(profile.site, profile);
    return reply({ status: "shared", site: profile.site, tables: profile.tables.length, rules: rules.length, next: ["another agent can call use_profile with this site", "open /registry to see all shared profiles"] });
  },
);

server.tool(
  {
    name: "use_profile",
    description: "Load what another agent learned about a system. You still compile the page yourself (that takes a second). What you gain is the dependents it saw: your previews and dry runs now predict them. Nothing is trusted blindly: your first real delete still asks the owner and takes a full copy, then confirms the rule itself.",
    inputSchema: z.object({ site: z.string() }),
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ site }) => {
    const p = registry.get(siteKey(site));
    if (!p) return reply({ status: "refused", error: "no_profile", detail: `Nobody has shared a profile for ${siteKey(site)}.`, known_sites: [...registry.keys()], next: ["compile_site yourself, then share_profile so the next agent has it"] });
    const learned = wicket.rules.importRules(p.rules.map((r) => ({ kind: r.kind, op: r.op as "delete" | "create" | "update", cascades: r.cascades })));
    return reply({ status: "loaded", site: p.site, shared_at: p.shared_at, dependents_learned: learned, tables_described: p.tables.map((x) => x.id), trust: "Your first delete here still asks the owner and takes a full copy. Rules become confirmed only by your own matching run." });
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
    name: "check_capability",
    description: "Read-only. Does the page still match what was compiled for this kind? Returns matches_contract, or what changed and how serious it is (ui_changed stops work on the kind; signed out and transient errors do not). Changes nothing.",
    inputSchema: z.object({ kind: z.string() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ kind }) => reply((await wicket.checkCapability(kind)) as Record<string, unknown>),
);

server.tool(
  {
    name: "repair_capability",
    description: "For a capability that was disabled because its page changed: re-learn the page and re-enable it only if every test passes (a matching list, a usable key, delete still meaning delete, and earlier records still being the same records). Reads only; never changes a record. If it cannot prove the repair, it stays disabled and the owner is told.",
    inputSchema: z.object({ kind: z.string() }),
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ kind }) => reply((await wicket.repairCapability(kind)) as Record<string, unknown>),
);

server.tool(
  {
    name: "reconcile",
    description: "Use when commit says outcome_unknown (the server stopped while a change was running). Reads the system to find out what really happened, and never re-runs the change. Returns a receipt if it happened, or retires the plan if it did not.",
    inputSchema: z.object({ plan_id: z.string() }),
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ plan_id }) => reply(await wicket.reconcile(plan_id)),
);

server.tool(
  {
    name: "get_plan",
    description: "Check a plan: awaiting_approval, approved, expired, committed. Use it to poll for the owner's decision instead of retrying commit.",
    inputSchema: z.object({ plan_id: z.string(), wait_seconds: z.number().int().min(0).max(25).optional().describe("Wait up to this long for the owner to decide, so you do not burn turns polling.") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ plan_id, wait_seconds }) => {
    let plan = wicket.getPlan(plan_id) as Record<string, unknown>;
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
server.get("/robots.txt", (c) => c.text(robotsTxt(originOf(c))));
server.get("/", (c) => c.text(`Aperture\n\n${NAME_LINE}\n\nAn MCP server for working safely in web systems that have no API.\nMCP endpoint: ${originOf(c)}/mcp\nStart: ${originOf(c)}/llms.txt\n`));

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
