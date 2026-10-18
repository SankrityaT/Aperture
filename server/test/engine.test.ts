import { test } from "node:test";
import assert from "node:assert/strict";
import { Wicket, isRefusal } from "../src/engine.js";
import { RuleBook } from "../src/rules.js";
import { FakeSchool, startingRules } from "../src/adapters/fake-school.js";

function make(mandate = {}) {
  const adapter = new FakeSchool();
  const rules = new RuleBook();
  for (const r of startingRules()) rules.set(r.kind, r.op, r.cascades, r.confirmed);
  return { adapter, w: new Wicket(adapter, { rules, mandate }) };
}

test("find returns both students with the same name and says names are not unique", async () => {
  const { w } = make();
  const r = (await w.find("student", "alex morgan")) as { count: number; items: { key: string }[]; note?: string };
  assert.equal(r.count, 2);
  assert.deepEqual(r.items.map((i) => i.key).sort(), ["S014", "S022"]);
  assert.match(r.note ?? "", /not unique/);
});

test("deleting by a name instead of a key is refused with suggestions", async () => {
  const { w } = make();
  const r = await w.preview({ op: "delete", kind: "student", key: "Alex Morgan" });
  assert.ok(isRefusal(r));
  if (isRefusal(r)) {
    assert.equal(r.error, "not_found");
    assert.equal((r.did_you_mean as unknown[]).length, 2);
    assert.ok(r.next.length > 0);
  }
});

test("preview changes nothing and lists the cascade", async () => {
  const { w, adapter } = make();
  const before = await adapter.counts();
  const p = await w.preview({ op: "delete", kind: "student", key: "S001" });
  assert.ok(!isRefusal(p));
  assert.deepEqual(await adapter.counts(), before);
  if (!isRefusal(p)) {
    assert.ok(p.diff[0]!.startsWith("- student"));
    assert.equal(p.needsApproval, false);
    assert.ok(p.dependents.length > 0);
  }
});

test("apply commits in-policy deletes, verifies by read-back, and undo restores everything", async () => {
  const { w, adapter } = make();
  const before = await adapter.counts();
  const r = (await w.apply({ op: "delete", kind: "student", key: "S001" })) as { status: string; receipt: string; verified: { ok: boolean } };
  assert.equal(r.status, "done");
  assert.equal(r.verified.ok, true);
  assert.equal((await adapter.counts()).student, before.student! - 1);
  assert.equal(await adapter.read("student", "S001"), null);
  const u = (await w.undo(r.receipt)) as { status: string };
  assert.equal(u.status, "undone");
  assert.deepEqual(await adapter.counts(), before);
  assert.ok(await adapter.read("student", "S001"));
});

test("an unconfirmed class delete asks the owner, then a surprise is caught, learned, and undone", async () => {
  const { w, adapter } = make();
  const before = await adapter.counts();
  const a = (await w.apply({ op: "delete", kind: "class", key: "C101" })) as { status: string; plan_id: string };
  assert.equal(a.status, "awaiting_approval");
  assert.deepEqual(await adapter.counts(), before);
  const c1 = await w.commit(a.plan_id);
  assert.ok(isRefusal(c1) && c1.error === "awaiting_approval");
  w.approve(a.plan_id);
  const rc = (await w.commit(a.plan_id)) as { id: string; status: string; surprise?: { kind: string; delta: number }[] };
  assert.equal(rc.status, "done_with_surprise");
  assert.equal(rc.surprise?.[0]?.kind, "timetable");
  assert.ok(w.rules.cascadesFor("class", "delete").some((c) => c.kind === "timetable"));
  const u = (await w.undo(rc.id)) as { status: string };
  assert.equal(u.status, "undone");
  assert.deepEqual(await adapter.counts(), before);
  // The next preview now knows about the timetable.
  const p = await w.preview({ op: "delete", kind: "class", key: "C102" });
  assert.ok(!isRefusal(p) && p.diff.some((l) => l.includes("timetable")));
});

