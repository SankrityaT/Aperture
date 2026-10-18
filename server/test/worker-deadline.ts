// A page that never answers must not jam the worker: the caller gets worker_busy in time, the stuck page is replaced, and the
// next call works. Run: CHROME_PATH=... npx tsx test/worker-deadline.ts
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { RemoteWorker } from "../src/worker/remote.js";

const SITE = 9391, W = 9392, TOKEN = "deadline-test-token-123456";
const site = createServer((req, res) => { if (req.url === "/hang") return; res.setHeader("content-type", "text/html"); res.end("<table><tr><th>Name</th></tr><tr><td>A</td></tr></table>"); }).listen(SITE);
const worker = spawn("npx", ["tsx", "src/worker/server.ts"], { env: { ...process.env, PORT: String(W), HOST: "127.0.0.1", WICKET_WORKER_TOKEN: TOKEN, WICKET_ALLOWED_HOSTS: "127.0.0.1", WICKET_ANSWER_DEADLINE_MS: "4000", WICKET_RUN_DEADLINE_MS: "3000" }, stdio: "inherit" });
const w = new RemoteWorker(`http://127.0.0.1:${W}`, TOKEN);
for (let i = 0; i < 40 && !(await w.health()); i++) await new Promise((r) => setTimeout(r, 250));

let fails = 0;
const check = (ok: boolean, what: string, detail: unknown) => { if (!ok) fails++; console.log(ok ? "PASS" : "FAIL", what, detail); };

await w.call("forms", "open", [`http://127.0.0.1:${SITE}/`]);
let t0 = Date.now();
const hung = await w.call("forms", "open", [`http://127.0.0.1:${SITE}/hang`]).then(() => "finished", (e: Error) => `${e.name}: ${e.message}`);
check(hung.startsWith("WorkerBusy") && Date.now() - t0 < 6000, "a hanging page answers worker_busy before the deadline", { hung, ms: Date.now() - t0 });

// A call queued behind the stuck one is answered too, and the queue frees once the stuck page is replaced.
t0 = Date.now();
const after = await w.call("forms", "open", [`http://127.0.0.1:${SITE}/`]).then(() => "ok", (e: Error) => `${e.name}: ${e.message}`);
check(after === "ok", "the next call works after the stuck page was replaced", { after, ms: Date.now() - t0 });

worker.kill(); site.close();
process.exit(fails ? 1 : 0);
