// Generality tests: one explorer and one adapter, four differently built pages, no per-page code.
// Needs a Chromium. CHROME_PATH points at one (see package.json script test:gen).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { FormAdapter, NotAuthorized } from "../src/generator/form-adapter.js";
import { Wicket, isRefusal } from "../src/engine.js";
import { RuleBook } from "../src/rules.js";
import { startSite, type TestSite } from "./fixtures/site.js";

let site: TestSite;
before(async () => { site = await startSite(); });
after(async () => { await site.close(); });

function engineFor(fa: FormAdapter) {
  const rules = new RuleBook();
  for (const id of fa.formIds()) rules.set(id, "update", [], true); // field edits are reversible drafts
  return new Wicket(fa, { rules });
}

test("explores a label-for page: types, requirements, options, limits, and skips hidden fields", async () => {
  const fa = new FormAdapter();
  try {
    const s = await fa.compile(`${site.url}/signup`);
    assert.equal(s.forms.length, 1);
    const f = s.forms[0]!;
    const by = Object.fromEntries(f.fields.map((x) => [x.name, x]));
    assert.equal(by.username!.label, "Username");
    assert.equal(by.username!.required, true);
    assert.equal(by.email!.type, "email");
    assert.equal(by.age!.type, "number");
    assert.match(by.age!.hint ?? "", /16\.\.19/);
    assert.equal(by.grade!.type, "select");
    assert.ok(by.grade!.options!.some((o) => o.startsWith("10")));
    assert.equal(by.house!.type, "radio");
    assert.equal(by.house!.label, "House");
    assert.equal(by.consent!.type, "checkbox");
    assert.equal(by.consent!.required, true);
    assert.equal(by.dob!.type, "date");
    assert.match(by.notes!.hint ?? "", /max 40/);
    assert.match(by.studentid!.hint ?? "", /read-only/);
    assert.equal(by.csrf, undefined, "hidden fields are not offered to the agent");
    assert.equal(f.submit, "Create account");
  } finally { await fa.close(); }
});

test("explores a table-layout page where labels are in the previous cell", async () => {
  const fa = new FormAdapter();
  try {
    const f = (await fa.compile(`${site.url}/address`)).forms[0]!;
    const by = Object.fromEntries(f.fields.map((x) => [x.name, x]));
    assert.equal(by.street!.label, "Street");
    assert.equal(by.zip!.label, "Postcode");
    assert.equal(by.zip!.required, true);
    assert.match(by.zip!.hint ?? "", /format/);
    assert.deepEqual(by.country!.options!.map((o) => o.split(" ")[0]), ["uk", "us"], "the disabled placeholder option is skipped");
    assert.equal(by.delivery!.type, "radio");
    assert.equal(f.submit, "Save address");
  } finally { await fa.close(); }
});

test("explores a page with two forms that have only aria-labels", async () => {
  const fa = new FormAdapter();
  try {
    const s = await fa.compile(`${site.url}/survey`);
    assert.equal(s.forms.length, 2);
    const names = s.forms.map((f) => f.id);
    assert.equal(new Set(names).size, 2, "ids are unique");
    const email = s.forms[0]!.fields.find((x) => x.name === "email")!;
    assert.equal(email.label, "Your email");
    const rating = s.forms[1]!.fields.find((x) => x.name === "rating")!;
    assert.match(rating.label, /Rating/);
  } finally { await fa.close(); }
});

test("a CAPTCHA is reported as a human step, never worked around", async () => {
  const fa = new FormAdapter();
  try {
    const s = await fa.compile(`${site.url}/captcha`);
    assert.ok(s.warnings.some((w) => /CAPTCHA/i.test(w) && /person/.test(w)));
  } finally { await fa.close(); }
});

test("only authorized hosts can be compiled", async () => {
  const fa = new FormAdapter();
  await assert.rejects(() => fa.compile("https://travel.state.gov/"), NotAuthorized);
  await assert.rejects(() => fa.compile("file:///etc/passwd"), NotAuthorized);
  await fa.close();
});

