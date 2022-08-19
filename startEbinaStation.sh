#!/bin/sh
cd `dirname $0`

if [ -e ./generate/ebinaStationHonbu ]; then
  ./generate/ebinaStationHonbu
else
  echo "init first"
  exit 1
fi
