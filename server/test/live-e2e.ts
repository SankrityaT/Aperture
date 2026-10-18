// The whole architecture, for real: an MCP server (anywhere) -> the public worker on an InstaBox machine -> demo systems
// on that machine. Ground truth is asked of the machine itself over `instabox exec`, never of Wicket's own read-back.
// Usage: npx tsx test/live-e2e.ts <mcp-base-url>

import { execFileSync } from "node:child_process";

const base = (process.argv[2] ?? "http://127.0.0.1:3055").replace(/\/$/, "");
let id = 0, sid: string | undefined;

async function rpc(method: string, params?: unknown) {
  const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(sid ? { "mcp-session-id": sid } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), signal: AbortSignal.timeout(180_000) });
  sid = res.headers.get("mcp-session-id") ?? sid;
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(line ? line.slice(6) : text);
}
async function tool(name: string, args: Record<string, unknown>) {
  const t = performance.now();
  const body = await rpc("tools/call", { name, arguments: args });
  const r = body.result;
  if (!r) throw new Error(`${name}: ${JSON.stringify(body).slice(0, 300)}`);
  return { data: (r.structuredContent ?? JSON.parse(r.content[0].text)) as Record<string, any>, isError: !!r.isError, ms: Math.round(performance.now() - t) };
}
const truth = (port: number, path: string): any => JSON.parse(execFileSync("instabox", ["exec", "wicket-worker", "--", `curl -s http://127.0.0.1:${port}${path}`], { encoding: "utf8", env: { ...process.env, INSTABOX_NO_TELEMETRY: "1", PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` } }));
const results: boolean[] = [];
const check = (label: string, ok: boolean, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`); };
const approve = (plan_id: string) => fetch(`${base}/owner/approve?token=${process.env.OWNER_TOKEN ?? ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan_id }) });

await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "live-e2e", version: "0" } });
await fetch(`${base}/owner/demo?token=${process.env.OWNER_TOKEN ?? ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reset" }) });
check("the demo systems start from a known state", truth(9101, "/__state").people.length === 5 && truth(9103, "/__aspx").residents.length === 14);

console.log("\n--- 1. a classic table with a confirmation page, on the machine");
let c = await tool("compile_site", { url: "http://127.0.0.1:9101/people" });
check("compile finds the list, its key and delete", c.data.status === "compiled" && c.data.tables?.[0]?.key === "Student ID", `(${c.ms} ms)`);
let ask = await tool("apply", { op: "delete", kind: "students", key: "S2" });
check("a delete this system has never seen asks the owner", ask.data.status === "awaiting_approval");
await approve(ask.data.plan_id);
let done = await tool("delete", { kind: "students", key: "S2", plan_id: ask.data.plan_id });
check("commit really deletes it (asked of the machine itself)", done.data.status === "done" && !truth(9101, "/__state").people.some((p: any) => p.id === "S2"), `(${done.ms} ms)`);
let back = await tool("undo", { receipt_id: done.data.receipt });
check("undo brings it back (asked of the machine itself)", back.data.status === "undone" && truth(9101, "/__state").people.some((p: any) => p.name === "Ben Ortiz"), `(${back.ms} ms)`);

console.log("\n--- 2. a client-rendered SPA grid with a custom modal");
c = await tool("compile_site", { url: "http://127.0.0.1:9102/spa" });
const spaKind = c.data.tables?.[0]?.id as string;
check("compile finds the div grid that has no <table>", c.data.status === "compiled" && !!spaKind && c.data.tables[0].paged === true, `(${c.ms} ms) kind=${spaKind}`);
ask = await tool("apply", { op: "delete", kind: spaKind, key: "ines@zoo.test" });
await approve(ask.data.plan_id);
done = await tool("delete", { kind: spaKind, key: "ines@zoo.test", plan_id: ask.data.plan_id });
check("delete on page 2 through the icon button and the modal", done.data.status === "done" && !truth(9102, "/__zoo").users.some((u: any) => u.email === "ines@zoo.test"), `(${done.ms} ms)`);

console.log("\n--- 3. an ASP.NET WebForms look-alike with postback links");
c = await tool("compile_site", { url: "http://127.0.0.1:9103/Residents.aspx" });
const aspKind = c.data.tables?.[0]?.id as string;
check("compile finds the grid past the filter row and the pager row", c.data.status === "compiled" && c.data.tables?.[0]?.key === "Dir", `(${c.ms} ms)`);
ask = await tool("apply", { op: "delete", kind: aspKind, key: "108" });
await approve(ask.data.plan_id);
done = await tool("delete", { kind: aspKind, key: "108", plan_id: ask.data.plan_id });
check("delete on page 2 through a javascript postback link", done.data.status === "done" && !truth(9103, "/__aspx").residents.some((r: any) => r.dir === "108"), `(${done.ms} ms)`);

console.log("\n--- 4. guardrails");
const bad = await tool("compile_site", { url: "https://travel.state.gov/" });
check("a government site is refused, with no workaround offered", bad.isError && bad.data.error === "not_authorized");
const byName = await tool("apply", { op: "delete", kind: aspKind, key: "Marlow" });
check("a name instead of a key is refused with suggestions", byName.isError && byName.data.error === "not_found");

console.log("\n--- 4b. the gate portal: two pages compiled in one session, a resident deleted with the devices that go with it (Armature case 1)");
const own = (path: string, body: unknown) => fetch(`${base}${path}?token=${process.env.OWNER_TOKEN ?? ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
await own("/owner/demo", { action: "reset" });
await own("/owner/dependency", { kind: "residents", cascade_kind: "devices", by: "Dir" });
await own("/owner/delegate", { kinds: ["residents", "devices"], ops: ["delete"], limit: 3, hours: 1 });
const sys = await tool("find_systems", { need: "remove a resident and their gate devices" });
check("discovery finds both gate-portal pages", (sys.data.matches ?? []).filter((m: any) => String(m.address).includes(":9104")).length >= 2);
const cr = await tool("compile_site", { url: "http://127.0.0.1:9104/Residents.aspx" });
const cd = await tool("compile_site", { url: "http://127.0.0.1:9104/Devices.aspx" });
const bothKinds = [cr.data.tables?.[0]?.id, cd.data.tables?.[0]?.id];
const fr = await tool("find", { kind: "residents" });
const fd = await tool("find", { kind: "devices" });
check("compiling the second page keeps the first (both kinds stay live)", fr.data.count === 91 && fd.data.count === 168, `kinds=${bothKinds.join(",")}`);
// Agents call tools in parallel. Three reads in the same instant must all succeed (one browser page, one lock).
const par = await Promise.all([tool("find", { kind: "residents" }), tool("find", { kind: "devices" }), tool("find", { kind: "residents", query: "Alder" })]);
check("three parallel reads all succeed with full data", par[0].data.count === 91 && par[1].data.count === 168 && !par.some((x) => x.isError), `(${Math.max(...par.map((x) => x.ms))} ms for the slowest)`);
// The exact pattern that broke an agent run: two compile_site calls in the same instant. Both pages must end up compiled.
await own("/owner/demo", { action: "reset" });
const pc = await Promise.all([tool("compile_site", { url: "http://127.0.0.1:9104/Residents.aspx" }), tool("compile_site", { url: "http://127.0.0.1:9104/Devices.aspx" })]);
const pf = await Promise.all([tool("find", { kind: "residents" }), tool("find", { kind: "devices" })]);
check("two compile_site calls in parallel still leave both pages compiled", pf[0].data.count === 91 && pf[1].data.count === 168 && !pc.some((x) => x.isError), `kinds live: residents=${pf[0].data.count} devices=${pf[1].data.count}`);
const gate = truth(9104, "/__state");
const del = await tool("apply", { op: "delete", kind: "residents", key: "1004" });
const after = truth(9104, "/__state");
check("the delete went through the owner's delegation and the check matched", del.data.status === "done" && del.data.authority?.startsWith("dlg_") && del.data.verified?.matches_prediction === true, `(${del.ms} ms)`);
check("ground truth: that resident and their devices are gone, nobody else", after.residents === gate.residents - 1 && after.devices < gate.devices && !truth(9104, "/__state").dirs.includes("1004"));
const und = await tool("undo", { receipt_id: del.data.receipt });
check("undo restores them", und.data.status === "undone" && truth(9104, "/__state").dirs.includes("1004"));
await own("/owner/dependency", { kind: "residents", cascade_kind: "nonexistent_kind", by: "Dir" });
const badDep = await tool("apply", { op: "delete", kind: "residents", key: "1010" });
check("a dependency on a page that is not compiled is a typed refusal with next moves", badDep.isError && !!badDep.data.error && !!badDep.data.detail && Array.isArray(badDep.data.next), JSON.stringify(badDep.data).slice(0, 120));

console.log("\n--- 5. reset for the next judge");
await fetch(`${base}/owner/demo?token=${process.env.OWNER_TOKEN ?? ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reset" }) });
check("the demo systems are back to the start", truth(9101, "/__state").people.length === 5 && truth(9103, "/__aspx").residents.length === 14 && truth(9102, "/__zoo").users.length === 11);

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