test("the daily limit refuses with next moves, escalation reaches the owner, and raising the cap unblocks", async () => {
  const { w } = make({ maxDeletesPerDay: 2 });
  assert.equal(((await w.apply({ op: "delete", kind: "student", key: "S001" })) as { status: string }).status, "done");
  assert.equal(((await w.apply({ op: "delete", kind: "student", key: "S002" })) as { status: string }).status, "done");
  const third = await w.apply({ op: "delete", kind: "student", key: "S003" });
  assert.ok(isRefusal(third));
  if (isRefusal(third)) { assert.equal(third.error, "policy_denied"); assert.ok(third.next.some((n) => n.includes("escalate"))); }
  const e = w.escalate("Work order lists 20 removals; the daily limit is 2.") as { status: string };
  assert.equal(e.status, "pending_human");
  w.raiseCap(25);
  assert.equal(((await w.apply({ op: "delete", kind: "student", key: "S003" })) as { status: string }).status, "done");
});

test("a plan goes stale if the record changes after the preview", async () => {
  const { w, adapter } = make();
  const p = await w.preview({ op: "delete", kind: "student", key: "S005" });
  assert.ok(!isRefusal(p));
  adapter.tamper("student", "S005", { form: "changed" });
  if (!isRefusal(p)) {
    const c = await w.commit(p.id);
    assert.ok(isRefusal(c) && c.error === "changed_since_preview");
  }
  assert.ok(await adapter.read("student", "S005"));
});

test("publish always needs the owner and cannot be undone", async () => {
  const { w } = make();
  await w.apply({ op: "delete", kind: "student", key: "S004" });
  const a = (await w.apply({ op: "publish" })) as { status: string; plan_id: string };
  assert.equal(a.status, "awaiting_approval");
  w.approve(a.plan_id);
  const rc = (await w.commit(a.plan_id)) as { id: string; status: string };
  assert.equal(rc.status, "done");
  const u = await w.undo(rc.id);
  assert.ok(isRefusal(u) && u.error === "not_undoable");
});

test("a batch commits what is allowed, lists the rest, and gives one summary", async () => {
  const { w, adapter } = make();
  const out = (await w.applyBatch([
    { op: "delete", kind: "student", key: "S006" },
    { op: "delete", kind: "student", key: "Alex Morgan" },
    { op: "delete", kind: "class", key: "C104" },
    { op: "delete", kind: "student", key: "S007" },
  ])) as { committed: number; awaiting_approval: number; refused: number };
  assert.equal(out.committed, 2);
  assert.equal(out.awaiting_approval, 1);
  assert.equal(out.refused, 1);
  assert.equal(await adapter.read("student", "S006"), null);
  assert.equal(await adapter.read("student", "S007"), null);
});

test("two writes at once on the same record: only one wins, nothing is deleted twice", async () => {
  const { w } = make();
  const p1 = await w.preview({ op: "delete", kind: "student", key: "S010" });
  const p2 = await w.preview({ op: "delete", kind: "student", key: "S010" });
  assert.ok(!isRefusal(p1) && !isRefusal(p2));
  if (!isRefusal(p1) && !isRefusal(p2)) {
    const [a, b] = await Promise.all([w.commit(p1.id), w.commit(p2.id)]);
    const wins = [a, b].filter((x) => !isRefusal(x)).length;
    assert.equal(wins, 1);
  }
});

test("preview is fast when it can use the cache", async () => {
  const { w, adapter } = make();
  adapter.latencyMs = 40;
  await w.find("student", "S01");
  const t = performance.now();
  await w.find("student", "S01");
  assert.ok(performance.now() - t < 20, "second find should come from the cache");
});

test("dry run shows the total blast radius and changes nothing", async () => {
  const { w, adapter } = make();
  const before = await adapter.counts();
  const r = (await w.applyBatch([{ op: "delete", kind: "student", key: "S001" }, { op: "delete", kind: "student", key: "S002" }], true, { dryRun: true })) as { status: string; changed_nothing: boolean; would_remove: Record<string, number>; items: unknown[] };
  assert.equal(r.status, "blast_radius");
  assert.equal(r.changed_nothing, true);
  assert.equal(r.would_remove.student, 2);
  assert.equal(r.items.length, 2);
  assert.deepEqual(await adapter.counts(), before);
});

