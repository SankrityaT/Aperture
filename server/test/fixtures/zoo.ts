// A zoo of deliberately hard sites. Each is built a different way. The generator has no code for any of them.
//   /spa        client-rendered SPA: ARIA div grid (no <table>), button pagination, custom modal, hash router
//   /datatable  jQuery DataTables look-alike: rows injected late, pager links WITHOUT href, search box, page-size select
//   /shadow     a Web Component whose grid lives inside an open shadow root
//   /frame      the table is inside an <iframe>; each row's delete is a button inside its own <form>
//   /nested     layout tables four deep, with tables nested inside data cells
//   /infinite   virtualized list: only the first rows exist until you scroll
// Server state is exposed at /__zoo so tests can check the app itself, not just our read-back.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface Zoo {
  url: string;
  state: {
    users: { id: string; name: string; email: string; role: string }[];
    orders: { id: string; customer: string; total: string }[];
    items: { id: string; label: string }[];
    nested: { sku: string; name: string; city: string }[];
  };
  close(): Promise<void>;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const page = (title: string, head: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${head}</style></head><body>${body}</body></html>`;

const SPA = `
const root = document.getElementById("root");
const S = { page: 1, size: 4, users: [], total: 0, dialog: null, target: null };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
async function load() {
  const r = await fetch("/api/users?page=" + S.page + "&size=" + S.size);
  const d = await r.json(); S.users = d.items; S.total = d.total; render();
}
function render() {
  const pages = Math.max(1, Math.ceil(S.total / S.size));
  root.innerHTML = '<div class="app"><header><h1>Team</h1><button class="btn primary" id="add">+ Add member</button></header>' +
    '<div role="grid" aria-label="Team members" class="grid">' +
    '<div role="row" class="row head"><div role="columnheader">Name</div><div role="columnheader">Email</div><div role="columnheader">Role</div><div role="columnheader"><span class="sr-only">Actions</span></div></div>' +
    S.users.map((u) => '<div role="row" class="row" data-id="' + u.id + '"><div role="gridcell"><div class="cell"><span>' + esc(u.name) + '</span></div></div><div role="gridcell">' + esc(u.email) + '</div><div role="gridcell"><span class="badge">' + esc(u.role) + '</span></div><div role="gridcell"><button aria-label="Delete ' + esc(u.name) + '" class="icon-btn danger" data-del="' + u.id + '"><svg width="14" height="14"><path d="M2 2l10 10M12 2L2 12"/></svg></button></div></div>').join("") +
    '</div><nav aria-label="Pagination"><button aria-label="Previous page" id="prev"' + (S.page === 1 ? " disabled" : "") + '>&lsaquo;</button><span>Page ' + S.page + ' of ' + pages + '</span><button aria-label="Next page" id="next"' + (S.page >= pages ? " disabled" : "") + '>&rsaquo;</button></nav>' +
    (S.dialog === "confirm" ? '<div role="dialog" aria-modal="true" class="modal"><p>Delete this member?</p><button id="yes" class="btn danger">Yes, delete</button><button id="no" class="btn">Cancel</button></div>' : "") +
    (S.dialog === "add" ? '<div role="dialog" aria-modal="true" class="modal"><form id="addForm"><h3>New member</h3><label>Name <input name="name"></label><label>Email <input name="email" type="email"></label><label>Role <select name="role"><option>Admin</option><option>Editor</option><option>Viewer</option></select></label><button type="submit" class="btn primary">Create</button><button type="button" id="cancel" class="btn">Cancel</button></form></div>' : "") + '</div>';
  document.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => { S.dialog = "confirm"; S.target = b.dataset.del; render(); });
  const on = (id, f) => { const e = document.getElementById(id); if (e) e.onclick = f; };
  on("prev", () => { S.page--; load(); }); on("next", () => { S.page++; load(); });
  on("add", () => { S.dialog = "add"; render(); }); on("cancel", () => { S.dialog = null; render(); }); on("no", () => { S.dialog = null; render(); });
  on("yes", async () => { await fetch("/api/users/" + S.target, { method: "DELETE" }); S.dialog = null; S.page = Math.min(S.page, Math.max(1, Math.ceil((S.total - 1) / S.size))); load(); });
  const f = document.getElementById("addForm");
  if (f) f.onsubmit = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(f)); await fetch("/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(d) }); S.dialog = null; load(); };
}
setTimeout(load, 350); // data arrives late, as in a real app
`;

const DATATABLE = `
var rows = [], page = 1, size = 5, q = "";
function view() { return rows.filter(function (r) { return (r.id + r.customer).toLowerCase().indexOf(q) >= 0; }); }
function draw() {
  var v = view(), pages = Math.max(1, Math.ceil(v.length / size)), slice = v.slice((page - 1) * size, page * size);
  document.querySelector("#orders tbody").innerHTML = slice.map(function (r) { return '<tr><td>' + r.id + '</td><td>' + r.customer + '</td><td>$' + r.total + '</td><td><button class="btn-delete" data-id="' + r.id + '"><i class="fa fa-trash"></i> Delete</button></td></tr>'; }).join("");
  var nums = ""; for (var i = 1; i <= pages; i++) nums += '<a class="paginate_button' + (i === page ? ' current' : '') + '" data-dt-idx="' + i + '" tabindex="0">' + i + '</a>';
  document.getElementById("pager").innerHTML = '<a class="paginate_button previous' + (page === 1 ? ' disabled' : '') + '" id="orders_previous" tabindex="0">Previous</a><span>' + nums + '</span><a class="paginate_button next' + (page >= pages ? ' disabled' : '') + '" id="orders_next" tabindex="0">Next</a>';
  document.getElementById("info").textContent = "Showing " + (slice.length ? (page - 1) * size + 1 : 0) + " to " + ((page - 1) * size + slice.length) + " of " + v.length + " entries";
  Array.prototype.forEach.call(document.querySelectorAll("#pager a"), function (a) { a.onclick = function () { if (/disabled/.test(a.className)) return; if (a.id === "orders_next") page++; else if (a.id === "orders_previous") page--; else page = Number(a.textContent); draw(); }; });
  Array.prototype.forEach.call(document.querySelectorAll(".btn-delete"), function (b) { b.onclick = async function () { if (!confirm("Delete order " + b.dataset.id + "?")) return; await fetch("/api/orders/" + b.dataset.id, { method: "DELETE" }); rows = rows.filter(function (r) { return r.id !== b.dataset.id; }); draw(); }; });
}
document.getElementById("search").oninput = function (e) { q = e.target.value.toLowerCase(); page = 1; draw(); };
document.getElementById("len").onchange = function (e) { size = Number(e.target.value); page = 1; draw(); };
setTimeout(function () { fetch("/api/orders").then(function (r) { return r.json(); }).then(function (d) { rows = d; draw(); }); }, 400);
`;

const SHADOW = `
class UserGrid extends HTMLElement {
  async connectedCallback() {
    this.attachShadow({ mode: "open" });
    await this.load();
  }
  async load() {
    const d = await (await fetch("/api/users?page=1&size=100")).json();
    this.shadowRoot.innerHTML = '<style>table{border-collapse:collapse}th,td{padding:4px 10px;border:1px solid #ccc}</style><h3>Members (shadow)</h3><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>' +
      d.items.map((u) => '<tr><td>' + u.name + '</td><td>' + u.email + '</td><td>' + u.role + '</td><td><button title="Remove" data-id="' + u.id + '">x</button></td></tr>').join("") + '</tbody></table>';
    this.shadowRoot.querySelectorAll("button[data-id]").forEach((b) => b.onclick = async () => { if (!confirm("Remove member?")) return; await fetch("/api/users/" + b.dataset.id, { method: "DELETE" }); this.load(); });
  }
}
customElements.define("user-grid", UserGrid);
`;

const INFINITE = `
var list = document.getElementById("list"), loaded = 0, total = 0, busy = false;
async function more() {
  if (busy) return; busy = true;
  var d = await (await fetch("/api/items?offset=" + loaded + "&limit=5")).json();
  total = d.total;
  d.items.forEach(function (it) {
    var row = document.createElement("div"); row.className = "item"; row.setAttribute("data-id", it.id);
    row.innerHTML = '<span class="id">' + it.id + '</span><span class="label">' + it.label + '</span><button class="del" aria-label="Delete ' + it.id + '">Delete</button>';
    row.querySelector("button").onclick = async function () { if (!confirm("Delete " + it.id + "?")) return; await fetch("/api/items/" + it.id, { method: "DELETE" }); row.remove(); loaded--; };
    list.insertBefore(row, document.getElementById("sentinel"));
  });
  loaded += d.items.length; busy = false;
  document.getElementById("sentinel").style.display = loaded >= total ? "none" : "block";
}
new IntersectionObserver(function (e) { if (e[0].isIntersecting && loaded < total) more(); }).observe(document.getElementById("sentinel"));
setTimeout(more, 300);
`;

export async function startZoo(port = 0): Promise<Zoo & { reset(): void }> {
  const first = ["Aiko", "Bram", "Cleo", "Dev", "Esme", "Finn", "Gita", "Hugo", "Ines", "Jude", "Kira"];
  const last = ["Tan", "Voss", "Marsh", "Rao", "Lund", "Okoro", "Sen", "Ward", "Cruz", "Hale", "Pike"];
  const roles = ["Admin", "Editor", "Viewer"];
  const state: Zoo["state"] = {
    users: first.map((f, i) => ({ id: `U${String(i + 1).padStart(2, "0")}`, name: `${f} ${last[i]}`, email: `${f.toLowerCase()}@zoo.test`, role: roles[i % 3]! })),
    orders: Array.from({ length: 13 }, (_, i) => ({ id: `ORD-${1001 + i}`, customer: `${first[i % 11]} ${last[(i * 3) % 11]}`, total: (20 + i * 7.5).toFixed(2) })),
    items: Array.from({ length: 14 }, (_, i) => ({ id: `ITM-${i + 1}`, label: `Thing number ${i + 1}` })),
    nested: [{ sku: "K-100", name: "Anvil", city: "Leeds" }, { sku: "K-101", name: "Bellows", city: "York" }, { sku: "K-102", name: "Crucible", city: "Hull" }, { sku: "K-103", name: "Drill", city: "Bath" }],
  };

  const initial = structuredClone(state);
  const css = "body{font-family:sans-serif} .row{display:flex;gap:12px;padding:6px;border-bottom:1px solid #ddd}.row>div{flex:1}.head{font-weight:700}.modal{position:fixed;left:30%;top:30%;background:#fff;border:2px solid #333;padding:16px}.sr-only{position:absolute;left:-9999px}.item{display:flex;gap:12px;padding:6px}#viewport{height:120px;overflow:auto;border:1px solid #999}";

  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const path = u.pathname;
    const html = (b: string) => { res.setHeader("content-type", "text/html"); res.end(b); };
    const json = (o: unknown, code = 200) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
    const redirect = (to: string) => { res.statusCode = 302; res.setHeader("location", to); res.end(); };
    const body = (cb: (raw: string) => void) => { let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => cb(raw)); };

    if (path === "/__zoo") return json(state);
    if (path === "/__reset") { Object.assign(state, structuredClone(initial)); return json({ ok: true }); }

    // ---- APIs ----
    if (path === "/api/users" && req.method === "GET") {
      const pg = Number(u.searchParams.get("page") ?? 1), size = Number(u.searchParams.get("size") ?? 4);
      return json({ total: state.users.length, items: state.users.slice((pg - 1) * size, pg * size) });
    }
    if (path === "/api/users" && req.method === "POST") return body((raw) => { const d = JSON.parse(raw) as { name: string; email: string; role: string }; state.users.push({ id: `U${String(state.users.length + 50)}`, ...d }); json({ ok: true }); });
    if (path.startsWith("/api/users/") && req.method === "DELETE") { state.users = state.users.filter((x) => x.id !== path.split("/").pop()); return json({ ok: true }); }
    if (path === "/api/orders" && req.method === "GET") return json(state.orders);
    if (path.startsWith("/api/orders/") && req.method === "DELETE") { state.orders = state.orders.filter((x) => x.id !== path.split("/").pop()); return json({ ok: true }); }
    if (path === "/api/items" && req.method === "GET") {
      const off = Number(u.searchParams.get("offset") ?? 0), lim = Number(u.searchParams.get("limit") ?? 5);
      return json({ total: state.items.length, items: state.items.slice(off, off + lim) });
    }
    if (path.startsWith("/api/items/") && req.method === "DELETE") { state.items = state.items.filter((x) => x.id !== path.split("/").pop()); return json({ ok: true }); }

    // ---- pages ----
    if (path === "/spa") return html(page("Team", css, `<div id="root"></div><script>${SPA}</script>`));
    if (path === "/datatable") {
      return html(page("Orders", css + "table.display{border-collapse:collapse}table.display th,table.display td{border:1px solid #ccc;padding:4px 10px}", `<h2>Orders</h2><label>Show <select id="len"><option value="5">5</option><option value="10">10</option></select> entries</label> <label>Search: <input id="search" type="search"></label>
