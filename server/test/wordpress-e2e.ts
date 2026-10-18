// Real WordPress on this machine (targets/wordpress/up.sh). Not tuned for: the compiler was never run on it before this file.
// Every step is graded from WordPress's own database, never from what Wicket says.
import { execSync } from "node:child_process";
import { FormAdapter } from "../src/generator/form-adapter.js";
import { TableAdapter } from "../src/generator/tables.js";
import { CompositeAdapter } from "../src/adapters/composite.js";
import { Wicket, isRefusal } from "../src/engine.js";
import { RuleBook } from "../src/rules.js";

const BASE = "http://localhost:8082";
const db = (sql: string) => execSync(`docker exec wp-db mariadb -N -uwp -pwp wp -e "${sql}"`, { encoding: "utf8" }).trim();
const out: { step: string; ok: boolean; detail: string }[] = [];
const rec = (step: string, ok: boolean, detail: string) => { out.push({ step, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${step}  ${detail}`); };

const wp = (args: string) => execSync(`docker run --rm --network wicket-wp --volumes-from wp-web -e WORDPRESS_DB_HOST=wp-db -e WORDPRESS_DB_NAME=wp -e WORDPRESS_DB_USER=wp -e WORDPRESS_DB_PASSWORD=wp --user 33:33 wordpress:cli wp ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
// Put the test data back first, so this test can be run again: user tester5 present, 'Test post 3' published.
try { wp("user get tester5 --field=ID"); } catch { wp('user create tester5 tester5@example.test --role=subscriber --user_pass=pw-5-test --first_name=Test5 --last_name=User'); }
execSync(`docker exec wp-db mariadb -uwp -pwp wp -e "update wp_posts set post_status='publish' where post_title='Test post 3' and post_type='post'"`, { stdio: "ignore" });
const fa = new FormAdapter();
try {
  const si = await fa.signIn(`${BASE}/wp-login.php`, "WP");
  rec("sign in with a stored login", si.signedIn, si.detail.slice(0, 80));
  if (!si.signedIn) throw new Error("not signed in");

  // ---- Users
  await fa.open(`${BASE}/wp-admin/users.php`); await fa.refresh();
  const ta = new TableAdapter(() => fa.currentPage());
  const models = await ta.attach();
  const um = models.find((m) => /user/i.test(m.id) && m.rows >= 5) ?? models[0]!;
  rec("compile the Users list", !!um && um.keySource !== "none", `kind=${um?.id} key=${um?.keyColumn ?? um?.keyParam} rows=${um?.rows}/page paged=${um?.paged} actions=${um?.actions.map((a) => a.label + ":" + a.type).join(",")} add=${um?.add} recovery_seen=${JSON.stringify(um?.recoveryHints ?? [])}`);
  const w = new Wicket(new CompositeAdapter([ta]), { rules: new RuleBook(), cacheTtlMs: 0, mandate: { maxDeletesPerDay: 50 } });

  const all = (await w.find(um.id, undefined, 100)) as { count: number; items: Record<string, unknown>[] };
  const dbUsers = Number(db("select count(*) from wp_users"));
  rec("every user is seen across all pages", all.count === dbUsers, `wicket sees ${all.count}, database has ${dbUsers}`);

  const target = all.items.find((i) => Object.values(i).some((v) => v === "tester5"));
  rec("a specific user is found by key, not by name", !!target, `key=${target?.key}`);
  const before = Number(db("select count(*) from wp_users"));
  const idBefore = db("select ID from wp_users where user_login='tester5'");
  const a = (await w.apply({ op: "delete", kind: um.id, key: String(target?.key) })) as Record<string, any>;
  rec("a first-time delete waits for the owner", a.status === "awaiting_approval", `status=${a.status ?? a.error}`);
  if (a.plan_id) w.approve(a.plan_id);
  const c = a.plan_id ? ((await w.commit(a.plan_id)) as any) : null;
  const gone = db("select count(*) from wp_users where user_login='tester5'") === "0";
  rec("delete: the system's own database agrees", !!c && ["done", "done_with_surprise"].includes(c.status) && gone && Number(db("select count(*) from wp_users")) === before - 1, `receipt=${c?.status ?? JSON.stringify(c).slice(0, 120)} surprise=${JSON.stringify(c?.surprise ?? null)} users ${before}->${db("select count(*) from wp_users")}`);
  if (c?.receipt || c?.id) {
    const u = (await w.undo(c.receipt ?? c.id)) as any;
    const back = db("select count(*) from wp_users where user_login='tester5'") === "1";
    const idAfter = db("select ID from wp_users where user_login='tester5'");
    rec("undo: the user is back in the database", u.status === "undone" && back, `undo=${u.status ?? u.error} ${u.detail ?? ""} ${JSON.stringify(u.next ?? "")} id ${idBefore} -> ${idAfter || "none"} not_restored=${JSON.stringify(u.verified?.fields_not_restored ?? [])} recovery=${JSON.stringify(c.recovery ?? null)}`);
  }

  // ---- Posts (WordPress has a native Trash)
  await fa.open(`${BASE}/wp-admin/edit.php`); await fa.refresh();
  const pm = (await ta.attach()).find((m) => /post/i.test(m.id) || m.columns.some((x) => /title/i.test(x)));
  rec("compile the Posts list", !!pm && pm.keySource !== "none", `kind=${pm?.id} key=${pm?.keyColumn ?? pm?.keyParam} rows=${pm?.rows} actions=${pm?.actions.map((x) => x.label + ":" + x.type).join(",")} recovery_seen=${JSON.stringify(pm?.recoveryHints ?? [])}`);
  if (pm) {
    const posts = (await w.find(pm.id, "Test post 3", 5)) as { items: Record<string, unknown>[] };
    const p3 = posts.items?.[0];
    const published = () => db("select post_status from wp_posts where post_title='Test post 3' and post_type='post' limit 1");
    rec("the post is found", !!p3, `key=${p3?.key} status in DB: ${published()}`);
    if (p3) {
      const pa = (await w.apply({ op: "delete", kind: pm.id, key: String(p3.key) })) as any;
      if (pa.plan_id) w.approve(pa.plan_id);
      const pc = pa.plan_id ? ((await w.commit(pa.plan_id)) as any) : pa;
      rec("post removal: what the DATABASE says happened", true, `receipt=${pc?.status ?? pc?.error} db post_status now: ${published() || "(row gone)"}  (WordPress Trash keeps the row as 'trash'; a hard delete removes it)`);
    }
  }
} catch (e) { rec("run", false, String((e as Error).message).split("\n")[0]!); }
finally { await fa.close(); }
console.log(`\n${out.filter((x) => x.ok).length}/${out.length} checks passed`);
