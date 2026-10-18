// The worker: the part of Wicket that holds a browser. It runs on a machine that has one (an InstaBox desktop), and the
// MCP server, which can be anywhere, calls it over HTTPS. Same code as the local adapters, just reached by a tiny RPC.
//
// Safety, in order of importance:
//   - every call needs the bearer token (WICKET_WORKER_TOKEN); there is no open endpoint except /health
//   - only the adapter methods in ALLOWED can be called, nothing else
//   - the allowlist of hosts (WICKET_ALLOWED_HOSTS) and stored logins (WICKET_CREDS_*) live on THIS machine, never in a call
//   - one call at a time, because there is one browser and one logged-in session

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { FormAdapter, HumanRequired, NoBrowser, NoSecret, NotAuthorized, WorkerBusy } from "../generator/form-adapter.js";
import { TableAdapter } from "../generator/tables.js";

const TOKEN = process.env.WICKET_WORKER_TOKEN ?? "";
if (TOKEN.length < 16) {
  console.error("[worker] set WICKET_WORKER_TOKEN to a random string of at least 16 characters");
  process.exit(1);
}

const forms = new FormAdapter();
const tables = new TableAdapter(() => forms.currentPage());
const targets: Record<string, Record<string, (...a: any[]) => unknown>> = {
  forms: forms as unknown as Record<string, (...a: any[]) => unknown>,
  tables: tables as unknown as Record<string, (...a: any[]) => unknown>,
};
const ALLOWED: Record<string, string[]> = {
  forms: ["compile", "signIn", "open", "refresh", "summary", "formIds", "read", "list", "create", "delete", "update", "validate", "normalize", "counts", "exportAll", "pendingPublish", "publish", "reset"],
  tables: ["attach", "summary", "read", "list", "create", "delete", "counts", "exportAll", "pendingPublish", "publish", "reset", "driftCheck", "repair"],
};

