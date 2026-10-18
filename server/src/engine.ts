// The ticket engine. Every write is a ticket: preview, rules, approval when a rule says so, commit,
// read-back, receipt, undo. Plain code only. No model is used here.

import { createHash } from "node:crypto";
import { RuleBook } from "./rules.js";
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
}

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
    const { data, ageMs } = await this.cached(`list:${kind}`, () => this.adapter.list(kind));
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
    const out = await this.previewInner(op, batchDeletes);
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
      this.plans.set(id, plan);
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
      this.plans.set(id, plan);
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
    this.plans.set(id, plan);
    return plan;
  }

  // ---------- commit ----------

  async commit(planId: string): Promise<Receipt | Refusal | Plan> {
    this.metrics.calls++;
    return this.queue.run(() => this.commitInner(planId));
  }

  private async commitInner(planId: string): Promise<Receipt | Refusal | Plan> {
    const t0 = performance.now();
    const plan = this.plans.get(planId);
    if (!plan) return this.r(refuse("unknown_plan", `No plan '${planId}'.`, ["run a dry_run first to get a plan_id"]));
    if (plan.status === "committed") return this.r(refuse("already_committed", "This plan was already committed.", ["check the receipt, or make a new plan"]));
    if (plan.status === "rejected") return this.r(refuse("rejected", "The owner rejected this plan.", ["do not retry", "escalate(reason) if it is important"]));
    if (this.now() > plan.expiresAt) { plan.status = "expired"; return this.r(refuse("expired", "The plan expired.", ["run a new dry_run"])); }
    if (plan.status === "stale") return this.r(refuse("changed_since_preview", "The record changed since the preview.", ["run a new dry_run"]));
    if (plan.needsApproval && plan.status !== "approved") {
      return this.r(refuse("awaiting_approval", plan.reasons.join("; ") || "needs the owner", ["poll get_plan until status is approved", "do not retry commit in a loop"], { plan_id: plan.id, diff: plan.diff }));
    }

    const { op } = plan;
    // Re-read, uncached, and compare to what was previewed.
    let currentHash = plan.hash;
    if (op.op === "delete" && op.kind && op.key) {
      const cur = await this.adapter.read(op.kind, op.key);
      if (!cur) { plan.status = "stale"; return this.r(refuse("changed_since_preview", "The record is already gone.", ["run find to see the current state"])); }
      const deps: Snapshotted[] = [];
      for (const c of this.rules.cascadesFor(op.kind, "delete")) for (const d of await this.adapter.list(c.kind, { [c.by]: op.key })) deps.push({ kind: c.kind, record: d });
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

    const before = await this.adapter.counts();
    const fullBefore = plan.confirmed || op.op === "publish" ? null : await this.adapter.exportAll();
    const snapshot: Snapshotted[] = op.op === "delete" && plan.subject && op.kind ? [{ kind: op.kind, record: plan.subject }, ...plan.dependents] : [];
    if (op.op === "update" && op.kind && op.key && op.patch && plan.subject) {
      // Only the fields we are about to change need saving.
      snapshot.push({ kind: op.kind, record: { key: op.key, ...Object.fromEntries(Object.keys(op.patch).map((f) => [f, plan.subject![f]])) } });
    }

    // Do the change.
    try {
      if (op.op === "update" && op.kind && op.key && op.patch && this.adapter.update) await this.adapter.update(op.kind, op.key, op.patch);
      else if (op.op === "delete" && op.kind && op.key) await this.adapter.delete(op.kind, op.key);
      else if (op.op === "create" && op.kind && op.record) await this.adapter.create(op.kind, op.record);
      else if (op.op === "publish") await this.adapter.publish();
    } catch (e) {
      this.invalidate();
      return this.finish(plan, snapshot, { status: "failed", verified: { error: String((e as Error).message) } }, t0);
    }
    this.invalidate();

    // Read back and compare with the prediction.
    const after = await this.adapter.counts();
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
    verified.counts_after = after;
    verified.matches_prediction = surprises.length === 0;
    const okSubject = op.op === "delete" ? verified.subject_present === false : op.op === "create" ? verified.subject_present === true : op.op === "update" ? verified.fields_match === true : verified.still_pending === 0;
    verified.ok = okSubject && surprises.length === 0;

    // A surprise becomes a rule, and everything it removed is saved so undo can restore it.
    if (surprises.length && fullBefore && op.kind && op.key && op.op === "delete") {
      const fullAfter = await this.adapter.exportAll();
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
      this.metrics.surprises++;
      if (op.kind && op.op !== "publish") this.rules.learn(op.kind, op.op, { kind: surprises[0]!.kind, by: "unknown" });
    }
    if (!surprises.length && op.kind && op.op !== "publish") this.rules.confirm(op.kind, op.op);

    if (op.op === "delete") this.deletesToday++;
    return this.finish(plan, snapshot, { status: surprises.length ? "done_with_surprise" : verified.ok ? "done" : "failed", verified, surprise: surprises.length ? surprises : undefined }, t0);
  }

  private finish(plan: Plan, snapshot: Snapshotted[], r: { status: Receipt["status"]; verified: Record<string, unknown>; surprise?: Receipt["surprise"] }, t0: number): Receipt {
    const t = this.now();
    const receipt: Receipt = { id: `rcpt_${(++this.seq.rcpt).toString(36)}`, planId: plan.id, op: plan.op, at: t, status: r.status, verified: r.verified, snapshot, undoUntil: t + this.mandate.undoWindowMs, ...(r.surprise ? { surprise: r.surprise } : {}) };
    this.receipts.set(receipt.id, receipt);
    plan.status = "committed";
    this.metrics.commits++;
    this.metrics.commitMs.push(performance.now() - t0);
    return receipt;
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

  async applyBatch(ops: Op[], stopOnFailure = true): Promise<Record<string, unknown>> {
    this.metrics.calls++;
    const committed: unknown[] = [], awaiting: unknown[] = [], refused: unknown[] = [];
    let notAttempted = 0;
    let stop = false;
    let batchDeletes = 0;
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]!;
      if (stop) { notAttempted++; continue; }
      const out = await this.apply(op, batchDeletes);
      const tag = { i, op: op.op, kind: op.kind, key: op.key ?? op.record?.key };
      if (isRefusal(out)) { refused.push({ ...tag, error: out.error, detail: out.detail, next: out.next }); continue; }
      if (out.status === "awaiting_approval") { awaiting.push({ ...tag, plan_id: out.plan_id, why: out.reasons }); continue; }
      if (out.status === "failed" || out.status === "done_with_surprise") { committed.push({ ...tag, receipt: out.receipt, status: out.status }); if (stopOnFailure && out.status === "failed") stop = true; if (op.op === "delete") batchDeletes += 0; continue; }
      committed.push({ ...tag, receipt: out.receipt });
    }
    return { status: "batch_done", committed: committed.length, awaiting_approval: awaiting.length, refused: refused.length, not_attempted: notAttempted, items: { committed, awaiting, refused }, next: awaiting.length ? ["ask the owner about awaiting items; they are listed with plan_id"] : [] };
  }

  /** Short, agent-friendly view of a receipt. */
  present(x: Receipt | Refusal | Plan): Record<string, unknown> {
    if (isRefusal(x)) return x;
    if ("planId" in x) {
      return { status: x.status, receipt: x.id, verified: x.verified, undo_until: new Date(x.undoUntil).toISOString(), ...(x.surprise ? { surprise: x.surprise, note: "The system did more than predicted. The rule was learned and everything removed is saved, so undo restores it." } : {}), ...(x.op.op === "publish" ? { note: "Published. This cannot be recalled." } : {}) };
    }
    return { status: x.status, plan_id: x.id, diff: x.diff };
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
      const before = await this.adapter.counts();
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
      this.invalidate();
      const after = await this.adapter.counts();
      const subject = rc.op.op === "delete" ? rc.snapshot[0] : undefined;
      let restored = subject ? (await this.adapter.read(subject.kind, subject.record.key)) !== null : rc.op.op === "create" && rc.op.kind && rc.op.record ? (await this.adapter.read(rc.op.kind, rc.op.record.key)) === null : false;
      if (rc.op.op === "update" && rc.op.kind && rc.op.key && rc.snapshot[0]) {
        const now = await this.adapter.read(rc.op.kind, rc.op.key);
        const { key: _k2, ...old } = rc.snapshot[0].record;
        restored = !!now && Object.entries(old).every(([f, v]) => stable(now[f]) === stable(v));
      }
      rc.status = "undone";
      this.metrics.undos++;
      return { status: "undone", receipt: rc.id, verified: { restored, counts_before: before, counts_after: after }, note: rc.op.op === "delete" ? "Restored from the copy saved before the change." : rc.op.op === "update" ? "Put the old values back." : "Removed what was created." };
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
    return { plan_id: id, status: "approved" };
  }

  reject(id: string): Record<string, unknown> | Refusal {
    const p = this.plans.get(id);
    if (!p) return refuse("unknown_plan", `No plan '${id}'.`, []);
    p.status = "rejected";
    this.metrics.humanDecisions++;
    return { plan_id: id, status: "rejected" };
  }

  escalate(reason: string): Record<string, unknown> {
    this.metrics.calls++;
    const e: Escalation = { id: `esc_${(++this.seq.esc).toString(36)}`, reason, at: this.now(), status: "open" };
    this.escalations.push(e);
    this.metrics.escalations++;
    return { status: "pending_human", ticket: e.id, note: "One message went to the owner. Keep working on other items; do not retry the blocked one.", agent_can_continue_with: ["find", "create", "other deletes inside the limit"] };
  }

  raiseCap(n: number): Record<string, unknown> {
    this.mandate.maxDeletesPerDay = n;
    for (const e of this.escalations) if (e.status === "open") e.status = "resolved";
    this.metrics.humanDecisions++;
    return { max_deletes_per_day: n };
  }

  ownerState(): Record<string, unknown> {
    const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : 0);
    return {
      awaiting: [...this.plans.values()].filter((p) => p.status === "awaiting_approval").map((p) => ({ id: p.id, diff: p.diff, reasons: p.reasons })),
      escalations: this.escalations.filter((e) => e.status === "open"),
      mandate: this.mandate,
      deletes_today: this.deletesToday,
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
