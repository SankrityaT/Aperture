// The ticket engine. Every write is a ticket: preview, rules, approval when a rule says so, commit,
// read-back, receipt, undo. Plain code only. No model is used here.

import { createHash } from "node:crypto";
import { RuleBook } from "./rules.js";
import type { Ledger } from "./ledger.js";
import type {
  Adapter, Delta, Escalation, Kind, Mandate, Op, Plan, Receipt, Rec, Refusal, Snapshotted,
} from "./types.js";

// ---------- small helpers ----------

class Queue {
  private tail: Promise<unknown> = Promise.resolve();
  /** One write at a time per system. Reads skip this. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

function sha(v: unknown): string {
  return createHash("sha256").update(stable(v)).digest("hex").slice(0, 16);
}

function refuse(error: string, detail: string, next: string[], extra: Record<string, unknown> = {}): Refusal {
  return { status: "refused", error, detail, next, ...extra };
}

export function isRefusal(x: unknown): x is Refusal {
  return !!x && typeof x === "object" && (x as Refusal).status === "refused";
}

function addDelta(d: Delta, kind: Kind, n: number): void {
  d[kind] = (d[kind] ?? 0) + n;
}

function label(r: Rec): string {
  const name = (r.name ?? r.title ?? r.day ?? "") as string;
  return name ? `${r.key} ${name}` : r.key;
}

export interface EngineOpts {
  rules: RuleBook;
  mandate?: Partial<Mandate>;
  now?: () => number;
  cacheTtlMs?: number;
  /** Where tickets, receipts and undo copies are kept. Without one, a restart forgets them. */
  ledger?: Ledger;
}

/** A standing, bounded authority the owner grants once. The agent never creates or widens one. */
export interface Delegation {
  id: string; kinds: string[]; ops: ("create" | "update" | "delete")[]; limit: number; used: number;
  createdAt: number; expiresAt: number; note: string; paused: string | null; revoked: boolean;
}

/** What was compiled for one capability, whether it still holds, and every repair it has had. */
export interface RepairEntry { at: number; fromVersion: number; toVersion: number | null; failure: string; evidence: unknown; tests: unknown; outcome: "repaired" | "not_repaired"; before?: unknown; after?: unknown }
export interface ContractRecord {
  kind: Kind; version: number; status: "active" | "disabled"; since: number; lastOkAt: number | null;
  lastDrift: { klass: string; drifts: unknown; at: number } | null; history: RepairEntry[];
}
const isDrift = (e: unknown): e is { name: string; kind: string; klass: string; drifts: { what: string; blocking: boolean }[]; message: string } => !!e && typeof e === "object" && (e as { name?: string }).name === "CapabilityDrift";

export class Wicket {
  readonly plans = new Map<string, Plan>();
  readonly receipts = new Map<string, Receipt>();
  readonly escalations: Escalation[] = [];
  readonly rules: RuleBook;
  mandate: Mandate;
  deletesToday = 0;
  metrics = { calls: 0, previews: 0, commits: 0, refusals: 0, undos: 0, humanDecisions: 0, escalations: 0, surprises: 0, previewMs: [] as number[], commitMs: [] as number[] };

  private queue = new Queue();
  private cache = new Map<string, { at: number; data: unknown }>();
  private seq = { pln: 0, rcpt: 0, esc: 0 };
  private now: () => number;
  private cacheTtl: number;

  constructor(readonly adapter: Adapter, opts: EngineOpts) {
    this.rules = opts.rules;
    this.now = opts.now ?? Date.now;
    this.cacheTtl = opts.cacheTtlMs ?? 3000;
    this.mandate = { maxDeletesPerDay: 5, planTtlMs: 5 * 60_000, undoWindowMs: 24 * 3600_000, ...opts.mandate };
    this.ledger = opts.ledger ?? null;
    this.restore();
  }

  // ---------- durability ----------

  private ledger: Ledger | null;

  /** Write everything that matters to the ledger. Called after every state change; a failure to write is loud, not silent. */
  private persist(): void {
    if (!this.ledger) return;
    this.ledger.save({
      v: 1, plans: [...this.plans.values()], receipts: [...this.receipts.values()], escalations: this.escalations,
      delegations: [...this.delegations.values()], lessons: [...this.lessons.entries()], contracts: [...this.contracts.values()], seq: this.seq, deletesToday: this.deletesToday, mandate: this.mandate, rules: this.rules.exportRules(),
    });
  }

  private restore(): void {
    const s = this.ledger?.load() as { plans?: Plan[]; receipts?: Receipt[]; escalations?: Escalation[]; delegations?: Delegation[]; contracts?: ContractRecord[]; lessons?: [string, string[]][]; seq?: { pln: number; rcpt: number; esc: number }; deletesToday?: number; mandate?: Mandate; rules?: { kind: string; op: "delete" | "create" | "update"; cascades: { kind: string; by: string }[]; vouched: boolean }[] } | null;
    if (!s) return;
    for (const p of s.plans ?? []) {
      // The server stopped while this change was running. Whether it happened is not known, and it must not be retried blind.
      if (p.status === "executing") { p.status = "unknown"; p.reasons = ["The server stopped while this was running. Whether it happened is not known."]; }
      this.plans.set(p.id, p);
    }
    for (const r of s.receipts ?? []) this.receipts.set(r.id, r);
    this.escalations.push(...(s.escalations ?? []));
    for (const d of s.delegations ?? []) this.delegations.set(d.id, d);
    for (const c of s.contracts ?? []) this.contracts.set(c.kind, c);
    for (const [k, v] of s.lessons ?? []) this.lessons.set(k, v);
    if (s.seq) this.seq = s.seq;
    if (typeof s.deletesToday === "number") this.deletesToday = s.deletesToday;
    if (s.mandate) this.mandate = { ...this.mandate, ...s.mandate };
    for (const r of s.rules ?? []) this.rules.set(r.kind, r.op, r.cascades, r.vouched);
    this.persist();
  }

  // ---------- cached reads (fast path for find and preview) ----------

  private async cached<T>(key: string, load: () => Promise<T>): Promise<{ data: T; ageMs: number }> {
    const hit = this.cache.get(key);
    const t = this.now();
    if (hit && t - hit.at < this.cacheTtl) return { data: hit.data as T, ageMs: t - hit.at };
    const data = await load();
    this.cache.set(key, { at: t, data });
    return { data, ageMs: 0 };
  }

  private invalidate(): void {
    this.cache.clear();
    this.adapter.invalidate?.(); // a write through one adapter can change what another one would read
  }

  /** Forget cached reads, for example after a new system was compiled. */
  flush(): void {
    this.cache.clear();
  }

  // ---------- reads ----------

