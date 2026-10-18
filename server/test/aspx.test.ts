// The WebForms patterns. Written BEFORE any fix, to see what the generator does on them as it stands.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { FormAdapter } from "../src/generator/form-adapter.js";
import { TableAdapter } from "../src/generator/tables.js";
import { CompositeAdapter } from "../src/adapters/composite.js";
import { Wicket, isRefusal } from "../src/engine.js";
import { RuleBook } from "../src/rules.js";
import { startAspx, type AspxSite } from "./fixtures/aspx.js";

let site: AspxSite;
before(async () => { site = await startAspx(); });
after(async () => { await site.close(); });

async function setup() {
  const fa = new FormAdapter();
  await fa.compile(`${site.url}/Residents.aspx`);
  const ta = new TableAdapter(() => fa.currentPage());
  const models = await ta.attach();
  const w = new Wicket(new CompositeAdapter([ta]), { rules: new RuleBook() });
  return { fa, ta, models, w };
}

test("webforms: finds the grid past the filter row, with its columns, key, delete action and add link", async () => {
  const { fa, models } = await setup();
  try {
    assert.equal(models.length, 1, "one table");
    const m = models[0]!;
    assert.deepEqual(m.columns, ["Resident", "Dir", "Ent", "SL"]);
    assert.equal(m.keyColumn, "Dir", "the filter row and the pager row must not break key detection");
    assert.ok(m.actions.some((a) => a.label === "Delete" && a.type === "delete"));
    assert.equal(m.add, "Add");
    assert.equal(m.paged, true, "a pager made of postback links is pagination");
  } finally { await fa.close(); }
});

test("webforms: reads every record across pager postbacks, with no filter or pager rows among them", async () => {
  const { fa, ta } = await setup();
  try {
    const recs = await ta.list("residents");
    assert.equal(recs.length, 14);
    assert.deepEqual(recs.map((r) => r.key).sort(), site.state.residents.map((r) => r.dir).sort());
  } finally { await fa.close(); }
});

test("webforms: deletes a row on page 2 through its postback link and confirm(), verified against the server", async () => {
  const { fa, w } = await setup();
  try {
    const ask = (await w.apply({ op: "delete", kind: "residents", key: "108" })) as { status: string; plan_id: string };
    assert.equal(ask.status, "awaiting_approval");
    w.approve(ask.plan_id);
    const rc = (await w.commit(ask.plan_id)) as { id: string; status: string };
    assert.equal(rc.status, "done");
    assert.equal(site.state.residents.some((r) => r.dir === "108"), false, "the server really removed it");
    assert.equal(site.state.residents.length, 13);
  } finally { await fa.close(); }
});

test("webforms: undo re-creates it through the Add panel using the right Save button, and keeps its Dir", async () => {
  const { fa, w } = await setup();
  try {
    const ask = (await w.apply({ op: "delete", kind: "residents", key: "103" })) as { plan_id: string };
    w.approve(ask.plan_id);
    const rc = (await w.commit(ask.plan_id)) as { id: string };
    assert.equal(site.state.residents.some((r) => r.dir === "103"), false);
    const u = (await w.undo(rc.id)) as { status: string; verified: { restored: boolean } };
    assert.equal(u.status, "undone", JSON.stringify(u));
    assert.equal(u.verified.restored, true);
    assert.equal(site.state.sends, 0, "undo must press Save, never Send Data");
    assert.ok(site.state.residents.some((r) => r.dir === "103" && r.name === "Halvorsen L"));
  } finally { await fa.close(); }
});

test("webforms: a name is refused with suggestions, and nothing is sent", async () => {
  const { fa, w } = await setup();
  try {
    const p = await w.preview({ op: "delete", kind: "residents", key: "Marlow" });
    assert.ok(isRefusal(p) && p.error === "not_found");
    assert.equal(site.state.sends, 0);
  } finally { await fa.close(); }
});
