//created by kinjal
// Tally every judged Armature run in evidence/armature into a per-case table (markdown on stdout).
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "evidence", "armature");
const cases = JSON.parse(readFileSync(join(here, "cases.json"), "utf8")).cases;
const rows = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith("-verdict.json"))) {
  const n = /^case(\d+)-/.exec(f)?.[1];
  const v = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const verdict = v.evaluation?.verdict ?? "not judged";
  const s = JSON.parse(readFileSync(join(dir, f.replace("-verdict.json", "-status.json")), "utf8"));
  const dur = (s.run ?? s).duration_ms;
  (rows[n] ??= []).push({ verdict, dur, file: f });
}
let all = 0, pass = 0;
console.log("| # | Case | Runs | Passed | Partial | Failed | Median time |\n|---|---|---|---|---|---|---|");
for (const c of cases) {
  const r = rows[c.n] ?? [];
  const p = r.filter((x) => x.verdict === "passed").length, pa = r.filter((x) => x.verdict === "partial").length;
  const fl = r.length - p - pa;
  const d = r.map((x) => x.dur ?? 0).sort((a, b) => a - b);
  const med = d.length ? `${Math.round(d[Math.floor(d.length / 2)] / 1000)} s` : "-";
  all += r.length; pass += p;
  console.log(`| ${c.n} | ${c.name}${c.readonly ? " (read-only)" : ""} | ${r.length} | ${p} | ${pa} | ${fl} | ${med} |`);
}
console.log(`\n**Total: ${pass} of ${all} judged runs passed.**`);