test("bad values are refused with reasons before anything is typed", async () => {
  const fa = new FormAdapter();
  try {
    await fa.compile(`${site.url}/signup`);
    const w = engineFor(fa);
    const r = await w.preview({ op: "update", kind: "signup", key: "current", patch: { age: 30, grade: "Z", email: "nope", notes: "x".repeat(50), studentid: "hack" } });
    assert.ok(isRefusal(r) && r.error === "invalid_value");
    if (isRefusal(r)) {
      const p = (r.problems as string[]).join(" | ");
      assert.match(p, /age must be at most 19/);
      assert.match(p, /grade must be one of/);
      assert.match(p, /email must be an email/);
      assert.match(p, /longer than 40/);
      assert.match(p, /studentid is read-only/);
    }
    const unknown = await w.preview({ op: "update", kind: "signup", key: "current", patch: { favourite_colour: "red" } });
    assert.ok(isRefusal(unknown) && unknown.error === "unknown_field" && Array.isArray(unknown.valid_fields));
  } finally { await fa.close(); }
});

test("fill, read back, undo, then submit only with the owner's approval", async () => {
  const fa = new FormAdapter();
  try {
    await fa.compile(`${site.url}/signup`);
    const w = engineFor(fa);
    const patch = { username: "riley", email: "riley@example.com", age: 17, grade: "Year 10", house: "blue", consent: true, notes: "hello", dob: "2009-04-02" };

    const filled = (await w.apply({ op: "update", kind: "signup", key: "current", patch })) as { status: string; receipt: string; verified: { fields_match: boolean; ok: boolean } };
    assert.equal(filled.status, "done");
    assert.equal(filled.verified.fields_match, true);
    const now = (await fa.read("signup", "current"))!;
    assert.equal(now.username, "riley");
    assert.equal(now.grade, "10", "a label was accepted and normalized to the option value");
    assert.equal(now.house, "blue");
    assert.equal(now.consent, true);
    assert.equal(site.submissions.length, 0, "nothing was submitted by filling");

    const undone = (await w.undo(filled.receipt)) as { status: string; verified: { restored: boolean } };
    assert.equal(undone.status, "undone");
    assert.equal(undone.verified.restored, true);
    assert.equal((await fa.read("signup", "current"))!.username, "");

    await w.apply({ op: "update", kind: "signup", key: "current", patch });
    const ask = (await w.apply({ op: "publish" })) as { status: string; plan_id: string; diff: string[] };
    assert.equal(ask.status, "awaiting_approval");
    assert.ok(ask.diff.some((l) => l.includes("submit signup")));
    assert.equal(site.submissions.length, 0, "still not submitted: the owner has not approved");
    w.approve(ask.plan_id);
    const sent = (await w.commit(ask.plan_id)) as { status: string };
    assert.equal(sent.status, "done");
    assert.equal(site.submissions.length, 1);
    const got = site.submissions[0]!.body;
    assert.equal(got.username, "riley");
    assert.equal(got.grade, "10");
    assert.equal(got.house, "blue");
    assert.equal(got.csrf, "abc123", "hidden fields are carried through untouched");
    const result = await fa.read("result", "latest");
    assert.match(String(result?.text), /Thanks, received/);
  } finally { await fa.close(); }
});

test("the same code fills the table-layout page and the two-form page", async () => {
  const fa = new FormAdapter();
  try {
    await fa.compile(`${site.url}/address`);
    const w = engineFor(fa);
    const id = fa.formIds()[0]!;
    const r = (await w.apply({ op: "update", kind: id, key: "current", patch: { street: "1 High St", city: "Leeds", zip: "LS12", country: "United Kingdom", delivery: "exp" } })) as { status: string; verified: { fields_match: boolean } };
    assert.equal(r.status, "done");
    assert.equal(r.verified.fields_match, true);
    const bad = await w.preview({ op: "update", kind: id, key: "current", patch: { zip: "12" } });
    assert.ok(isRefusal(bad) && /format/.test(String(bad.detail)));
  } finally { await fa.close(); }
});