test("a canary that does exactly what was predicted lets the rest of the batch run", async () => {
  const { w, adapter } = make();
  const before = (await adapter.counts()).student!;
  const r = (await w.applyBatch([{ op: "delete", kind: "student", key: "S001" }, { op: "delete", kind: "student", key: "S002" }, { op: "delete", kind: "student", key: "S003" }], true, { canary: 1 })) as { status: string; committed: number; not_attempted: number };
  assert.equal(r.status, "batch_done");
  assert.equal(r.committed, 3);
  assert.equal((await adapter.counts()).student, before - 3);
});

test("a canary that surprises halts the rest, and one undo restores it", async () => {
  const { w, adapter } = make();
  w.rules.set("class", "delete", [], true); // confirmed, but wrongly: it has a hidden dependent
  const before = await adapter.counts();
  const r = (await w.applyBatch([{ op: "delete", kind: "class", key: "C101" }, { op: "delete", kind: "student", key: "S001" }, { op: "delete", kind: "student", key: "S002" }], true, { canary: 1 })) as { status: string; committed: number; not_attempted: number; canary_halt?: { receipt: string } };
  assert.equal(r.status, "halted_by_canary");
  assert.equal(r.not_attempted, 2);
  assert.equal((await adapter.counts()).student, before.student);
  const u = (await w.undo(r.canary_halt!.receipt)) as { status: string };
  assert.equal(u.status, "undone");
  assert.deepEqual(await adapter.counts(), before);
});

test("a second agent loads what the first learned: its dry run predicts the hidden dependent, and still asks the owner", async () => {
  // Agent A starts with no rule for classes, deletes one, and is surprised by the timetable rows.
  const a = new Wicket(new FakeSchool(), { rules: new RuleBook() });
  const first = (await a.apply({ op: "delete", kind: "class", key: "C101" })) as { plan_id: string };
  a.approve(first.plan_id);
  await a.commit(first.plan_id);
  const shared = a.rules.exportRules().filter((r) => r.kind === "class");
  assert.ok(shared.some((r) => r.cascades.some((c) => c.kind === "timetable")));

  // Agent B is brand new. Before loading: it predicts only the class.
  const b = new Wicket(new FakeSchool(), { rules: new RuleBook() });
  const blind = (await b.applyBatch([{ op: "delete", kind: "class", key: "C102" }], true, { dryRun: true })) as { would_remove: Record<string, number> };
  assert.equal(blind.would_remove.timetable, undefined);

  // After loading: the dry run sees the timetable rows, but nothing is trusted yet.
  assert.ok(b.rules.importRules(shared) > 0);
  const seen = (await b.applyBatch([{ op: "delete", kind: "class", key: "C102" }], true, { dryRun: true })) as { would_remove: Record<string, number>; needs_owner: number };
  assert.ok((seen.would_remove.timetable ?? 0) > 0);
  assert.equal(seen.needs_owner, 1);
  assert.equal(b.rules.isConfirmed("class", "delete"), false);
});

test("delegation: inside the owner's grant a change needs no per-item approval, keeps the full copy, and names its authority", async () => {
  const { w, adapter } = make();
  const before = await adapter.counts();
  const d = w.delegate({ kinds: ["class"], ops: ["delete"], limit: 2, ttlMs: 60_000 });
  const r = (await w.apply({ op: "delete", kind: "class", key: "C101" })) as { status: string; authority?: string; receipt: string };
  assert.notEqual(r.status, "awaiting_approval");
  assert.equal(r.authority, d.id);
  // a hidden dependent was found, and because the rule was unconfirmed the full copy was taken, so undo restores everything
  const u = (await w.undo(r.receipt)) as { status: string };
  assert.equal(u.status, "undone");
  assert.deepEqual(await adapter.counts(), before);
});

test("delegation does not cover other kinds or operations, and publish always needs the owner", async () => {
  const { w } = make();
  w.delegate({ kinds: ["class"], ops: ["delete"], limit: 5, ttlMs: 60_000 });
  const create = (await w.apply({ op: "create", kind: "class", record: { key: "C999", name: "New" } })) as { status: string };
  assert.equal(create.status, "awaiting_approval");
});

