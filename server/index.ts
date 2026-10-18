import { MCPServer } from "mcp-use";
import { z } from "zod";
import { Wicket } from "./src/engine.js";
import { RuleBook } from "./src/rules.js";
import { FakeSchool, startingRules } from "./src/adapters/fake-school.js";
import { OWNER_PAGE } from "./src/owner-page.js";
import type { Op } from "./src/types.js";

const server = new MCPServer({
  name: "wicket",
  title: "Wicket",
  version: "0.1.0",
  description: "A safe door into a legacy records system. Every change is previewed, checked, read back, and undoable.",
});

// ---- the system under test and the engine ----
// Today this is a fake school system with invented data. The adapter is swappable: see contract.md.
const rules = new RuleBook();
for (const r of startingRules()) rules.set(r.kind, r.op, r.cascades, r.confirmed);
const wicket = new Wicket(new FakeSchool(), { rules });

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

const opSchema = z.object({ op: z.enum(["delete", "create", "publish"]), kind: z.string().optional(), key: z.string().optional(), record: z.record(z.string(), z.unknown()).optional() });

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
  async () => { await wicket.resetDemo(); return reply({ status: "reset", note: "Fake data restored." }); },
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
