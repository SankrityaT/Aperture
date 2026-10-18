#!/usr/bin/env bash
# WordPress: free choice x6 (two tasks, two models), and browser-only vs Aperture-only on each task.
cd ~/wicket-build
r() { ./bench/wp/run.sh "$@" > "bench/wp/log-$1-$2-$3.log" 2>&1; }
r choice user 1 default; r choice post 2 default
r choice user 3 sonnet; r choice post 4 sonnet
r choice user 5 default; r choice post 6 sonnet
r browser user 7 default; r aperture user 8 default
r browser post 9 default; r aperture post 10 default
echo WP-DONE
