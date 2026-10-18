// The zoo: six differently built, deliberately hard sites. Written BEFORE any fix, to see what really happens.
// Each site must: be found, have its records read in full, and survive a delete verified against the app's own state.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { FormAdapter } from "../src/generator/form-adapter.js";
import { TableAdapter } from "../src/generator/tables.js";
import { CompositeAdapter } from "../src/adapters/composite.js";
import { Wicket, isRefusal } from "../src/engine.js";
import { RuleBook } from "../src/rules.js";
import { startZoo, type Zoo } from "./fixtures/zoo.js";

let zoo: Zoo;
before(async () => { zoo = await startZoo(); });
after(async () => { await zoo.close(); });

async function setup(path: string) {
  const fa = new FormAdapter();
  await fa.compile(`${zoo.url}${path}`);
  const ta = new TableAdapter(() => fa.currentPage());
  const models = await ta.attach();
  const w = new Wicket(new CompositeAdapter([ta]), { rules: new RuleBook() });
  return { fa, ta, models, w };
}

async function deleteAndCheck(path: string, kind: string, key: string, gone: () => boolean) {
  const { fa, w } = await setup(path);
  try {
    const ask = await w.apply({ op: "delete", kind, key });
    assert.ok(!isRefusal(ask), `${path}: ${JSON.stringify(ask)}`);
    assert.equal((ask as { status: string }).status, "awaiting_approval");
    w.approve((ask as { plan_id: string }).plan_id);
    const rc = (await w.commit((ask as { plan_id: string }).plan_id)) as { status: string; verified: Record<string, unknown> };
    assert.equal(rc.status, "done", `${path}: ${JSON.stringify(rc)}`);
    assert.equal(gone(), true, `${path}: the app itself still has it`);
  } finally { await fa.close(); }
}

test("spa: an ARIA div grid with no <table>, late data, button pagination, custom modal", async () => {
  const { fa, ta, models } = await setup("/spa");
  try {
    assert.equal(models.length, 1, "the grid is found");
    assert.deepEqual(models[0]!.columns, ["Name", "Email", "Role"]);
    assert.equal(models[0]!.paged, true);
    assert.equal((await ta.list(models[0]!.id)).length, zoo.state.users.length, "all 3 pages are read");
  } finally { await fa.close(); }
});
test("spa: delete a member on page 2 through its icon button and the custom modal", async () => {
  const id = zoo.state.users[5]!.email; // the key is the unique email
  await deleteAndCheck("/spa", "team_members", id, () => !zoo.state.users.some((u) => u.email === id));
});

test("datatable: rows injected late, pager links with no href, search box, page-size select", async () => {
  const { fa, ta, models } = await setup("/datatable");
  try {
    assert.equal(models.length, 1);
    assert.equal(models[0]!.keyColumn, "Order");
    assert.equal(models[0]!.paged, true);
    assert.equal((await ta.list(models[0]!.id)).length, zoo.state.orders.length);
  } finally { await fa.close(); }
});
test("datatable: delete an order on page 2 (confirm dialog)", async () => {
  await deleteAndCheck("/datatable", "orders", "ORD-1008", () => !zoo.state.orders.some((o) => o.id === "ORD-1008"));
});

test("shadow: a grid inside an open shadow root", async () => {
  const { fa, ta, models } = await setup("/shadow");
  try {
    assert.equal(models.length, 1, "the table inside the shadow root is found");
    assert.equal((await ta.list(models[0]!.id)).length, zoo.state.users.length);
  } finally { await fa.close(); }
});
test("shadow: delete through a button inside the shadow root", async () => {
  const email = zoo.state.users[2]!.email;
  await deleteAndCheck("/shadow", "members_shadow", email, () => !zoo.state.users.some((u) => u.email === email));
});

test("frame: a table inside an iframe, with a delete button inside a per-row form", async () => {
  const { fa, ta, models } = await setup("/frame");
  try {
    assert.equal(models.length, 1, "the table in the iframe is found");
    assert.equal((await ta.list(models[0]!.id)).length, zoo.state.nested.length);
  } finally { await fa.close(); }
});
test("frame: delete a row inside the iframe", async () => {
  await deleteAndCheck("/frame", "stock", "K-101", () => !zoo.state.nested.some((n) => n.sku === "K-101"));
});

test("nested: layout tables four deep, with tables inside the data cells", async () => {
  const { fa, ta, models } = await setup("/nested");
  try {
    assert.equal(models.length, 1, "exactly one data table, not the layout tables");
    assert.equal(models[0]!.keyColumn, "SKU");
    assert.equal((await ta.list(models[0]!.id)).length, zoo.state.nested.length, "rows with a nested table in a cell are still records");
  } finally { await fa.close(); }
});
test("nested: delete a row through its link", async () => {
  await deleteAndCheck("/nested", "warehouse", "K-102", () => !zoo.state.nested.some((n) => n.sku === "K-102"));
});

test("infinite: a list that only renders more as you scroll", async () => {
  const { fa, ta, models } = await setup("/infinite");
  try {
    assert.equal(models.length, 1, "the repeated rows are recognized as a list");
    assert.equal((await ta.list(models[0]!.id)).length, zoo.state.items.length, "scrolling loads every row");
  } finally { await fa.close(); }
});