<table id="orders" class="display"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Actions</th></tr></thead><tbody></tbody></table><div id="info"></div><div id="pager" class="dataTables_paginate"></div><script>${DATATABLE}</script>`));
    }
    if (path === "/shadow") return html(page("Shadow", css, `<h2>Directory</h2><user-grid></user-grid><script>${SHADOW}</script>`));
    if (path === "/frame") return html(page("Frames", css, `<h2>Back office</h2><nav>Home | Reports</nav><iframe src="/inner" title="Records" width="700" height="300"></iframe>`));
    if (path === "/inner" && req.method === "GET") {
      const rows = state.nested.map((n) => `<tr><td>${n.sku}</td><td>${esc(n.name)}</td><td>${esc(n.city)}</td><td><form method="post" action="/inner/remove"><input type="hidden" name="sku" value="${n.sku}"><button type="submit">Remove</button></form></td></tr>`).join("");
      return html(page("Records", css, `<h3>Stock</h3><table border="1"><tr><th>SKU</th><th>Name</th><th>City</th><th></th></tr>${rows}</table>`));
    }
    if (path === "/inner/remove" && req.method === "POST") return body((raw) => { const sku = new URLSearchParams(raw).get("sku"); state.nested = state.nested.filter((n) => n.sku !== sku); redirect("/inner"); });
    if (path === "/nested") {
      const rows = state.nested.map((n) => `<tr><td>${n.sku}</td><td>${esc(n.name)}</td><td><table class="detail"><tr><td>City</td><td>${esc(n.city)}</td></tr><tr><td>Stock</td><td>12</td></tr></table></td><td><a href="/nested?del=${n.sku}">Delete</a></td></tr>`).join("");
      const del = u.searchParams.get("del");
      if (del) { state.nested = state.nested.filter((n) => n.sku !== del); return redirect("/nested"); }
      return html(page("Nested", css, `<table width="100%"><tr><td><table><tr><td>MENU</td><td><table><tr><td><table><tr><td><h3>Warehouse</h3><table border="1" id="stock"><tr><th>SKU</th><th>Name</th><th>Details</th><th>Action</th></tr>${rows}</table></td></tr></table></td></tr></table></td></tr></table></td></tr></table>`));
    }
    if (path === "/infinite") return html(page("Infinite", css, `<h2>Feed</h2><div id="viewport"><div id="list"><div id="sentinel">loading…</div></div></div><script>${INFINITE}</script>`));

    res.statusCode = 404; html("<h1>Not found</h1>");
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const bound = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${bound}`, state, reset: () => { Object.assign(state, structuredClone(initial)); }, close: () => new Promise((r) => server.close(() => r())) };
}
