// An emulation of an ASP.NET WebForms admin page (the kind a DoorKing-style or PeopleSoft-style screen is built from).
// It is NOT the .NET runtime. It reproduces the HTML and behavior patterns that make such pages hard for scripts:
//   - one big <form> with hidden __VIEWSTATE / __EVENTTARGET / __EVENTARGUMENT fields
//   - links are javascript:__doPostBack('control','argument'), never real addresses, and the URL never changes
//   - a GridView table: sortable header links, a FILTER row under the header, row numbers, a delete link with an
//     onclick confirm(), and a PAGER row inside the table made of postback links (a nested table)
//   - a toolbar with several submit buttons ("Send Data" comes BEFORE the add form's Save button)
//   - an "Add" link that opens a panel on the same page, with server-side validation messages

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface AspxSite {
  url: string;
  state: { residents: { dir: string; name: string; ent: string; sl: string }[]; sends: number };
  close(): Promise<void>;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const PAGE_SIZE = 5;

interface View { page: number; sort: string; addOpen: boolean; error: string }

export async function startAspx(): Promise<AspxSite> {
  const names = ["Marlow D", "Petrov A", "Halvorsen L", "Tanaka R", "Rowan T", "Silva M", "Okafor N", "Brandt K", "Quill E", "Ivers J", "Nakamura H", "Dunne P", "Castro V", "Arden S"];
  const state: AspxSite["state"] = {
    residents: names.map((n, i) => ({ dir: String(101 + i), name: n, ent: String(1000 + i * 7), sl: "01" })),
    sends: 0,
  };

  const shown = (v: View) => {
    const sorted = [...state.residents].sort((a, b) => (v.sort === "Dir" ? a.dir.localeCompare(b.dir) : a.name.localeCompare(b.name)));
    return { sorted, pages: Math.max(1, Math.ceil(sorted.length / PAGE_SIZE)), slice: sorted.slice((v.page - 1) * PAGE_SIZE, v.page * PAGE_SIZE) };
  };

  const render = (v: View) => {
    const { pages, slice } = shown(v);
    const rows = slice.map((r, i) => `<tr class="rgRow"><td>${(v.page - 1) * PAGE_SIZE + i + 1}</td><td>${esc(r.name)}</td><td>${r.dir}</td><td>${r.ent}</td><td>${r.sl}</td><td><a href="javascript:__doPostBack('ctl00$gv','Delete$${i}')" onclick="return confirm('Delete this resident?');">Delete</a></td></tr>`).join("");
    const pager = Array.from({ length: pages }, (_, i) => i + 1).map((n) => (n === v.page ? `<td><span>${n}</span></td>` : `<td><a href="javascript:__doPostBack('ctl00$gv','Page$${n}')">${n}</a></td>`)).join("");
    const viewState = Buffer.from(JSON.stringify(v)).toString("base64");
    const panel = v.addOpen
      ? `<div id="pnlAdd"><h3>Add resident</h3>${v.error ? `<span class="err">${esc(v.error)}</span>` : ""}
<label for="txtName">Name</label><input type="text" id="txtName" name="ctl00$txtName">
<label for="txtDir">Dir</label><input type="text" id="txtDir" name="ctl00$txtDir">
<label for="txtEnt">Ent</label><input type="text" id="txtEnt" name="ctl00$txtEnt">
<input type="submit" name="ctl00$btnSave" value="Save" id="btnSave"><input type="submit" name="ctl00$btnCancel" value="Cancel" id="btnCancel"></div>`
      : "";
    return `<!doctype html><html><head><meta charset="utf-8"><title>Residents</title></head><body>
<form method="post" action="./Residents.aspx" id="form1">
<div class="aspNetHidden"><input type="hidden" name="__EVENTTARGET" id="__EVENTTARGET" value=""><input type="hidden" name="__EVENTARGUMENT" id="__EVENTARGUMENT" value=""><input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="${viewState}"><input type="hidden" name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="C2EE9ABB"><input type="hidden" name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="x7Qk"></div>
<script type="text/javascript">
var theForm = document.forms['form1']; if (!theForm) { theForm = document.form1; }
function __doPostBack(eventTarget, eventArgument) { if (!theForm.onsubmit || (theForm.onsubmit() != false)) { theForm.__EVENTTARGET.value = eventTarget; theForm.__EVENTARGUMENT.value = eventArgument; theForm.submit(); } }
</script>
<div id="toolbar"><input type="submit" name="ctl00$btnSend" value="Send Data" id="btnSend"> <a id="lnkAdd" href="javascript:__doPostBack('ctl00$lnkAdd','')">Add</a> <a href="javascript:__doPostBack('ctl00$lnkStats','')">Stats</a></div>
<h2>Residents</h2>
<table id="ctl00_gv" class="rgMasterTable" cellspacing="0">
<tr><th scope="col">&nbsp;</th><th scope="col"><a href="javascript:__doPostBack('ctl00$gv','Sort$Name')">Resident</a></th><th scope="col"><a href="javascript:__doPostBack('ctl00$gv','Sort$Dir')">Dir</a></th><th scope="col">Ent</th><th scope="col">SL</th><th scope="col">&nbsp;</th></tr>
<tr class="rgFilterRow"><td></td><td><input type="text" name="ctl00$fRes"></td><td><input type="text" name="ctl00$fDir"></td><td><input type="text" name="ctl00$fEnt"></td><td></td><td><input type="image" name="ctl00$fGo" alt="Filter" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></td></tr>
${rows}
<tr class="rgPager"><td colspan="6"><table><tr>${pager}</tr></table></td></tr>
</table>
${panel}
</form></body></html>`;
  };

  const readView = (vs: string | null): View => { try { return JSON.parse(Buffer.from(vs ?? "", "base64").toString()) as View; } catch { return { page: 1, sort: "Name", addOpen: false, error: "" }; } };

  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const html = (b: string) => { res.setHeader("content-type", "text/html"); res.end(b); };
    if (path === "/__aspx") { res.setHeader("content-type", "application/json"); return void res.end(JSON.stringify(state)); }
    if (path !== "/Residents.aspx") { res.statusCode = 404; return void html("<h1>Not found</h1>"); }
    if (req.method === "GET") return html(render({ page: 1, sort: "Name", addOpen: false, error: "" }));
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const b = new URLSearchParams(raw);
      const v = readView(b.get("__VIEWSTATE"));
      v.error = "";
      const target = b.get("__EVENTTARGET") ?? "", arg = b.get("__EVENTARGUMENT") ?? "";
      if (target === "ctl00$gv" && arg.startsWith("Delete$")) {
        const row = shown(v).slice[Number(arg.split("$")[1])];
        if (row) state.residents = state.residents.filter((r) => r.dir !== row.dir);
        v.page = Math.min(v.page, shown(v).pages);
      } else if (target === "ctl00$gv" && arg.startsWith("Page$")) v.page = Number(arg.split("$")[1]);
      else if (target === "ctl00$gv" && arg.startsWith("Sort$")) { v.sort = arg.split("$")[1]!; v.page = 1; }
      else if (target === "ctl00$lnkAdd") v.addOpen = true;
      else if (b.get("ctl00$btnSend") !== null) state.sends++;
      else if (b.get("ctl00$btnCancel") !== null) v.addOpen = false;
      else if (b.get("ctl00$btnSave") !== null) {
        const name = (b.get("ctl00$txtName") ?? "").trim(), dir = (b.get("ctl00$txtDir") ?? "").trim();
        if (!name || !dir) { v.addOpen = true; v.error = "Name and Dir are required."; }
        else if (state.residents.some((r) => r.dir === dir)) { v.addOpen = true; v.error = `Dir ${dir} already exists.`; }
        else { state.residents.push({ dir, name, ent: (b.get("ctl00$txtEnt") ?? "").trim(), sl: "01" }); v.addOpen = false; }
      }
      html(render(v));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, state, close: () => new Promise((r) => server.close(() => r())) };
}
