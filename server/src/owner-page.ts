// A tiny page for the owner: approve or reject, raise the daily limit. Demo only, with fake data.
// It is a plain web page on purpose. The agent has no way to approve its own plan.

export const OWNER_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aperture owner</title>
<style>
  :root { color-scheme: light dark; --bg:#f4f6f9; --fg:#0e1a2b; --muted:#5b6b80; --line:#cbd5e1; --card:#fff; --accent:#d9480f; --ok:#12703a; --bad:#a8221a; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0a111c; --fg:#e6edf6; --muted:#8da0b8; --line:#25344a; --card:#111b2a; --accent:#ff8a4c; --ok:#5bd08a; --bad:#ff8277; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui,sans-serif; padding:20px max(16px, env(safe-area-inset-left)); }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 4px; } p.sub { color: var(--muted); margin: 0 0 20px; }
  h2 { font-size: 15px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 26px 0 8px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; margin-bottom: 10px; }
  .diff { font: 13px ui-monospace, Menlo, monospace; margin: 6px 0; }
  .d { color: var(--bad); } .a { color: var(--ok); }
  button { font: inherit; font-weight: 600; border: 1px solid var(--line); background: var(--bg); color: var(--fg); border-radius: 8px; padding: 7px 14px; cursor: pointer; margin-right: 6px; }
  button.go { background: var(--accent); border-color: var(--accent); color: #fff; }
  .muted { color: var(--muted); } .stats { display:grid; grid-template-columns: repeat(auto-fit,minmax(130px,1fr)); gap:8px; }
  .stat b { display:block; font-size: 22px; }
  input { font: inherit; width: 70px; padding: 6px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); }
</style></head><body><main>
<h1>Owner</h1><p class="sub">Decisions the rules sent to a person. Demo data only.</p>
<h2>Waiting for you</h2><div id="awaiting"></div>
<h2>Agent asked for help</h2><div id="esc"></div>
<h2>Limits</h2><div class="card" id="mandate"></div>
<h2>This session</h2><div class="card stats" id="metrics"></div>
<h2>What it has learned</h2><div class="card" id="rules"></div>
</main>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const tok = new URLSearchParams(location.search).get("token") || "";
const q = tok ? "?token=" + encodeURIComponent(tok) : "";
async function post(path, body) { await fetch(path + q, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); load(); }
async function load() {
  const r = await fetch("/owner/state" + q); if (!r.ok) { $("awaiting").textContent = "Not allowed. Add ?token=..."; return; }
  const s = await r.json();
  $("awaiting").innerHTML = s.awaiting.length ? s.awaiting.map((p) => '<div class="card"><b>' + esc(p.id) + '</b><div class="diff">' + p.diff.map((l) => '<div class="' + (l[0] === "-" ? "d" : l[0] === "+" ? "a" : "") + '">' + esc(l) + "</div>").join("") + '</div><div class="muted">' + esc(p.reasons.join("; ")) + '</div><p><button class="go" data-a="' + esc(p.id) + '">Approve</button><button data-r="' + esc(p.id) + '">Reject</button></p></div>').join("") : '<p class="muted">Nothing waiting.</p>';
  $("esc").innerHTML = s.escalations.length ? s.escalations.map((e) => '<div class="card">' + esc(e.reason) + '<p><button class="go" data-cap="1">Raise daily delete limit to</button><input id="cap" type="number" value="' + (s.mandate.maxDeletesPerDay + 20) + '"></p></div>').join("") : '<p class="muted">No requests.</p>';
  $("mandate").innerHTML = "Deletes today: <b>" + s.deletes_today + "</b> of <b>" + s.mandate.maxDeletesPerDay + "</b>. Publish always needs you.";
  const m = s.metrics; $("metrics").innerHTML = [["Tool calls", m.calls], ["Previews", m.previews], ["Commits", m.commits], ["Refusals", m.refusals], ["Undos", m.undos], ["Your decisions", m.human_decisions], ["Surprises caught", m.surprises], ["Avg preview ms", m.avg_preview_ms], ["Avg commit ms", m.avg_commit_ms]].map((x) => '<div class="stat"><b>' + x[1] + "</b>" + x[0] + "</div>").join("");
  $("rules").innerHTML = s.rules.map((r) => "<div>" + esc(r.rule) + (r.cascades.length ? " &rarr; also removes " + esc(r.cascades.join(", ")) : "") + ' <span class="muted">' + (r.confirmed ? "confirmed" : "not confirmed yet: asks first") + "</span></div>").join("");
  document.querySelectorAll("[data-a]").forEach((b) => b.onclick = () => post("/owner/approve", { plan_id: b.dataset.a }));
  document.querySelectorAll("[data-r]").forEach((b) => b.onclick = () => post("/owner/reject", { plan_id: b.dataset.r }));
  document.querySelectorAll("[data-cap]").forEach((b) => b.onclick = () => post("/owner/cap", { max: Number($("cap").value) }));
}
load(); setInterval(load, 2000);
</script></body></html>`;
