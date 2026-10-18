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
import { FormAdapter, HumanRequired, NoBrowser, NoSecret, NotAuthorized } from "../generator/form-adapter.js";
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
  tables: ["attach", "summary", "read", "list", "create", "delete", "counts", "exportAll", "pendingPublish", "publish", "reset"],
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

const errorName = (e: unknown): string =>
  e instanceof NotAuthorized ? "NotAuthorized" : e instanceof NoBrowser ? "NoBrowser" : e instanceof NoSecret ? "NoSecret" : e instanceof HumanRequired ? "HumanRequired" : "Error";

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
        await oneAtATime(async () => {
          await fetch("http://127.0.0.1:9100/reset", { method: "POST", signal: AbortSignal.timeout(5000) }).catch(() => undefined);
          await forms.reset(); await tables.reset();
        });
        return send(200, { ok: true, result: "reset", kinds: kindsNow() });
      }
      if (!ALLOWED[target]?.includes(method) || typeof targets[target]?.[method] !== "function") return send(400, { ok: false, error: { name: "Error", message: `not a worker method: ${target}.${method}` }, kinds: kindsNow() });
      const result = await oneAtATime(async () => await targets[target]![method]!.apply(targets[target], args ?? []));
      send(200, { ok: true, result: result ?? null, kinds: kindsNow() });
    } catch (e) {
      send(200, { ok: false, error: { name: errorName(e), message: String((e as Error).message ?? e).split("\n")[0] }, kinds: kindsNow() });
    }
  });
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, process.env.HOST ?? "0.0.0.0", () => console.log(`[worker] listening on :${port} (allowed hosts: ${process.env.WICKET_ALLOWED_HOSTS ?? "default"})`));
process.on("unhandledRejection", (e) => console.error("[worker] unhandled rejection:", e instanceof Error ? e.message : e));
process.on("SIGTERM", () => { void forms.close().finally(() => process.exit(0)); });
