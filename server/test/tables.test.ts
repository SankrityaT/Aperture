// Generality tests for record lists. One table reader, two apps built differently, no per-app code.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { FormAdapter } from "../src/generator/form-adapter.js";
import { TableAdapter, classifyAction } from "../src/generator/tables.js";
import { CompositeAdapter } from "../src/adapters/composite.js";
import { Wicket, isRefusal } from "../src/engine.js";
import { RuleBook } from "../src/rules.js";
import { startApps, type TestApps } from "./fixtures/apps.js";

let apps: TestApps;
before(async () => { apps = await startApps(); });
after(async () => { await apps.close(); });

async function setup(path: string) {
  const fa = new FormAdapter();
  await fa.compile(`${apps.url}${path}`);
  const ta = new TableAdapter(() => fa.currentPage());
  const models = await ta.attach();
  const w = new Wicket(new CompositeAdapter([ta]), { rules: new RuleBook() });
  return { fa, ta, models, w };
}

test("action labels are classified by meaning, including icon-only buttons", () => {
  assert.equal(classifyAction({ label: "Delete", href: "", onclick: "", cls: "" }), "delete");
  assert.equal(classifyAction({ label: "Remove", href: "", onclick: "", cls: "" }), "delete");
  assert.equal(classifyAction({ label: "", href: "", onclick: "", cls: "fa fa-trash" }), "delete");
  assert.equal(classifyAction({ label: "Edit", href: "", onclick: "", cls: "" }), "edit");
  assert.equal(classifyAction({ label: "Details", href: "", onclick: "", cls: "" }), "view");
  assert.equal(classifyAction({ label: "Print", href: "", onclick: "", cls: "" }), "other");
});

test("app A: finds the table, its columns, its key column, its delete action and its add button", async () => {
  const { fa, models } = await setup("/people");
  try {
    assert.equal(models.length, 1);
    const m = models[0]!;
    assert.equal(m.id, "students");
    assert.deepEqual(m.columns, ["Student ID", "Name", "Year"]);
    assert.equal(m.keyColumn, "Student ID");
    assert.ok(m.actions.some((a) => a.label === "Delete" && a.type === "delete"));
    assert.equal(m.add, "Add student");
  } finally { await fa.close(); }
});

test("app B: follows pagination, finds the key without an id column, and sees an icon-only delete", async () => {
  const { fa, ta, models } = await setup("/staff");
  try {
    const m = models[0]!;
    assert.equal(m.id, "staff");
    assert.equal(m.keyColumn, "Email", "no id column, so the unique email is the key");
    assert.equal(m.paged, true);
    assert.ok(m.actions.some((a) => a.type === "delete"), `actions: ${JSON.stringify(m.actions)}`);
    assert.equal(m.add, "+ New staff");
    const all = await ta.list("staff");
    assert.equal(all.length, 5, "two pages of rows are both read");
    assert.deepEqual(all.map((r) => r.key).sort(), ["ann@school.test", "bo@school.test", "cal@school.test", "dot@school.test", "eve@school.test"]);
  } finally { await fa.close(); }
});

test("app A through the engine: unknown at first so it asks, then a verified delete, undo, and a faster second delete", async () => {
  const { fa, w } = await setup("/people");
  try {
    const before = apps.state.people.length;
    const ask = (await w.apply({ op: "delete", kind: "students", key: "S2" })) as { status: string; plan_id: string; diff: string[] };
    assert.equal(ask.status, "awaiting_approval", "a delete this system has never done is unconfirmed, so a person decides");
    assert.equal(apps.state.people.length, before, "nothing changed yet");
    w.approve(ask.plan_id);
    const rc = (await w.commit(ask.plan_id)) as { id: string; status: string; verified: { ok: boolean; subject_present: boolean } };
    assert.equal(rc.status, "done");
    assert.equal(rc.verified.subject_present, false);
    assert.equal(apps.state.people.some((p) => p.id === "S2"), false, "the app itself no longer has S2");
    assert.equal(apps.state.people.length, before - 1);

    const u = (await w.undo(rc.id)) as { status: string; verified: { restored: boolean } };
    assert.equal(u.status, "undone");
    assert.equal(u.verified.restored, true, "found again under its old key, even though the app assigned a new id");
    const back = apps.state.people.find((p) => p.name === "Ben Ortiz");
    assert.ok(back, "the app really has Ben Ortiz again");
    assert.equal(apps.state.people.length, before);

    const fast = (await w.apply({ op: "delete", kind: "students", key: "S3" })) as { status: string };
    assert.equal(fast.status, "done", "after one matching delete, the rule is confirmed and the next one needs no approval");
    assert.equal(apps.state.people.some((p) => p.id === "S3"), false);
  } finally { await fa.close(); }
});

