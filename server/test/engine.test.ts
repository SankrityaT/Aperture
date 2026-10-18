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
