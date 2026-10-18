// Two small record-keeping apps built in different styles. The generator has no code for either.
//  A  /people  classic table, text "Delete" link opens a confirmation PAGE, system-assigned ids
//  B  /staff   paginated, icon-only delete button with a JS confirm() dialog, no id column (email is the key)

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface TestApps {
  url: string;
  state: { people: { id: string; name: string; year: string }[]; staff: { first: string; last: string; email: string }[] };
  close(): Promise<void>;
}

const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export async function startApps(): Promise<TestApps> {
  const state: TestApps["state"] = {
    people: [
      { id: "S1", name: "Ava Lin", year: "9" }, { id: "S2", name: "Ben Ortiz", year: "10" }, { id: "S3", name: "Cy Ng", year: "11" },
      { id: "S4", name: "Dee Fox", year: "9" }, { id: "S5", name: "Eli Roy", year: "12" },
    ],
    staff: [
      { first: "Ann", last: "Lee", email: "ann@school.test" }, { first: "Bo", last: "Kim", email: "bo@school.test" }, { first: "Cal", last: "Roe", email: "cal@school.test" },
      { first: "Dot", last: "Fay", email: "dot@school.test" }, { first: "Eve", last: "Gu", email: "eve@school.test" },
    ],
  };
  let nextId = 6;

  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const path = u.pathname;
    const html = (b: string) => { res.setHeader("content-type", "text/html"); res.end(b); };
    const redirect = (to: string) => { res.statusCode = 302; res.setHeader("location", to); res.end(); };
    const withBody = (cb: (b: URLSearchParams) => void) => { let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => cb(new URLSearchParams(raw))); };

    if (path === "/__state") { res.setHeader("content-type", "application/json"); return void res.end(JSON.stringify(state)); }

    // ---- A: classic ----
    if (path === "/people" && req.method === "GET") {
      const rows = state.people.map((p) => `<tr><td>${p.id}</td><td>${esc(p.name)}</td><td>${p.year}</td><td><a href="/people/delete?id=${p.id}">Delete</a></td></tr>`).join("");
      return html(page("Students", `<h2>Students</h2><a href="/people/new">Add student</a><table><thead><tr><th>Student ID</th><th>Name</th><th>Year</th><th></th></tr></thead><tbody>${rows}</tbody></table>`));
    }
    if (path === "/people/delete" && req.method === "GET") {
      const id = u.searchParams.get("id") ?? "";
      return html(page("Confirm", `<h2>Delete ${esc(id)}?</h2><form method="post" action="/people/delete"><input type="hidden" name="id" value="${esc(id)}"><button type="submit">Yes, delete</button></form><a href="/people">Cancel</a>`));
    }
    if (path === "/people/delete" && req.method === "POST") return withBody((b) => { state.people = state.people.filter((p) => p.id !== b.get("id")); redirect("/people"); });
    if (path === "/people/new" && req.method === "GET") {
      return html(page("New student", `<h2>New student</h2><form method="post" action="/people/new"><label for="name">Name</label><input id="name" name="name" required><label for="year">Year</label><select id="year" name="year"><option>9</option><option>10</option><option>11</option><option>12</option></select><button type="submit">Save student</button></form>`));
    }
    if (path === "/people/new" && req.method === "POST") return withBody((b) => { state.people.push({ id: `S${nextId++}`, name: b.get("name") ?? "", year: b.get("year") ?? "" }); redirect("/people"); });

    // ---- B: paginated, icon-only, confirm() dialog ----
    if (path === "/staff" && req.method === "GET") {
      const pg = Number(u.searchParams.get("page") ?? "1");
      const per = 3;
      const slice = state.staff.slice((pg - 1) * per, pg * per);
      const rows = slice.map((s) => `<tr><td>${esc(s.first)}</td><td>${esc(s.last)}</td><td>${esc(s.email)}</td><td><button title="Remove" onclick="if(confirm('Remove this person?')){fetch('/staff/remove',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'email='+encodeURIComponent('${s.email}')}).then(function(){location.reload()})}"><i class="fa fa-trash"></i></button></td></tr>`).join("");
      const next = pg * per < state.staff.length ? `<a rel="next" href="/staff?page=${pg + 1}">Next &rsaquo;</a>` : "";
      return html(page("Staff directory", `<h2>Staff</h2><a class="add" href="/staff/add">+ New staff</a><table><tr><th>First</th><th>Last</th><th>Email</th><th></th></tr>${rows}</table>${next}`));
    }
    if (path === "/staff/remove" && req.method === "POST") return withBody((b) => { state.staff = state.staff.filter((s) => s.email !== b.get("email")); res.end("ok"); });
    if (path === "/staff/add" && req.method === "GET") {
      return html(page("New staff", `<h2>New staff</h2><form method="post" action="/staff/add"><label>First <input name="first"></label><label>Last <input name="last"></label><label>Email <input name="email" type="email"></label><input type="submit" value="Add"></form>`));
    }
    if (path === "/staff/add" && req.method === "POST") return withBody((b) => { state.staff.push({ first: b.get("first") ?? "", last: b.get("last") ?? "", email: b.get("email") ?? "" }); redirect("/staff"); });

    res.statusCode = 404; html(page("Not found", "<h1>Not found</h1>"));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, state, close: () => new Promise((r) => server.close(() => r())) };
}
