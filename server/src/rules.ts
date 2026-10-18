// What we have learned about how the system behaves.
// A rule is "confirmed" once a commit matched its prediction. Unconfirmed rules take the slower path:
// ask the owner first, and keep a full snapshot so any surprise can be undone.

import type { Kind } from "./types.js";

export interface Cascade {
  kind: Kind;
  /** The field on the dependent record that holds the parent's key. */
  by: string;
}

type OpKey = "delete" | "create" | "update";

export class RuleBook {
  private cascades = new Map<string, Cascade[]>();
  private confirmed = new Set<string>();

  static id(kind: Kind, op: OpKey): string {
    return `${kind}:${op}`;
  }

  /** Forget everything learned. Used when a demo is reset. */
  clear(): void {
    this.cascades.clear();
    this.confirmed.clear();
  }

  set(kind: Kind, op: OpKey, cascades: Cascade[], confirmed: boolean): void {
    const id = RuleBook.id(kind, op);
    this.cascades.set(id, cascades);
    if (confirmed) this.confirmed.add(id);
    else this.confirmed.delete(id);
  }

  cascadesFor(kind: Kind, op: OpKey): Cascade[] {
    return this.cascades.get(RuleBook.id(kind, op)) ?? [];
  }

  isConfirmed(kind: Kind, op: OpKey): boolean {
    return this.confirmed.has(RuleBook.id(kind, op));
  }

  confirm(kind: Kind, op: OpKey): void {
    this.confirmed.add(RuleBook.id(kind, op));
  }

  /** A surprise: remember the new dependent and fall back to the slow path until it matches once. */
  learn(kind: Kind, op: OpKey, cascade: Cascade): void {
    const id = RuleBook.id(kind, op);
    const list = this.cascades.get(id) ?? [];
    if (!list.some((c) => c.kind === cascade.kind && c.by === cascade.by)) list.push(cascade);
    this.cascades.set(id, list);
    this.confirmed.delete(id);
  }

  /** What a second agent can learn from this one: the dependents we saw, and whether a real run ever matched the prediction. */
  exportRules(): { kind: Kind; op: OpKey; cascades: Cascade[]; vouched: boolean }[] {
    const ids = new Set([...this.cascades.keys(), ...this.confirmed]);
    return [...ids].sort().map((id) => {
      const [kind, op] = id.split(":") as [Kind, OpKey];
      return { kind, op, cascades: this.cascades.get(id) ?? [], vouched: this.confirmed.has(id) };
    });
  }

  /**
   * Take another agent's rules. The dependents are believed (so previews and dry runs predict them), but nothing becomes
   * confirmed here: the first real run on this side still asks the owner and takes a full copy, then confirms it itself.
   */
  importRules(rules: { kind: Kind; op: OpKey; cascades: Cascade[] }[]): number {
    let n = 0;
    for (const r of rules) {
      const id = RuleBook.id(r.kind, r.op);
      const list = this.cascades.get(id) ?? [];
      for (const c of r.cascades) if (!list.some((x) => x.kind === c.kind && x.by === c.by)) { list.push(c); n++; }
      this.cascades.set(id, list);
    }
    return n;
  }

  describe(): { rule: string; cascades: string[]; confirmed: boolean }[] {
    const ids = new Set([...this.cascades.keys(), ...this.confirmed]);
    return [...ids].sort().map((id) => ({
      rule: id,
      cascades: (this.cascades.get(id) ?? []).map((c) => `${c.kind} by ${c.by}`),
      confirmed: this.confirmed.has(id),
    }));
  }
}