  instructions(): Record<string, unknown> {
    return {
      what: "A safe interface to a school records system. Every change is a ticket: preview, check, commit, read-back, undo.",
      kinds: this.adapter.kinds(),
      how: [
        "Look first: find(kind, query). Names are not unique. Always use the key.",
        "To change something: apply(op, kind, key). If the rules allow it, it commits at once and returns a receipt.",
        "To look before you commit: delete or create with dry_run: true, then commit with plan_id.",
        "Some changes need the owner. You get status awaiting_approval and a plan_id. Poll get_plan. Never retry blindly.",
        "publish pushes staged changes to the outside world. It always needs the owner.",
        "A receipt has verified facts from a read-back. If verified is false, say so. Do not claim success.",
        "undo(receipt_id) reverses a change within the undo window. Published changes cannot be recalled.",
        "A refusal always lists next moves. Follow one of them.",
        "Web forms: compile_site(url) reads a page's forms (only hosts the operator authorized). Each form is a kind with key 'current'. Fill with apply({op:'update', patch}). Submit with publish, which always needs the owner. A CAPTCHA is a human step.",
      ],
      mandate: this.mandate,
    };
  }

  async find(kind: Kind, query?: string, limit = 20): Promise<Record<string, unknown> | Refusal> {
    this.metrics.calls++;
    if (!this.adapter.kinds().includes(kind)) return this.r(refuse("unknown_kind", `No kind '${kind}'.`, [`find with one of: ${this.adapter.kinds().join(", ")}`]));
    const blocked = this.gate(kind); if (blocked) return blocked;
    let loaded: { data: Rec[]; ageMs: number };
    try { loaded = await this.cached(`list:${kind}`, () => this.adapter.list(kind)); } catch (e) { if (isDrift(e)) return this.onDrift(kind, e); return this.unexpected(e); }
    const { data, ageMs } = loaded;
    const q = query?.toLowerCase().trim();
    const hits = q ? data.filter((r) => Object.values(r).some((v) => typeof v === "string" && v.toLowerCase().includes(q))) : data;
    const note = hits.length > 1 && q ? "Several matches. Names are not unique, use the key." : undefined;
    return { kind, count: hits.length, items: hits.slice(0, limit), as_of_ms: ageMs, ...(hits.length > limit ? { truncated: true } : {}), ...(note ? { note } : {}) };
  }

  // ---------- preview ----------

  /** Work out what an op would change, without changing anything. */
  async preview(op: Op, batchDeletes = 0): Promise<Plan | Refusal> {
    this.metrics.calls++;
    const t0 = performance.now();
    const blocked = this.gate(op.kind); if (blocked) return blocked;
    let out: Plan | Refusal;
    try { out = await this.previewInner(op, batchDeletes); } catch (e) { if (isDrift(e) && op.kind) return this.onDrift(op.kind, e); return this.unexpected(e); }
    if (!isRefusal(out)) { this.metrics.previews++; this.metrics.previewMs.push(performance.now() - t0); }
    return out;
  }

  private r<T extends Refusal>(x: T): T {
    this.metrics.refusals++;
    return x;
  }

  /** A helpful not_found: keys are not names, so suggest likely matches. */
  private async notFound(kind: Kind, key: string): Promise<Refusal> {
    const { data: all } = await this.cached(`list:${kind}`, () => this.adapter.list(kind));
    const q = key.toLowerCase();
    const maybe = all.filter((r) => Object.values(r).some((v) => typeof v === "string" && v.toLowerCase().includes(q))).slice(0, 5);
    return refuse("not_found", `No ${kind} with key '${key}'. Keys are not names.`, [`find ${kind} with a query, then use the key`], maybe.length ? { did_you_mean: maybe.map((r) => ({ key: r.key, name: r.name ?? r.title })) } : {});
  }

