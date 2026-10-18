// Ryan-shaped work order on a REPLICA gate portal: remove 20 leaving residents (and their 31 devices), add 2, never duplicate,
// use directory codes not names, and report honestly when the app hangs. Ground truth is the replica's own state.
import { FormAdapter } from "../src/generator/form-adapter.js";
import { TableAdapter } from "../src/generator/tables.js";
import { CompositeAdapter } from "../src/adapters/composite.js";
import { Wicket } from "../src/engine.js";
import { RuleBook } from "../src/rules.js";
import { startGatePortal } from "./fixtures/gateportal.js";

const g = await startGatePortal(0);
const truth = () => ({ residents: g.state.residents.length, devices: g.state.devices.length });
const leavers = g.state.residents.slice(0, 20).map((r) => r.dir);
const hangNoop = leavers[6]!, hangAfter = leavers[12]!;
g.hang([hangNoop], "noop"); g.hang([hangAfter], "after");
const fa = new FormAdapter();
const say = (s: string) => console.log(s);
try {
  await fa.compile(`${g.url}/Residents.aspx`);
  const res = new TableAdapter(() => fa.currentPage()); const [rm] = await res.attach();
  await fa.open(`${g.url}/Devices.aspx`); await fa.refresh();
  const dev = new TableAdapter(() => fa.currentPage()); const [dm] = await dev.attach();
  say(`compiled: ${rm!.id} (key ${rm!.keyColumn}, ${rm!.rows}/page) and ${dm!.id} (key ${dm!.keyColumn})`);
  const w = new Wicket(new CompositeAdapter([res, dev]), { rules: new RuleBook(), mandate: { maxDeletesPerDay: 100 } });
  say(`START ${JSON.stringify(truth())}   work order: remove 20 residents (31 devices), add 2 -> 73 residents, 137 devices`);

  const ops = (dirs: string[]) => dirs.map((key) => ({ op: "delete" as const, kind: rm!.id, key }));
  const dry = (await w.applyBatch(ops(leavers), true, { dryRun: true })) as any;
  say(`\n1. DRY RUN  would_remove=${JSON.stringify(dry.would_remove)} needs_owner=${dry.needs_owner}  (it cannot know about devices yet: no real run has shown the dependent)  state unchanged=${JSON.stringify(truth())}`);

  const submit = async (dirs: string[]) => { const b = (await w.applyBatch(ops(dirs), true)) as any; const ids = (b.items.awaiting as any[]).map((x) => x.plan_id as string); ids.forEach((id) => w.approve(id)); return ids; };
  let plans = await submit(leavers);
  say(`2. SUBMITTED ${plans.length} plans; owner approved all after seeing the dry run`);
  let r = (await w.commitBatch(plans, 1)) as any;
  say(`3. COMMIT, CANARY=1 -> ${r.status}; committed=${r.committed} not_attempted=${r.not_attempted}`);
  if (r.canary_halt) say(`   halted because: surprise=${JSON.stringify(r.canary_halt.surprise)}   state=${JSON.stringify(truth())}`);

  // The owner has now seen the cascade. Run the rest: previews now predict the devices.
  const rest = leavers.slice(1);
  plans = await submit(rest);
  say(`4. REST: ${rest.length} new plans, previews now predict the devices; approved`);
  r = (await w.commitBatch(plans, 1)) as any;
  const items = r.items.committed as any[];
  say(`   -> ${r.status}; committed=${r.committed} refused=${r.refused} not_attempted=${r.not_attempted}`);
  for (const it of items) if (it.status !== "done") say(`   * ${JSON.stringify({ i: it.i, status: it.status, verified: it.verified ? { present: it.verified.subject_present, note: it.verified.note, app_error: it.verified.app_error } : undefined })}`);
  for (const x of r.items.refused as any[]) say(`   * refused plan ${x.plan_id}: ${x.error}`);

  say(`\nGROUND TRUTH NOW ${JSON.stringify(truth())}   still present: ${leavers.filter((d) => g.state.residents.some((x) => x.dir === d)).join(", ") || "none"}`);
  const leaverDevicesLeft = g.state.devices.filter((d) => leavers.includes(d.dir)).length;
  say(`devices still held by leavers: ${leaverDevicesLeft}   (the one app hang that did nothing keeps its devices)`);

  // Add two residents, one of them a repeat of an existing directory code.
  const addOps = [{ op: "create" as const, kind: rm!.id, record: { key: "2001", Resident: "Nia Fenn", Dir: "2001", Unit: "140A" } }, { op: "create" as const, kind: rm!.id, record: { key: "1050", Resident: "Dup Person", Dir: "1050", Unit: "999Z" } }];
  for (const op of addOps) {
    const a = (await w.apply(op)) as any;
    if (a.status === "awaiting_approval") { w.approve(a.plan_id); const c = (await w.commit(a.plan_id)) as any; say(`5. ADD ${op.record.Dir} -> ${c.status ?? c.error} verified=${JSON.stringify((c.verified ?? {}) as object).slice(0, 160)} ${c.detail ?? ""}`); }
    else say(`5. ADD ${op.record.Dir} -> ${JSON.stringify(a).slice(0, 220)}`);
  }
  say(`\nFINAL ground truth ${JSON.stringify(truth())}  (target 73 / 137)`);
} finally { await fa.close(); await g.close(); }
