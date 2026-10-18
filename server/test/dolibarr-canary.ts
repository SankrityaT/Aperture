// Real Dolibarr, real database as ground truth. An agent is told: "remove these three customers."
// Shows the dry run (blast radius), then a canary batch, then undo. Not part of the unit tests.
import { execSync } from "node:child_process";
import { FormAdapter } from "../src/generator/form-adapter.js";
import { TableAdapter } from "../src/generator/tables.js";
import { CompositeAdapter } from "../src/adapters/composite.js";
import { Wicket } from "../src/engine.js";
import { RuleBook } from "../src/rules.js";

const db = (sql: string) => execSync(`docker exec doli-db mariadb -N -udolibarr -pdolibarr dolibarr -e "${sql}"`, { encoding: "utf8" }).trim();
const counts = () => ({ thirdparties: Number(db("select count(*) from llx_societe")), contacts: Number(db("select count(*) from llx_socpeople")), invoices: Number(db("select count(*) from llx_facture")) });
const BASE = "http://localhost:8081";
const NAMES = (process.env.NAMES ?? "NLTechno,Swiss Touch,Boulangerie AFA").split(",");

const fa = new FormAdapter();
try {
  await fa.signIn(`${BASE}/`, "dolibarr");
  await fa.open(`${BASE}/societe/list.php?mainmenu=companies&leftmenu=thirdparties`); await fa.refresh();
  const tp = new TableAdapter(() => fa.currentPage()); const tpModels = await tp.attach();
  await fa.open(`${BASE}/contact/list.php?mainmenu=companies&leftmenu=contacts`); await fa.refresh();
  const ct = new TableAdapter(() => fa.currentPage()); const ctModels = await ct.attach();
  console.log(`compiled: ${[...tpModels, ...ctModels].map((m) => `${m.id}(key=${m.keyColumn}, ${m.rows} rows)`).join(", ")}`);
  const kind = tpModels[0]!.id;
  const w = new Wicket(new CompositeAdapter([tp, ct]), { rules: new RuleBook() });

  const all = await tp.list(kind);
  const keys = NAMES.map((n) => all.find((r) => Object.values(r).some((v) => v === n))?.key).filter(Boolean) as string[];
  console.log("targets:", NAMES.map((n, i) => `${n}=${keys[i]}`).join(", "));
  const ops = keys.map((key) => ({ op: "delete" as const, kind, key }));

  console.log("\nDATABASE BEFORE:", JSON.stringify(counts()));
  const dry = await w.applyBatch(ops, true, { dryRun: true });
  console.log("\n1. DRY RUN:", JSON.stringify({ status: dry.status, changed_nothing: dry.changed_nothing, would_remove: dry.would_remove, needs_owner: dry.needs_owner }));
  console.log("   database unchanged:", JSON.stringify(counts()));

  // The agent submits the batch; everything unfamiliar waits for the owner, who has seen the dry run.
  const batch = (await w.applyBatch(ops, true)) as any;
  const plans = (batch.items.awaiting as any[]).map((x) => x.plan_id as string);
  console.log(`\n2. BATCH SUBMITTED: ${plans.length} plans wait for the owner; database unchanged: ${JSON.stringify(counts())}`);
  for (const id of plans) w.approve(id);
  console.log("   owner approved all three after seeing the dry run");
  const r = (await w.commitBatch(plans, 1)) as any;
  console.log("\n3. COMMIT WITH CANARY=1:", JSON.stringify({ status: r.status, committed: r.committed, not_attempted: r.not_attempted, canary_halt: r.canary_halt }));
  console.log("   DATABASE NOW:", JSON.stringify(counts()));
  const rc = (r.canary_halt as any)?.receipt ?? (r.items.committed as any[])[0]?.receipt;
  const receipt = rc;
  if (receipt) {
    const u = (await w.undo(receipt)) as any;
    console.log("\n3. UNDO ->", JSON.stringify({ status: u.status ?? u.error, fields_not_restored: u.verified?.fields_not_restored }));
    console.log("   DATABASE AFTER UNDO:", JSON.stringify(counts()));
  }
} finally { await fa.close(); }
