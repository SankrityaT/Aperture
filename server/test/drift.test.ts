// What happens when a page changes under a compiled capability. Real browser, real engine, the replica gate portal as ground truth.
// A change that breaks the contract must stop work and say why; a repair must be proven before it is trusted; nothing may act on the wrong thing.
process.env.WICKET_SCAN_TTL_MS = "0";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { FormAdapter } from "../src/generator/form-adapter.js";
import { TableAdapter } from "../src/generator/tables.js";
import { CompositeAdapter } from "../src/adapters/composite.js";
import { Wicket, isRefusal } from "../src/engine.js";
import { RuleBook } from "../src/rules.js";
import { startGatePortal } from "./fixtures/gateportal.js";

let g: Awaited<ReturnType<typeof startGatePortal>>;
const fa = new FormAdapter();
let ta: TableAdapter; let kind: string; let w: Wicket;

before(async () => { g = await startGatePortal(0); await fa.compile(`${g.url}/Residents.aspx`); });
after(async () => { await fa.close(); await g.close(); });

/** A fresh engine and a freshly compiled list, with a few real records seen once so a repair has something to be tested against. */
async function fresh() {
  g.reset();
  await fa.open(`${g.url}/Residents.aspx`); await fa.refresh();
  ta = new TableAdapter(() => fa.currentPage());
  kind = (await ta.attach())[0]!.id;
  w = new Wicket(new CompositeAdapter([ta]), { rules: new RuleBook(), cacheTtlMs: 0, mandate: { maxDeletesPerDay: 100 } });
  const seen = (await w.find(kind, undefined, 5)) as { count: number };
  assert.equal(seen.count, 91);
}
const cap = () => (w.ownerState() as { capabilities: { kind: string; status: string; version: number; repairs: number }[] }).capabilities.find((c) => c.kind === kind);

test("a renamed ordinary column is noticed but does not stop work", async () => {
  await fresh(); g.setDrift("rename_col");
  const r = (await w.find(kind, undefined, 3)) as { count: number };
  assert.equal(r.count, 91);
  assert.notEqual(cap()?.status, "disabled");
});

test("a renamed KEY column disables the capability, refuses writes, and a repair proven against earlier records re-enables it", async () => {
  await fresh(); g.setDrift("rename_key");
  const f = await w.find(kind);
  assert.ok(isRefusal(f) && f.error === "capability_changed", JSON.stringify(f).slice(0, 200));
  assert.equal(cap()?.status, "disabled");
  const del = await w.preview({ op: "delete", kind, key: "1002" });
  assert.ok(isRefusal(del) && del.error === "capability_disabled");
  assert.equal(g.state.residents.length, 91, "nothing was touched");

  const rep = (await w.repairCapability(kind)) as { status: string; version: number; tests: { pass: boolean; name: string }[] };
  assert.equal(rep.status, "repaired", JSON.stringify(rep).slice(0, 400));
  assert.equal(rep.version, 2);
  assert.ok(rep.tests.every((t) => t.pass));
  assert.equal(cap()?.status, "active");
  assert.equal(cap()?.repairs, 1);

  // and it works again, on the right record, verified against the system's own state
  w.delegate({ kinds: [kind], ops: ["delete"], limit: 3, ttlMs: 60_000 });
  const done = (await w.apply({ op: "delete", kind, key: "1002" })) as { status: string };
  assert.ok(["done", "done_with_surprise"].includes(done.status), JSON.stringify(done).slice(0, 300));
  assert.ok(!g.state.residents.some((r) => r.dir === "1002"));
  assert.equal(g.state.residents.length, 90);
});

test("when the delete control stops meaning delete, the repair is NOT proven: it stays disabled and the owner is told", async () => {
  await fresh(); g.setDrift("no_delete");
  const f = await w.find(kind);
  assert.ok(isRefusal(f) && f.error === "capability_changed");
  const rep = await w.repairCapability(kind);
  assert.ok(isRefusal(rep) && rep.error === "repair_not_proven", JSON.stringify(rep).slice(0, 300));
  assert.equal(cap()?.status, "disabled");
  const tests = (rep as unknown as { tests: { name: string; pass: boolean }[] }).tests;
  assert.ok(tests.some((t) => /still means delete/.test(t.name) && !t.pass));
  assert.ok((w.ownerState() as { escalations: unknown[] }).escalations.length >= 1);
  const del = await w.preview({ op: "delete", kind, key: "1003" });
  assert.ok(isRefusal(del) && del.error === "capability_disabled");
  assert.equal(g.state.residents.length, 91);
});

test("an inserted decoy table is never acted on: either it still works on the right table, or it stops", async () => {
  await fresh(); g.setDrift("decoy");
  const f = (await w.find(kind)) as { count?: number; error?: string; items?: { key: string }[] };
  if (f.error) { assert.ok(["capability_changed"].includes(f.error)); return; }
  assert.equal(f.count, 91);
  assert.ok(f.items!.every((i) => /^\d{4}$/.test(i.key)), "every record is a resident, none is a notice");
});

test("a signed-out page is reported as signed out, does not disable the capability, and recovers when signed in again", async () => {
  await fresh(); g.setDrift("signedout");
  const f = await w.find(kind);
  assert.ok(isRefusal(f) && f.error === "signed_out", JSON.stringify(f).slice(0, 200));
  assert.notEqual(cap()?.status, "disabled");
  g.setDrift("");
  const again = (await w.find(kind)) as { count: number };
  assert.equal(again.count, 91);
});

test("a Delete button that no longer deletes is caught by the read-back: failed, never done", async () => {
  await fresh(); g.setDrift("archive");
  w.delegate({ kinds: [kind], ops: ["delete"], limit: 3, ttlMs: 60_000 });
  const r = (await w.apply({ op: "delete", kind, key: "1004" })) as { status: string; verified?: { subject_present?: unknown } };
  assert.equal(r.status, "failed", JSON.stringify(r).slice(0, 300));
  assert.equal(g.state.residents.length, 91, "the system really did not change");
});

test("smaller pages are handled by scanning, not by a contract failure", async () => {
  await fresh(); g.setDrift("paging");
  const f = (await w.find(kind)) as { count: number };
  assert.equal(f.count, 91);
});

test("a proactive check finds the change before any task does, and re-enables when the page goes back", async () => {
  await fresh(); g.setDrift("rename_key");
  const c = (await w.checkCapability(kind)) as { matches_contract: boolean; class?: string };
  assert.equal(c.matches_contract, false);
  assert.equal(c.class, "ui_changed");
  assert.equal(cap()?.status, "disabled");
  g.setDrift("");
  const back = (await w.checkCapability(kind)) as { matches_contract: boolean };
  assert.equal(back.matches_contract, true);
  assert.equal(cap()?.status, "active");
});