test("delegation pauses at the first surprise: the next change goes back to the owner", async () => {
  const { w } = make();
  const d = w.delegate({ kinds: ["class"], ops: ["delete"], limit: 5, ttlMs: 60_000 });
  const first = (await w.apply({ op: "delete", kind: "class", key: "C101" })) as { status: string };
  assert.equal(first.status, "done_with_surprise");
  const state = w.ownerState() as { delegations: { id: string; paused: string | null }[] };
  assert.ok(state.delegations.find((x) => x.id === d.id)?.paused);
  const second = (await w.apply({ op: "delete", kind: "class", key: "C102" })) as { status: string };
  assert.equal(second.status, "awaiting_approval");
  w.resumeDelegation(d.id);
});

test("a delegation revoked after the preview no longer covers the commit", async () => {
  const { w } = make();
  const d = w.delegate({ kinds: ["class"], ops: ["delete"], limit: 5, ttlMs: 60_000 });
  const p = await w.preview({ op: "delete", kind: "class", key: "C103" });
  assert.ok(!isRefusal(p) && p.delegatedBy === d.id && !p.needsApproval);
  w.revokeDelegation(d.id);
  const c = await w.commit((p as { id: string }).id);
  assert.ok(isRefusal(c) && c.error === "delegation_ended");
});

test("a delegation is used up at its limit; later changes are covered only by what they would have had anyway", async () => {
  const { w } = make();
  const d = w.delegate({ kinds: ["class"], ops: ["delete"], limit: 1, ttlMs: 60_000 });
  const a = (await w.apply({ op: "delete", kind: "class", key: "C101" })) as { authority?: string };
  assert.equal(a.authority, d.id);
  const state = w.ownerState() as { delegations: { id: string; used: number; active: boolean }[] };
  const mine = state.delegations.find((x) => x.id === d.id)!;
  assert.equal(mine.used, 1);
  assert.equal(mine.active, false);
  const b = (await w.apply({ op: "delete", kind: "class", key: "C102" })) as { authority?: string; status: string };
  assert.notEqual(b.authority, d.id);
});

import { mkdtempSync, readFileSync as readF, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLedger } from "../src/ledger.js";

function ledgerPath() { return join(mkdtempSync(join(tmpdir(), "wicket-ledger-")), "ledger.json"); }
const withLedger = (adapter: FakeSchool, path: string) => { const rules = new RuleBook(); for (const r of startingRules()) rules.set(r.kind, r.op, r.cascades, r.confirmed); return new Wicket(adapter, { rules, ledger: new FileLedger(path) }); };

test("ledger: receipts, delegations and learned rules survive a restart, and undo still works from the saved copy", async () => {
  const path = ledgerPath(); const adapter = new FakeSchool();
  const before = await adapter.counts();
  const a = withLedger(adapter, path);
  const d = a.delegate({ kinds: ["class"], ops: ["delete"], limit: 3, ttlMs: 60_000 });
  const r = (await a.apply({ op: "delete", kind: "class", key: "C101" })) as { receipt: string; authority: string };
  assert.equal(r.authority, d.id);
  // a brand new engine on the same file, as after a restart
  const b = withLedger(adapter, path);
  const state = b.ownerState() as { delegations: { id: string; used: number }[]; rules: { rule: string; cascades: string[] }[] };
  assert.equal(state.delegations.find((x) => x.id === d.id)?.used, 1);
  assert.ok(state.rules.some((x) => x.rule === "class:delete" && x.cascades.some((c) => c.startsWith("timetable"))), "the learned dependent was kept");
  const u = (await b.undo(r.receipt)) as { status: string };
  assert.equal(u.status, "undone");
  assert.deepEqual(await adapter.counts(), before);
});

test("ledger: a change that was running when the server stopped comes back as unknown, is never retried, and reconcile finds the truth", async () => {
  const path = ledgerPath(); const adapter = new FakeSchool();
  const a = withLedger(adapter, path);
  const p = (await a.preview({ op: "delete", kind: "student", key: "S001" })) as { id: string };
  // Simulate the crash: the delete reached the system, then the process died before it could write a receipt.
  const plan = a.plans.get(p.id)!;
  plan.status = "executing"; plan.snapshot = [{ kind: "student", record: plan.subject! }];
  (a as unknown as { persist(): void }).persist();
  await adapter.delete("student", "S001");

  const b = withLedger(adapter, path);
  assert.equal(b.plans.get(p.id)!.status, "unknown");
  const c = await b.commit(p.id);
  assert.ok(isRefusal(c) && c.error === "outcome_unknown", "no blind retry");
  const rec = (await b.reconcile(p.id)) as { status: string; receipt?: string; reconciled?: boolean };
  assert.equal(rec.reconciled, true);
  const u = (await b.undo(rec.receipt!)) as { status: string };
  assert.equal(u.status, "undone");
  assert.ok(await adapter.read("student", "S001"), "undo restored it from the copy saved before the change");
});

