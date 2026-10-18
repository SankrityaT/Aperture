#!/usr/bin/env bash
# One wave = one run of each arm at the same time, each on its own replica (and its own local Wicket server for C and D).
IDX="$1"; cd ~/wicket-build
for ARM in A B C D; do ./bench/run-one.sh $ARM $IDX > bench/runs-$ARM$IDX.log 2>&1 & done
wait
for ARM in A B C D; do tail -1 bench/runs-$ARM$IDX.log; done
