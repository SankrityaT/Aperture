// End-to-end smoke test over real MCP HTTP. Usage: node test/smoke.mjs <base-url>   (default http://127.0.0.1:3055)
// Walks the whole story: find, a refused name, an in-policy delete, undo, an unconfirmed class delete that needs the
// owner, a surprise that is caught and undone, and the owner page. Prints timings so speed claims can be measured.

const base = (process.argv[2] ?? "http://127.0.0.1:3055").replace(/\/$/, "");
let id = 0;
let sid;

async function rpc(method, params) {
  const t = performance.now();
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(sid ? { "mcp-session-id": sid } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  sid = res.headers.get("mcp-session-id") ?? sid;
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  const body = JSON.parse(line ? line.slice(6) : text);
  return { body, ms: Math.round(performance.now() - t) };
}

async function tool(name, args) {
  const { body, ms } = await rpc("tools/call", { name, arguments: args });
  const r = body.result;
  const data = r?.structuredContent ?? JSON.parse(r.content[0].text);
  return { data, isError: !!r.isError, ms };
}

const ok = [];
function check(label, cond, extra = "") {
  ok.push(cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
}

await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "wicket-smoke", version: "0" } });
await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(sid ? { "mcp-session-id": sid } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });

const list = await rpc("tools/list", {});
const names = list.body.result.tools.map((t) => t.name);
check("tools listed", ["get_instructions", "find", "apply", "apply_batch", "undo", "escalate", "get_plan"].every((n) => names.includes(n)), `(${names.length} tools, ${list.ms} ms)`);

await tool("reset_demo", {});
const guide = await tool("get_instructions", {});
check("instructions are short and useful", JSON.stringify(guide.data).length < 2500, `(${JSON.stringify(guide.data).length} chars)`);

const found = await tool("find", { kind: "student", query: "alex morgan" });
check("find shows two students with the same name", found.data.count === 2 && /not unique/.test(found.data.note), `(${found.ms} ms)`);

const byName = await tool("apply", { op: "delete", kind: "student", key: "Alex Morgan" });
check("deleting by name is refused with suggestions and next moves", byName.isError && byName.data.error === "not_found" && byName.data.did_you_mean?.length === 2 && byName.data.next.length > 0);

const del = await tool("apply", { op: "delete", kind: "student", key: "S003" });
check("in-policy delete commits and is verified by read-back", del.data.status === "done" && del.data.verified?.ok === true, `(${del.ms} ms)`);
const undo = await tool("undo", { receipt_id: del.data.receipt });
check("undo restores it, verified", undo.data.status === "undone" && undo.data.verified?.restored === true, `(${undo.ms} ms)`);

const cls = await tool("apply", { op: "delete", kind: "class", key: "C101" });
check("class delete needs the owner and nothing changed yet", cls.data.status === "awaiting_approval" && !!cls.data.plan_id, `plan ${cls.data.plan_id}`);
const early = await tool("delete", { kind: "class", key: "C101", plan_id: cls.data.plan_id });
check("committing before approval is refused, not retried blindly", early.isError && early.data.error === "awaiting_approval");
const ap = await fetch(`${base}/owner/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan_id: cls.data.plan_id }) });
check("owner page approves (a plain web route, not an agent tool)", ap.ok);
const done = await tool("delete", { kind: "class", key: "C101", plan_id: cls.data.plan_id });
check("commit catches the surprise (timetable) and says so", done.data.status === "done_with_surprise" && done.data.surprise?.[0]?.kind === "timetable");
const back = await tool("undo", { receipt_id: done.data.receipt });
check("undo restores everything the surprise removed", back.data.status === "undone");
const next = await tool("delete", { kind: "class", key: "C102", dry_run: true });
check("the next class preview already knows about the timetable", next.data.diff?.some((l) => l.includes("timetable")), JSON.stringify(next.data.diff));

const state = await (await fetch(`${base}/owner/state`)).json();
console.log(`\nowner metrics: ${JSON.stringify(state.metrics)}`);
console.log(`${ok.filter(Boolean).length}/${ok.length} checks passed`);
process.exit(ok.every(Boolean) ? 0 : 1);
