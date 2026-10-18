// Controlled benchmark: ONE cascading delete on the replica gate portal (91 residents / 168 devices), approved, committed.
// Reports wall time and how many page loads the browser did. Same machine, same data, so two engine versions compare fairly.
import { FormAdapter } from "../src/generator/form-adapter.js";
import { TableAdapter } from "../src/generator/tables.js";
import { CompositeAdapter } from "../src/adapters/composite.js";
import { Wicket } from "../src/engine.js";
import { RuleBook } from "../src/rules.js";
import { startGatePortal } from "./fixtures/gateportal.js";

const g = await startGatePortal(0);
const fa = new FormAdapter();
try {
  await fa.compile(`${g.url}/Residents.aspx`);
  const res = new TableAdapter(() => fa.currentPage()); const [rm] = await res.attach();
  await fa.open(`${g.url}/Devices.aspx`); await fa.refresh();
  const dev = new TableAdapter(() => fa.currentPage()); await dev.attach();
  const page = (await fa.currentPage())!;
  let loads = 0; page.on("framenavigated", (f) => { if (f === page.mainFrame()) loads++; });
  let clicks = 0; page.on("request", (r) => { if (r.isNavigationRequest()) clicks++; });
  const w = new Wicket(new CompositeAdapter([res, dev]), { rules: new RuleBook(), mandate: { maxDeletesPerDay: 100 } });
  // teach the rule once so the measured delete is a normal one (cascade known, so plan predicts devices)
  w.rules.set(rm!.id, "delete", [{ kind: "devices", by: "Dir" }], true);
  const dirs = [process.env.DIR ?? "1002"];
  const t0 = Date.now();
  const out: string[] = [];
  for (const key of dirs) {
    const t = Date.now();
    const a = (await w.apply({ op: "delete", kind: rm!.id, key })) as any;
    out.push(`${key}: ${a.status} in ${((Date.now() - t) / 1000).toFixed(1)}s verified.ok=${a.verified?.ok} matches=${a.verified?.matches_prediction}`);
  }
  console.log(out.join("\n"));
  console.log(`TOTAL ${((Date.now() - t0) / 1000).toFixed(1)}s, page loads ${loads}, navigation requests ${clicks}`);
  console.log(`truth: residents ${g.state.residents.length}, devices ${g.state.devices.length}`);
} finally { await fa.close(); await g.close(); }
