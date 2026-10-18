// End-to-end over real MCP HTTP for record lists: compile a page with a table, find, delete with approval, undo.
// Usage: CHROME_PATH=... npx tsx test/tables-e2e.ts http://127.0.0.1:3055

import { startApps } from "./fixtures/apps.js";

const base = (process.argv[2] ?? "http://127.0.0.1:3055").replace(/\/$/, "");
let id = 0, sid: string | undefined;

async function rpc(method: string, params?: unknown) {
  const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(sid ? { "mcp-session-id": sid } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  sid = res.headers.get("mcp-session-id") ?? sid;
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(line ? line.slice(6) : text);
}
async function tool(name: string, args: Record<string, unknown>) {
  const t = performance.now();
  const body = await rpc("tools/call", { name, arguments: args });
  const r = body.result;
  return { data: (r.structuredContent ?? JSON.parse(r.content[0].text)) as Record<string, any>, isError: !!r.isError, ms: Math.round(performance.now() - t) };
}
const results: boolean[] = [];
const check = (label: string, ok: boolean, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`); };
const approve = (plan_id: string) => fetch(`${base}/owner/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan_id }) });

const apps = await startApps();
try {
  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "tables-e2e", version: "0" } });
  await tool("reset_demo", {});

  for (const [path, kind, key, name] of [["/people", "students", "S4", "Dee Fox"], ["/staff", "staff", "dot@school.test", "Dot"]] as const) {
    console.log(`\n--- ${path}`);
    const c = await tool("compile_site", { url: `${apps.url}${path}` });
    const t = c.data.tables?.[0];
    check("compile finds the table, its key and its delete action", c.data.status === "compiled" && t?.id === kind && t.actions.some((a: string) => /delete/.test(a)), `(${c.ms} ms) key=${t?.key} cols=${t?.columns?.join("/")}`);
    console.log("      compile reply:", JSON.stringify(c.data).length, "chars");

    const f = await tool("find", { kind, query: name.split(" ")[0] });
    check("find returns the record with its key", f.data.count === 1 && f.data.items[0].key === key, `(${f.ms} ms)`);

    const ask = await tool("apply", { op: "delete", kind, key });
    check("the first delete this system has seen asks the owner", ask.data.status === "awaiting_approval");
    const ap = await approve(ask.data.plan_id);
    check("owner approves on the web page", ap.ok);
    const done = await tool("delete", { kind, key, plan_id: ask.data.plan_id });
    const gone = path === "/people" ? !apps.state.people.some((p) => p.id === key) : !apps.state.staff.some((s) => s.email === key);
    check("commit deletes it in the real app and the read-back confirms", done.data.status === "done" && done.data.verified?.subject_present === false && gone, `(${done.ms} ms)`);

    const back = await tool("undo", { receipt_id: done.data.receipt });
    check("undo re-creates it through the app's own form, verified", back.data.status === "undone" && back.data.verified?.restored === true, `(${back.ms} ms)`);
  }
} finally { await apps.close(); }
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
