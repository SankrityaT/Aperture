// End-to-end over real MCP HTTP: compile a page, fill it, get refused on bad values, undo, submit with approval.
// Usage: CHROME_PATH=... npx tsx test/forms-e2e.ts http://127.0.0.1:3055   (the server must be running with a browser available)

import { startSite } from "./fixtures/site.js";

const base = (process.argv[2] ?? "http://127.0.0.1:3055").replace(/\/$/, "");
let id = 0, sid: string | undefined;

async function rpc(method: string, params?: unknown) {
  const t = performance.now();
  const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(sid ? { "mcp-session-id": sid } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  sid = res.headers.get("mcp-session-id") ?? sid;
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return { body: JSON.parse(line ? line.slice(6) : text), ms: Math.round(performance.now() - t) };
}
async function tool(name: string, args: Record<string, unknown>) {
  const { body, ms } = await rpc("tools/call", { name, arguments: args });
  const r = body.result;
  return { data: (r.structuredContent ?? JSON.parse(r.content[0].text)) as Record<string, any>, isError: !!r.isError, ms };
}
const results: boolean[] = [];
const check = (label: string, ok: boolean, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`); };

const site = await startSite();
try {
  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "forms-e2e", version: "0" } });
  await tool("reset_demo", {});

  const c = await tool("compile_site", { url: `${site.url}/signup` });
  check("compile_site reads the form and offers typed fields", c.data.status === "compiled" && c.data.forms?.[0]?.fields?.length >= 8, `(${c.ms} ms, ${c.data.forms?.[0]?.fields?.length} fields, form '${c.data.forms?.[0]?.id}')`);
  console.log("      compile reply size:", JSON.stringify(c.data).length, "chars");
  const formId = c.data.forms[0].id as string;

  const bad = await tool("apply", { op: "update", kind: formId, key: "current", patch: { age: 30, grade: "Z" } });
  check("bad values are refused with reasons and next moves", bad.isError && bad.data.error === "invalid_value" && bad.data.next.length > 0, bad.data.detail);

  const fill = await tool("apply", { op: "update", kind: formId, key: "current", patch: { username: "riley", email: "riley@example.com", age: 17, grade: "Year 10", house: "blue", consent: true } });
  check("fill commits and the page read-back matches", fill.data.status === "done" && fill.data.verified?.fields_match === true, `(${fill.ms} ms)`);
  check("nothing was submitted by filling", site.submissions.length === 0);

  const undo = await tool("undo", { receipt_id: fill.data.receipt });
  check("undo puts the old values back, verified", undo.data.status === "undone" && undo.data.verified?.restored === true, `(${undo.ms} ms)`);
  await tool("apply", { op: "update", kind: formId, key: "current", patch: { username: "riley", email: "riley@example.com", age: 17, grade: "Year 10", house: "blue", consent: true } });

  const sub = await tool("apply", { op: "publish" });
  check("submitting asks the owner and does not submit yet", sub.data.status === "awaiting_approval" && site.submissions.length === 0, sub.data.diff?.[0]);
  const ap = await fetch(`${base}/owner/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan_id: sub.data.plan_id }) });
  check("owner approves on the web page", ap.ok);
  const done = await tool("publish", { plan_id: sub.data.plan_id });
  check("submit goes through and the server received the values", done.data.status === "done" && site.submissions.length === 1 && site.submissions[0]!.body.username === "riley" && site.submissions[0]!.body.grade === "10", `(${done.ms} ms)`);
  const res = await tool("find", { kind: "result" });
  check("the agent can read what the site said back", /Thanks, received/.test(JSON.stringify(res.data)));

  const refused = await tool("compile_site", { url: "https://travel.state.gov/" });
  check("an unauthorized host is refused, with no workaround offered", refused.isError && refused.data.error === "not_authorized");

  const guide = await tool("get_instructions", {});
  check("instructions mention forms", /compile_site/.test(JSON.stringify(guide.data)));
} finally {
  await site.close();
}
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