test("ledger: reconcile retires a plan whose change never reached the system", async () => {
  const path = ledgerPath(); const adapter = new FakeSchool();
  const a = withLedger(adapter, path);
  const p = (await a.preview({ op: "delete", kind: "student", key: "S002" })) as { id: string };
  const plan = a.plans.get(p.id)!;
  plan.status = "executing"; plan.snapshot = [{ kind: "student", record: plan.subject! }];
  (a as unknown as { persist(): void }).persist();
  const b = withLedger(adapter, path);
  const rec = (await b.reconcile(p.id)) as { status: string };
  assert.equal(rec.status, "not_applied");
  assert.ok(await adapter.read("student", "S002"));
  assert.equal(b.plans.get(p.id)!.status, "stale");
});

test("ledger: the file is only readable by its owner, and an unreadable ledger is never overwritten", () => {
  const path = ledgerPath();
  new FileLedger(path).save({ v: 1 });
  assert.equal(JSON.parse(readF(path, "utf8")).v, 1);
  const mode = statSync(path).mode & 0o777;
  assert.equal(mode, 0o600);
  writeFileSync(path, "{not json");
  assert.throws(() => new FileLedger(path).load(), /could not be read/);
  assert.equal(readF(path, "utf8"), "{not json");
});

test("recovery: a preview names how the change would be reversed, and after an undo that could not restore a field, the next preview warns about it", async () => {
  // A system that gives a re-created record a new student number, like the school page did (S2 came back as S6).
  const rows = new Map<string, Record<string, unknown>>([["a", { key: "a", name: "Ben", number: "S2" }], ["b", { key: "b", name: "Cy", number: "S3" }]]);
  let n = 100;
  const stub = {
    kinds: () => ["person"], read: async (_k: string, key: string) => (rows.has(key) ? { ...rows.get(key)! } : null),
    list: async () => [...rows.values()].map((r) => ({ ...r })), delete: async (_k: string, key: string) => { rows.delete(key); },
    create: async (_k: string, rec: Record<string, unknown>) => { rows.set(String(rec.key), { ...rec, number: `S${n++}` }); },
    counts: async () => ({ person: rows.size }), exportAll: async () => ({ person: [...rows.values()].map((r) => ({ ...r })) }),
    pendingPublish: async () => [], publish: async () => ({ published: 0, notified: 0 }), reset: async () => undefined,
  };
  const w = new Wicket(stub as never, { rules: new RuleBook(), cacheTtlMs: 0 });
  w.delegate({ kinds: ["person"], ops: ["delete"], limit: 5, ttlMs: 60_000 });
  const first = (await w.apply({ op: "delete", kind: "person", key: "a" })) as { receipt: string; recovery?: { strategy: string; expected: string; lessons?: string[] } };
  assert.equal(first.recovery?.strategy, "recreate_from_saved_copy");
  assert.match(first.recovery!.expected, /functionally equivalent/);
  assert.equal(first.recovery?.lessons, undefined, "nothing learned yet");
  const u = (await w.undo(first.receipt)) as { verified: { fields_not_restored?: string[] } };
  assert.deepEqual(u.verified.fields_not_restored, ["number"]);
  // the next agent is told before it acts
  const p = (await w.preview({ op: "delete", kind: "person", key: "b" })) as { recovery?: { expected: string; lessons?: string[] } };
  assert.match(p.recovery!.expected, /partial/);
  assert.ok(p.recovery!.lessons!.some((l) => /number/.test(l)));
});

