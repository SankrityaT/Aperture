// Signing in with a stored login. The agent only names the login. The password stays on the server.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { FormAdapter, NoSecret, readSecret } from "../src/generator/form-adapter.js";
import { TableAdapter } from "../src/generator/tables.js";
import { CompositeAdapter } from "../src/adapters/composite.js";
import { Wicket } from "../src/engine.js";
import { RuleBook } from "../src/rules.js";
import { startApps, type TestApps } from "./fixtures/apps.js";

let apps: TestApps;
before(async () => { apps = await startApps(); process.env.WICKET_CREDS_TESTAPP = "admin:s3cret"; process.env.WICKET_CREDS_WRONG = "admin:nope"; });
after(async () => { await apps.close(); });

test("a stored login is read by name only, from the server's own environment", () => {
  assert.deepEqual(readSecret("testapp"), { user: "admin", pass: "s3cret" });
  assert.throws(() => readSecret("nothing_here"), NoSecret);
  assert.throws(() => readSecret("PATH"), NoSecret, "it can only read WICKET_CREDS_* values, never other environment variables");
  assert.throws(() => readSecret("a b; rm"), NoSecret);
});

test("signing in works, the password never appears in anything returned, and a wrong login is reported", async () => {
  const bad = new FormAdapter();
  try {
    const r = await bad.signIn(`${apps.url}/secure/login`, "wrong");
    assert.equal(r.signedIn, false);
    assert.doesNotMatch(JSON.stringify(r), /nope|s3cret/);
  } finally { await bad.close(); }

  const fa = new FormAdapter();
  try {
    const r = await fa.signIn(`${apps.url}/secure/login`, "testapp");
    assert.equal(r.signedIn, true);
    assert.doesNotMatch(JSON.stringify(r), /s3cret/);
    await fa.open(`${apps.url}/secure/items`);
    const summary = await fa.refresh();
    assert.doesNotMatch(JSON.stringify(summary), /s3cret/);
    const ta = new TableAdapter(() => fa.currentPage());
    const models = await ta.attach();
    assert.equal(models.length, 1);
    assert.equal(models[0]!.id, "inventory");
    assert.equal(models[0]!.keyColumn, "Code");
  } finally { await fa.close(); }
});

test("behind a login: a one-click delete link with no confirmation is found, verified, and undone", async () => {
  const fa = new FormAdapter();
  try {
    await fa.signIn(`${apps.url}/secure/login`, "testapp");
    await fa.open(`${apps.url}/secure/items`);
    const ta = new TableAdapter(() => fa.currentPage());
    await ta.attach();
    const w = new Wicket(new CompositeAdapter([ta]), { rules: new RuleBook() });
    const ask = (await w.apply({ op: "delete", kind: "inventory", key: "W2" })) as { status: string; plan_id: string };
    assert.equal(ask.status, "awaiting_approval");
    w.approve(ask.plan_id);
    const rc = (await w.commit(ask.plan_id)) as { id: string; status: string };
    assert.equal(rc.status, "done");
    assert.equal(apps.state.items.some((i) => i.code === "W2"), false);
    const u = (await w.undo(rc.id)) as { verified: { restored: boolean } };
    assert.equal(u.verified.restored, true);
    assert.ok(apps.state.items.some((i) => i.name === "Gadget"));
  } finally { await fa.close(); }
});
