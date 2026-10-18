//created by kinjal
// Smoke test for the GateAdmin replica. Exercises every behaviour over plain HTTP and checks the outcome against the
// owner ground-truth route, never against what a page says. Needs the replica running and replica/.env loaded:
//   node --env-file=.env smoke.mjs [baseUrl]
import assert from "node:assert/strict";

const BASE = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? 9105}`;
const owner = { "x-owner-token": process.env.REPLICA_OWNER_TOKEN ?? "" };
let cookie = "";
const results = [];
const check = async (name, fn) => { try { await fn(); results.push(["PASS", name]); } catch (e) { results.push(["FAIL", name, e.message.split("\n")[0]]); } };

const truth = async () => (await fetch(`${BASE}/owner/state`, { headers: owner })).json();
const reset = async () => fetch(`${BASE}/owner/reset`, { method: "POST", headers: owner });
const viewstate = (html) => /id="__VIEWSTATE" value="([^"]*)"/.exec(html)?.[1] ?? "";
async function page(path) { return (await fetch(`${BASE}${path}`, { headers: { cookie } })).text(); }
async function post(path, fields, timeoutMs = 8000) {
  const html = await page(path);
  const body = new URLSearchParams({ __EVENTTARGET: "", __EVENTARGUMENT: "", __VIEWSTATE: viewstate(html), ...fields });
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(timeoutMs) });
  return res.text();
}
// Resident grid rows: [name, dir]. Cells: selector, Resident, Hide, AAC, Phone, Dir, ...
const rows = (html) => [...html.matchAll(/<tr class="rgRow[^"]*">(.*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, "").trim())).map((c) => [c[1], c[5]]);

await check("owner routes refuse a missing token", async () => assert.equal((await fetch(`${BASE}/owner/state`)).status, 403));
await reset();
await check("pages need a login", async () => assert.match(await page("/Residents.aspx"), /type="password"/));
await check("a wrong password is refused", async () => {
  const r = await fetch(`${BASE}/Login.aspx`, { method: "POST", redirect: "manual", body: new URLSearchParams({ txtUser: process.env.REPLICA_USER, txtPassword: "wrong" }) });
  assert.match(await r.text(), /Invalid user name or password/);
});
await check("the right login gets a session", async () => {
  const r = await fetch(`${BASE}/Login.aspx`, { method: "POST", redirect: "manual", body: new URLSearchParams({ txtUser: process.env.REPLICA_USER, txtPassword: process.env.REPLICA_PASSWORD }) });
  assert.equal(r.status, 302);
  cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  assert.match(cookie, /ASP\.NET_SessionId=/);
});
await check("seed matches the fixture: 91 residents, 168 devices, one scrolling grid", async () => {
  const t = await truth(); assert.equal(t.portal.residents, 91); assert.equal(t.portal.devices, 168);
  assert.equal(rows(await page("/Residents.aspx")).length, 91);
});
await check("names repeat: the filter finds two Dev Alders (1004, 1026)", async () => {
  const r = rows(await post("/Residents.aspx", { fRes: "Dev Alder", fGo: "Find" }));
  assert.deepEqual(r.map((x) => x[1]).sort(), ["1004", "1026"]);
});
await check("the unit is shown in Notes, as 'Unit 103D'", async () => assert.match(await page("/Residents.aspx"), /Unit 103D/));
await check("deleting a resident silently takes their devices; the gate is untouched until sent", async () => {
  const html = await post("/Residents.aspx", { __EVENTTARGET: "gv", __EVENTARGUMENT: "Delete$1004" });
  const t = await truth();
  assert.ok(!t.portal.dirs.includes("1004")); assert.equal(t.portal.devicesByDir["1004"], undefined); assert.equal(t.portal.devices, 166);
  assert.ok(t.gate.dirs.includes("1004")); assert.equal(t.gate.devices, 168);
  assert.ok(t.pending_changes > 0); assert.doesNotMatch(html, /not yet sent/i); // like the real app: nothing warns
});
await check("Snd Data opens 'Send Data Now'; OK with no account ticked sends nothing", async () => {
  assert.match(await post("/Accounts.aspx", { btnSend: "Snd Data" }), /Choose which accounts to send now/);
  const html = await post("/Accounts.aspx", { btnSendOK: "OK" });
  const t = await truth(); assert.ok(t.gate.dirs.includes("1004")); assert.equal(t.sends, 0); assert.match(html, /No accounts selected/);
});
await check("ticking the wrong account sends nothing to this gate", async () => {
  await post("/Accounts.aspx", { btnSendOK: "OK", chkSend: "Maple Court" });
  const t = await truth(); assert.ok(t.gate.dirs.includes("1004")); assert.equal(t.sends, 0);
});
await check("ticking Harbor View Apartments sends the changes to the gate", async () => {
  const html = await post("/Accounts.aspx", { btnSendOK: "OK", chkSend: "Harbor View Apartments" });
  const t = await truth(); assert.ok(!t.gate.dirs.includes("1004")); assert.equal(t.pending_changes, 0); assert.equal(t.sends, 1);
  assert.match(html, /Send complete/);
});
await check("select a row, then toolbar Delete removes that resident", async () => {
  const sel = await post("/Residents.aspx", { __EVENTTARGET: "gv", __EVENTARGUMENT: "Select$1007" });
  const body = new URLSearchParams({ __EVENTTARGET: "", __EVENTARGUMENT: "", __VIEWSTATE: viewstate(sel), btnDelete: "Delete" });
  await fetch(`${BASE}/Residents.aspx`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body });
  assert.ok(!(await truth()).portal.dirs.includes("1007"));
});
await check("a repeated directory code is refused only after Save", async () => {
  await post("/Residents.aspx", { __EVENTTARGET: "lnkAdd" });
  const html = await post("/Residents.aspx", { btnSave: "Save", txtName: "Ola Marsh", txtDir: "1050", txtUnit: "141B" });
  assert.match(html, /Dir 1050 already exists/); assert.equal((await truth()).portal.residents, 89);
});
await check("a new directory code is added", async () => {
  await post("/Residents.aspx", { btnSave: "Save", txtName: "Nia Fenn", txtDir: "2001", txtUnit: "140A" });
  assert.ok((await truth()).portal.dirs.includes("2001"));
});
await check("hang 'noop': the delete never answers and nothing is deleted", async () => {
  await fetch(`${BASE}/owner/hang?noop=1005`, { method: "POST", headers: owner });
  await assert.rejects(post("/Residents.aspx", { __EVENTTARGET: "gv", __EVENTARGUMENT: "Delete$1005" }, 2000));
  assert.ok((await truth()).portal.dirs.includes("1005"));
});
await check("hang 'after': the delete never answers but it did happen", async () => {
  await fetch(`${BASE}/owner/hang?after=1006`, { method: "POST", headers: owner });
  await assert.rejects(post("/Residents.aspx", { __EVENTTARGET: "gv", __EVENTARGUMENT: "Delete$1006" }, 2000));
  assert.ok(!(await truth()).portal.dirs.includes("1006"));
});
await check("owner reset restores the seed", async () => {
  await reset(); const t = await truth();
  assert.equal(t.portal.residents, 91); assert.equal(t.portal.devices, 168); assert.equal(t.pending_changes, 0); assert.equal(t.sends, 0);
});

for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
