// The restyled GateAdmin replica, run locally, against the unmodified compiler. Graded from the replica's owner state.
process.env.WICKET_SCAN_TTL_MS = "3000";
import { FormAdapter } from "../src/generator/form-adapter.js";
import { TableAdapter } from "../src/generator/tables.js";
import { CompositeAdapter } from "../src/adapters/composite.js";
import { Wicket } from "../src/engine.js";
import { RuleBook } from "../src/rules.js";
const B = "http://127.0.0.1:9115";
const owner = async () => (await (await fetch(`${B}/owner/state`, { headers: { "X-Owner-Token": "local-owner-tok-456" } })).json()) as any;
await fetch(`${B}/owner/reset`, { method: "POST", headers: { "X-Owner-Token": "local-owner-tok-456" } });
const fa = new FormAdapter();
try {
  const si = await fa.signIn(`${B}/Login.aspx`, "RL"); console.log("sign in:", si.signedIn, si.detail);
  await fa.open(`${B}/Residents.aspx`); await fa.refresh();
  const ta = new TableAdapter(() => fa.currentPage());
  const rm = await ta.attach();
  for (const m of rm) console.log("residents page list:", m.id, "key", m.keyColumn ?? m.keyParam ?? "NONE", "rows", m.rows, "paged", m.paged, "cols", m.columns.slice(0, 6).join("|"), "actions", m.actions.map((a) => a.label + ":" + a.type).join(","), "add", m.add);
  await fa.open(`${B}/Devices.aspx`); await fa.refresh();
  const all = await ta.attach();
  for (const m of all) console.log("known list:", m.id, "key", m.keyColumn ?? m.keyParam ?? "NONE", "rows", m.rows);
  const res = all.find((m) => m.columns.some((c) => /resident/i.test(c)) && m.columns.some((c) => /^dir$/i.test(c)) && !/vendor/i.test(m.id))!;
  const dev = all.find((m) => m.columns.some((c) => /device/i.test(c)) && m !== res)!;
  console.log("counts:", JSON.stringify(await ta.counts()));
  const w = new Wicket(new CompositeAdapter([ta]), { rules: new RuleBook(), cacheTtlMs: 0, mandate: { maxDeletesPerDay: 20 } });
  w.declareDependency(res.id, { kind: dev.id, by: "Dir" });
  w.delegate({ kinds: [res.id, dev.id], ops: ["delete"], limit: 5, ttlMs: 60_000 });
  const before = await owner();
  const r = (await w.apply({ op: "delete", kind: res.id, key: "1004" })) as any;
  console.log("delete 1004:", r.status ?? r.error, r.detail ?? "", JSON.stringify(r.verified ?? {}).slice(0, 200), "surprise", JSON.stringify(r.surprise ?? null));
  const after = await owner();
  const n = (s: any, k: string) => (Array.isArray(s?.portal?.[k]) ? s.portal[k].length : s?.portal?.[k]);
  console.log("owner state: residents", n(before, "residents"), "->", n(after, "residents"), "| devices", n(before, "devices"), "->", n(after, "devices"), "| pending", after.pending_changes);
  if (r.receipt) { const u = (await w.undo(r.receipt)) as any; console.log("undo:", u.status ?? u.error, u.detail ?? "", "restored:", JSON.stringify(u.restored ?? []), "not_restored:", JSON.stringify((u.not_restored ?? []).map((x: any) => x.kind + ":" + x.key))); console.log("after undo residents:", n(await owner(), "residents")); }
} finally { await fa.close(); }
