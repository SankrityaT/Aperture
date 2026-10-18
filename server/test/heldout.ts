// Held-out check: point the compiler, unmodified, at public demo apps nobody here has tuned it for. Read-only: sign in, compile, print what it found.
import { FormAdapter } from "../src/generator/form-adapter.js";
import { TableAdapter } from "../src/generator/tables.js";

const SITES: { name: string; login?: string; start: string; then: string }[] = JSON.parse(process.env.SITES ?? "[]");
for (const s of SITES) {
  const fa = new FormAdapter();
  const t0 = Date.now();
  try {
    if (s.login) { const r = await fa.signIn(s.start, s.login); console.log(`\n## ${s.name}\nsign in: ${r.signedIn} (${r.detail.slice(0, 90)})`); if (!r.signedIn) continue; await fa.open(s.then); }
    else { console.log(`\n## ${s.name}`); await fa.open(s.then); }
    await fa.refresh();
    const ta = new TableAdapter(() => fa.currentPage());
    const ms = await ta.attach();
    console.log(`compiled in ${Date.now() - t0} ms; page: ${(await fa.currentPage())?.url()}`);
    if (!ms.length) console.log("tables: none found");
    for (const m of ms) console.log(`- ${m.id} [${m.shape}] rows=${m.rows} key=${m.keyColumn ?? m.keyParam ?? "NONE"} cols=${m.columns.slice(0, 6).join(" | ")} actions=${m.actions.map((a) => a.type).join(",") || "none"} add=${m.add ?? "-"}`);
    if (ms[0]) { const rows = await ta.list(ms[0].id); console.log(`first rows: ${JSON.stringify(rows.slice(0, 2)).slice(0, 260)}`); }
  } catch (e) { console.log(`ERROR: ${String((e as Error).message).split("\n")[0]}`); }
  finally { await fa.close(); }
}
