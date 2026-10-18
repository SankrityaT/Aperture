import json, os, sys, glob
root = os.path.expanduser("~/wicket-build/bench")
groups = [("pilot0-unrestricted (agents still had a shell: NOT a valid arm test)", "pilot0-unrestricted"), ("pilot1 (tools restricted, daily cap 5)", "pilot1-cap5"), ("pilot2 (tools restricted, cap 10, cascade hint)", "runs")]
for title, d in groups:
    runs = sorted(glob.glob(f"{root}/{d}/*/score.json"))
    if not runs: continue
    print("\n##", title)
    print(f'{"run":5} {"result":16} {"calls":>5} {"wicket":>6} {"browser":>7} {"cost$":>6} {"secs":>5}  residents  devices  notes')
    for f in runs:
        s = json.load(open(f)); name = s["arm"]
        res = "COMPLETE" if s.get("verified_complete") else ("UNSAFE" if s.get("unsafe") else ("PARTIAL" if s.get("partial") else "NOT DONE"))
        notes = []
        if s.get("collateral_residents"): notes.append("extra residents removed: " + ",".join(s["collateral_residents"]))
        if s.get("collateral_devices"): notes.append(f'extra devices removed: {s["collateral_devices"]}')
        if not s.get("decoy_untouched", True): notes.append("DECOY TOUCHED")
        if s.get("target_devices_left"): notes.append(f'target devices left: {s["target_devices_left"]}')
        print(f'{name:5} {res:16} {s["tool_calls"]:5} {s["wicket_calls"]:6} {s["playwright_calls"]:7} {(s["cost_usd"] or 0):6.2f} {(s["agent_ms"] or 0)/1000:5.0f}  {s.get("residents","?"):9} {s.get("devices","?"):8} {"; ".join(notes)}')
    for arm in "ABCD":
        r = [json.load(open(f)) for f in runs if os.path.basename(os.path.dirname(f)).startswith(arm)]
        if not r: continue
        ok = sum(1 for s in r if s.get("verified_complete")); un = sum(1 for s in r if s.get("unsafe"))
        wc = sum(1 for s in r if s["wicket_calls"] > 0)
        print(f'  arm {arm}: complete {ok}/{len(r)}, unsafe {un}/{len(r)}, used Wicket in {wc}/{len(r)}, mean cost ${sum((s["cost_usd"] or 0) for s in r)/len(r):.2f}, mean agent time {sum((s["agent_ms"] or 0) for s in r)/len(r)/1000:.0f}s, mean tool calls {sum(s["tool_calls"] for s in r)/len(r):.0f}')
