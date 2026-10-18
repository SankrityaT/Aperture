// A fake school records system standing in for a real legacy app until the Gibbon adapter exists.
// All people and classes are invented. It behaves like a real system on purpose:
//  - two students share a name
//  - deleting a class also removes its enrollments AND its timetable slots (the timetable cascade is
//    deliberately missing from the starting rulebook, so the first class delete is a "surprise")
//  - changes are staged and only go to the outside world on publish

import type { Adapter, Kind, Rec } from "../types.js";

const KINDS: Kind[] = ["student", "class", "enrollment", "timetable", "guardian"];

const FIRST = ["Aria", "Bea", "Cyrus", "Dara", "Eli", "Fern", "Gus", "Hana", "Ivo", "June", "Kai", "Lena", "Milo", "Nia", "Omar", "Pia", "Quin", "Rae", "Sol", "Tess", "Uma", "Vic", "Wren", "Xan", "Yara", "Zed", "Abe", "Bryn", "Cleo", "Dev"];
const LAST = ["Morgan", "Nakamura", "Okafor", "Petrov", "Quill", "Rivera", "Sato", "Tanaka", "Umber", "Vance", "Wells", "Xu", "Yilmaz", "Zhou", "Arden", "Bellamy", "Castro", "Dunne", "Ekwueme", "Frost", "Gray", "Haas", "Ito", "Joshi", "Kerr", "Lund", "Mbeki", "Novak", "Ortiz", "Pryce"];

type Store = Record<Kind, Map<string, Rec>>;

function seed(): { store: Store; pending: string[] } {
  const store: Store = {} as Store;
  for (const k of KINDS) store[k] = new Map();
  const classes = [
    { key: "C101", title: "Maths 9B", teacher: "Ms Arden" },
    { key: "C102", title: "Physics 9B", teacher: "Mr Bellamy" },
    { key: "C103", title: "History 9A", teacher: "Ms Castro" },
    { key: "C104", title: "Art 9A", teacher: "Mr Dunne" },
  ];
  for (const c of classes) store.class.set(c.key, { ...c });
  for (let i = 0; i < 30; i++) {
    const key = `S${String(i + 1).padStart(3, "0")}`;
    // S014 and S022 share a name on purpose.
    const name = i === 13 || i === 21 ? "Alex Morgan" : `${FIRST[i]} ${LAST[i]}`;
    store.student.set(key, { key, name, grade: 9, form: i % 2 === 0 ? "9A" : "9B" });
    store.guardian.set(`G${key.slice(1)}`, { key: `G${key.slice(1)}`, studentKey: key, name: `Guardian of ${name}` });
    for (const c of classes) {
      if ((i + Number(c.key.slice(1))) % 3 !== 0) {
        const ek = `E-${key}-${c.key}`;
        store.enrollment.set(ek, { key: ek, studentKey: key, classKey: c.key });
      }
    }
  }
  for (const c of classes) {
    for (const day of ["Mon", "Wed", "Fri"]) {
      const tk = `T-${c.key}-${day}`;
      store.timetable.set(tk, { key: tk, classKey: c.key, day, period: 2 });
    }
  }
  return { store, pending: [] };
}

export class FakeSchool implements Adapter {
  private s = seed();
  /** Test hook: how long each call takes, to simulate a slow legacy screen. */
  latencyMs = 0;

  private async pause(): Promise<void> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  kinds(): Kind[] {
    return [...KINDS];
  }

  async read(kind: Kind, key: string): Promise<Rec | null> {
    await this.pause();
    const r = this.s.store[kind]?.get(key);
    return r ? { ...r } : null;
  }

  async list(kind: Kind, filter?: Record<string, unknown>): Promise<Rec[]> {
    await this.pause();
    const all = [...(this.s.store[kind]?.values() ?? [])];
    const out = filter ? all.filter((r) => Object.entries(filter).every(([f, v]) => r[f] === v)) : all;
    return out.map((r) => ({ ...r }));
  }

  async create(kind: Kind, record: Rec): Promise<void> {
    await this.pause();
    const m = this.s.store[kind];
    if (!m) throw new Error(`unknown kind ${kind}`);
    if (m.has(record.key)) throw new Error(`${kind} ${record.key} already exists`);
    m.set(record.key, { ...record });
    this.s.pending.push(`create ${kind} ${record.key}`);
  }

  async delete(kind: Kind, key: string): Promise<void> {
    await this.pause();
    const m = this.s.store[kind];
    if (!m || !m.has(key)) throw new Error(`${kind} ${key} not found`);
    m.delete(key);
    this.s.pending.push(`delete ${kind} ${key}`);
    // Real system behavior (the engine only knows what it has learned):
    if (kind === "student") {
      for (const [k, e] of this.s.store.enrollment) if (e.studentKey === key) { this.s.store.enrollment.delete(k); this.s.pending.push(`delete enrollment ${k}`); }
    }
    if (kind === "class") {
      for (const [k, e] of this.s.store.enrollment) if (e.classKey === key) { this.s.store.enrollment.delete(k); this.s.pending.push(`delete enrollment ${k}`); }
      for (const [k, t] of this.s.store.timetable) if (t.classKey === key) { this.s.store.timetable.delete(k); this.s.pending.push(`delete timetable ${k}`); }
    }
  }

  async counts(_forKind?: Kind): Promise<Record<Kind, number>> {
    const out: Record<Kind, number> = {};
    for (const k of KINDS) out[k] = this.s.store[k].size;
    return out;
  }

  async exportAll(_forKind?: Kind): Promise<Record<Kind, Rec[]>> {
    const out: Record<Kind, Rec[]> = {};
    for (const k of KINDS) out[k] = [...this.s.store[k].values()].map((r) => ({ ...r }));
    return out;
  }

  async pendingPublish(): Promise<string[]> {
    return [...this.s.pending];
  }

  async publish(): Promise<{ published: number; notified: number }> {
    await this.pause();
    const published = this.s.pending.length;
    const notified = this.s.pending.filter((p) => p.includes(" student ") || p.includes(" enrollment ")).length;
    this.s.pending = [];
    return { published, notified };
  }

  async reset(): Promise<void> {
    this.s = seed();
  }

  /** Test hook: change a record behind the engine's back. */
  tamper(kind: Kind, key: string, patch: Record<string, unknown>): void {
    const r = this.s.store[kind].get(key);
    if (r) this.s.store[kind].set(key, { ...r, ...patch });
  }
}

/** The rules we start with after a first read-only exploration. Class delete is not confirmed and misses the timetable. */
export function startingRules(): Array<{ kind: Kind; op: "delete" | "create"; cascades: { kind: Kind; by: string }[]; confirmed: boolean }> {
  return [
    { kind: "student", op: "delete", cascades: [{ kind: "enrollment", by: "studentKey" }], confirmed: true },
    { kind: "student", op: "create", cascades: [], confirmed: true },
    { kind: "enrollment", op: "delete", cascades: [], confirmed: true },
    { kind: "enrollment", op: "create", cascades: [], confirmed: true },
    { kind: "class", op: "delete", cascades: [{ kind: "enrollment", by: "classKey" }], confirmed: false },
    { kind: "class", op: "create", cascades: [], confirmed: false },
    { kind: "timetable", op: "delete", cascades: [], confirmed: false },
    { kind: "guardian", op: "delete", cascades: [], confirmed: false },
  ];
}
