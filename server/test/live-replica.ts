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

// --- a write on the replica behind the login, graded by the replica's own owner state (not by Aperture)
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(`${process.env.HOME}/.wicket/replica.env`, "utf8").split("\n").filter(Boolean).map((l) => l.split("=") as [string, string]));
const ownerState = async () => (await (await fetch("https://9105-agquzv5jxhq3utbstzpvnhdmni.instabox.tech/owner/state", { headers: { "X-Owner-Token": env.REPLICA_OWNER_TOKEN! } })).json()) as Record<string, any>;
const before = await ownerState();
console.log("owner state keys:", Object.keys(before).join(","));
const d = await tool("compile_site", { url: "http://127.0.0.1:9105/Login.aspx", login: "REPLICA", then: "http://127.0.0.1:9105/Devices.aspx" });
console.log(d.data.status === "compiled" ? "PASS" : "FAIL", "devices page compiled behind the login:", d.data.status, JSON.stringify((d.data.tables ?? []).map((t: any) => t.id)), "also live:", JSON.stringify(d.data.also_compiled_and_still_live ?? []));
const acc = await tool("compile_site", { url: "http://127.0.0.1:9105/Accounts.aspx" });
console.log(acc.data.status === "compiled" ? "PASS" : "FAIL", "the Accounts page (where Send lives) compiles, send steps seen:", JSON.stringify(acc.data.send_steps ?? []));
const del = await tool("apply", { op: "delete", kind: "residents", key: "1004" });
console.log(["done", "done_with_surprise"].includes(del.data.status) ? "PASS" : "FAIL", "delete 1004 behind the login:", del.data.status ?? del.data.error, del.data.detail ?? "", JSON.stringify(del.data.verified ?? {}).slice(0, 160));
console.log(del.data.not_yet_live ? "PASS" : "FAIL", "the receipt says the change is not yet sent to the gate:", String(del.data.not_yet_live ?? "(nothing said)").slice(0, 110));
const pub = await tool("publish", {});
console.log(pub.data.error === "send_needs_owner" ? "PASS" : "FAIL", "publish agrees with the receipt (recorded, not sent, owner sends):", pub.data.error, String(pub.data.detail ?? "").slice(0, 110));
const after = await ownerState();
console.log("portal residents:", before.portal?.residents?.length ?? before.residents, "->", after.portal?.residents?.length ?? after.residents, "| pending:", JSON.stringify(after.pending ?? after.pending_changes ?? null).slice(0, 120));
if (del.data.receipt) { const u = await tool("undo", { receipt_id: del.data.receipt }); console.log(u.data.status === "undone" ? "PASS" : "FAIL", "undo:", u.data.status ?? u.data.error, u.data.detail ?? "", JSON.stringify(u.data.verified?.fields_not_restored ?? [])); }
const fin = await ownerState(); console.log("after undo, portal residents:", fin.portal?.residents?.length ?? fin.residents);