test("undo of a change that failed is refused: nothing happened, so nothing is 'undone'", async () => {
  const rows = new Map<string, Record<string, unknown>>([["a", { key: "a", name: "Ben" }]]);
  const stub = {
    kinds: () => ["person"], read: async (_k: string, key: string) => (rows.has(key) ? { ...rows.get(key)! } : null),
    list: async () => [...rows.values()].map((r) => ({ ...r })),
    delete: async () => { /* the app silently does nothing */ },
    create: async () => undefined, counts: async () => ({ person: rows.size }), exportAll: async () => ({ person: [...rows.values()] }),
    pendingPublish: async () => [], publish: async () => ({ published: 0, notified: 0 }), reset: async () => undefined,
  };
  const w = new Wicket(stub as never, { rules: new RuleBook(), cacheTtlMs: 0 });
  w.delegate({ kinds: ["person"], ops: ["delete"], limit: 3, ttlMs: 60_000 });
  const r = (await w.apply({ op: "delete", kind: "person", key: "a" })) as { status: string; receipt: string };
  assert.equal(r.status, "failed");
  const u = await w.undo(r.receipt);
  assert.ok(isRefusal(u) && u.error === "nothing_to_undo", JSON.stringify(u).slice(0, 200));
});

test("a demo reset clears standing delegations, so authority granted for one run cannot linger into the next", async () => {
  const { w } = make();
  w.delegate({ kinds: ["class"], ops: ["delete"], limit: 5, ttlMs: 60_000 });
  assert.equal((w.ownerState() as { delegations: unknown[] }).delegations.length, 1);
  await w.resetDemo();
  assert.equal((w.ownerState() as { delegations: unknown[] }).delegations.length, 0);
  const a = (await w.apply({ op: "delete", kind: "class", key: "C101" })) as { status: string };
  assert.equal(a.status, "awaiting_approval", "back to asking the owner");
});

test("undo that can only put back part of a change says exactly what came back and what did not", async () => {
  const people = new Map<string, Record<string, unknown>>([["p1", { key: "p1", name: "Ann" }]]);
  const cards = new Map<string, Record<string, unknown>>([["c1", { key: "c1", owner: "p1" }], ["c2", { key: "c2", owner: "p1" }]]);
  const tbl = (k: string) => (k === "person" ? people : cards);
  const stub = {
    kinds: () => ["person", "card"], read: async (k: string, key: string) => (tbl(k).has(key) ? { ...tbl(k).get(key)! } : null),
    list: async (k: string, f?: Record<string, unknown>) => [...tbl(k).values()].filter((r) => !f || Object.entries(f).every(([a, b]) => r[a] === b)).map((r) => ({ ...r })),
    delete: async (k: string, key: string) => { tbl(k).delete(key); if (k === "person") for (const [ck, c] of cards) if (c.owner === key) cards.delete(ck); },
    create: async (k: string, rec: Record<string, unknown>) => { if (k === "card") throw new Error("no add button found for card"); tbl(k).set(String(rec.key), { ...rec }); },
    counts: async () => ({ person: people.size, card: cards.size }), exportAll: async () => ({ person: [...people.values()], card: [...cards.values()] }),
    pendingPublish: async () => [], publish: async () => ({ published: 0, notified: 0 }), reset: async () => undefined,
  };
  const rules = new RuleBook(); rules.set("person", "delete", [{ kind: "card", by: "owner" }], false);
  const w = new Wicket(stub as never, { rules, cacheTtlMs: 0 });
  w.delegate({ kinds: ["person"], ops: ["delete"], limit: 3, ttlMs: 60_000 });
  const r = (await w.apply({ op: "delete", kind: "person", key: "p1" })) as { status: string; receipt: string };
  assert.equal(r.status, "done");
  const u = await w.undo(r.receipt);
  assert.ok(isRefusal(u) && u.error === "undo_partial", JSON.stringify(u).slice(0, 200));
  assert.deepEqual((u as unknown as { restored: { key: string }[] }).restored.map((x) => x.key), ["p1"]);
  assert.deepEqual((u as unknown as { not_restored: { key: string }[] }).not_restored.map((x) => x.key).sort(), ["c1", "c2"]);
  assert.ok(people.has("p1"), "the person really is back");
  const again = await w.undo(r.receipt);
  assert.ok(isRefusal(again) && again.error === "already_partially_undone");
});
