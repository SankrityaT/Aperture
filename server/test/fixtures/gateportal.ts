// A REPLICA of a gate-access admin portal, built from the kind of screens such systems show (ASP.NET WebForms style).
// It is NOT DoorKing and holds no real data. What it copies is the PATTERN a property manager's work order runs into:
//   - Residents grid and Devices (credentials) grid, each with a filter row, a postback pager, and a Delete link that confirm()s
//   - an "Add resident" panel that rejects a repeated directory code
//   - a "Send Data" button that counts as pushing the changes to the gate
//   - a Delete that sometimes HANGS (reported by a real user of such software). Two ways, because they need different honesty:
//       "noop"  the request hangs and nothing is deleted
//       "after" the delete happens, then the response hangs, so the page never confirms it
// ASSUMPTIONS we made, not facts about any real product:
//   - deleting a resident also removes that resident's devices (this is the hidden dependent the engine must notice)
//   - the page shows 10 rows per page

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface Resident { dir: string; name: string; unit: string }
export interface Device { id: string; dir: string; kind: string }
export interface GatePortal {
  url: string;
  state: { residents: Resident[]; devices: Device[]; sends: number };
  hang(dirs: string[], mode: "noop" | "after"): void; // replaces the set for that mode
  reset(): void;
  close(): Promise<void>;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const BASE_PAGE = 10;
const FIRST = ["Ana", "Ben", "Cho", "Dev", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jon", "Kai", "Lea", "Mo", "Nia", "Oz", "Pia", "Quin", "Rue", "Sol", "Tia"];
const LAST = ["Alder", "Brook", "Cole", "Dunn", "Ellis", "Frost", "Gray", "Hale", "Ito"];

/** 91 residents and 168 devices. The first 20 residents "leave" and hold 31 devices between them. Directory codes are unique, names are not. */
function seed(): { residents: Resident[]; devices: Device[] } {
  const residents: Resident[] = [];
  for (let i = 0; i < 91; i++) residents.push({ dir: String(1001 + i), name: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`, unit: `${100 + (i % 40)}${"ABCD"[i % 4]}` });
  // A leaver and a stayer who share a name: only the directory code tells them apart.
  residents[25]!.name = residents[3]!.name; residents[60]!.name = residents[10]!.name;
  const devices: Device[] = [];
  let n = 1;
  const add = (dir: string, kind: string) => devices.push({ id: `D${String(n++).padStart(4, "0")}`, dir, kind });
  residents.slice(0, 20).forEach((r, i) => { add(r.dir, "Transmitter"); if (i < 11) add(r.dir, "Keypad code"); }); // 20 + 11 = 31
  residents.slice(20).forEach((r, i) => { add(r.dir, "Transmitter"); if (i % 3 === 0) add(r.dir, "Keypad code"); if (i % 2 === 0 && i < 40) add(r.dir, "Card"); });
  // top up so the stayers hold exactly 137
  const stayers = () => devices.filter((d) => !residents.slice(0, 20).some((r) => r.dir === d.dir)).length;
  let k = 20;
  while (stayers() < 137) add(residents[k++ % 71 + 20]!.dir, "Card");
  while (stayers() > 137) devices.pop();
  return { residents, devices };
}

interface View { page: number; addOpen: boolean; error: string; flt: string }

export async function startGatePortal(port = 0): Promise<GatePortal & { reset(): void; setDrift(mode: string): void }> {
  // 'The site changed' modes, for testing what a compiled integration does when its page is edited under it:
  //   rename_col  a non-key column is renamed          rename_key  the key column is renamed
  //   no_delete   the Delete control becomes 'Archive' decoy      a different table is inserted before the real one
  //   signedout   the page asks for a sign-in          archive     'Delete' stays on the page but no longer deletes
  //   renumber    the key shown on each row now belongs to the next resident (keys reused); Delete still acts on the row's own resident
  //   paging      smaller pages
  let drift = "";
  const PAGE_FOR = () => (drift === "paging" ? 5 : BASE_PAGE);
  const state: GatePortal["state"] = { ...seed(), sends: 0 };
  const initial = structuredClone(state);
  const hangs: { noop: Set<string>; after: Set<string> } = { noop: new Set<string>(), after: new Set<string>() };

  const nav = `<div id="nav"><a href="/Residents.aspx">Residents</a> | <a href="/Devices.aspx">Devices</a></div>`;
  const shell = (title: string, body: string, vs: View) =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>
<form method="post" id="form1">
<div class="aspNetHidden"><input type="hidden" name="__EVENTTARGET" id="__EVENTTARGET" value=""><input type="hidden" name="__EVENTARGUMENT" id="__EVENTARGUMENT" value=""><input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="${Buffer.from(JSON.stringify(vs)).toString("base64")}"></div>
<script type="text/javascript">var theForm = document.forms['form1'];
function __doPostBack(t, a) { theForm.__EVENTTARGET.value = t; theForm.__EVENTARGUMENT.value = a; theForm.submit(); }</script>
${nav}<div id="toolbar"><input type="submit" name="btnSend" value="Send Data" id="btnSend"> <a id="lnkAdd" href="javascript:__doPostBack('lnkAdd','')">Add</a></div>
<h2>${title}</h2>${body}</form></body></html>`;

  const pager = (pages: number, cur: number) => Array.from({ length: pages }, (_, i) => i + 1).map((n) => (n === cur ? `<td><span>${n}</span></td>` : `<td><a href="javascript:__doPostBack('gv','Page$${n}')">${n}</a></td>`)).join("");

  const residentsPage = (v: View) => {
    const list = state.residents.filter((r) => !v.flt || r.name.toLowerCase().includes(v.flt.toLowerCase()) || r.dir.includes(v.flt));
    const PAGE = PAGE_FOR();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    const slice = list.slice((v.page - 1) * PAGE, v.page * PAGE);
    const shownDir = (r: Resident) => (drift === "renumber" ? state.residents[(state.residents.indexOf(r) + 1) % state.residents.length]!.dir : r.dir);
    const rows = slice.map((r, i) => `<tr class="rgRow"><td>${(v.page - 1) * PAGE + i + 1}</td><td>${esc(r.name)}</td><td>${shownDir(r)}</td><td>${esc(r.unit)}</td><td>${drift === "no_delete" ? `<a href="javascript:__doPostBack('gv','Archive$${r.dir}')" onclick="return confirm('Archive this resident?');">Archive</a>` : `<a href="javascript:__doPostBack('gv','Delete$${r.dir}')" onclick="return confirm('Delete this resident and their devices?');">Delete</a>`}</td></tr>`).join("");
    const panel = v.addOpen ? `<div id="pnlAdd"><h3>Add resident</h3>${v.error ? `<span class="err">${esc(v.error)}</span>` : ""}<label for="txtName">Name</label><input type="text" id="txtName" name="txtName"><label for="txtDir">Dir</label><input type="text" id="txtDir" name="txtDir"><label for="txtUnit">Unit</label><input type="text" id="txtUnit" name="txtUnit"><input type="submit" name="btnSave" value="Save" id="btnSave"><input type="submit" name="btnCancel" value="Cancel" id="btnCancel"></div>` : "";
    if (drift === "signedout") return `<!doctype html><html><body><form method="post"><h2>Sign in</h2><input type="text" name="user"><input type="password" name="pw"><input type="submit" value="Sign in"></form></body></html>`;
    const decoy = drift === "decoy" ? `<table id="notices"><tr><th>Notice</th><th>Date</th></tr><tr><td>Gate closed Friday</td><td>10/20</td></tr><tr><td>Pool open</td><td>10/21</td></tr></table>` : "";
    return shell("Residents", `${decoy}<table id="gv" class="rgMasterTable"><tr><th>&nbsp;</th><th>${drift === "rename_col" ? "Full name" : "Resident"}</th><th>${drift === "rename_key" ? "Directory code" : "Dir"}</th><th>Unit</th><th>&nbsp;</th></tr><tr class="rgFilterRow"><td></td><td><input type="text" name="fRes" value="${esc(v.flt)}"></td><td><input type="text" name="fDir"></td><td></td><td><input type="image" name="fGo" alt="Filter" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></td></tr>${rows}<tr class="rgPager"><td colspan="5"><table><tr>${pager(pages, v.page)}</tr></table></td></tr></table>${panel}`, v);
  };

  const devicesPage = (v: View) => {
    const list = state.devices;
    const PAGE = PAGE_FOR();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    const slice = list.slice((v.page - 1) * PAGE, v.page * PAGE);
    const rows = slice.map((d, i) => `<tr class="rgRow"><td>${(v.page - 1) * PAGE + i + 1}</td><td>${d.id}</td><td>${d.dir}</td><td>${esc(d.kind)}</td><td><a href="javascript:__doPostBack('gv','Delete$${d.id}')" onclick="return confirm('Delete this device?');">Delete</a></td></tr>`).join("");
    return shell("Devices", `<table id="gv" class="rgMasterTable"><tr><th>&nbsp;</th><th>Device</th><th>Dir</th><th>Type</th><th>&nbsp;</th></tr><tr class="rgFilterRow"><td></td><td><input type="text" name="fId"></td><td><input type="text" name="fDir"></td><td></td><td><input type="image" name="fGo" alt="Filter" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></td></tr>${rows}<tr class="rgPager"><td colspan="5"><table><tr>${pager(pages, v.page)}</tr></table></td></tr></table>`, v);
  };

  const readView = (vs: string | null): View => { try { return JSON.parse(Buffer.from(vs ?? "", "base64").toString()) as View; } catch { return { page: 1, addOpen: false, error: "", flt: "" }; } };

  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const url = new URL(req.url ?? "/", "http://x");
    const html = (b: string) => { res.setHeader("content-type", "text/html"); res.end(b); };
    if (path === "/__reset") { Object.assign(state, structuredClone(initial)); hangs.noop.clear(); hangs.after.clear(); drift = ""; res.end("reset"); return; }
    if (path === "/__state") { res.setHeader("content-type", "application/json"); return void res.end(JSON.stringify({ residents: state.residents.length, devices: state.devices.length, sends: state.sends, dirs: state.residents.map((r) => r.dir) })); }
    if (path === "/__drift") { drift = url.searchParams.get("mode") ?? ""; return void res.end("ok"); }
    if (path === "/__hang") { hangs.noop = new Set((url.searchParams.get("noop") ?? "").split(",").filter(Boolean)); hangs.after = new Set((url.searchParams.get("after") ?? "").split(",").filter(Boolean)); return void res.end("ok"); }
    if (path !== "/Residents.aspx" && path !== "/Devices.aspx") { res.statusCode = 404; return void html("<h1>Not found</h1>"); }
    const isRes = path === "/Residents.aspx";
    if (req.method === "GET") return html((isRes ? residentsPage : devicesPage)({ page: 1, addOpen: false, error: "", flt: "" }));
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const b = new URLSearchParams(raw);
      const v = readView(b.get("__VIEWSTATE")); v.error = "";
      const target = b.get("__EVENTTARGET") ?? "", arg = b.get("__EVENTARGUMENT") ?? "";
      let hold = false;
      if (target === "gv" && arg.startsWith("Delete$")) {
        const id = arg.split("$")[1]!;
        if (isRes && drift === "archive") { /* the button is still there; it no longer deletes */ }
        else if (isRes) {
          if (hangs.noop.has(id) || hangs.after.has(id)) {
            if (hangs.after.has(id)) { state.devices = state.devices.filter((d) => d.dir !== id); state.residents = state.residents.filter((r) => r.dir !== id); }
            hold = true; // never answers
          } else { state.devices = state.devices.filter((d) => d.dir !== id); state.residents = state.residents.filter((r) => r.dir !== id); }
        } else state.devices = state.devices.filter((d) => d.id !== id);
        v.page = 1;
      } else if (target === "gv" && arg.startsWith("Page$")) v.page = Number(arg.split("$")[1]);
      else if (target === "lnkAdd") v.addOpen = true;
      else if (b.get("fGo.x") !== null || b.get("fGo") !== null) { v.flt = b.get("fRes") ?? ""; v.page = 1; }
      else if (b.get("btnSend") !== null) state.sends++;
      else if (b.get("btnCancel") !== null) v.addOpen = false;
      else if (b.get("btnSave") !== null && isRes) {
        const name = (b.get("txtName") ?? "").trim(), dir = (b.get("txtDir") ?? "").trim();
        if (!name || !dir) { v.addOpen = true; v.error = "Name and Dir are required."; }
        else if (state.residents.some((r) => r.dir === dir)) { v.addOpen = true; v.error = `Dir ${dir} already exists.`; }
        else { state.residents.push({ dir, name, unit: (b.get("txtUnit") ?? "").trim() }); v.addOpen = false; }
      }
      if (hold) return; // leave the connection open: the browser waits, like the real thing reportedly does
      html((isRes ? residentsPage : devicesPage)(v));
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const bound = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${bound}`, state,
    hang: (dirs, mode) => { (mode === "after" ? hangs.after : hangs.noop).clear(); dirs.forEach((d) => (mode === "after" ? hangs.after : hangs.noop).add(d)); },
    reset: () => { Object.assign(state, structuredClone(initial)); hangs.noop.clear(); hangs.after.clear(); drift = ""; },
    setDrift: (m: string) => { drift = m; },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
