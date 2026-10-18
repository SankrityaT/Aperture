// A real-app check on a Dolibarr we host locally (see targets/dolibarr/up.sh). Not part of the unit tests.
// Deletes one third party through the engine, then asks the app's own database whether it is really gone.
import { execSync } from "node:child_process";
import { FormAdapter } from "../src/generator/form-adapter.js";
import { TableAdapter } from "../src/generator/tables.js";
import { CompositeAdapter } from "../src/adapters/composite.js";
import { Wicket, isRefusal } from "../src/engine.js";
import { RuleBook } from "../src/rules.js";

const db = (sql: string) => execSync(`docker exec doli-db mariadb -N -udolibarr -pdolibarr dolibarr -e "${sql}"`, { encoding: "utf8" }).trim();
const BASE = "http://localhost:8081";

const fa = new FormAdapter();
try {
  console.log("sign in:", (await fa.signIn(`${BASE}/`, "dolibarr")).detail);
if (process.env.WICKET_HEADED === "1") await new Promise((r) => setTimeout(r, 2500));
  await fa.open(`${BASE}/societe/list.php?mainmenu=companies&leftmenu=thirdparties`);
  await fa.refresh();
  const ta = new TableAdapter(() => fa.currentPage());
  const models = await ta.attach();
  const m = models[0]!;
  console.log(`compiled '${m.id}': key=${m.keyColumn}, ${m.rows} rows on this page`);
  const w = new Wicket(new CompositeAdapter([ta]), { rules: new RuleBook() });

  const rows = await ta.list(m.id);
  const target = rows.find((r) => r["Third-party name"] === process.env.TARGET_NAME) ?? rows[rows.length - 1]!;
  const targetName = String(target["Third-party name"] ?? target.key);
  const dbBefore = Number(db("select count(*) from llx_societe"));
  console.log(`\ntarget: ${targetName} (${target.key}); the app's database has ${dbBefore} third parties`);

  const ask = (await w.apply({ op: "delete", kind: m.id, key: target.key })) as Record<string, any>;
  console.log("1. apply ->", ask.status, JSON.stringify(ask.diff ?? ask.detail ?? ""));
  if (ask.status !== "awaiting_approval") process.exit(1);
  w.approve(ask.plan_id);
  const t0 = performance.now();
  const rc = await w.commit(ask.plan_id);
  const ms = Math.round(performance.now() - t0);
  if (isRefusal(rc)) { console.log("2. commit refused:", rc.error, rc.detail); process.exit(1); }
  console.log(`2. commit (${ms} ms) -> status=${rc.status} verified=${JSON.stringify(rc.verified).slice(0, 400)}`);

  const dbAfter = Number(db("select count(*) from llx_societe"));
  const stillThere = Number(db(`select count(*) from llx_societe where nom='${targetName.replace(/'/g, "")}'`));
  console.log(`3. the app's own database: ${dbBefore} -> ${dbAfter} third parties; rows with that customer code now: ${stillThere} (0 also if the record had no code)`);
  console.log(dbAfter === dbBefore - 1 && stillThere === 0 ? "RESULT: really deleted, and the read-back agrees with the database" : "RESULT: mismatch, see above");

  const u = await w.undo(rc.id);
  console.log("4. undo ->", JSON.stringify(isRefusal(u) ? { refused: u.error, detail: u.detail } : { status: u.status, restored: (u as any).verified?.restored, fields_not_restored: (u as any).verified?.fields_not_restored ?? [] }));
  console.log(`   database after undo: ${db("select count(*) from llx_societe")} third parties`);
} finally { await fa.close(); }
