// A durable record of tickets, approvals, receipts, delegations and undo copies, so a restart cannot erase the evidence
// or turn an unfinished change into a clean success.
//
// It is one JSON file written atomically (write a temp file, fsync it, rename it over the old one), so a crash leaves either the
// old state or the new state, never half of one. It holds record data (the copies undo needs), so it is created readable by the
// owner only. This is a single-process file. A hosted deployment needs a real database behind the same two methods.

import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Ledger {
  load(): unknown | null;
  save(state: unknown): void;
}

export class FileLedger implements Ledger {
  constructor(private readonly path: string) {}

  load(): unknown | null {
    if (!existsSync(this.path)) return null;
    try { return JSON.parse(readFileSync(this.path, "utf8")); }
    catch { throw new Error(`The ledger at ${this.path} could not be read. It was not overwritten. Move it aside after checking it.`); }
  }

  save(state: unknown): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    const fd = openSync(tmp, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, this.path);
  }
}
