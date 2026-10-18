// The MCP server's view of a worker. These classes look exactly like the local FormAdapter and TableAdapter,
// so the engine and the tools do not know or care whether the browser is in this process or on another machine.

import type { Adapter, Kind, Rec } from "../types.js";
import type { CompileSummary } from "../generator/form-adapter.js";
import { HumanRequired, NoBrowser, NoSecret, NotAuthorized, WorkerBusy } from "../generator/form-adapter.js";
import type { TableModel } from "../generator/tables.js";

type Kinds = { forms: string[]; tables: string[] };

export class RemoteWorker {
  private kinds: Kinds = { forms: [], tables: [] };
  readonly forms: RemoteForms;
  readonly tables: RemoteTables;

  constructor(private readonly base: string, private readonly token: string) {
    this.forms = new RemoteForms(this);
    this.tables = new RemoteTables(this);
  }

  kindsOf(target: "forms" | "tables"): string[] {
    return this.kinds[target];
  }

  async call<T>(target: "forms" | "tables" | "demo", method: string, args: unknown[] = []): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base.replace(/\/$/, "")}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ target, method, args }),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      throw new NoBrowser(`The browser worker could not be reached (${String((e as Error).message).split("\n")[0]}). The operator needs to start it.`);
    }
    if (res.status === 401) throw new NoBrowser("The browser worker refused the token. The operator needs to check WICKET_WORKER_TOKEN.");
    // Anything but our JSON (a proxy's error page, a cut-off) means the worker did not answer this call.
    const text = await res.text();
    let body: { ok: boolean; result?: T; error?: { name: string; message: string }; kinds?: Kinds };
    try { body = JSON.parse(text); } catch { throw new WorkerBusy(`The browser worker did not answer this call (HTTP ${res.status}: ${text.slice(0, 60).replace(/\s+/g, " ")}).`); }
    if (body.kinds) this.kinds = body.kinds;
    if (body.ok) return body.result as T;
    const { name, message } = body.error ?? { name: "Error", message: "worker error" };
    if (name === "CapabilityDrift") { const x = body.error as unknown as { kind: string; klass: string; drifts: unknown[] }; throw Object.assign(new Error(message), { name: "CapabilityDrift", kind: x.kind, klass: x.klass, drifts: x.drifts }); }
    if (name === "NotAuthorized") throw new NotAuthorized(message);
    if (name === "NoBrowser") throw new NoBrowser(message);
    if (name === "NoSecret") throw new NoSecret(message);
    if (name === "HumanRequired") throw new HumanRequired(message);
    if (name === "WorkerBusy") throw new WorkerBusy(message);
    throw new Error(message);
  }

  /** Demo only: reset the invented demo systems on the worker's machine. */
  async resetDemo(): Promise<void> { await this.call("demo", "reset"); }

  async health(): Promise<boolean> {
    try { const r = await fetch(`${this.base.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(5000) }); return r.ok; } catch { return false; }
  }
}

abstract class RemoteBase implements Adapter {
  constructor(protected readonly w: RemoteWorker, protected readonly target: "forms" | "tables") {}
  kinds(): Kind[] { return this.w.kindsOf(this.target); }
  read(kind: Kind, key: string): Promise<Rec | null> { return this.w.call(this.target, "read", [kind, key]); }
  list(kind: Kind, filter?: Record<string, unknown>): Promise<Rec[]> { return this.w.call(this.target, "list", [kind, filter]); }
  create(kind: Kind, record: Rec): Promise<void> { return this.w.call(this.target, "create", [kind, record]); }
  delete(kind: Kind, key: string): Promise<void> { return this.w.call(this.target, "delete", [kind, key]); }
  counts(forKind?: Kind): Promise<Record<Kind, number>> { return this.w.call(this.target, "counts", [forKind]); }
  exportAll(forKind?: Kind): Promise<Record<Kind, Rec[]>> { return this.w.call(this.target, "exportAll", [forKind]); }
  pendingPublish(): Promise<string[]> { return this.w.call(this.target, "pendingPublish"); }
  publish(): Promise<{ published: number; notified: number }> { return this.w.call(this.target, "publish"); }
  reset(): Promise<void> { return this.w.call(this.target, "reset"); }
}

export class RemoteForms extends RemoteBase {
  constructor(w: RemoteWorker) { super(w, "forms"); }
  update(kind: Kind, key: string, patch: Record<string, unknown>): Promise<void> { return this.w.call("forms", "update", [kind, key, patch]); }
  validate(kind: Kind, key: string, patch: Record<string, unknown>): Promise<string[]> { return this.w.call("forms", "validate", [kind, key, patch]); }
  normalize(kind: Kind, patch: Record<string, unknown>): Promise<Record<string, unknown>> { return this.w.call("forms", "normalize", [kind, patch]); }
  compile(url: string): Promise<CompileSummary> { return this.w.call("forms", "compile", [url]); }
  /** Compile and read its tables in one call, on one browser (a pooled public worker serves several at once). */
  compileAll(url: string): Promise<{ summary: CompileSummary; tables: TableModel[] }> { return this.w.call("forms", "compileAll", [url]); }
  signIn(url: string, secret: string): Promise<{ signedIn: boolean; detail: string }> { return this.w.call("forms", "signIn", [url, secret]); }
  open(url: string): Promise<void> { return this.w.call("forms", "open", [url]); }
  refresh(): Promise<CompileSummary> { return this.w.call("forms", "refresh"); }
  summary(): Promise<CompileSummary> { return this.w.call("forms", "summary"); }
  formIds(): Promise<string[]> { return this.w.call("forms", "formIds"); }
}

export class RemoteTables extends RemoteBase {
  constructor(w: RemoteWorker) { super(w, "tables"); }
  attach(): Promise<TableModel[]> { return this.w.call("tables", "attach"); }
  driftCheck(kind: Kind) { return this.w.call<Awaited<ReturnType<NonNullable<Adapter["driftCheck"]>>>>("tables", "driftCheck", [kind]); }
  repair(kind: Kind) { return this.w.call<Awaited<ReturnType<NonNullable<Adapter["repair"]>>>>("tables", "repair", [kind]); }
  summary(): Promise<TableModel[]> { return this.w.call("tables", "summary"); }
}