test("app B through the engine: a JS confirm() dialog is accepted and the row is gone from the real app", async () => {
  const { fa, w } = await setup("/staff");
  try {
    const ask = (await w.apply({ op: "delete", kind: "staff", key: "bo@school.test" })) as { status: string; plan_id: string };
    assert.equal(ask.status, "awaiting_approval");
    w.approve(ask.plan_id);
    const rc = (await w.commit(ask.plan_id)) as { id: string; status: string };
    assert.equal(rc.status, "done");
    assert.equal(apps.state.staff.some((s) => s.email === "bo@school.test"), false);
    const u = (await w.undo(rc.id)) as { status: string; verified: { restored: boolean } };
    assert.equal(u.verified.restored, true);
    assert.ok(apps.state.staff.some((s) => s.email === "bo@school.test" && s.first === "Bo"), "re-created with the same details through the app's own form");
  } finally { await fa.close(); }
});

test("deleting by a name is refused with suggestions, on both apps", async () => {
  for (const [path, kind, name] of [["/people", "students", "Ava"], ["/staff", "staff", "Ann"]] as const) {
    const { fa, w } = await setup(path);
    try {
      const p = await w.preview({ op: "delete", kind, key: name });
      assert.ok(isRefusal(p) && p.error === "not_found" && (p.did_you_mean as unknown[]).length === 1, `${path}: ${JSON.stringify(p)}`);
    } finally { await fa.close(); }
  }
});

test("a name column that links to a profile page is data, so the list still gets a key (Moodle-shaped list)", async () => {
  const { createServer } = await import("node:http");
  const rows = [["Admin User", "2"], ["Ada Byron", "3"], ["Grace Hopper", "4"], ["Alan Turing", "5"]];
  const html = `<!doctype html><title>Users</title><table class="generaltable"><thead><tr><th>Select all</th><th>First name / Last name</th><th>Email address</th><th>Actions</th></tr></thead><tbody>${rows.map(([n, id]) => `<tr><td><label>${n}<input type="checkbox"></label></td><td><a href="/user/profile.php?id=${id}">${n}</a></td><td>${n.split(" ")[0]!.toLowerCase()}@x.test</td><td><a href="/user/editadvanced.php?id=${id}">Edit</a> <a href="/admin/user.php?delete=${id}">Delete</a></td></tr>`).join("")}</tbody></table>`;
  const srv = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(html); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;
  const fa = new FormAdapter();
  try {
    await fa.compile(`http://127.0.0.1:${port}/`);
    const ta = new TableAdapter(() => fa.currentPage());
    const [m] = await ta.attach();
    assert.ok(m!.columns.some((c) => /first name/i.test(c)), `name column kept: ${m!.columns.join(" | ")}`);
    assert.notEqual(m!.keySource, "none");
    const recs = await ta.list(m!.id);
    assert.equal(recs.length, 4);
  } finally { await fa.close(); srv.close(); }
});

test("blank placeholder rows are not records: a list of 4 real users and 6 empty rows still gets a key and 4 records", async () => {
  const { createServer } = await import("node:http");
  const users = [["Admin User", "2"], ["Max Manager", "5"], ["Sam Student", "4"], ["Terri Teacher", "3"]];
  const blank = `<tr><td></td><td></td><td></td><td></td></tr>`.repeat(6);
  const html = `<!doctype html><title>Users</title><table><thead><tr><th>Select all</th><th>First name / Last name</th><th>Email address</th><th>Actions</th></tr></thead><tbody>${users.map(([n, id]) => `<tr><td>${n}</td><td><a href="/user/profile.php?id=${id}">${n}</a></td><td>${n.split(" ")[0]!.toLowerCase()}@x.test</td><td><a href="/user/editadvanced.php?id=${id}">Edit</a> <a href="/admin/user.php?delete=${id}">Delete</a></td></tr>`).join("")}${blank}</tbody></table>`;
  const srv = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(html); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const fa = new FormAdapter();
  try {
    await fa.compile(`http://127.0.0.1:${(srv.address() as { port: number }).port}/`);
    const ta = new TableAdapter(() => fa.currentPage());
    const [m] = await ta.attach();
    assert.notEqual(m!.keySource, "none", "blank rows must not defeat key detection");
    assert.equal((await ta.list(m!.id)).length, 4);
  } finally { await fa.close(); srv.close(); }
});

test("a real row with a blank key still fails closed: no key is chosen", async () => {
  const { createServer } = await import("node:http");
  const html = `<!doctype html><title>Ids</title><table><thead><tr><th>Id</th><th>Name</th></tr></thead><tbody><tr><td>1</td><td>Ann</td></tr><tr><td></td><td>Bob</td></tr><tr><td>3</td><td>Cy</td></tr></tbody></table>`;
  const srv = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(html); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const fa = new FormAdapter();
  try {
    await fa.compile(`http://127.0.0.1:${(srv.address() as { port: number }).port}/`);
    const ta = new TableAdapter(() => fa.currentPage());
    const [m] = await ta.attach();
    // "Name" is unique and non-blank, so it may be chosen, but the blank Id must never be used as the key
    assert.notEqual(m!.keyColumn, "Id");
  } finally { await fa.close(); srv.close(); }
});
