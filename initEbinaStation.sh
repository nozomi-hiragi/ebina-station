#!/bin/sh
cd `dirname $0`
SCRIPT_DIR=$(pwd)

if !(type deno > /dev/null 2>&1); then
  echo "Please install deno"
  exit 1
fi

echo "Compile EbinaStation Honbu"
deno compile --allow-run --allow-read --allow-write --allow-net -o ./generate/ebinaStationHonbu ./honbu/main.ts

if (type systemctl > /dev/null 2>&1); then
  sed -e 's/ExecStart.*/ExecStart=\/app\/ebina-station\/startEbinaStation.sh/' ebina-station.service.base > ./generate/ebina-station.service
  echo "link ebina-station.service to systemd"
  sudo ln -s  ${SCRIPT_DIR}/generate/ebina-station.service /etc/systemd/system/ebina-station.service
fi
