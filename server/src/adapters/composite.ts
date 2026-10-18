// Routes each kind to the adapter that owns it, so one server can front a records system and compiled forms together.

import type { Adapter, Kind, Rec } from "../types.js";

export class CompositeAdapter implements Adapter {
  constructor(private readonly parts: Adapter[]) {}

  private owner(kind: Kind): Adapter | undefined {
    return this.parts.find((p) => p.kinds().includes(kind));
  }

  private need(kind: Kind): Adapter {
    const o = this.owner(kind);
    if (!o) throw new Error(`unknown kind ${kind}`);
    return o;
  }

  kinds(): Kind[] {
    return this.parts.flatMap((p) => p.kinds());
  }
  read(kind: Kind, key: string): Promise<Rec | null> {
    return this.need(kind).read(kind, key);
  }
  list(kind: Kind, filter?: Record<string, unknown>): Promise<Rec[]> {
    return this.need(kind).list(kind, filter);
  }
  create(kind: Kind, record: Rec): Promise<void> {
    return this.need(kind).create(kind, record);
  }
  delete(kind: Kind, key: string): Promise<void> {
    return this.need(kind).delete(kind, key);
  }
  async update(kind: Kind, key: string, patch: Record<string, unknown>): Promise<void> {
    const o = this.need(kind);
    if (!o.update) throw new Error(`${kind} does not support edits`);
    return o.update(kind, key, patch);
  }
  async normalize(kind: Kind, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const o = this.owner(kind);
    return o?.normalize ? o.normalize(kind, patch) : patch;
  }
  async validate(kind: Kind, key: string, patch: Record<string, unknown>): Promise<string[]> {
    const o = this.owner(kind);
    return o?.validate ? o.validate(kind, key, patch) : [];
  }
  async counts(): Promise<Record<Kind, number>> {
    return Object.assign({}, ...(await Promise.all(this.parts.map((p) => p.counts()))));
  }
  async exportAll(): Promise<Record<Kind, Rec[]>> {
    return Object.assign({}, ...(await Promise.all(this.parts.map((p) => p.exportAll()))));
  }
  async pendingPublish(): Promise<string[]> {
    return (await Promise.all(this.parts.map((p) => p.pendingPublish()))).flat();
  }
  async publish(): Promise<{ published: number; notified: number }> {
    let published = 0, notified = 0;
    for (const p of this.parts) {
      if ((await p.pendingPublish()).length) { const r = await p.publish(); published += r.published; notified += r.notified; }
    }
    return { published, notified };
  }
  async reset(): Promise<void> {
    for (const p of this.parts) await p.reset();
  }
}
