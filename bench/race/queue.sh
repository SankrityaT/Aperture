#!/usr/bin/env bash
# Run the race set two at a time: 5 normal pairs (11-15) and 3 hang pairs (21-23).
cd ~/wicket-build
run() { ./bench/race/race-n.sh "$1" "$2" > "bench/race/runs-$1.log" 2>&1; }
run 11 normal & run 21 hang & wait
run 12 normal & run 22 hang & wait
run 13 normal & run 23 hang & wait
run 14 normal & run 15 normal & wait
echo QUEUE-DONE
