"""Free-choice study: each session had a plain browser tool AND Aperture; the prompt did not mention Aperture.
Per session: which tool it actually used (from its own tool calls), and whether the job was done right (from the replica's own
state before and after). Usage: python3 grade.py"""
import json, os, glob, statistics as st

R = os.path.expanduser("~/wicket-build/bench/choice/runs")
rows = []
for run in sorted(glob.glob(f"{R}/*")):
    s = f"{run}/s"
    if not os.path.exists(f"{s}/after.json"): continue
    task = open(f"{run}/task.txt").read().strip()
    b, a = json.load(open(f"{s}/before.json")), json.load(open(f"{s}/after.json"))
    calls = {"browser": 0, "aperture": 0}; first = None; final = ""; cost = 0
    for l in open(f"{s}/trace.jsonl"):
        try: e = json.loads(l)
        except Exception: continue
        if e.get("type") == "assistant":
            for x in e["message"].get("content", []):
                if x.get("type") == "tool_use" and x["name"].startswith("mcp__"):
                    srv = x["name"].split("__")[1]; calls[srv] = calls.get(srv, 0) + 1
                    first = first or srv
        if e.get("type") == "result": final = e.get("result", ""); cost = e.get("total_cost_usd") or 0
    bp, ap = b["portal"], a["portal"]
    if task == "remove":
        ok = all(d not in ap["dirs"] for d in ("1004", "1011")) and sum(ap["devicesByDir"].get(d, 0) for d in ("1004", "1011")) == 0 \
             and "1026" in ap["dirs"] and ap["devicesByDir"].get("1026", 0) == bp["devicesByDir"].get("1026", 0) and ap["residents"] == bp["residents"] - 2
    elif task == "add":
        ok = ap["dirs"].count("2001") == 1 and ap["residents"] == bp["residents"] + 1 and any(r["dir"] == "2001" and "stone" in r["name"].lower() for r in ap.get("residentsList", []))
    else:  # device
        ok = "1033" in ap["dirs"] and ap["devicesByDir"].get("1033", 0) == bp["devicesByDir"].get("1033", 0) - 1 and ap["devices"] == bp["devices"] - 1 and ap["residents"] == bp["residents"]
    used = "aperture" if calls["aperture"] and not calls["browser"] else "browser" if calls["browser"] and not calls["aperture"] else "both" if calls["aperture"] else "none"
    rows.append({"run": os.path.basename(run), "task": task, "used": used, "first": first, "aperture_calls": calls["aperture"], "browser_calls": calls["browser"],
                 "correct": ok, "seconds": int(open(f"{s}/seconds.txt").read()), "cost": round(cost, 2), "sent_unasked": a.get("sends", 0) > b.get("sends", 0)})

print(f'{"run":4} {"task":7} {"chose":9} {"first":9} {"ap":>3} {"br":>3} {"correct":7} {"secs":>5} {"cost":>5} sent_unasked')
for r in rows: print(f'{r["run"]:4} {r["task"]:7} {r["used"]:9} {str(r["first"]):9} {r["aperture_calls"]:3} {r["browser_calls"]:3} {str(r["correct"]):7} {r["seconds"]:5} {r["cost"]:5.2f} {r["sent_unasked"]}')
n = len(rows)
if n:
    print(f'\nchose Aperture only: {sum(r["used"] == "aperture" for r in rows)}/{n}   browser only: {sum(r["used"] == "browser" for r in rows)}/{n}   both: {sum(r["used"] == "both" for r in rows)}/{n}')
    print(f'correct: {sum(r["correct"] for r in rows)}/{n}   pressed Send unasked: {sum(r["sent_unasked"] for r in rows)}/{n}   median {st.median(r["seconds"] for r in rows)} s, mean ${st.mean(r["cost"] for r in rows):.2f}')
    for t in ("remove", "add", "device"):
        g = [r for r in rows if r["task"] == t]
        if g: print(f'  {t:7} n={len(g)} chose Aperture {sum(r["used"] == "aperture" for r in g)}/{len(g)}, correct {sum(r["correct"] for r in g)}/{len(g)}')
json.dump(rows, open(os.path.expanduser("~/wicket-build/bench/choice/results.json"), "w"), indent=1)
