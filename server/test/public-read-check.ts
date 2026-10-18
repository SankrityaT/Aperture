import { FormAdapter } from "../src/generator/form-adapter.ts";
import { TableAdapter } from "../src/generator/tables.ts";
process.env.WICKET_ALLOWED_HOSTS = "127.0.0.1,localhost";
const forms = new FormAdapter(); const tables = new TableAdapter(() => forms.currentPage());
const t0 = Date.now();
try {
  const s = await forms.compile("https://www.amazon.com/s?k=apple+airpods");
  const models = await tables.attach();
  console.log("compiled amazon in", Date.now() - t0, "ms; title:", (s as any).title, "; tables:", models.map((m) => `${m.id}(${m.title?.slice(0, 30)})`).slice(0, 6));
  try { await tables.delete(models[0]!.id, "x"); console.log("FAIL a delete on amazon was not refused"); } catch (e) { console.log("delete on amazon:", (e as Error).message.slice(0, 120)); }
  try { await forms.signIn("https://www.amazon.com/ap/signin", "REPLICA"); console.log("FAIL"); } catch (e) { console.log("stored login on amazon:", (e as Error).message.slice(0, 100)); }
  try { await forms.compile("http://169.254.169.254/latest/meta-data/"); console.log("FAIL"); } catch (e) { console.log("metadata:", (e as Error).message.slice(0, 90)); }
} finally { await forms.close(); }
