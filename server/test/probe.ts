// Look at a real app through the generator, read-only. Usage:
//   WICKET_CREDS_X=user:pass CHROME_PATH=... npx tsx test/probe.ts <login-url> <login-name> <page-url> [<page-url> ...]
// It signs in, opens each page, and prints what it found. It changes nothing.
import { FormAdapter } from "../src/generator/form-adapter.js";
import { TableAdapter } from "../src/generator/tables.js";

const [loginUrl, login, ...pages] = process.argv.slice(2);
const fa = new FormAdapter();
try {
  const r = await fa.signIn(loginUrl!, login!);
  console.log("sign in:", r.signedIn, "-", r.detail);
  for (const url of pages) {
    await fa.open(url);
    const s = await fa.refresh();
    const ta = new TableAdapter(() => fa.currentPage());
    const t = await ta.attach();
    console.log(`\n== ${url}\n   title: ${s.title}   forms: ${s.forms.length}   tables: ${t.length}`);
    for (const m of t) {
      console.log(`   table '${m.id}' rows=${m.rows} paged=${m.paged}`);
      console.log(`     columns: ${m.columns.join(" | ")}`);
      console.log(`     key: ${m.keyColumn ?? (m.keyParam ? "link param " + m.keyParam : "NONE")}   add: ${m.add ?? "none"}`);
      console.log(`     actions: ${m.actions.map((a) => `${a.label || "(icon)"}:${a.type}`).join(", ") || "none"}`);
      const recs = await ta.list(m.id).catch((e) => { console.log("     list failed:", String(e.message).split("\n")[0]); return []; });
      console.log(`     read ${recs.length} records; first: ${JSON.stringify(recs[0] ?? null).slice(0, 160)}`);
    }
  }
} finally { await fa.close(); }
