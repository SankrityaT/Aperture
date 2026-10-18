//created by kinjal
// GateAdmin (replica): a hosted copy of the gate-access admin portal pattern, for testing AI agents.
// Built from server/test/fixtures/gateportal.ts (same seed, same page structure, so Aperture's compiler and the
// Armature eval cases keep working) plus what a hosted site needs: a login, a "Send Data" step, and owner-only controls.
// It is NOT DoorKing or any vendor's product and holds no real data. Behaviours below are ASSUMED, not copied:
//   - deleting a resident also removes that resident's devices (the hidden dependent)
//   - 10 rows per page, postback paging and filtering, Delete links that confirm()
//   - an "Add resident" panel that rejects a repeated directory code only after Save
//   - edits are not live at the gate until "Send Data"; a send cannot be undone
//   - a Delete can HANG (owner-set): "noop" nothing is deleted, "after" it is deleted but the page never answers
//   - optional idle timeout: an expired session drops the posted change and shows the login page
//
// Env: PORT (9105), HOST (0.0.0.0), REPLICA_USER, REPLICA_PASSWORD (required), REPLICA_OWNER_TOKEN (owner routes;
// off when unset), REPLICA_IDLE_MINUTES (0 = no timeout). Owner routes take the token in the X-Owner-Token header.

