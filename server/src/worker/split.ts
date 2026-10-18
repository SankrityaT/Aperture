// Two browsers, one view. Listed systems (the operator's own, signed in, writable) stay on the primary worker. Public pages are read
// by a second worker on an ordinary home or office connection, because large retail sites refuse datacenter addresses outright.
// The public worker has no stored logins and no listed hosts, so it can only read: changes there are refused by the worker itself.
import type { Kind, Rec } from "../types.js";
import type { CompileSummary } from "../generator/form-adapter.js";
import type { TableModel } from "../generator/tables.js";
import type { RemoteForms, RemoteTables, RemoteWorker } from "./remote.js";
import { exclusive } from "../generator/browser-lock.js";

const primaryHosts = (): string[] => (process.env.WICKET_PRIMARY_HOSTS ?? "127.0.0.1,localhost").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
const unreachable = (e: unknown): boolean => /could not be reached|did not answer this call|refused the token/.test(String((e as Error)?.message ?? e));
export const isPrimaryUrl = (url: string): boolean => { try { return primaryHosts().includes(new URL(url).hostname.toLowerCase()); } catch { return true; } };

abstract class SplitBase<T extends RemoteForms | RemoteTables> {
  /** Which worker the last compile went to: refresh and attach follow it. */
  active: T;
  constructor(readonly a: T, readonly b: T) { this.active = a; }
  kinds(): Kind[] { return [...new Set([...this.a.kinds(), ...this.b.kinds()])]; }
  protected by(kind: Kind): T { return this.b.kinds().includes(kind) && !this.a.kinds().includes(kind) ? this.b : this.a; }
  /** Both workers can hold a list with the same name (the primary fills in when the public worker is away): read both and
   *  merge by key, the public worker's rows winning (they are newer and may come from the product page itself). */
  private both(kind: Kind): boolean { return this.a.kinds().includes(kind) && this.b.kinds().includes(kind); }
  async read(kind: Kind, key: string): Promise<Rec | null> {
    if (!this.both(kind)) return this.by(kind).read(kind, key);
    return (await this.b.read(kind, key).catch(() => null)) ?? this.a.read(kind, key);
  }
  async list(kind: Kind, filter?: Record<string, unknown>): Promise<Rec[]> {
    if (!this.both(kind)) return this.by(kind).list(kind, filter);
    const [ra, rb] = await Promise.all([this.a.list(kind, filter).catch(() => [] as Rec[]), this.b.list(kind, filter).catch(() => [] as Rec[])]);
    const m = new Map<string, Rec>();
    for (const r of [...ra, ...rb]) m.set(String((r as Record<string, unknown>).key ?? JSON.stringify(r)), r);
    return [...m.values()];
  }
  create(kind: Kind, record: Rec): Promise<void> { return this.by(kind).create(kind, record); }
  delete(kind: Kind, key: string): Promise<void> { return this.by(kind).delete(kind, key); }
  async counts(forKind?: Kind): Promise<Record<Kind, number>> {
    if (forKind) return this.by(forKind).counts(forKind);
    const b = this.b.kinds().length ? await this.b.counts().catch(() => ({})) : {};
    return { ...b, ...(await this.a.counts()) };
  }
  async exportAll(forKind?: Kind): Promise<Record<Kind, Rec[]>> {
    if (forKind) return this.by(forKind).exportAll(forKind);
    const b = this.b.kinds().length ? await this.b.exportAll().catch(() => ({})) : {};
    return { ...b, ...(await this.a.exportAll()) };
  }
  pendingPublish(): Promise<string[]> { return this.a.pendingPublish(); }
  publish(): Promise<{ published: number; notified: number }> { return this.a.publish(); }
  async reset(): Promise<void> { await this.a.reset(); await this.b.reset().catch(() => undefined); }
}

export class SplitForms extends SplitBase<RemoteForms> {
  update(kind: Kind, key: string, patch: Record<string, unknown>): Promise<void> { return this.by(kind).update(kind, key, patch); }
  validate(kind: Kind, key: string, patch: Record<string, unknown>): Promise<string[]> { return this.by(kind).validate(kind, key, patch); }
  normalize(kind: Kind, patch: Record<string, unknown>): Promise<Record<string, unknown>> { return this.by(kind).normalize(kind, patch); }
  /** Public pages go to the public worker; if it cannot be reached (a laptop asleep), the primary reads them instead of failing. */
  async compile(url: string): Promise<CompileSummary> {
    if (isPrimaryUrl(url)) { this.active = this.a; return this.a.compile(url); }
    try { this.active = this.b; return await this.b.compile(url); }
    catch (e) { if (!unreachable(e)) throw e; this.active = this.a; return this.a.compile(url); }
  }
  /** A public page, without holding the primary's lock: the public worker compiles and reads tables in one call, several at once.
   *  If it cannot be reached, the primary does it, under the lock like any other compile. */
  async publicCompile(url: string, primaryTables: RemoteTables): Promise<{ summary: CompileSummary; tables: TableModel[] }> {
    try { return await this.b.compileAll(url); }
    catch (e) {
      if (!unreachable(e)) throw e;
      return exclusive(async () => { this.active = this.a; const summary = await this.a.compile(url); return { summary, tables: await primaryTables.attach() }; });
    }
  }
  signIn(url: string, secret: string) { this.active = this.a; return this.a.signIn(url, secret); }
  open(url: string): Promise<void> { this.active = isPrimaryUrl(url) ? this.a : this.b; return this.active.open(url); }
  refresh(): Promise<CompileSummary> { return this.active.refresh(); }
  summary(): Promise<CompileSummary> { return this.active.summary(); }
  formIds(): Promise<string[]> { return this.active.formIds(); }
}

export class SplitTables extends SplitBase<RemoteTables> {
  constructor(a: RemoteTables, b: RemoteTables, private readonly forms: SplitForms) { super(a, b); }
  /** Tables are read from whichever browser the last compile used. */
  attach(): Promise<TableModel[]> { this.active = this.forms.active === this.forms.a ? this.a : this.b; return this.active.attach(); }
  driftCheck(kind: Kind) { return this.by(kind).driftCheck(kind); }
  repair(kind: Kind) { return this.by(kind).repair(kind); }
  summary(): Promise<TableModel[]> { return this.active.summary(); }
}

export function split(primary: RemoteWorker, pub: RemoteWorker): { forms: SplitForms; tables: SplitTables } {
  const forms = new SplitForms(primary.forms, pub.forms);
  return { forms, tables: new SplitTables(primary.tables, pub.tables, forms) };
}
