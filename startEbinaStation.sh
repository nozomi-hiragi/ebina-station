#!/bin/sh
cd `dirname $0`

if [ -e ./generate/ebinaStationHonbu ]; then
  deno run -A ./honbu/main.ts
else
  echo "init first"
  exit 1
fi