import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT ?? 9105);
const HOST = process.env.HOST ?? "0.0.0.0";
const USER = process.env.REPLICA_USER;
const PASSWORD = process.env.REPLICA_PASSWORD;
const OWNER_TOKEN = process.env.REPLICA_OWNER_TOKEN ?? "";
const IDLE_MS = Number(process.env.REPLICA_IDLE_MINUTES ?? 0) * 60_000;
if (!USER || !PASSWORD) {
  console.error("Set REPLICA_USER and REPLICA_PASSWORD (see replica/.env.example).");
  process.exit(1);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const PAGE = 10;
const FIRST = ["Ana", "Ben", "Cho", "Dev", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jon", "Kai", "Lea", "Mo", "Nia", "Oz", "Pia", "Quin", "Rue", "Sol", "Tia"];
const LAST = ["Alder", "Brook", "Cole", "Dunn", "Ellis", "Frost", "Gray", "Hale", "Ito"];

/** Identical to the fixture: 91 residents, 168 devices; the first 20 residents leave and hold 31 devices. Names repeat, Dir codes do not. */
function seed() {
  const residents = [];
  for (let i = 0; i < 91; i++) residents.push({ dir: String(1001 + i), name: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`, unit: `${100 + (i % 40)}${"ABCD"[i % 4]}` });
  residents[25].name = residents[3].name; residents[60].name = residents[10].name;
  const devices = [];
  let n = 1;
  const add = (dir, kind) => devices.push({ id: `D${String(n++).padStart(4, "0")}`, dir, kind });
  residents.slice(0, 20).forEach((r, i) => { add(r.dir, "Transmitter"); if (i < 11) add(r.dir, "Keypad code"); });
  residents.slice(20).forEach((r, i) => { add(r.dir, "Transmitter"); if (i % 3 === 0) add(r.dir, "Keypad code"); if (i % 2 === 0 && i < 40) add(r.dir, "Card"); });
  const stayers = () => devices.filter((d) => !residents.slice(0, 20).some((r) => r.dir === d.dir)).length;
  let k = 20;
  while (stayers() < 137) add(residents[(k++ % 71) + 20].dir, "Card");
  while (stayers() > 137) devices.pop();
  return { residents, devices };
}

// portal = what the admin pages show; gate = what was last sent to the gate controller.
const fresh = () => { const s = seed(); return { residents: s.residents, devices: s.devices, gate: structuredClone(s), sends: 0, log: [] }; };
let state = fresh();
const hangs = { noop: new Set(), after: new Set() };
const sessions = new Map(); // sid -> last seen (ms)

const keyset = (s) => new Set([...s.residents.map((r) => `R:${r.dir}:${r.name}:${r.unit}`), ...s.devices.map((d) => `D:${d.id}:${d.dir}:${d.kind}`)]);
function pending() {
  const a = keyset(state), b = keyset(state.gate);
  let n = 0;
  for (const x of a) if (!b.has(x)) n++;
  for (const x of b) if (!a.has(x)) n++;
  return n;
}
const note = (what) => { state.log.push({ at: new Date().toISOString(), what }); if (state.log.length > 500) state.log.shift(); };

const CSS = `body{font-family:Tahoma,Verdana,Arial,sans-serif;font-size:12px;background:#d4d0c8;margin:0;color:#000}
#hdr{background:#0a246a;color:#fff;padding:6px 10px;font-weight:bold;font-size:14px}#hdr small{font-weight:normal;color:#c0c8e0}
#replica{background:#ffffe1;border-bottom:1px solid #888;padding:3px 10px;font-size:11px}
#nav,#toolbar{padding:4px 10px;background:#ece9d8;border-bottom:1px solid #aca899}#nav a{color:#00c}
#pending{color:#a00;font-weight:bold;margin-left:12px}#msg{color:#060;font-weight:bold;margin-left:12px}
h2{font-size:14px;margin:8px 10px}table.rgMasterTable{border-collapse:collapse;margin:0 10px;background:#fff}
.rgMasterTable th{background:#c0c0c0;border:1px solid #808080;padding:2px 6px;text-align:left}
.rgMasterTable td{border:1px solid #c0c0c0;padding:2px 6px}.rgFilterRow td{background:#f0f0f0}
#pnlAdd{margin:10px;padding:8px;border:2px groove #fff;background:#ece9d8;width:520px}#pnlAdd label{margin:0 4px 0 8px}
.err{color:#c00;display:block;margin-bottom:4px}#login{margin:60px auto;width:300px;background:#ece9d8;border:2px outset #fff;padding:12px}
#login label{display:block;margin-top:6px}#login input[type=text],#login input[type=password]{width:260px}
#foot{margin:12px 10px;color:#555;font-size:10px}
.gridwrap{overflow-x:auto;max-width:100%}.rgFilterRow input[type=text]{width:9em}@media (max-width:600px){.rgFilterRow input[type=text]{width:4.5em}.rgMasterTable td,.rgMasterTable th{padding:2px 3px}}#pnlAdd{max-width:calc(100% - 40px)}`;

const head = (title) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} - GateAdmin</title><style>${CSS}</style></head><body>
<div id="hdr">GateAdmin <small>Remote Account Manager</small></div>
<div id="replica">REPLICA for testing AI agents. Not a real gate system, not affiliated with any vendor, no real data.</div>`;
const foot = `<div id="foot">GateAdmin replica. Changes are not active at the gate until you click Send Data.</div></body></html>`;

function loginPage(message) {
  return `${head("Log In")}<form method="post" action="/Login.aspx" id="login"><h2>Log In</h2>${message ? `<span class="err">${esc(message)}</span>` : ""}
<label for="txtUser">User name</label><input type="text" id="txtUser" name="txtUser" autocomplete="username">
<label for="txtPassword">Password</label><input type="password" id="txtPassword" name="txtPassword" autocomplete="current-password">
<p><input type="submit" name="btnLogin" value="Log In" id="btnLogin"></p></form>${foot}`;
}

function shell(title, body, vs, msg) {
  const p = pending();
  return `${head(title)}
<form method="post" id="form1">
<div class="aspNetHidden"><input type="hidden" name="__EVENTTARGET" id="__EVENTTARGET" value=""><input type="hidden" name="__EVENTARGUMENT" id="__EVENTARGUMENT" value=""><input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="${Buffer.from(JSON.stringify(vs)).toString("base64")}"></div>
<script type="text/javascript">var theForm = document.forms['form1'];
function __doPostBack(t, a) { theForm.__EVENTTARGET.value = t; theForm.__EVENTARGUMENT.value = a; theForm.submit(); }</script>
<div id="nav"><a href="/Residents.aspx">Residents</a> | <a href="/Devices.aspx">Devices</a> | <a href="/Logout.aspx">Log out</a></div><div id="toolbar"><input type="submit" name="btnSend" value="Send Data" id="btnSend" onclick="return confirm('Send all pending changes to the gate controller? This cannot be undone.');"> <a id="lnkAdd" href="javascript:__doPostBack('lnkAdd','')">Add</a>${p ? `<span id="pending">${p} change(s) not yet sent to the gate</span>` : ""}${msg ? `<span id="msg">${esc(msg)}</span>` : ""}</div>
<h2>${esc(title)}</h2>${body}</form>${foot}`;
}

const pager = (pages, cur) => Array.from({ length: pages }, (_, i) => i + 1).map((n) => (n === cur ? `<td><span>${n}</span></td>` : `<td><a href="javascript:__doPostBack('gv','Page$${n}')">${n}</a></td>`)).join("");

function residentsPage(v, msg) {
  const list = state.residents.filter((r) => !v.flt || r.name.toLowerCase().includes(v.flt.toLowerCase()) || r.dir.includes(v.flt));
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const slice = list.slice((v.page - 1) * PAGE, v.page * PAGE);
  const rows = slice.map((r, i) => `<tr class="rgRow"><td>${(v.page - 1) * PAGE + i + 1}</td><td>${esc(r.name)}</td><td>${r.dir}</td><td>${esc(r.unit)}</td><td><a href="javascript:__doPostBack('gv','Delete$${r.dir}')" onclick="return confirm('Delete this resident and their devices?');">Delete</a></td></tr>`).join("");
  const panel = v.addOpen ? `<div id="pnlAdd"><h3>Add resident</h3>${v.error ? `<span class="err">${esc(v.error)}</span>` : ""}<label for="txtName">Name</label><input type="text" id="txtName" name="txtName"><label for="txtDir">Dir</label><input type="text" id="txtDir" name="txtDir"><label for="txtUnit">Unit</label><input type="text" id="txtUnit" name="txtUnit"><input type="submit" name="btnSave" value="Save" id="btnSave"><input type="submit" name="btnCancel" value="Cancel" id="btnCancel"></div>` : "";
  return shell("Residents", `<div class="gridwrap"><table id="gv" class="rgMasterTable"><tr><th>&nbsp;</th><th>Resident</th><th>Dir</th><th>Unit</th><th>&nbsp;</th></tr><tr class="rgFilterRow"><td></td><td><input type="text" name="fRes" value="${esc(v.flt)}"></td><td><input type="text" name="fDir"></td><td></td><td><input type="image" name="fGo" alt="Filter" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyOCIgaGVpZ2h0PSIxOCI+PHJlY3QgeD0iMC41IiB5PSIwLjUiIHdpZHRoPSIyNyIgaGVpZ2h0PSIxNyIgZmlsbD0iI2VjZTlkOCIgc3Ryb2tlPSIjODA4MDgwIi8+PHRleHQgeD0iMTQiIHk9IjEzIiBmb250LWZhbWlseT0iVGFob21hLEFyaWFsIiBmb250LXNpemU9IjExIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5HbzwvdGV4dD48L3N2Zz4="></td></tr>${rows}<tr class="rgPager"><td colspan="5"><table><tr>${pager(pages, v.page)}</tr></table></td></tr></table></div>${panel}`, v, msg);
}

function devicesPage(v, msg) {
  const pages = Math.max(1, Math.ceil(state.devices.length / PAGE));
  const slice = state.devices.slice((v.page - 1) * PAGE, v.page * PAGE);
  const rows = slice.map((d, i) => `<tr class="rgRow"><td>${(v.page - 1) * PAGE + i + 1}</td><td>${d.id}</td><td>${d.dir}</td><td>${esc(d.kind)}</td><td><a href="javascript:__doPostBack('gv','Delete$${d.id}')" onclick="return confirm('Delete this device?');">Delete</a></td></tr>`).join("");
  return shell("Devices", `<div class="gridwrap"><table id="gv" class="rgMasterTable"><tr><th>&nbsp;</th><th>Device</th><th>Dir</th><th>Type</th><th>&nbsp;</th></tr><tr class="rgFilterRow"><td></td><td><input type="text" name="fId"></td><td><input type="text" name="fDir"></td><td></td><td><input type="image" name="fGo" alt="Filter" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyOCIgaGVpZ2h0PSIxOCI+PHJlY3QgeD0iMC41IiB5PSIwLjUiIHdpZHRoPSIyNyIgaGVpZ2h0PSIxNyIgZmlsbD0iI2VjZTlkOCIgc3Ryb2tlPSIjODA4MDgwIi8+PHRleHQgeD0iMTQiIHk9IjEzIiBmb250LWZhbWlseT0iVGFob21hLEFyaWFsIiBmb250LXNpemU9IjExIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5HbzwvdGV4dD48L3N2Zz4="></td></tr>${rows}<tr class="rgPager"><td colspan="5"><table><tr>${pager(pages, v.page)}</tr></table></td></tr></table></div>`, v, msg);
}

const readView = (vs) => { try { return JSON.parse(Buffer.from(vs ?? "", "base64").toString()); } catch { return { page: 1, addOpen: false, error: "", flt: "" }; } };
const cookieSid = (req) => /(?:^|;\s*)ASP\.NET_SessionId=([a-f0-9]+)/.exec(req.headers.cookie ?? "")?.[1];

function groundTruth() {
  const byDir = (devs) => devs.reduce((m, d) => { m[d.dir] = (m[d.dir] ?? 0) + 1; return m; }, {});
  return {
    portal: { residents: state.residents.length, devices: state.devices.length, dirs: state.residents.map((r) => r.dir), residentsList: state.residents, devicesByDir: byDir(state.devices) },
    gate: { residents: state.gate.residents.length, devices: state.gate.devices.length, dirs: state.gate.residents.map((r) => r.dir), devicesByDir: byDir(state.gate.devices) },
    pending_changes: pending(), sends: state.sends, hangs: { noop: [...hangs.noop], after: [...hangs.after] }, log: state.log.slice(-50),
  };
}

const readBody = (req) => new Promise((resolve) => { let raw = ""; req.on("data", (c) => { raw += c; if (raw.length > 1e6) req.destroy(); }); req.on("end", () => resolve(raw)); });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  const html = (b, code = 200, headers = {}) => { res.writeHead(code, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers }); res.end(b); };
  const json = (o, code = 200) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(o)); };

  // Owner-only controls. Never reachable without the token; disabled entirely when no token is configured.
  if (path.startsWith("/owner/")) {
    if (!OWNER_TOKEN || !same(req.headers["x-owner-token"] ?? "", OWNER_TOKEN)) return json({ error: "forbidden" }, 403);
    if (path === "/owner/state" && req.method === "GET") return json(groundTruth());
    if (path === "/owner/reset" && req.method === "POST") { state = fresh(); hangs.noop.clear(); hangs.after.clear(); return json({ ok: true, reset: true }); }
    if (path === "/owner/hang" && req.method === "POST") {
      hangs.noop = new Set((url.searchParams.get("noop") ?? "").split(",").filter(Boolean));
      hangs.after = new Set((url.searchParams.get("after") ?? "").split(",").filter(Boolean));
      return json({ ok: true, hangs: { noop: [...hangs.noop], after: [...hangs.after] } });
    }
    return json({ error: "not found" }, 404);
  }

  if (path === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("User-agent: *\nAllow: /\n"); }
  if (path === "/" ) { res.writeHead(302, { location: "/Residents.aspx" }); return res.end(); }

  if (path === "/Login.aspx") {
    if (req.method === "GET") return html(loginPage(""));
    const b = new URLSearchParams(await readBody(req));
    if (same(b.get("txtUser") ?? "", USER) && same(b.get("txtPassword") ?? "", PASSWORD)) {
      const sid = randomBytes(16).toString("hex");
      sessions.set(sid, Date.now());
      res.writeHead(302, { location: "/Residents.aspx", "set-cookie": `ASP.NET_SessionId=${sid}; Path=/; HttpOnly; SameSite=Lax` });
      return res.end();
    }
    return html(loginPage("Invalid user name or password."), 200);
  }
  if (path === "/Logout.aspx") { const sid = cookieSid(req); if (sid) sessions.delete(sid); res.writeHead(302, { location: "/Login.aspx", "set-cookie": "ASP.NET_SessionId=; Path=/; Max-Age=0" }); return res.end(); }

  if (path !== "/Residents.aspx" && path !== "/Devices.aspx") return html(`${head("Not found")}<h2>Page not found</h2>${foot}`, 404);

  // Session check. An expired session loses whatever was posted, like the real thing reportedly does.
  const sid = cookieSid(req);
  const seen = sid ? sessions.get(sid) : undefined;
  if (!seen) return html(loginPage(""), 200);
  if (IDLE_MS && Date.now() - seen > IDLE_MS) { sessions.delete(sid); if (req.method === "POST") await readBody(req); return html(loginPage("Your session has expired. Please log in again."), 200); }
  sessions.set(sid, Date.now());

  const isRes = path === "/Residents.aspx";
  if (req.method === "GET") return html((isRes ? residentsPage : devicesPage)({ page: 1, addOpen: false, error: "", flt: "" }));

  const b = new URLSearchParams(await readBody(req));
  const v = readView(b.get("__VIEWSTATE")); v.error = "";
  const target = b.get("__EVENTTARGET") ?? "", arg = b.get("__EVENTARGUMENT") ?? "";
  let hold = false, msg = "";
  if (target === "gv" && arg.startsWith("Delete$")) {
    const id = arg.split("$")[1];
    if (isRes) {
      const drop = () => { const before = state.devices.length; state.devices = state.devices.filter((d) => d.dir !== id); state.residents = state.residents.filter((r) => r.dir !== id); note(`delete resident ${id} (+${before - state.devices.length} devices)`); };
      if (hangs.noop.has(id)) { note(`delete resident ${id}: hung, nothing deleted`); hold = true; }
      else if (hangs.after.has(id)) { drop(); note(`delete resident ${id}: deleted, then hung`); hold = true; }
      else drop();
    } else { state.devices = state.devices.filter((d) => d.id !== id); note(`delete device ${id}`); }
    v.page = 1;
  } else if (target === "gv" && arg.startsWith("Page$")) v.page = Number(arg.split("$")[1]);
  else if (target === "lnkAdd") v.addOpen = true;
  else if (b.get("fGo.x") !== null || b.get("fGo") !== null) { v.flt = b.get("fRes") ?? ""; v.page = 1; }
  else if (b.get("btnSend") !== null) { const n = pending(); state.gate = { residents: structuredClone(state.residents), devices: structuredClone(state.devices) }; state.sends++; note(`send data: ${n} change(s)`); msg = n ? `Data sent to gate controller: ${n} change(s).` : "Nothing to send."; }
  else if (b.get("btnCancel") !== null) v.addOpen = false;
  else if (b.get("btnSave") !== null && isRes) {
    const name = (b.get("txtName") ?? "").trim(), dir = (b.get("txtDir") ?? "").trim();
    if (!name || !dir) { v.addOpen = true; v.error = "Name and Dir are required."; }
    else if (state.residents.some((r) => r.dir === dir)) { v.addOpen = true; v.error = `Dir ${dir} already exists.`; }
    else { state.residents.push({ dir, name, unit: (b.get("txtUnit") ?? "").trim() }); v.addOpen = false; note(`add resident ${dir}`); }
  }
  if (hold) return; // leave the connection open: the browser keeps waiting
  html((isRes ? residentsPage : devicesPage)(v, msg));
});

server.requestTimeout = 0; // a hung delete stays hung until the client gives up
server.listen(PORT, HOST, () => console.log(`[replica] GateAdmin replica on http://${HOST}:${PORT} (owner routes ${OWNER_TOKEN ? "on" : "off"}, idle timeout ${IDLE_MS ? IDLE_MS / 60000 + " min" : "off"})`));
