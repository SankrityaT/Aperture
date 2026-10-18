// A pool of workers behind one address, for public reading. Each worker is its own process with its own browser, so several
// pages load at once. A compile goes to the least busy worker and returns its forms and tables in one call. Reading a kind asks
// every worker that has it and merges the records, so cards found by different browsers make one list.
// Run: WICKET_WORKER_TOKEN=... WICKET_POOL=3 PORT=8790 npx tsx src/worker/pool.ts   (workers take PORT+1 .. PORT+N)
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";

const TOKEN = process.env.WICKET_WORKER_TOKEN ?? "";
if (TOKEN.length < 16) { console.error("[pool] set WICKET_WORKER_TOKEN"); process.exit(1); }
const N = Math.max(1, Number(process.env.WICKET_POOL ?? 3));
// Some sites reject a browser without a window (an HTTP/2 error, or the page never loads). Those get a visible browser.
const HEADED = Math.min(N, Math.max(0, Number(process.env.WICKET_POOL_HEADED ?? 1)));
const PORT = Number(process.env.PORT ?? 8790);
type Kinds = { forms: string[]; tables: string[] };
type B = { url: string; inflight: number; kinds: Kinds; n: number; headed: boolean };
const backends: B[] = [];
for (let i = 1; i <= N; i++) {
  const port = PORT + i;
  const headed = i > N - HEADED;
  const child = spawn("npx", ["tsx", "src/worker/server.ts"], { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", WICKET_HEADED: headed ? "1" : "0" }, stdio: ["ignore", "inherit", "inherit"] });
  process.on("exit", () => child.kill());
  backends.push({ url: `http://127.0.0.1:${port}`, inflight: 0, kinds: { forms: [], tables: [] }, n: 0, headed });
}
let last: B = backends[0]!;
let rr = 0;

const authed = (h: string | undefined) => { const g = Buffer.from((h ?? "").replace(/^Bearer\s+/i, "")); const w = Buffer.from(TOKEN); return g.length === w.length && timingSafeEqual(g, w); };
const union = (): Kinds => ({ forms: [...new Set(backends.flatMap((b) => b.kinds.forms))], tables: [...new Set(backends.flatMap((b) => b.kinds.tables))] });
type Body = { ok: boolean; result?: unknown; error?: unknown; kinds?: Kinds };
async function call(b: B, target: string, method: string, args: unknown[] = []): Promise<Body> {
  b.inflight++;
  try {
    const r = await fetch(`${b.url}/rpc`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ target, method, args }), signal: AbortSignal.timeout(85_000) });
    const body = (await r.json()) as Body;
    if (body.kinds) b.kinds = body.kinds;
    return body;
  } catch (e) {
    return { ok: false, error: { name: "WorkerBusy", message: `A pooled browser did not answer (${String((e as Error).message).split("\n")[0]}).` } };
  } finally { b.inflight--; }
}
const needsWindow = new Set<string>((process.env.WICKET_POOL_WINDOW_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean));
const hostOf = (u: unknown) => { try { return new URL(String(u)).hostname.toLowerCase(); } catch { return ""; } };
const pick = (headed?: boolean): B => {
  const set = headed === undefined ? backends : backends.filter((b) => b.headed === headed);
  const pool = set.length ? set : backends;
  const min = Math.min(...pool.map((b) => b.inflight)); const free = pool.filter((b) => b.inflight === min); return free[rr++ % free.length]!;
};
const rejected = (x: Body) => !x.ok && /HTTP2_PROTOCOL|ERR_CONNECTION|Timeout \d+ms exceeded|did not finish|hanging/i.test(JSON.stringify(x.error ?? ""));
const owners = (target: string, kind: string) => backends.filter((b) => (target === "tables" ? b.kinds.tables : b.kinds.forms).includes(kind));
const KIND_FIRST = new Set(["read", "list", "create", "delete", "update", "validate", "normalize", "driftCheck", "repair"]);

async function route(target: string, method: string, args: unknown[]): Promise<Body> {
  if (target === "forms" && method === "compileAll") {
    const host = hostOf(args[0]);
    let b = pick(HEADED && needsWindow.has(host) ? true : HEADED < N ? false : undefined); last = b;
    let s = await call(b, "forms", "compile", args);
    if (rejected(s) && !b.headed && HEADED) { needsWindow.add(host); b = pick(true); last = b; s = await call(b, "forms", "compile", args); }
    if (!s.ok) return s;
    const t = await call(b, "tables", "attach", []);
    return { ok: true, result: { summary: s.result, tables: t.ok ? t.result : [] } };
  }
  if (target === "forms" && (method === "compile" || method === "open")) { const b = pick(); last = b; return call(b, target, method, args); }
  if (method === "reset" || target === "demo") { const all = await Promise.all(backends.map((b) => call(b, target, method, args))); return all.find((x) => !x.ok) ?? all[0]!; }
  const kind = typeof args[0] === "string" ? (args[0] as string) : undefined;
  if (kind && (KIND_FIRST.has(method) || method === "counts" || method === "exportAll")) {
    const own = owners(target, kind);
    if (!own.length) return call(last, target, method, args);
    if (method === "list") {
      const all = await Promise.all(own.map((b) => call(b, target, method, args)));
      const bad = all.find((x) => !x.ok); if (bad && all.every((x) => !x.ok)) return bad;
      const m = new Map<string, Record<string, unknown>>();
      for (const x of all) for (const r of (x.ok ? (x.result as Record<string, unknown>[]) : [])) {
        const k = String(r.key ?? JSON.stringify(r)); const prev = m.get(k);
        m.set(k, prev && prev.source === "product page" && r.source !== "product page" ? prev : { ...(prev ?? {}), ...r });
      }
      return { ok: true, result: [...m.values()] };
    }
    if (method === "read") {
      const all = await Promise.all(own.map((b) => call(b, target, method, args)));
      return all.find((x) => x.ok && x.result) ?? all[0]!;
    }
    return call(own[0]!, target, method, args);
  }
  if (method === "counts" || method === "exportAll") {
    const all = await Promise.all(backends.map((b) => call(b, target, method, args)));
    return { ok: true, result: Object.assign({}, ...all.filter((x) => x.ok).map((x) => x.result as object)) };
  }
  return call(last, target, method, args);
}

createServer((req, res) => {
  const send = (code: number, body: unknown) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };
  if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, pool: backends.map((b) => ({ inflight: b.inflight })), kinds: union() });
  if (req.method !== "POST" || req.url !== "/rpc") return send(404, { ok: false, error: { name: "Error", message: "not found" } });
  if (!authed(req.headers.authorization)) return send(401, { ok: false, error: { name: "Error", message: "unauthorized" } });
  let raw = ""; req.on("data", (c) => { raw += c; if (raw.length > 1_000_000) req.destroy(); });
  req.on("end", async () => {
    try { const { target, method, args } = JSON.parse(raw) as { target: string; method: string; args?: unknown[] }; const r = await route(target, method, args ?? []); send(200, { ...r, kinds: union() }); }
    catch (e) { send(200, { ok: false, error: { name: "Error", message: String((e as Error).message).split("\n")[0] }, kinds: union() }); }
  });
}).listen(PORT, "127.0.0.1", () => console.log(`[pool] ${N} browsers behind :${PORT}`));
