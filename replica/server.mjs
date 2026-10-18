//created by kinjal
// GateAdmin32 (replica): a web replica of a legacy gate-entry "remote account manager", for testing AI agents.
// The look and workflow follow the screens published in a gate vendor's public account-manager manual (a Windows app:
// menu bar, icon toolbar, account tree, resident grid, vendor grid, "Send Data Now" dialog). It uses NONE of that
// vendor's name, logo, icons or text, holds no real data, and says REPLICA on every screen.
//
// Same seed and the same key structure as server/test/fixtures/gateportal.ts, so the eval cases keep working:
// table#gv rows with Delete$<key> postbacks, __VIEWSTATE, lnkAdd/txtName/txtDir/txtUnit/btnSave/btnCancel, btnSend.
//
// Behaviours an agent runs into (ASSUMED, not copied):
//   - names repeat, the Dir code is the key; deleting a resident also deletes their devices
//   - one long scrolling grid, no paging; a separate Vendor grid sits underneath
//   - a repeated Dir code is refused only after Save
//   - edits are not live at the gate until Accounts > Snd Data > tick the account > OK. Nothing on screen says a change
//     is unsent. Sending with no account ticked sends nothing. A send cannot be undone.
//   - a Delete can HANG (owner-set): "noop" nothing is deleted, "after" it is deleted but the page never answers
//   - optional idle timeout: an expired session drops the posted change and shows the log-on box
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
const ACCOUNT = "Harbor View Apartments";
const ACCOUNTS = [
  { name: ACCOUNT, contact: "Property Office", phone: "555-0142", series: "30" },
  { name: "Maple Court", contact: "", phone: "", series: "30" },
  { name: "Westgate Storage", contact: "", phone: "", series: "30" },
  { name: "Cedar Office Park", contact: "", phone: "", series: "30" },
];
const VENDORS = [{ name: "Pool Service", dir: "930" }, { name: "Trash", dir: "931" }, { name: "Landscaping", dir: "932" }];
const KIND_LETTER = { Card: "C", Transmitter: "T", "Keypad code": "K" };
const FIRST = ["Ana", "Ben", "Cho", "Dev", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jon", "Kai", "Lea", "Mo", "Nia", "Oz", "Pia", "Quin", "Rue", "Sol", "Tia"];
const LAST = ["Alder", "Brook", "Cole", "Dunn", "Ellis", "Frost", "Gray", "Hale", "Ito"];

/** Same as the fixture: 91 residents, 168 devices; the first 20 residents leave and hold 31 devices. Names repeat, Dir codes do not. */
function seed() {
  const residents = [];
  for (let i = 0; i < 91; i++) {
    residents.push({
      dir: String(1001 + i), name: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`,
      unit: `${100 + (i % 40)}${"ABCD"[i % 4]}`, phone: `555-01${String(i % 100).padStart(2, "0")}`,
    });
  }
  residents[25].name = residents[3].name; residents[60].name = residents[10].name;
  const devices = [];
  let n = 1;
  const add = (dir, kind) => devices.push({ id: String(1000 + n++).padStart(5, "0"), dir, kind });
  residents.slice(0, 20).forEach((r, i) => { add(r.dir, "Transmitter"); if (i < 11) add(r.dir, "Keypad code"); });
  residents.slice(20).forEach((r, i) => { add(r.dir, "Transmitter"); if (i % 3 === 0) add(r.dir, "Keypad code"); if (i % 2 === 0 && i < 40) add(r.dir, "Card"); });
  const stayers = () => devices.filter((d) => !residents.slice(0, 20).some((r) => r.dir === d.dir)).length;
  let k = 20;
  while (stayers() < 137) add(residents[(k++ % 71) + 20].dir, "Card");
  while (stayers() > 137) devices.pop();
  return { residents, devices };
}

// portal = what the account manager shows; gate = what was last sent to the gate controller.
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

// Windows-7-era desktop chrome, drawn in CSS. No vendor icons: toolbar glyphs are plain Unicode.
const CSS = `*{box-sizing:border-box}.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}#form1{display:flex;flex-direction:column;flex:1;min-height:0}body{font-family:"Segoe UI",Tahoma,Verdana,Arial,sans-serif;font-size:12px;background:#6d8fb5;margin:0;color:#000}
.win{margin:8px;border:1px solid #3c5a80;border-radius:6px 6px 0 0;background:#f0f0f0;box-shadow:0 2px 8px rgba(0,0,0,.4);height:calc(100vh - 16px);min-height:520px;display:flex;flex-direction:column}
.title{background:linear-gradient(#cfe0f4,#a8c4e8);border-radius:6px 6px 0 0;padding:5px 8px;display:flex;align-items:center;gap:6px;border-bottom:1px solid #8aa6cc}
.title .app{font-size:13px}.title .rep{margin-left:auto;background:#ffffe1;border:1px solid #c9a227;padding:0 6px;font-size:11px;white-space:nowrap}
.title .btns span{display:inline-block;width:26px;height:16px;border:1px solid #7a8fa8;border-radius:3px;margin-left:2px;background:linear-gradient(#e8eef6,#c8d6e8);text-align:center;line-height:14px;font-size:10px}
.title .btns span.x{background:linear-gradient(#e8a090,#c74a33);color:#fff;width:40px}
.menu{background:#f5f5f5;border-bottom:1px solid #ddd;padding:2px 4px}.menu span{padding:2px 7px}.menu u{text-decoration:underline}
.tools{display:flex;flex-wrap:wrap;gap:2px;padding:4px;border-bottom:1px solid #c8c8c8;background:linear-gradient(#fafafa,#e8e8e8)}
.tb{display:flex;flex-direction:column;align-items:center;min-width:54px;padding:3px 6px;border:1px solid transparent;background:none;font:inherit;color:#000;cursor:pointer;text-decoration:none}
.tb:hover{border-color:#9ec5ef;background:#e3f0fc}.tb .g{font-size:20px;line-height:24px}.tb.off{color:#9a9a9a;cursor:default}.tb.off:hover{border-color:transparent;background:none}
.main{display:flex;flex:1;min-height:0;overflow:hidden;border-top:1px solid #fff}
.tree{width:230px;flex:none;background:#fff;border:1px solid #a0a0a0;margin:3px;padding:4px 2px;overflow:auto;line-height:20px;white-space:nowrap}
.tree a{color:#000;text-decoration:none;padding:0 3px}.tree a.cur{background:#cce8ff;border:1px dotted #26a0da}.tree .i1{padding-left:16px}.tree .i2{padding-left:32px}.tree .i3{padding-left:52px}
.pane{flex:1;min-width:0;min-height:0;margin:3px 3px 3px 0;display:flex;flex-direction:column;gap:3px}
.grid{background:#d4d4d4;border:2px inset #fff;overflow:auto}.grid.res{flex:1;min-height:200px}.grid.ven{flex:none;height:130px}
table.rgMasterTable{border-collapse:collapse;background:#fff;min-width:100%}
.rgMasterTable th{background:linear-gradient(#f4f4f4,#dcdcdc);border:1px solid #a8a8a8;padding:1px 6px;font-weight:normal;position:sticky;top:0}
.rgMasterTable td{border:1px solid #d8d8d8;padding:1px 6px;white-space:nowrap}.rgMasterTable td.rs{background:#ececec;width:16px;padding:0 3px;text-align:center}
.rgMasterTable td.rs a{color:#000;text-decoration:none}.rgMasterTable tr.sel td{background:#cce8ff}.rgMasterTable td.notes{width:100%}
.rgMasterTable td.act a{color:#00c;font-size:11px}.rgMasterTable tr.new td{background:#fbfbfb}.rgMasterTable input[type=text]{font:inherit;width:100%;min-width:60px}
.status{display:flex;border-top:1px solid #c8c8c8;background:#f0f0f0;padding:2px 4px}.status span{border:1px inset #fff;padding:0 6px;margin-left:2px}.status span:first-child{flex:1;border:none}
.err{color:#c00}.dlgback{position:fixed;inset:0;background:rgba(0,0,0,.15);display:flex;align-items:center;justify-content:center}
.dlg{background:#f0f0f0;border:1px solid #3c5a80;border-radius:6px 6px 0 0;box-shadow:0 4px 16px rgba(0,0,0,.5);min-width:320px;max-width:95vw}
.dlg .title{justify-content:space-between}.dlg .body{padding:12px;display:flex;gap:12px}.dlg fieldset{border:1px solid #c8c8c8;padding:6px}
.dlg .btncol{display:flex;flex-direction:column;gap:6px}.dlg button,.dlg input[type=submit]{min-width:90px;padding:3px 10px;font:inherit}
.search{padding:4px;display:flex;gap:6px;align-items:center;background:#f7f7f7;border:1px solid #c8c8c8}
@media (max-width:700px){.win{height:auto}.grid.res{max-height:60vh}.main{flex-direction:column}.tree{width:auto;max-height:150px}.pane{margin:3px}.tb{min-width:44px;padding:2px 3px}.tb .g{font-size:16px;line-height:20px}.title .rep{white-space:normal}}`;

const glyph = { Account: "🗂", Add: "➕", "Add Dev": "▤", Delete: "⊗", Assign: "⎘", AntiPass: "⛔", Sort: "⇅", Search: "🔍", Stats: "▦", "Sec Level": "🔒", "Elev. Ref": "▯", "Snd Data": "⇉", "Rcv Data": "⇇", "Rcv Tran": "⇆", "Config Ports": "⚙", Registration: "🔑", Activity: "▥", Messages: "●", "Share Info": "👥" };
const tool = (label, { on = false, href = "", name = "", confirm = "" } = {}) => {
  const inner = `<span class="g" aria-hidden="true">${glyph[label] ?? "□"}</span><span>${esc(label)}</span>`;
  if (!on) return `<span class="tb off" aria-disabled="true">${inner}</span>`;
  if (name) return `<button type="submit" class="tb" name="${name}" id="${name}" value="${esc(label)}"${confirm ? ` onclick="return confirm('${confirm}');"` : ""}>${inner}</button>`;
  return `<a class="tb" href="${href}">${inner}</a>`;
};

function page(title, inner, { tools = "", cur = "", dialog = "", status = "Ready" } = {}) {
  const t = (key, label, href, cls) => `<div class="${cls}"><a href="${href}"${cur === key ? ' class="cur"' : ""}>${label}</a></div>`;
  const tree = `<nav class="tree" role="tree" aria-label="Accounts">${t("sched", "<span aria-hidden='true'>⏰</span> Scheduled Transfers", "/Accounts.aspx", "")}${t("accounts", "<span aria-hidden='true'>📂</span> Accounts", "/Accounts.aspx", "")}
<div role="treeitem" class="i1"><span aria-hidden='true'>📁</span> ${esc(ACCOUNTS[3].name)}</div><div role="treeitem" class="i1"><span aria-hidden='true'>📁</span> ${esc(ACCOUNTS[1].name)}</div>
<div role="treeitem" class="i1"><span aria-hidden='true'>📂</span> ${esc(ACCOUNT)}</div><div role="treeitem" class="i2"><span aria-hidden='true'>▤</span> System Information</div><div role="treeitem" class="i3"><span aria-hidden='true'>⚿</span> Hold Open</div><div role="treeitem" class="i3"><span aria-hidden='true'>🔒</span> Security Level</div><div role="treeitem" class="i3"><span aria-hidden='true'>⛔</span> Anti Pass</div>
${t("res", "<span aria-hidden='true'>👤</span> Resident", "/Residents.aspx", "i2")}${t("dev", "<span aria-hidden='true'>▦</span> Devices", "/Devices.aspx", "i2")}<div role="treeitem" class="i2"><span aria-hidden='true'>✎</span> Transactions</div><div role="treeitem" class="i1"><span aria-hidden='true'>📁</span> ${esc(ACCOUNTS[2].name)}</div>
<div style="margin-top:8px"><a href="/Logout.aspx"><span aria-hidden='true'>⏻</span> Log off</a></div></nav>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} - GateAdmin32 (replica)</title><style>${CSS}</style></head><body>
<div class="win"><div class="title"><span aria-hidden="true">👑</span><span class="app">${esc(title)} - GateAdmin32</span><span class="rep">REPLICA for testing AI agents - not a real gate system, no real data, not affiliated with any vendor</span><span class="btns"><span>–</span><span>▢</span><span class="x">✕</span></span></div>
<div class="menu"><span><u>F</u>ile</span><span><u>E</u>dit</span><span><u>V</u>iew</span><span><u>A</u>ction</span><span><u>O</u>ptions</span><span><u>H</u>elp</span></div>
${inner(tree, tools)}${dialog}
<div class="status"><span>For Help, press F1</span><span>${esc(status)}</span><span>NUM</span></div></div></body></html>`;
}

// A server-rendered form shell, keeping the postback machinery the fixture has.
const formOpen = (vs) => `<form method="post" id="form1"><div class="aspNetHidden"><input type="hidden" name="__EVENTTARGET" id="__EVENTTARGET" value=""><input type="hidden" name="__EVENTARGUMENT" id="__EVENTARGUMENT" value=""><input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="${Buffer.from(JSON.stringify(vs)).toString("base64")}"></div>
<script type="text/javascript">var theForm = document.forms['form1'];
function __doPostBack(t, a) { theForm.__EVENTTARGET.value = t; theForm.__EVENTARGUMENT.value = a; theForm.submit(); }</script>`;

function loginPage(message) {
  const dlg = `<div class="dlgback"><form method="post" action="/Login.aspx" class="dlg" id="login"><div class="title"><span>Log On</span><span class="btns"><span class="x">✕</span></span></div>
<div class="body"><fieldset><legend>Enter your user name and password</legend>${message ? `<div class="err">${esc(message)}</div>` : ""}
<table><tr><td><label for="txtUser">User name:</label></td><td><input type="text" id="txtUser" name="txtUser" autocomplete="username"></td></tr>
<tr><td><label for="txtPassword">Password:</label></td><td><input type="password" id="txtPassword" name="txtPassword" autocomplete="current-password"></td></tr></table></fieldset>
<div class="btncol"><input type="submit" name="btnLogin" value="Log In" id="btnLogin"><button type="reset">Cancel</button></div></div></form></div>`;
  return page("Log On", (tree) => `<div class="tools" role="toolbar" aria-label="Toolbar">${["Add", "Delete", "Snd Data", "Rcv Data", "Rcv Tran", "Sort"].map((l) => tool(l)).join("")}</div><div class="main">${tree}<div class="pane"><div class="grid res"></div></div></div>`, { dialog: dlg, status: "Not logged on" });
}

function accountsPage(v, msg) {
  const rows = ACCOUNTS.map((a, i) => `<tr class="rgRow"><td class="rs">${i === 0 ? "▸" : ""}</td><td>${esc(a.name)}</td><td>${esc(a.contact)}</td><td>${esc(a.phone)}</td><td>${a.series}</td><td><b>History</b></td></tr>`).join("");
  const dialog = v.sendOpen ? `<div class="dlgback"><div class="dlg" id="dlgSend"><div class="title"><span>Send Data Now</span><span class="btns"><span class="x">✕</span></span></div>
<div class="body"><fieldset><legend>Choose which accounts to send now:</legend><table class="rgMasterTable" id="gvSend" aria-label="Accounts to send"><caption class="vh">Accounts to send</caption><tr><th>Account Name</th><th>Snd Now</th></tr>
${ACCOUNTS.map((a) => `<tr><td>${esc(a.name)}</td><td style="text-align:center"><input type="checkbox" name="chkSend" value="${esc(a.name)}" form="form1"></td></tr>`).join("")}</table></fieldset>
<div class="btncol"><button type="button" onclick="document.querySelectorAll('input[name=chkSend]').forEach(c=>c.checked=false)">Clear All</button><input type="submit" name="btnSendOK" value="OK" id="btnSendOK" form="form1"><input type="submit" name="btnSendCancel" value="Cancel" id="btnSendCancel" form="form1"></div></div></div></div>` : "";
  return page("Accounts", (tree) => `${formOpen(v)}<div class="tools" role="toolbar" aria-label="Toolbar">${tool("Add")}${tool("Delete")}${tool("Snd Data", { on: true, name: "btnSend" })}${tool("Rcv Data")}${tool("Rcv Tran")}${tool("Sort")}${tool("Config Ports")}${tool("Registration")}${tool("Activity")}${tool("Messages")}${tool("Share Info")}</div>
<div class="main">${tree}<div class="pane"><div class="grid res"><table id="gvAccounts" class="rgMasterTable" aria-label="Accounts"><caption class="vh">Accounts</caption><tr><th></th><th>Account Name</th><th>Contact Name</th><th>Contact Phone</th><th>Series</th><th>Status</th></tr>${rows}</table></div></div></div></form>`, { cur: "accounts", dialog, status: msg || "Ready" });
}

const searchBox = (v) => (v.searchOpen ? `<div class="search">Find resident: <input type="text" name="fRes" value="${esc(v.flt)}"> <input type="submit" name="fGo" value="Find"> <input type="submit" name="fClear" value="Show All"></div>` : "");

function residentsPage(v, msg) {
  const list = state.residents.filter((r) => !v.flt || r.name.toLowerCase().includes(v.flt.toLowerCase()) || r.dir.includes(v.flt));
  const first = (dir) => state.devices.find((d) => d.dir === dir);
  const rows = list.map((r) => {
    const d = first(r.dir);
    return `<tr class="rgRow${v.sel === r.dir ? " sel" : ""}"><td class="rs"><a href="javascript:__doPostBack('gv','Select$${r.dir}')" title="Select">${v.sel === r.dir ? "▸" : "&nbsp;"}</a></td><td>${esc(r.name)}</td><td><input type="checkbox" disabled></td><td></td><td>${esc(r.phone ?? "")}</td><td>${r.dir}</td><td></td><td>02</td><td>${d ? KIND_LETTER[d.kind] ?? "" : ""}</td><td>${d ? d.id : ""}</td><td></td><td>1</td><td class="notes">${r.unit ? `Unit ${esc(r.unit)}` : ""}</td><td class="act"><a href="javascript:__doPostBack('gv','Delete$${r.dir}')" onclick="return confirm('Delete this resident and their devices?');">Delete</a></td></tr>`;
  }).join("");
  const addRow = v.addOpen
    ? `<tr class="new"><td class="rs">✎</td><td><input type="text" id="txtName" name="txtName" aria-label="Resident" placeholder="Resident"></td><td></td><td></td><td></td><td><input type="text" id="txtDir" name="txtDir" aria-label="Dir" placeholder="Dir"></td><td></td><td></td><td></td><td></td><td></td><td></td><td class="notes"><input type="text" id="txtUnit" name="txtUnit" aria-label="Notes" placeholder="Unit"> <input type="submit" name="btnSave" value="Save" id="btnSave"> <input type="submit" name="btnCancel" value="Cancel" id="btnCancel">${v.error ? ` <span class="err">${esc(v.error)}</span>` : ""}</td><td></td></tr>`
    : `<tr class="new"><td class="rs">*</td><td colspan="13"></td></tr>`;
  const vendors = VENDORS.map((x) => `<tr><td class="rs">&nbsp;</td><td>${esc(x.name)}</td><td></td><td></td><td>*VENDOR*</td><td>${x.dir}</td><td></td><td>05</td><td></td><td></td><td></td><td>1</td><td class="notes"></td></tr>`).join("");
  const head = `<th></th><th>Resident</th><th>Hide</th><th>AAC</th><th>Phone</th><th>Dir</th><th>Ent</th><th>SL</th><th>T</th><th>Device #</th><th>FL</th><th>ER</th><th>Notes</th>`;
  return page(`Account ${ACCOUNT}`, (tree) => `${formOpen(v)}<div class="tools" role="toolbar" aria-label="Toolbar">${tool("Account", { on: true, href: "/Accounts.aspx" })}<a class="tb" id="lnkAdd" href="javascript:__doPostBack('lnkAdd','')" title="Add"><span class="g" aria-hidden="true">${glyph.Add}</span><span>Add</span></a>${tool("Add Dev")}${tool("Delete", { on: !!v.sel, name: "btnDelete", confirm: "Delete this resident and their devices?" })}${tool("Assign")}${tool("AntiPass")}${tool("Sort")}${tool("Search", { on: true, name: "btnSearch" })}${tool("Stats")}${tool("Sec Level")}${tool("Elev. Ref")}</div>
<div class="main">${tree}<div class="pane">${searchBox(v)}<div class="grid res"><table id="gv" class="rgMasterTable" aria-label="Residents"><caption class="vh">Residents</caption><tr>${head}<th></th></tr>${rows}${addRow}</table></div>
<div class="grid ven"><table id="gvVendor" class="rgMasterTable" aria-label="Vendors"><caption class="vh">Vendors</caption><tr><th></th><th>Vendor</th><th></th><th></th><th></th><th>Dir</th><th>Ent</th><th>SL</th><th>T</th><th>Device #</th><th>FL</th><th>ER</th><th>Notes</th></tr>${vendors}<tr class="new"><td class="rs">*</td><td colspan="12"></td></tr></table></div></div></div></form>`, { cur: "res", status: msg || `${list.length} resident(s)` });
}

function devicesPage(v, msg) {
  const name = (dir) => state.residents.find((r) => r.dir === dir)?.name ?? "";
  const rows = state.devices.map((d) => `<tr class="rgRow"><td class="rs">&nbsp;</td><td>${KIND_LETTER[d.kind] ?? ""}</td><td>${d.id}</td><td>${d.dir}</td><td>${esc(name(d.dir))}</td><td>${esc(d.kind)}</td><td>02</td><td class="act"><a href="javascript:__doPostBack('gv','Delete$${d.id}')" onclick="return confirm('Delete this device?');">Delete</a></td></tr>`).join("");
  const addRow = v.addOpen
    ? `<tr class="new"><td class="rs">✎</td><td></td><td><input type="text" id="txtDevice" name="txtDevice" aria-label="Device #" placeholder="Device #"></td><td><input type="text" id="txtDevDir" name="txtDevDir" aria-label="Dir" placeholder="Dir"></td><td></td><td><input type="text" id="txtKind" name="txtKind" aria-label="Type" placeholder="Card, Transmitter or Keypad code"></td><td></td><td><input type="submit" name="btnSave" value="Save" id="btnSave"> <input type="submit" name="btnCancel" value="Cancel" id="btnCancel">${v.error ? ` <span class="err">${esc(v.error)}</span>` : ""}</td></tr>`
    : `<tr class="new"><td class="rs">*</td><td colspan="7"></td></tr>`;
  return page(`Account ${ACCOUNT}`, (tree) => `${formOpen(v)}<div class="tools" role="toolbar" aria-label="Toolbar">${tool("Account", { on: true, href: "/Accounts.aspx" })}<a class="tb" id="lnkAdd" href="javascript:__doPostBack('lnkAdd','')" title="Add"><span class="g" aria-hidden="true">${glyph.Add}</span><span>Add</span></a>${tool("Add Dev")}${tool("Delete")}${tool("Assign")}${tool("Sort")}${tool("Search")}</div>
<div class="main">${tree}<div class="pane"><div class="grid res"><table id="gv" class="rgMasterTable" aria-label="Devices"><caption class="vh">Devices</caption><tr><th></th><th>T</th><th>Device #</th><th>Dir</th><th>Resident</th><th>Type</th><th>SL</th><th></th></tr>${rows}${addRow}</table></div></div></div></form>`, { cur: "dev", status: msg || `${state.devices.length} device(s)` });
}

const blankView = () => ({ addOpen: false, error: "", flt: "", sel: "", searchOpen: false, sendOpen: false });
const readView = (vs) => { try { return { ...blankView(), ...JSON.parse(Buffer.from(vs ?? "", "base64").toString()) }; } catch { return blankView(); } };
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
const PAGES = { "/Residents.aspx": residentsPage, "/Devices.aspx": devicesPage, "/Accounts.aspx": accountsPage };

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
  if (path === "/") { res.writeHead(302, { location: "/Residents.aspx" }); return res.end(); }

  if (path === "/Login.aspx") {
    if (req.method === "GET") return html(loginPage(""));
    const b = new URLSearchParams(await readBody(req));
    if (same(b.get("txtUser") ?? "", USER) && same(b.get("txtPassword") ?? "", PASSWORD)) {
      const sid = randomBytes(16).toString("hex");
      sessions.set(sid, Date.now());
      res.writeHead(302, { location: "/Residents.aspx", "set-cookie": `ASP.NET_SessionId=${sid}; Path=/; HttpOnly; SameSite=Lax` });
      return res.end();
    }
    return html(loginPage("Invalid user name or password."));
  }
  if (path === "/Logout.aspx") { const sid = cookieSid(req); if (sid) sessions.delete(sid); res.writeHead(302, { location: "/Login.aspx", "set-cookie": "ASP.NET_SessionId=; Path=/; Max-Age=0" }); return res.end(); }

  const render = PAGES[path];
  if (!render) return html(page("Not found", (tree) => `<div class="main">${tree}<div class="pane"><p style="padding:8px">Page not found.</p></div></div>`), 404);

  // Session check. An expired session loses whatever was posted, like the real thing reportedly does.
  const sid = cookieSid(req);
  const seen = sid ? sessions.get(sid) : undefined;
  if (!seen) return html(loginPage(""));
  if (IDLE_MS && Date.now() - seen > IDLE_MS) { sessions.delete(sid); if (req.method === "POST") await readBody(req); return html(loginPage("Your session has expired. Please log in again.")); }
  sessions.set(sid, Date.now());

  if (req.method === "GET") return html(render(blankView()));

  const b = new URLSearchParams(await readBody(req));
  const v = readView(b.get("__VIEWSTATE")); v.error = "";
  const target = b.get("__EVENTTARGET") ?? "", arg = b.get("__EVENTARGUMENT") ?? "";
  const isRes = path === "/Residents.aspx";
  let hold = false, msg = "";
  const deleteResident = (id) => {
    const drop = () => { const before = state.devices.length; state.devices = state.devices.filter((d) => d.dir !== id); state.residents = state.residents.filter((r) => r.dir !== id); note(`delete resident ${id} (+${before - state.devices.length} devices)`); };
    if (hangs.noop.has(id)) { note(`delete resident ${id}: hung, nothing deleted`); hold = true; }
    else if (hangs.after.has(id)) { drop(); note(`delete resident ${id}: deleted, then hung`); hold = true; }
    else drop();
    v.sel = "";
  };
  if (target === "gv" && arg.startsWith("Delete$")) {
    const id = arg.split("$")[1];
    if (isRes) deleteResident(id); else { state.devices = state.devices.filter((d) => d.id !== id); note(`delete device ${id}`); }
  } else if (target === "gv" && arg.startsWith("Select$")) v.sel = arg.split("$")[1];
  else if (b.get("btnDelete") !== null && isRes && v.sel) deleteResident(v.sel);
  else if (target === "lnkAdd") v.addOpen = true;
  else if (b.get("btnSearch") !== null) v.searchOpen = !v.searchOpen;
  else if (b.get("fClear") !== null) { v.flt = ""; }
  else if (b.get("fGo.x") !== null || b.get("fGo") !== null) { v.flt = b.get("fRes") ?? ""; v.searchOpen = true; }
  else if (b.get("btnSend") !== null) v.sendOpen = true;
  else if (b.get("btnSendCancel") !== null) v.sendOpen = false;
  else if (b.get("btnSendOK") !== null) {
    v.sendOpen = false;
    const chosen = b.getAll("chkSend");
    if (!chosen.includes(ACCOUNT)) { note(`send data: no change (accounts ticked: ${chosen.join(", ") || "none"})`); msg = chosen.length ? `Send complete: ${chosen.join(", ")}` : "No accounts selected."; }
    else { const n = pending(); state.gate = { residents: structuredClone(state.residents), devices: structuredClone(state.devices) }; state.sends++; note(`send data: ${n} change(s) to ${ACCOUNT}`); msg = `Send complete: ${chosen.join(", ")}`; }
  }
  else if (b.get("btnCancel") !== null) v.addOpen = false;
  else if (b.get("btnSave") !== null && path === "/Devices.aspx") {
    const id = (b.get("txtDevice") ?? "").trim(), dir = (b.get("txtDevDir") ?? "").trim(), raw = (b.get("txtKind") ?? "").trim();
    const kind = Object.keys(KIND_LETTER).find((k) => k.toLowerCase() === raw.toLowerCase() || KIND_LETTER[k] === raw.toUpperCase());
    if (!id || !dir || !raw) { v.addOpen = true; v.error = "Device #, Dir and Type are required."; }
    else if (!/^\d{5}$/.test(id)) { v.addOpen = true; v.error = "Device # must be 5 digits."; }
    else if (state.devices.some((d) => d.id === id)) { v.addOpen = true; v.error = `Device ${id} already exists.`; }
    else if (!state.residents.some((r) => r.dir === dir)) { v.addOpen = true; v.error = `Dir ${dir} does not exist.`; }
    else if (!kind) { v.addOpen = true; v.error = "Type must be Card, Transmitter or Keypad code."; }
    else { state.devices.push({ id, dir, kind }); v.addOpen = false; note(`add device ${id} to ${dir}`); }
  }
  else if (b.get("btnSave") !== null && isRes) {
    const name = (b.get("txtName") ?? "").trim(), dir = (b.get("txtDir") ?? "").trim();
    const unit = (b.get("txtUnit") ?? "").trim().replace(/^unit\s+/i, "");
    if (!name || !dir) { v.addOpen = true; v.error = "Name and Dir are required."; }
    else if (state.residents.some((r) => r.dir === dir)) { v.addOpen = true; v.error = `Dir ${dir} already exists.`; }
    else { state.residents.push({ dir, name, unit, phone: "" }); v.addOpen = false; note(`add resident ${dir}`); }
  }
  if (hold) return; // leave the connection open: the browser keeps waiting
  html(render(v, msg));
});

server.requestTimeout = 0; // a hung delete stays hung until the client gives up
server.listen(PORT, HOST, () => console.log(`[replica] GateAdmin32 replica on http://${HOST}:${PORT} (owner routes ${OWNER_TOKEN ? "on" : "off"}, idle timeout ${IDLE_MS ? IDLE_MS / 60000 + " min" : "off"})`));
