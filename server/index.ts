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
process.on("unhandledRejection", (e) => console.error("[wicket] unhandled rejection:", e instanceof Error ? e.message : e));

const server = new MCPServer({
  name: "wicket",
  title: "Wicket",
  version: "0.1.0",
  description: "A safe door into a legacy records system. Every change is previewed, checked, read back, and undoable.",
});

// ---- the system under test and the engine ----
// Today this is a fake school system with invented data. The adapter is swappable: see contract.md.
const rules = new RuleBook();
const seedRules = () => { rules.clear(); for (const r of startingRules()) rules.set(r.kind, r.op, r.cascades, r.confirmed); };
seedRules();
// Where the browser lives. With WICKET_WORKER_URL set, it runs on another machine (an InstaBox desktop) and this
// server just calls it. Without it, the browser is in this process, which is how local development and the tests run.
interface FormsApi extends Adapter { compile(url: string): Promise<CompileSummary>; signIn(url: string, secret: string): Promise<{ signedIn: boolean; detail: string }>; open(url: string): Promise<void>; refresh(): Promise<CompileSummary>; summary(): CompileSummary | Promise<CompileSummary> }
interface TablesApi extends Adapter { attach(): Promise<TableModel[]> }
let forms: FormsApi;
let tables: TablesApi;
if (process.env.WICKET_WORKER_URL) {
  const worker = new RemoteWorker(process.env.WICKET_WORKER_URL, process.env.WICKET_WORKER_TOKEN ?? "");
  forms = worker.forms; tables = worker.tables;
} else {
  const local = new FormAdapter();
  forms = local; tables = new TableAdapter(() => local.currentPage());
}
const wicket = new Wicket(new CompositeAdapter([new FakeSchool(), forms, tables]), { rules });

/** Small on purpose: an agent pays for every token of this. */
const tableView = (t: TableModel) => ({ id: t.id, rows: t.rows, columns: t.columns, key: t.keyColumn ?? (t.keyParam ? `link param ${t.keyParam}` : "none found"), actions: t.actions.map((a) => `${a.label} (${a.type})`), add: t.add, ...(t.paged ? { paged: true } : {}) });

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
    description: "Point Wicket at a web page and it reads the page's forms, read-only, and turns each one into a typed record you can fill. Only works on hosts the operator has authorized. It never submits anything and never tries to get past a CAPTCHA: a person does that. Returns each form's id, fields (label, type, required, allowed values) and submit button.",
    inputSchema: z.object({
      url: z.string().describe("The page address, like http://host/signup. With login set, this is the login page."),
      login: z.string().optional().describe("Name of a login the operator stored on the server. You never see the password."),
      then: z.string().optional().describe("With login: the page to compile after signing in."),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, login, then }) => {
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
      return reply({ status: "compiled", ...s, ...(t.length ? { tables: t.map(tableView) } : {}), next: ["records in a table: find(kind), then apply({op:'delete'|'create', kind, key})", "fill a form with apply({op:'update', kind:<form id>, key:'current', patch:{...}})", "submit with publish (always needs the owner)", "a delete or create this system has never done asks the owner the first time"] });
    } catch (e) { return compileFail(e); }
  },
);

server.tool(
  { name: "describe_forms", description: "List the compiled forms again: ids, fields, types, allowed values, hints. Use it when you are unsure what a field accepts.", inputSchema: z.object({}), annotations: { readOnlyHint: true, openWorldHint: false } },
  async () => { try { return reply({ status: "ok", ...(await forms.summary()) }); } catch (e) { return compileFail(e); } },
);

server.tool(
  { name: "refresh_forms", description: "Read the current page again, for example after a submit moved to the next page. Read-only.", inputSchema: z.object({}), annotations: { readOnlyHint: true, openWorldHint: true } },
  async () => {
    try {
      const s = await forms.refresh();
      for (const f of s.forms) rules.set(f.id, "update", [], true);
      const t = await tables.attach();
      wicket.flush();
      return reply({ status: "refreshed", ...s, ...(t.length ? { tables: t.map(tableView) } : {}) });
    } catch (e) { return compileFail(e); }
  },
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
    inputSchema: z.object({ ops: z.array(opSchema).min(1).max(50), stop_on_failure: z.boolean().optional() }),
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ ops, stop_on_failure }) => reply(await wicket.applyBatch(ops as Op[], stop_on_failure ?? true)),
);

server.tool(
  {
    name: "get_plan",
    description: "Check a plan: awaiting_approval, approved, expired, committed. Use it to poll for the owner's decision instead of retrying commit.",
    inputSchema: z.object({ plan_id: z.string() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ plan_id }) => reply(wicket.getPlan(plan_id) as Record<string, unknown>),
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

server.tool(
  {
    name: "reset_demo",
    description: "Demo only. Resets the fake data and counters to the starting state so a run can be repeated. Never touches anything real.",
    inputSchema: z.object({}),
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async () => { await wicket.resetDemo(); seedRules(); return reply({ status: "reset", note: "Fake data, counters and what was learned are back to the start." }); },
);

server.prompt(
  { name: "safe-batch-job", description: "How to run a multi-step job safely and finish it without a human watching.", schema: z.object({ task: z.string().describe("What needs doing, in one or two sentences.") }) },
  async ({ task }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Do this job with the Wicket tools: ${task}\n\n1. Call get_instructions once.\n2. Use find to get exact keys. Names are not unique.\n3. Use apply_batch for many changes, or apply for one.\n4. If something is awaiting_approval, keep working on the rest and poll get_plan.\n5. Report only what the receipts verified. If verified.ok is false, say so.\n6. If you made a mistake, call undo with the receipt id.` } }],
  }),
);

// ---- owner side: a plain web page, never an agent tool ----

const OWNER_TOKEN = process.env.OWNER_TOKEN;
const allowed = (c: { req: { query: (k: string) => string | undefined } }) => !OWNER_TOKEN || c.req.query("token") === OWNER_TOKEN;

server.get("/owner", (c) => c.html(OWNER_PAGE));
server.get("/owner/state", (c) => (allowed(c) ? c.json(wicket.ownerState()) : c.json({ error: "not allowed" }, 403)));
server.post("/owner/approve", async (c) => {
  if (!allowed(c)) return c.json({ error: "not allowed" }, 403);
  const b = (await c.req.json()) as { plan_id: string };
  return c.json(wicket.approve(b.plan_id));
});
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
