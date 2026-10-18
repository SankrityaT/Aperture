#!/usr/bin/env bash
cd ~/wicket-build
c() { ./bench/choice/choice.sh "$1" "$2" > "bench/choice/run-$1.log" 2>&1; }
c 31 remove & c 41 add & wait
c 32 remove & c 51 device & wait
c 33 remove & c 42 add & wait
c 34 remove & c 52 device & wait
c 43 add & c 53 device & wait
echo CHOICE-DONE
