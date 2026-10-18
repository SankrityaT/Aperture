// The hosted replica with a login, through the deployed server: the agent names a stored login and never sees the password.
const base = (process.argv[2] ?? "").replace(/\/$/, "");
let id = 0, sid: string | undefined;
async function rpc(method: string, params?: unknown) {
  const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(sid ? { "mcp-session-id": sid } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), signal: AbortSignal.timeout(180_000) });
  sid = res.headers.get("mcp-session-id") ?? sid; const text = await res.text(); const line = text.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(line ? line.slice(6) : text);
}
const tool = async (name: string, args: Record<string, unknown>) => { const r = (await rpc("tools/call", { name, arguments: args })).result; return { data: (r.structuredContent ?? JSON.parse(r.content[0].text)) as Record<string, any>, isError: !!r.isError }; };
await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "live-replica", version: "0" } });
const bad = await tool("compile_site", { url: "http://127.0.0.1:9105/Login.aspx", login: "NOSUCH", then: "http://127.0.0.1:9105/Residents.aspx" });
console.log(bad.data.error === "no_stored_login" ? "PASS" : "FAIL", "an unknown login name is a typed refusal:", bad.data.error);
const c = await tool("compile_site", { url: "http://127.0.0.1:9105/Login.aspx", login: "REPLICA", then: "http://127.0.0.1:9105/Residents.aspx" });
console.log(c.data.status === "compiled" ? "PASS" : "FAIL", "signed in with the stored login and compiled:", c.data.status, c.data.error ?? "", JSON.stringify((c.data.tables ?? []).map((t: any) => t.id)));
const f = await tool("find", { kind: (c.data.tables ?? [])[0]?.id ?? "residents" });
console.log(f.data.count === 91 ? "PASS" : "FAIL", "the list behind the login reads in full:", f.data.count, "records");
