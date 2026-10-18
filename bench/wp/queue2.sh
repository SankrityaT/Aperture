#!/usr/bin/env bash
# Fair WordPress head-to-head: browser only vs Aperture only, same model both sides, the owner's standing delegation on Aperture
# (as in the GateAdmin32 runs). A user lane and a post lane run side by side (different records).
cd ~/wicket-build
r() { ./bench/wp/run.sh "$@" > "bench/wp/log-$1-$2-$3.log" 2>&1; }
i=20
for m in sonnet sonnet sonnet haiku haiku; do
  r browser user $((i+1)) $m & r aperture post $((i+2)) $m & wait
  r aperture user $((i+3)) $m & r browser post $((i+4)) $m & wait
  i=$((i+4))
done
echo WP2-DONE