  private async previewInner(op: Op, batchDeletes: number): Promise<Plan | Refusal> {
    const t = this.now();
    const id = `pln_${(++this.seq.pln).toString(36)}`;
    const base = { id, op, createdAt: t, expiresAt: t + this.mandate.planTtlMs, dependents: [] as Snapshotted[], diff: [] as string[], expectedDelta: {} as Delta, reasons: [] as string[], asOfMs: 0 };

    if (op.op === "publish") {
      const pending = await this.adapter.pendingPublish();
      if (pending.length === 0) return this.r(refuse("nothing_to_publish", "No changes are staged.", ["make a change first"]));
      const plan: Plan = { ...base, status: "awaiting_approval", subject: null, diff: [`~ ${pending.length} staged change${pending.length === 1 ? "" : "s"} go${pending.length === 1 ? "es" : ""} to the outside world`, ...pending.slice(0, 5).map((p) => `~ ${p}`), ...(pending.length > 5 ? [`~ and ${pending.length - 5} more`] : [])], needsApproval: true, reasons: ["publish always needs the owner"], hash: sha(pending), confirmed: true };
      this.plans.set(id, plan);
      this.persist();
      return plan;
    }

    const kind = op.kind;
    if (!kind || !this.adapter.kinds().includes(kind)) return this.r(refuse("unknown_kind", `No kind '${kind ?? ""}'.`, [`use one of: ${this.adapter.kinds().join(", ")}`]));

    if (op.op === "create") {
      const rec = op.record;
      if (!rec || !rec.key) return this.r(refuse("missing_key", "A record needs a unique key.", ["add a key field to the record"]));
      const exists = await this.adapter.read(kind, rec.key);
      if (exists) return this.r(refuse("already_exists", `${kind} ${rec.key} already exists.`, ["use a different key", `find ${kind} to see what exists`], { existing: exists }));
      const confirmed = this.rules.isConfirmed(kind, "create");
      const reasons = confirmed ? [] : [`creating a ${kind} has not been confirmed yet`];
      const plan: Plan = { ...base, status: reasons.length ? "awaiting_approval" : "previewed", subject: rec, diff: [`+ ${label(rec)}`], expectedDelta: { [kind]: 1 }, needsApproval: reasons.length > 0, reasons, hash: sha(rec), confirmed };
      this.applyDelegation(plan);
      this.plans.set(id, plan);
      this.persist();
      return plan;
    }

    if (op.op === "update") {
      const key = op.key;
      const patch = op.patch;
      if (!this.adapter.update) return this.r(refuse("unsupported", "This system does not support edits through Wicket.", ["use create and delete instead"]));
      if (!key) return this.r(refuse("missing_key", "update needs a key.", [`find ${kind} to get one`]));
      if (!patch || Object.keys(patch).length === 0) return this.r(refuse("empty_patch", "Nothing to change.", ["pass patch: { field: value }"]));
      const { data: subject, ageMs } = await this.cached(`read:${kind}:${key}`, () => this.adapter.read(kind, key));
      if (!subject) return this.r(await this.notFound(kind, key));
      const bad = Object.keys(patch).filter((f) => f === "key" || !(f in subject));
      if (bad.length) return this.r(refuse("unknown_field", `Cannot set: ${bad.join(", ")}.`, [`valid fields: ${Object.keys(subject).filter((f) => f !== "key").join(", ")}`], { valid_fields: Object.keys(subject).filter((f) => f !== "key") }));
      if (this.adapter.validate) {
        const problems = await this.adapter.validate(kind, key, patch);
        if (problems.length) return this.r(refuse("invalid_value", problems.join("; "), ["fix the values and try again", "describe_forms lists each field's type and allowed values"], { problems }));
      }
      // Compare, show, commit and verify in the system's own form of each value.
      const canonical = this.adapter.normalize ? await this.adapter.normalize(kind, patch) : patch;
      const changed = Object.entries(canonical).filter(([f, v]) => stable(subject[f]) !== stable(v));
      if (changed.length === 0) return this.r(refuse("no_change", "Those values are already set.", ["nothing to do"]));
      const confirmed = this.rules.isConfirmed(kind, "update");
      const reasons = confirmed ? [] : [`editing a ${kind} has not been confirmed yet, so the owner decides`];
      const plan: Plan = { ...base, op: { ...op, patch: canonical }, status: reasons.length ? "awaiting_approval" : "previewed", subject, dependents: [], diff: changed.map(([f, v]) => `~ ${f}: ${JSON.stringify(subject[f])} -> ${JSON.stringify(v)}`), expectedDelta: {}, needsApproval: reasons.length > 0, reasons, hash: sha(subject), confirmed, asOfMs: ageMs };
      this.applyDelegation(plan);
      this.plans.set(id, plan);
      this.persist();
      return plan;
    }

    // delete
    const key = op.key;
    if (!key) return this.r(refuse("missing_key", "delete needs a key.", [`find ${kind} to get one`]));
    const { data: subject, ageMs } = await this.cached(`read:${kind}:${key}`, () => this.adapter.read(kind, key));
    if (!subject) return this.r(await this.notFound(kind, key));
    if (this.deletesToday + batchDeletes + 1 > this.mandate.maxDeletesPerDay) {
      return this.r(refuse("policy_denied", `Daily delete limit reached: ${this.deletesToday + batchDeletes} of ${this.mandate.maxDeletesPerDay}.`, ["escalate(reason) to ask the owner for more", "wait until the limit resets"], { rule: "max_deletes_per_day", used: this.deletesToday + batchDeletes, limit: this.mandate.maxDeletesPerDay }));
    }
    const dependents: Snapshotted[] = [];
    const expectedDelta: Delta = {};
    addDelta(expectedDelta, kind, -1);
    for (const c of this.rules.cascadesFor(kind, "delete")) {
      if (!this.adapter.kinds().includes(c.kind)) return this.r(refuse("dependency_not_compiled", `Deleting a ${kind} also removes ${c.kind}, but the ${c.kind} page has not been compiled, so what would go with it cannot be shown or checked.`, [`compile_site the page for '${c.kind}' (find_systems lists it), then try again`, "nothing was changed"], { kind, needs: c.kind, compiled: this.adapter.kinds() }));
      const deps = await this.adapter.list(c.kind, { [c.by]: key });
      for (const d of deps) dependents.push({ kind: c.kind, record: d });
      addDelta(expectedDelta, c.kind, -deps.length);
    }
    const confirmed = this.rules.isConfirmed(kind, "delete");
    const reasons = confirmed ? [] : [`deleting a ${kind} has not been confirmed yet, so the owner decides`];
    const diff = [`- ${kind} ${label(subject)}`];
    const byKind = new Map<Kind, number>();
    for (const d of dependents) byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1);
    for (const [k, n] of byKind) diff.push(`- ${n} ${k}${n > 1 ? "s" : ""}`);
    const plan: Plan = { ...base, status: reasons.length ? "awaiting_approval" : "previewed", subject, dependents, diff, expectedDelta, needsApproval: reasons.length > 0, reasons, hash: sha({ subject, dependents }), confirmed, asOfMs: ageMs };
    this.applyDelegation(plan);
    this.plans.set(id, plan);
    this.persist();
    return plan;
  }

  // ---------- commit ----------

  async commit(planId: string): Promise<Receipt | Refusal | Plan> {
    this.metrics.calls++;
    return this.queue.run(async () => {
      const k = this.plans.get(planId)?.op.kind;
      const blocked = this.gate(k); if (blocked) return blocked;
      try { return await this.commitInner(planId); }
      catch (e) {
        if (!isDrift(e) || !k) { const plan = this.plans.get(planId); if (plan?.status === "executing") { plan.status = "unknown"; plan.reasons = ["The server hit an error while this was running. Whether it happened is not known."]; this.persist(); return this.r(refuse("outcome_unknown", "An error happened while this change was running, so it is not known whether it happened.", ["call reconcile with this plan_id", "never commit it again"], { plan_id: planId })); } return this.unexpected(e); }
        // If the change had already started, we no longer know whether it happened: say so, never retry.
        const plan = this.plans.get(planId);
        if (plan?.status === "executing") { plan.status = "unknown"; plan.reasons = ["The page changed while this was running. Whether it happened is not known."]; this.persist(); }
        const r = this.onDrift(k, e);
        return plan?.status === "unknown" ? this.r(refuse("outcome_unknown", "The page changed while this change was running, so it is not known whether it happened.", ["call reconcile with this plan_id", "never commit it again"], { plan_id: planId })) : r;
      }
    });
  }

  private async commitInner(planId: string): Promise<Receipt | Refusal | Plan> {
    const t0 = performance.now();
    const plan = this.plans.get(planId);
    if (!plan) return this.r(refuse("unknown_plan", `No plan '${planId}'.`, ["run a dry_run first to get a plan_id"]));
    if (plan.status === "committed") return this.r(refuse("already_committed", "This plan was already committed.", ["check the receipt, or make a new plan"]));
    if (plan.status === "rejected") return this.r(refuse("rejected", "The owner rejected this plan.", ["do not retry", "escalate(reason) if it is important"]));
    if (this.now() > plan.expiresAt) { plan.status = "expired"; return this.r(refuse("expired", "The plan expired.", ["run a new dry_run"])); }
    if (plan.status === "executing") return this.r(refuse("in_progress", "This change is running right now.", ["poll get_plan", "do not commit again"], { plan_id: plan.id }));
    if (plan.status === "unknown") return this.r(refuse("outcome_unknown", "The server stopped while this change was running, so it is not known whether it happened. It will not be retried blindly.", ["call reconcile with this plan_id: it reads the system and says what is true", "never re-commit a plan in this state"], { plan_id: plan.id }));
    if (plan.status === "stale") return this.r(refuse("changed_since_preview", "The record changed since the preview.", ["run a new dry_run"]));
    if (plan.needsApproval && plan.status !== "approved") {
      return this.r(refuse("awaiting_approval", plan.reasons.join("; ") || "needs the owner", ["poll get_plan until status is approved", "do not retry commit in a loop"], { plan_id: plan.id, diff: plan.diff }));
    }

    const { op } = plan;
    if (plan.delegatedBy) {
      const d = this.delegations.get(plan.delegatedBy);
      const live = d && !d.revoked && !d.paused && this.now() <= d.expiresAt && d.used < d.limit;
      if (!live) { plan.status = "awaiting_approval"; plan.needsApproval = true; plan.reasons = ["the delegation that covered this change has ended or been paused, so the owner decides"]; plan.delegatedBy = undefined; return this.r(refuse("delegation_ended", "The owner's delegation no longer covers this change.", ["poll get_plan: it now waits for the owner", "do not retry commit in a loop"], { plan_id: plan.id })); }
    }
    // Re-read, uncached, and compare to what was previewed.
    let currentHash = plan.hash;
    if (op.op === "delete" && op.kind && op.key) {
      const cur = await this.adapter.read(op.kind, op.key);
      if (!cur) { plan.status = "stale"; return this.r(refuse("changed_since_preview", "The record is already gone.", ["run find to see the current state"])); }
      const deps: Snapshotted[] = [];
      for (const c of this.rules.cascadesFor(op.kind, "delete")) {
        if (!this.adapter.kinds().includes(c.kind)) return this.r(refuse("dependency_not_compiled", `The ${c.kind} page is no longer compiled, so the effect of this delete cannot be checked.`, [`compile_site the page for '${c.kind}' again`, "nothing was changed"], { needs: c.kind }));
        for (const d of await this.adapter.list(c.kind, { [c.by]: op.key })) deps.push({ kind: c.kind, record: d });
      }
      currentHash = sha({ subject: cur, dependents: deps });
    } else if (op.op === "update" && op.kind && op.key) {
      const cur = await this.adapter.read(op.kind, op.key);
      if (!cur) { plan.status = "stale"; return this.r(refuse("changed_since_preview", "The record is gone.", ["run find to see the current state"])); }
      currentHash = sha(cur);
    } else if (op.op === "create" && op.record && op.kind) {
      if (await this.adapter.read(op.kind, op.record.key)) { plan.status = "stale"; return this.r(refuse("changed_since_preview", "That key now exists.", ["run a new dry_run"])); }
    } else if (op.op === "publish") {
      currentHash = sha(await this.adapter.pendingPublish());
    }
    if (currentHash !== plan.hash) { plan.status = "stale"; return this.r(refuse("changed_since_preview", "The record changed since the preview.", ["run a new dry_run"])); }
    if (op.op === "delete" && this.deletesToday + 1 > this.mandate.maxDeletesPerDay) {
      return this.r(refuse("policy_denied", "Daily delete limit reached.", ["escalate(reason) to ask the owner for more"]));
    }

    // A canary looks at every compiled table, so a cascade into another table is seen. Ordinary commits look only at their own.
    // Ordinary commits look at their own table and every table the plan says will change, so a predicted cascade can be checked.
    const scope: Kind[] | undefined = this.careful || !op.kind ? undefined : [...new Set([op.kind, ...Object.keys(plan.expectedDelta)])];
    const countsOf = async (): Promise<Record<Kind, number>> => { if (!scope) return this.adapter.counts(); const out: Record<Kind, number> = {}; for (const k of scope) Object.assign(out, await this.adapter.counts(k)); return out; };
    const exportOf = async (): Promise<Record<Kind, Rec[]>> => { if (!scope) return this.adapter.exportAll(); const out: Record<Kind, Rec[]> = {}; for (const k of scope) Object.assign(out, await this.adapter.exportAll(k)); return out; };
    const before = await countsOf();
    const fullBefore = (plan.confirmed && !this.careful) || op.op === "publish" ? null : await exportOf();
    const snapshot: Snapshotted[] = op.op === "delete" && plan.subject && op.kind ? [{ kind: op.kind, record: plan.subject }, ...plan.dependents] : [];
    if (op.op === "update" && op.kind && op.key && op.patch && plan.subject) {
      // Only the fields we are about to change need saving.
      snapshot.push({ kind: op.kind, record: { key: op.key, ...Object.fromEntries(Object.keys(op.patch).map((f) => [f, plan.subject![f]])) } });
    }

    // Record that this is running, with the undo copy, BEFORE touching the system. A crash from here on leaves 'unknown', never a silent success.
    plan.status = "executing"; plan.snapshot = snapshot; this.persist();

    // Do the change.
    let appError: string | null = null;
    try {
      if (op.op === "update" && op.kind && op.key && op.patch && this.adapter.update) await this.adapter.update(op.kind, op.key, op.patch);
      else if (op.op === "delete" && op.kind && op.key) await this.adapter.delete(op.kind, op.key);
      else if (op.op === "create" && op.kind && op.record) await this.adapter.create(op.kind, op.record);
      else if (op.op === "publish") await this.adapter.publish();
    } catch (e) {
      this.invalidate();
      // The app errored or hung. That says nothing about whether the change happened. Look, instead of guessing.
      let gone: boolean | null = null;
      if (op.op === "delete" && op.kind && op.key) { try { gone = (await this.adapter.read(op.kind, op.key)) === null; } catch { gone = null; } }
      if (gone !== true) {
        return this.finish(plan, snapshot, { status: "failed", verified: { error: String((e as Error).message).split("\n")[0], subject_present: gone === null ? "unknown" : true, note: gone === null ? "The app errored and the state could not be read back. Check the system before retrying." : "The app errored and the record is still there. Nothing changed." } }, t0);
      }
      appError = String((e as Error).message).split("\n")[0] ?? "the app errored";
    }
    this.invalidate();

    // Read back and compare with the prediction.
    const after = await countsOf();
    const actual: Delta = {};
    for (const k of Object.keys(after)) if ((after[k] ?? 0) !== (before[k] ?? 0)) actual[k] = (after[k] ?? 0) - (before[k] ?? 0);
    const predicted = Object.fromEntries(Object.entries(plan.expectedDelta).filter(([, n]) => n !== 0));
    let verified: Record<string, unknown> = {};
    if (op.op === "delete" && op.kind && op.key) verified.subject_present = (await this.adapter.read(op.kind, op.key)) !== null;
    if (op.op === "create" && op.kind && op.record) verified.subject_present = (await this.adapter.read(op.kind, op.record.key)) !== null;
    if (op.op === "update" && op.kind && op.key && op.patch) {
      const now = await this.adapter.read(op.kind, op.key);
      const mismatched = Object.entries(op.patch).filter(([f, v]) => !now || stable(now[f]) !== stable(v)).map(([f]) => f);
      verified.subject_present = now !== null;
      verified.fields_match = mismatched.length === 0;
      if (mismatched.length) verified.mismatched = mismatched;
    }
    if (op.op === "publish") verified.still_pending = (await this.adapter.pendingPublish()).length;

    const surprises: { kind: Kind; delta: number }[] = [];
    if (op.op !== "publish") {
      for (const k of new Set([...Object.keys(actual), ...Object.keys(predicted)])) {
        const a = actual[k] ?? 0, p = (predicted as Delta)[k] ?? 0;
        if (a !== p) surprises.push({ kind: k, delta: a - p });
      }
    }
    if (appError) verified.app_error = `The app reported an error (${appError}) but the change did happen. It was confirmed by reading the system back.`;
    verified.counts_after = after;
    verified.matches_prediction = surprises.length === 0;
    const okSubject = op.op === "delete" ? verified.subject_present === false : op.op === "create" ? verified.subject_present === true : op.op === "update" ? verified.fields_match === true : verified.still_pending === 0;
    verified.ok = okSubject && surprises.length === 0;

    // A surprise becomes a rule, and everything it removed is saved so undo can restore it.
    if (surprises.length && fullBefore && op.kind && op.key && op.op === "delete") {
      const fullAfter = await exportOf();
      for (const s of surprises) {
        if (s.delta >= 0) continue;
        const gone = (fullBefore[s.kind] ?? []).filter((r) => !(fullAfter[s.kind] ?? []).some((x) => x.key === r.key));
        for (const g of gone) {
          if (!snapshot.some((x) => x.kind === s.kind && x.record.key === g.key)) snapshot.push({ kind: s.kind, record: g });
          const by = Object.keys(g).find((f) => f !== "key" && g[f] === op.key);
          if (by) this.rules.learn(op.kind, "delete", { kind: s.kind, by });
        }
      }
      this.metrics.surprises++;
    } else if (surprises.length) {
      verified.restorable = false;
      this.metrics.surprises++;
      if (op.kind && op.op !== "publish") this.rules.learn(op.kind, op.op, { kind: surprises[0]!.kind, by: "unknown" });
    }
    if (!surprises.length && op.kind && op.op !== "publish") this.rules.confirm(op.kind, op.op);

    if (op.op === "delete") this.deletesToday++;
    return this.finish(plan, snapshot, { status: !okSubject ? "failed" : surprises.length ? "done_with_surprise" : "done", verified, surprise: surprises.length ? surprises : undefined }, t0);
  }

  private finish(plan: Plan, snapshot: Snapshotted[], r: { status: Receipt["status"]; verified: Record<string, unknown>; surprise?: Receipt["surprise"] }, t0: number): Receipt {
    const t = this.now();
    const receipt: Receipt = { id: `rcpt_${(++this.seq.rcpt).toString(36)}`, planId: plan.id, op: plan.op, at: t, status: r.status, verified: r.verified, snapshot, undoUntil: t + this.mandate.undoWindowMs, authority: plan.delegatedBy ?? (plan.confirmed ? "confirmed rule" : "owner approval"), ...(plan.recovery ? { recovery: plan.recovery } : {}), ...(r.surprise ? { surprise: r.surprise } : {}) };
    if (plan.delegatedBy) {
      const d = this.delegations.get(plan.delegatedBy);
      if (d) { d.used++; if (r.status !== "done") d.paused = `receipt ${receipt.id} was ${r.status}: the delegation is paused until the owner resumes it`; }
    }
    this.receipts.set(receipt.id, receipt);
    plan.status = "committed"; plan.snapshot = undefined;
    this.metrics.commits++;
    this.metrics.commitMs.push(performance.now() - t0);
    this.persist();
    return receipt;
  }

  /**
   * After a crash: read the system to find out what really happened to a change that was running. It never re-runs the change.
   * Present means it happened (a receipt is made from the undo copy that was saved before it started); absent means it did not (the plan is retired).
   */
  async reconcile(planId: string): Promise<Record<string, unknown> | Refusal> {
    this.metrics.calls++;
    return this.queue.run(async () => {
      const plan = this.plans.get(planId);
      if (!plan) return this.r(refuse("unknown_plan", `No plan '${planId}'.`, []));
      if (plan.status !== "unknown") return this.r(refuse("not_unknown", `Plan is ${plan.status}; there is nothing to reconcile.`, plan.status === "committed" ? ["look at its receipt"] : []));
      const { op } = plan;
      let happened: boolean | null = null;
      try {
        if (op.op === "delete" && op.kind && op.key) happened = (await this.adapter.read(op.kind, op.key)) === null;
        else if (op.op === "create" && op.kind && op.record) happened = (await this.adapter.read(op.kind, op.record.key)) !== null;
        else if (op.op === "update" && op.kind && op.key && op.patch) { const now = await this.adapter.read(op.kind, op.key); happened = !!now && Object.entries(op.patch).every(([f, v]) => stable(now[f]) === stable(v)); }
      } catch { happened = null; }
      if (happened === null) return this.r(refuse("cannot_reconcile", "The system could not be read, so what happened is still unknown.", ["check the system by hand", "try reconcile again when it is reachable"]));
      if (!happened) { plan.status = "stale"; plan.snapshot = undefined; this.persist(); return { status: "not_applied", plan_id: planId, note: "The system shows the change did not happen. Nothing was changed. Make a new plan if it is still wanted." }; }
      const receipt = this.finish(plan, plan.snapshot ?? [], { status: "done", verified: { ok: true, reconciled: true, subject_present: op.op !== "delete", note: "Found done after a restart. The change was verified by reading the system now; the earlier prediction check and dependents were not re-verified." } }, performance.now());
      return { ...this.present(receipt), reconciled: true, note: "The change had happened. A receipt was made from the undo copy saved before it started. Dependents were not re-verified." };
    });
  }

  // ---------- apply: preview and commit in one call when the rules allow ----------

  async apply(op: Op, batchDeletes = 0): Promise<Record<string, unknown> | Refusal> {
    const plan = await this.preview(op, batchDeletes);
    if (isRefusal(plan)) return plan;
    if (plan.needsApproval) {
      return { status: "awaiting_approval", plan_id: plan.id, diff: plan.diff, reasons: plan.reasons, next: ["poll get_plan until approved, then commit with plan_id", "keep working on other items meanwhile"] };
    }
    const res = await this.commit(plan.id);
    return this.present(res);
  }

  /**
   * Many changes, safely. Two optional modes:
   *  - dryRun: change nothing; return the total blast radius (everything that would go, dependents included).
   *  - canary: commit only the first N, check each did exactly what was predicted, and halt the rest if any surprised or failed.
   */
  /**
   * Commit plans the owner already approved, in order. The first `canary` run carefully (every compiled table is compared);
   * if any of them does not do exactly what was predicted, the rest are not touched.
   */
  async commitBatch(planIds: string[], canary = 1): Promise<Record<string, unknown>> {
    this.metrics.calls++;
    const committed: unknown[] = []; const refused: unknown[] = [];
    let halted: Record<string, unknown> | null = null; let notAttempted = 0;
    for (let i = 0; i < planIds.length; i++) {
      if (halted) { notAttempted++; continue; }
      this.careful = i < canary;
      const rc = await this.commit(planIds[i]!).finally(() => { this.careful = false; });
      if (isRefusal(rc)) { refused.push({ i, plan_id: planIds[i], error: rc.error, detail: rc.detail, next: rc.next }); if (i < canary) halted = { at: i, why: `The canary could not run: ${rc.error}.` }; continue; }
      const out = this.present(rc as Receipt);
      committed.push({ i, ...out });
      if (i < canary && out.status !== "done") halted = { at: i, receipt: out.receipt, status: out.status, surprise: out.surprise ?? null, why: "A canary item did not do exactly what was predicted, so the rest was not attempted. Undo it with the receipt, or approve the surprise and run the rest." };
    }
    return { status: halted ? "halted_by_canary" : "batch_done", committed: committed.length, refused: refused.length, not_attempted: notAttempted, ...(halted ? { canary_halt: halted } : {}), items: { committed, refused } };
  }

  /** No tool ever answers with a bare error. Anything unexpected becomes a refusal with a code, a detail and next moves. */
  private unexpected(e: unknown): Refusal {
    const msg = String((e as Error)?.message ?? e).split("\n")[0] ?? "error";
    const m = /unknown kind (\S+)/.exec(msg);
    if (m) return this.r(refuse("unknown_kind", `No kind '${m[1]}' is compiled.`, [`compile_site the page that holds '${m[1]}' (find_systems lists the systems)`, `compiled now: ${this.adapter.kinds().join(", ") || "nothing"}`]));
    return this.r(refuse("internal_error", `Something failed inside Wicket: ${msg}`, ["nothing is known to have changed by this call unless a receipt says so", "try again once; if it repeats, escalate with this message"], { detail_for_owner: msg }));
  }

  // ---------- recovery: say how a change can be reversed BEFORE doing it, and remember what undo could not restore ----------

  /** What undo of each kind of change has failed to restore before (for example an id the app reissued). Persisted. */
  private lessons = new Map<string, string[]>();

  private recoveryFor(op: Op): NonNullable<Plan["recovery"]> {
    const lessons = op.kind ? this.lessons.get(`${op.kind}:${op.op}`) : undefined;
    const l = lessons?.length ? { lessons } : {};
    if (op.op === "delete") return { strategy: "recreate_from_saved_copy", expected: lessons?.length ? "partial: this system has not given back everything last time (see lessons)" : "functionally equivalent: the record comes back with its saved values; ids and links the app assigns itself may differ", ...l };
    if (op.op === "create") return { strategy: "delete_what_was_created", expected: "exact: the new record is removed again", ...l };
    if (op.op === "update") return { strategy: "write_back_old_values", expected: "exact for the fields changed, if the app stores what it is given", ...l };
    return { strategy: "none", expected: "cannot be reversed: it has gone outside this system" };
  }

  // ---------- contracts: a compiled capability is only trusted while the page still matches it ----------

  private contracts = new Map<string, ContractRecord>();
  private repairing = new Set<string>();

  private contractOf(kind: Kind): ContractRecord {
    let c = this.contracts.get(kind);
    if (!c) { c = { kind, version: 1, status: "active", since: this.now(), lastOkAt: null, lastDrift: null, history: [] }; this.contracts.set(kind, c); }
    return c;
  }

  /** A disabled capability refuses all work until it is repaired and the repair has passed its tests. */
  private gate(kind: Kind | undefined): Refusal | null {
    if (!kind) return null;
    const c = this.contracts.get(kind);
    if (!c || c.status !== "disabled") return null;
    return this.r(refuse("capability_disabled", `The page for '${kind}' changed since it was compiled, so Wicket stopped using it.`, ["check_capability to see what changed", "repair_capability to re-learn it; it is only re-enabled if the repair passes its tests", "do not retry the change until then"], { kind, version: c.version, drift: c.lastDrift }));
  }

  private onDrift(kind: Kind, e: { klass: string; drifts: unknown; message: string }): Refusal {
    const c = this.contractOf(kind);
    c.lastDrift = { klass: e.klass, drifts: e.drifts, at: this.now() };
    if (e.klass === "ui_changed") c.status = "disabled";
    this.persist();
    if (e.klass === "auth") return this.r(refuse("signed_out", "The system is asking for a sign-in again.", ["ask the operator to sign in again, then retry", "nothing was changed"], { kind }));
    return this.r(refuse("capability_changed", e.message, ["check_capability to see exactly what changed", "repair_capability to re-learn it", "nothing was changed by this call"], { kind, drift: e.drifts }));
  }

  /** Read-only: does the page still match what was compiled? */
  async checkCapability(kind: Kind): Promise<Record<string, unknown> | Refusal> {
    this.metrics.calls++;
    if (!this.adapter.kinds().includes(kind)) return this.r(refuse("unknown_kind", `No kind '${kind}'.`, [`use one of: ${this.adapter.kinds().join(", ")}`]));
    if (!this.adapter.driftCheck) return this.r(refuse("unsupported", "This system cannot be checked for page changes.", []));
    return this.queue.run(async () => {
      const c = this.contractOf(kind);
      const r = await this.adapter.driftCheck!(kind);
      if (r.ok) { c.lastOkAt = this.now(); if (c.status === "disabled") { c.status = "active"; c.lastDrift = null; } this.persist(); return { kind, status: c.status, version: c.version, matches_contract: true, notes: r.drifts.filter((d) => !d.blocking), last_ok_at: c.lastOkAt }; }
      if (r.klass === "ui_changed") { c.status = "disabled"; c.lastDrift = { klass: r.klass, drifts: r.drifts, at: this.now() }; }
      this.persist();
      const next = r.klass === "ui_changed" ? ["repair_capability to re-learn it; changes stay refused until it passes"] : r.klass === "auth" ? ["ask the operator to sign in again"] : ["try again; this is not a change to the page"];
      return { kind, status: c.status, version: c.version, matches_contract: false, class: r.klass, drifts: r.drifts, ...(r.note ? { note: r.note } : {}), next };
    });
  }

  /** Re-learn a disabled capability. Read-only on the system. Re-enabled only if every test passes; otherwise it stays disabled and the owner is told. */
  async repairCapability(kind: Kind): Promise<Record<string, unknown> | Refusal> {
    this.metrics.calls++;
    const c = this.contracts.get(kind);
    if (!c || c.status !== "disabled") return this.r(refuse("not_broken", `'${kind}' is not disabled, so there is nothing to repair.`, ["check_capability to look for page changes"]));
    if (!this.adapter.repair) return this.r(refuse("unsupported", "This system cannot be repaired automatically.", ["ask the operator"]));
    if (this.repairing.has(kind)) return this.r(refuse("repair_in_progress", "A repair of this capability is already running.", ["wait and call check_capability"]));
    this.repairing.add(kind);
    try {
      return await this.queue.run(async () => {
        const failure = JSON.stringify(c.lastDrift?.drifts ?? "unknown").slice(0, 600);
        const r = await this.adapter.repair!(kind);
        const entry: RepairEntry = { at: this.now(), fromVersion: c.version, toVersion: r.status === "repaired" ? c.version + 1 : null, failure, evidence: c.lastDrift, tests: r.tests, outcome: r.status, before: r.before, after: r.after };
        c.history.push(entry);
        if (r.status === "repaired") { c.version++; c.status = "active"; c.lastDrift = null; c.lastOkAt = this.now(); this.persist(); return { kind, status: "repaired", version: c.version, tests: r.tests, note: "Re-enabled. This repair only changes how the page is read. It adds no permissions: delegations and approvals are unchanged.", rollback: `version ${entry.fromVersion} is kept in the history` }; }
        this.escalate(`The page for '${kind}' changed and the repair could not be proven correct. It stays disabled. ${r.tests.filter((t) => !t.pass).map((t) => t.name + ": " + t.detail).join("; ")}`);
        this.persist();
        return this.r(refuse("repair_not_proven", "The repair did not pass its tests, so the capability stays disabled.", ["do not retry the change", "the owner has been told", "a person should look at the page"], { kind, tests: r.tests }));
      });
    } finally { this.repairing.delete(kind); }
  }

  // ---------- delegation: authority granted once by the owner, inside which no per-item approval is needed ----------

  private delegations = new Map<string, Delegation>();

  /** Owner only (reached from the token-protected owner routes, never from a tool). */
  delegate(g: { kinds: string[]; ops: Delegation["ops"]; limit: number; ttlMs: number; note?: string }): Delegation {
    const d: Delegation = { id: `dlg_${(this.delegations.size + 1).toString(36)}`, kinds: g.kinds, ops: g.ops, limit: Math.max(1, Math.floor(g.limit)), used: 0, createdAt: this.now(), expiresAt: this.now() + g.ttlMs, note: g.note ?? "", paused: null, revoked: false };
    this.delegations.set(d.id, d);
    this.persist();
    return d;
  }
  /** Owner only: say in advance that deleting one kind also removes another. Stays unconfirmed, so the first real run still takes a full copy and checks the prediction. */
  declareDependency(kind: Kind, cascade: { kind: Kind; by: string }): void {
    this.rules.set(kind, "delete", [...this.rules.cascadesFor(kind, "delete").filter((c) => !(c.kind === cascade.kind && c.by === cascade.by)), cascade], this.rules.isConfirmed(kind, "delete"));
    this.persist();
  }

  revokeDelegation(id: string): { ok: boolean } { const d = this.delegations.get(id); if (!d) return { ok: false }; d.revoked = true; this.persist(); return { ok: true }; }
  resumeDelegation(id: string): { ok: boolean } { const d = this.delegations.get(id); if (!d) return { ok: false }; d.paused = null; this.persist(); return { ok: true }; }

  private delegationFor(kind: Kind, op: "create" | "update" | "delete"): Delegation | null {
    for (const d of this.delegations.values()) {
      if (d.revoked || d.paused || this.now() > d.expiresAt || d.used >= d.limit) continue;
      if (!d.ops.includes(op) || !(d.kinds.includes("*") || d.kinds.includes(kind))) continue;
      return d;
    }
    return null;
  }

  /** Inside a delegation the per-item approval is replaced by the owner's earlier grant. Everything else (full copy, canary, caps, refusals) still applies. */
  private applyDelegation(plan: Plan): void {
    const { op } = plan;
    plan.recovery = this.recoveryFor(op);
    if (!plan.needsApproval || !op.kind || op.op === "publish") return;
    const d = this.delegationFor(op.kind, op.op);
    if (!d) return;
    plan.needsApproval = false; plan.reasons = []; plan.status = "previewed"; plan.delegatedBy = d.id;
  }

  /** True while a canary item runs: take the full copy even when the rule is confirmed, so any surprise can be undone. */
  private careful = false;

  async applyBatch(ops: Op[], stopOnFailure = true, opts: { canary?: number; dryRun?: boolean } = {}): Promise<Record<string, unknown>> {
    this.metrics.calls++;
    if (opts.dryRun) {
      const total: Delta = {}; const items: unknown[] = []; const refused: unknown[] = []; let needOwner = 0;
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i]!;
        const plan = await this.preview(op, i);
        if (isRefusal(plan)) { refused.push({ i, op: op.op, kind: op.kind, key: op.key, error: plan.error, detail: plan.detail }); continue; }
        for (const [k, n] of Object.entries(plan.expectedDelta)) addDelta(total, k, n);
        if (plan.needsApproval) needOwner++;
        items.push({ i, op: op.op, kind: op.kind, key: op.key, diff: plan.diff, needs_owner: plan.needsApproval, ...(plan.reasons.length ? { why: plan.reasons } : {}) });
      }
      const removed = Object.fromEntries(Object.entries(total).filter(([, n]) => n < 0).map(([k, n]) => [k, -n]));
      return { status: "blast_radius", changed_nothing: true, would_remove: removed, would_add: Object.fromEntries(Object.entries(total).filter(([, n]) => n > 0)), needs_owner: needOwner, refused: refused.length, items, refused_items: refused, next: ["run apply_batch again with canary: 1 to try the first item and check it did what was predicted", "show the owner would_remove before approving anything"] };
    }
    const canary = opts.canary && opts.canary > 0 ? Math.min(opts.canary, ops.length) : 0;
    let canaryTried = 0, halted: Record<string, unknown> | null = null;
    const committed: unknown[] = [], awaiting: unknown[] = [], refused: unknown[] = [];
    let notAttempted = 0;
    let stop = false;
    let batchDeletes = 0;
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]!;
      if (stop || halted) { notAttempted++; continue; }
      this.careful = canary > 0 && canaryTried < canary;
      const out = await this.apply(op, batchDeletes).finally(() => { this.careful = false; });
      const tag = { i, op: op.op, kind: op.kind, key: op.key ?? op.record?.key };
      if (isRefusal(out)) { refused.push({ ...tag, error: out.error, detail: out.detail, next: out.next }); continue; }
      if (out.status === "awaiting_approval") { awaiting.push({ ...tag, plan_id: out.plan_id, why: out.reasons }); continue; }
      if (out.status === "failed" || out.status === "done_with_surprise") { committed.push({ ...tag, receipt: out.receipt, status: out.status }); if (stopOnFailure && out.status === "failed") stop = true; if (canary && canaryTried < canary) halted = { at: i, receipt: out.receipt, status: out.status, surprise: out.surprise ?? null, why: "A canary item did not do exactly what was predicted, so the rest was not attempted. Undo it with the receipt, or approve the surprise and run the rest." }; canaryTried++; continue; }
      committed.push({ ...tag, receipt: out.receipt });
      if (canary) canaryTried++;
    }
    return { status: halted ? "halted_by_canary" : "batch_done", committed: committed.length, awaiting_approval: awaiting.length, refused: refused.length, not_attempted: notAttempted, ...(halted ? { canary_halt: halted } : {}), items: { committed, awaiting, refused }, next: awaiting.length ? ["ask the owner about awaiting items; they are listed with plan_id"] : [] };
  }

  /** Short, agent-friendly view of a receipt. */
  present(x: Receipt | Refusal | Plan): Record<string, unknown> {
    if (isRefusal(x)) return x;
    if ("planId" in x) {
      return { status: x.status, receipt: x.id, authority: x.authority, ...(x.recovery ? { recovery: x.recovery } : {}), verified: x.verified, undo_until: new Date(x.undoUntil).toISOString(), ...(x.surprise ? { surprise: x.surprise, note: x.verified?.restorable === false ? "The system did more than predicted and the extra items were NOT saved, so undo restores only the item you named. The rule was learned: the next one takes a full copy first. Use canary on batches." : "The system did more than predicted. The rule was learned and everything removed is saved, so undo restores it." } : {}), ...(x.op.op === "publish" ? { note: "Published. This cannot be recalled." } : {}) };
    }
    return { status: x.status, plan_id: x.id, diff: x.diff, ...(x.recovery ? { recovery: x.recovery } : {}) };
  }

  // ---------- undo ----------

  async undo(receiptId: string): Promise<Record<string, unknown> | Refusal> {
    this.metrics.calls++;
    return this.queue.run(async () => {
      const rc = this.receipts.get(receiptId);
      if (!rc) return this.r(refuse("unknown_receipt", `No receipt '${receiptId}'.`, ["check the receipt id from the commit result"]));
      if (rc.status === "undone") return this.r(refuse("already_undone", "Already undone.", []));
      if (rc.op.op === "publish") return this.r(refuse("not_undoable", "Published changes went to the outside world and cannot be recalled.", ["send a correction as a new change"]));
      if (this.now() > rc.undoUntil) return this.r(refuse("undo_window_closed", "The undo window has closed.", ["make a new change that fixes it"]));
      const before = await this.adapter.counts(rc.op.kind);
      try {
        if (rc.op.op === "delete") {
          for (const s of rc.snapshot) {
            if (!(await this.adapter.read(s.kind, s.record.key))) await this.adapter.create(s.kind, s.record);
          }
          if (this.deletesToday > 0) this.deletesToday--;
        } else if (rc.op.op === "create" && rc.op.kind && rc.op.record) {
          await this.adapter.delete(rc.op.kind, rc.op.record.key);
        } else if (rc.op.op === "update" && rc.op.kind && rc.op.key && this.adapter.update && rc.snapshot[0]) {
          const { key: _k, ...old } = rc.snapshot[0].record;
          await this.adapter.update(rc.op.kind, rc.op.key, old);
        }
      } catch (e) {
        this.invalidate();
        // Say plainly that undo did not work, and hand back what was saved so a person can finish the job.
        return this.r(refuse("undo_failed", `Could not restore automatically: ${String((e as Error).message).split("\n")[0]}`, ["re-create the record by hand in the app using the saved values below", "tell the owner"], { saved: rc.snapshot.map((s) => ({ kind: s.kind, record: s.record })) }));
      }
      this.invalidate();
      const after = await this.adapter.counts(rc.op.kind);
      const subject = rc.op.op === "delete" ? rc.snapshot[0] : undefined;
      const back = subject ? await this.adapter.read(subject.kind, subject.record.key) : null;
      let restored = subject ? back !== null : rc.op.op === "create" && rc.op.kind && rc.op.record ? (await this.adapter.read(rc.op.kind, rc.op.record.key)) === null : false;
      // Present is not the same as identical. Say which fields did not come back (dates the app stamps itself are ignored).
      const notRestored: string[] = [];
      if (subject && back) {
        for (const [f, v] of Object.entries(subject.record)) {
          if (f === "key" || /date|modif|created|updated|last|login/i.test(f)) continue;
          if (stable(back[f]) !== stable(v) && !(v === "" || v === null)) notRestored.push(f);
        }
      }
      if (rc.op.op === "update" && rc.op.kind && rc.op.key && rc.snapshot[0]) {
        const now = await this.adapter.read(rc.op.kind, rc.op.key);
        const { key: _k2, ...old } = rc.snapshot[0].record;
        restored = !!now && Object.entries(old).every(([f, v]) => stable(now[f]) === stable(v));
      }
      rc.status = "undone";
      this.persist();
      this.metrics.undos++;
      if (notRestored.length && rc.op.kind) { const key = `${rc.op.kind}:${rc.op.op}`; const had = this.lessons.get(key) ?? []; this.lessons.set(key, [...new Set([...had, ...notRestored.map((f) => `undo did not give back '${f}' as it was`)])].slice(0, 6)); }
      this.persist();
      return { status: "undone", receipt: rc.id, verified: { restored, ...(notRestored.length ? { fields_not_restored: notRestored } : {}), counts_before: before, counts_after: after }, note: rc.op.op === "delete" ? "Restored from the copy saved before the change." : rc.op.op === "update" ? "Put the old values back." : "Removed what was created." };
    });
  }

  // ---------- plans, approval, escalation (owner side) ----------

  getPlan(id: string): Record<string, unknown> | Refusal {
    const p = this.plans.get(id);
    if (!p) return this.r(refuse("unknown_plan", `No plan '${id}'.`, ["run a dry_run first"]));
    if (p.status !== "committed" && this.now() > p.expiresAt) p.status = "expired";
    return { plan_id: p.id, status: p.status, diff: p.diff, reasons: p.reasons, expires_in_s: Math.max(0, Math.round((p.expiresAt - this.now()) / 1000)), next: p.status === "approved" ? ["commit with plan_id"] : p.status === "awaiting_approval" ? ["wait for the owner, poll again later"] : p.status === "expired" || p.status === "stale" ? ["run a new dry_run"] : [] };
  }

  approve(id: string): Record<string, unknown> | Refusal {
    const p = this.plans.get(id);
    if (!p) return refuse("unknown_plan", `No plan '${id}'.`, []);
    if (p.status !== "awaiting_approval") return refuse("not_awaiting", `Plan is ${p.status}.`, []);
    p.status = "approved";
    p.expiresAt = this.now() + this.mandate.planTtlMs;
    this.metrics.humanDecisions++;
    this.persist();
    return { plan_id: id, status: "approved" };
  }

  reject(id: string): Record<string, unknown> | Refusal {
    const p = this.plans.get(id);
    if (!p) return refuse("unknown_plan", `No plan '${id}'.`, []);
    p.status = "rejected";
    this.metrics.humanDecisions++;
    this.persist();
    return { plan_id: id, status: "rejected" };
  }

  escalate(reason: string): Record<string, unknown> {
    this.metrics.calls++;
    const e: Escalation = { id: `esc_${(++this.seq.esc).toString(36)}`, reason, at: this.now(), status: "open" };
    this.escalations.push(e);
    this.persist();
    this.metrics.escalations++;
    return { status: "pending_human", ticket: e.id, note: "One message went to the owner. Keep working on other items; do not retry the blocked one.", agent_can_continue_with: ["find", "create", "other deletes inside the limit"] };
  }

  raiseCap(n: number): Record<string, unknown> {
    this.mandate.maxDeletesPerDay = n;
    this.persist();
    for (const e of this.escalations) if (e.status === "open") e.status = "resolved";
    this.metrics.humanDecisions++;
    return { max_deletes_per_day: n };
  }

  ownerState(): Record<string, unknown> {
    const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : 0);
    return {
      awaiting: [...this.plans.values()].filter((p) => p.status === "awaiting_approval").map((p) => ({ id: p.id, diff: p.diff, reasons: p.reasons })),
      escalations: this.escalations.filter((e) => e.status === "open"),
      unknown_outcomes: [...this.plans.values()].filter((p) => p.status === "unknown").map((p) => ({ id: p.id, diff: p.diff })),
      mandate: this.mandate,
      deletes_today: this.deletesToday,
      capabilities: [...this.contracts.values()].map((c) => ({ kind: c.kind, version: c.version, status: c.status, repairs: c.history.length, last_drift: c.lastDrift })),
      delegations: [...this.delegations.values()].map((d) => ({ ...d, active: !d.revoked && !d.paused && this.now() <= d.expiresAt && d.used < d.limit })),
      rules: this.rules.describe(),
      metrics: { calls: this.metrics.calls, previews: this.metrics.previews, commits: this.metrics.commits, refusals: this.metrics.refusals, undos: this.metrics.undos, human_decisions: this.metrics.humanDecisions, surprises: this.metrics.surprises, avg_preview_ms: avg(this.metrics.previewMs), avg_commit_ms: avg(this.metrics.commitMs) },
    };
  }

  async resetDemo(): Promise<void> {
    await this.adapter.reset();
    this.plans.clear(); this.receipts.clear(); this.escalations.length = 0; this.invalidate();
    this.deletesToday = 0;
    this.metrics = { calls: 0, previews: 0, commits: 0, refusals: 0, undos: 0, humanDecisions: 0, escalations: 0, surprises: 0, previewMs: [], commitMs: [] };
  }
}
