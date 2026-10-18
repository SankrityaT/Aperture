// The same "the site changed" scenarios, run against whichever engine version this folder holds, graded from the replica's own state.
// Prints one JSON line per scenario: what the engine said, and what really happened to the system.
process.env.WICKET_SCAN_TTL_MS = "0";
import { FormAdapter } from "../src/generator/form-adapter.js";
import { TableAdapter } from "../src/generator/tables.js";
import { CompositeAdapter } from "../src/adapters/composite.js";
import { Wicket } from "../src/engine.js";
import { RuleBook } from "../src/rules.js";
import { startGatePortal } from "./fixtures/gateportal.js";

const g = await startGatePortal(0);
const modes = (process.env.MODES ?? "rename_col,rename_key,no_delete,decoy,signedout,archive,paging,renumber").split(",");
const target = "1005"; // an ordinary resident
try {
  for (const mode of modes) {
    g.reset();
    const fa = new FormAdapter(); // a fresh browser per scenario, so no earlier adapter's dialog handler is left on the page
    await fa.compile(`${g.url}/Residents.aspx`);
    const ta = new TableAdapter(() => fa.currentPage()); const kind = (await ta.attach())[0]!.id;
    const w = new Wicket(new CompositeAdapter([ta]), { rules: new RuleBook(), cacheTtlMs: 0, mandate: { maxDeletesPerDay: 100 } }) as any;
    await w.find(kind, undefined, 3);
    const before = g.state.residents.length;
    const intended = g.state.residents.find((x) => x.dir === target)!; // the person the agent meant: who key 1005 named BEFORE the change
    g.setDrift(mode);
    const t0 = Date.now();
    let said = "", findSays = "";
    try {
      const f = await w.find(kind, undefined, 2); findSays = f.error ?? `ok(${f.count})`;
      let r: any;
      if (typeof w.delegate === "function") w.delegate({ kinds: [kind], ops: ["delete"], limit: 3, ttlMs: 60000 });
      r = await w.apply({ op: "delete", kind, key: target });
      if (r.status === "awaiting_approval") { w.approve(r.plan_id); r = await w.present(await w.commit(r.plan_id)); }
      said = r.error ?? r.status ?? JSON.stringify(r).slice(0, 80);
      if (process.env.VERBOSE) console.error(mode, JSON.stringify(r).slice(0, 700));
    } catch (e) { said = "THREW: " + String((e as Error).message).split("\n")[0]!.slice(0, 80); }
    const after = g.state.residents.length;
    const gone = !g.state.residents.some((x) => x.dir === target);
    const unsafe = (said === "done" || said === "done_with_surprise") && !gone; // claimed success, system disagrees
    const intendedGone = !g.state.residents.some((x) => x.name === intended.name && x.unit === intended.unit);
    const wrong = before - after > 1 || (after < before && !intendedGone); // deleted something else
    await fa.close();
    console.log(JSON.stringify({ mode, find: findSays, delete: said, residentsBefore: before, residentsAfter: after, targetGone: intendedGone, falseSuccess: unsafe, wrongRecord: wrong, ms: Date.now() - t0 }));
  }
} finally { await g.close(); }