const authed = (header: string | undefined): boolean => {
  const given = Buffer.from((header ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(TOKEN);
  return given.length === want.length && timingSafeEqual(given, want);
};

const kindsNow = () => ({ forms: forms.kinds(), tables: tables.kinds() });

let tail: Promise<unknown> = Promise.resolve();
const oneAtATime = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = tail.then(fn, fn);
  tail = next.catch(() => undefined);
  return next;
};

// A call that never finishes (a page that hangs) must not hold the one browser forever, and the caller must always get our answer
// before the InstaBox proxy's own cut-off (about 20 s) replaces it with a text page.
//  - Answer deadline: after ANSWER_MS the caller gets WorkerBusy. A call still waiting in the queue is then dropped, never run later.
//    A call already running may still finish: for a change the engine then says the outcome is unknown and reads the system.
//  - Run deadline: an action running longer than RUN_MS is stuck. Its page is replaced by a fresh one in the same signed-in session,
//    which makes the stuck action fail and frees the queue. Compiled pages are kept.
const ANSWER_MS = Number(process.env.WICKET_ANSWER_DEADLINE_MS ?? 18_000);
const RUN_MS = Number(process.env.WICKET_RUN_DEADLINE_MS ?? 17_000);
const withDeadline = <T>(fn: () => Promise<T>): Promise<T> => {
  let answered = false;
  let answerTimer: NodeJS.Timeout | undefined;
  const run = oneAtATime(async () => {
    if (answered) throw new WorkerBusy("dropped: the caller was already told the browser was busy");
    let stuck = false;
    const runTimer = setTimeout(() => { stuck = true; void forms.replacePage().catch(() => undefined); }, RUN_MS);
    try { return await fn(); }
    catch (e) { if (stuck) throw new WorkerBusy(`The page did not finish within ${Math.round(RUN_MS / 1000)} s (it is hanging). It was closed and replaced; whether a change on it happened is not known.`); throw e; }
    finally { clearTimeout(runTimer); }
  });
  const late = new Promise<never>((_, reject) => {
    answerTimer = setTimeout(() => {
      answered = true;
      reject(new WorkerBusy(`The browser did not finish this within ${Math.round(ANSWER_MS / 1000)} s: it was busy, or the page is hanging (a hanging page is closed and replaced).`));
    }, ANSWER_MS);
  });
  run.catch(() => undefined);
  return Promise.race([run, late]).finally(() => { answered = true; clearTimeout(answerTimer); });
};

const errorName = (e: unknown): string =>
  (e as { name?: string })?.name === "CapabilityDrift" ? "CapabilityDrift" : e instanceof NotAuthorized ? "NotAuthorized" : e instanceof NoBrowser ? "NoBrowser" : e instanceof NoSecret ? "NoSecret" : e instanceof HumanRequired ? "HumanRequired" : e instanceof WorkerBusy ? "WorkerBusy" : "Error";

const server = createServer((req, res) => {
  const send = (code: number, body: unknown) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };
  if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, kinds: kindsNow() });
  if (req.method !== "POST" || req.url !== "/rpc") return send(404, { ok: false, error: { name: "Error", message: "not found" } });
  if (!authed(req.headers.authorization)) return send(401, { ok: false, error: { name: "Error", message: "unauthorized" } });
  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 1_000_000) req.destroy(); });
  req.on("end", async () => {
    try {
      const { target, method, args } = JSON.parse(raw) as { target: string; method: string; args?: unknown[] };
      // Demo only: put the invented demo systems on this machine back to their starting state, and forget what was compiled.
      if (target === "demo" && method === "reset") {
        await withDeadline(async () => {
          await fetch("http://127.0.0.1:9100/reset", { method: "POST", signal: AbortSignal.timeout(5000) }).catch(() => undefined);
          await forms.reset(); await tables.reset();
        });
        return send(200, { ok: true, result: "reset", kinds: kindsNow() });
      }
      // Demo only: choose which gate-portal deletes hang, so the failure case can be tested on purpose.
      if (target === "demo" && method === "hang") {
        const [noop, after] = (args ?? []) as [string[], string[]];
        const q = new URLSearchParams({ noop: (noop ?? []).join(","), after: (after ?? []).join(",") });
        await fetch(`http://127.0.0.1:9104/__hang?${q}`, { signal: AbortSignal.timeout(5000) }).catch(() => undefined);
        return send(200, { ok: true, result: "hang set", kinds: kindsNow() });
      }
      // Reading a list of item cards is memory only: answer at once instead of queueing behind page loads.
      if (target === "forms" && (method === "list" || method === "read")) {
        const a = (args ?? []) as [string, string?];
        const rows = forms.cardRows(a[0], method === "read" ? (a[1] ?? "") : undefined);
        if (rows !== undefined) return send(200, { ok: true, result: rows, kinds: kindsNow() });
      }
      if (!ALLOWED[target]?.includes(method) || typeof targets[target]?.[method] !== "function") return send(400, { ok: false, error: { name: "Error", message: `not a worker method: ${target}.${method}` }, kinds: kindsNow() });
      const result = await withDeadline(async () => await targets[target]![method]!.apply(targets[target], args ?? []));
      send(200, { ok: true, result: result ?? null, kinds: kindsNow() });
    } catch (e) {
      const d = e as { kind?: string; klass?: string; drifts?: unknown };
      send(200, { ok: false, error: { name: errorName(e), message: String((e as Error).message ?? e).split("\n")[0], ...(d?.klass ? { kind: d.kind, klass: d.klass, drifts: d.drifts } : {}) }, kinds: kindsNow() });
    }
  });
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, process.env.HOST ?? "0.0.0.0", () => console.log(`[worker] listening on :${port} (allowed hosts: ${process.env.WICKET_ALLOWED_HOSTS ?? "default"})`));
process.on("unhandledRejection", (e) => console.error("[worker] unhandled rejection:", e instanceof Error ? e.message : e));
process.on("SIGTERM", () => { void forms.close().finally(() => process.exit(0)); });
