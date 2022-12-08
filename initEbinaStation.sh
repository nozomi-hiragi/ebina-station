#!/bin/sh
cd `dirname $0`
SCRIPT_DIR=$(pwd)

if !(type docker > /dev/null 2>&1); then
  echo "Please install docker"
  exit 1
fi

if !(type docker-compose > /dev/null 2>&1); then
  echo "Please install docker-compose"
  exit 1
fi

if (type deno > /dev/null 2>&1); then
  DENO_PATH=$(which deno)
  DENO_DIR=`echo ${DENO_PATH%/deno}|sed -e 's/\//\\\\\//g'`
  sed -e "s/#export.*/cd ..\nexport PATH=$DENO_DIR:\$PATH/" startEbinaStation.sh > ./generate/startEbinaStation.sh
  sudo chmod 755 ./generate/startEbinaStation.sh
else
  echo "Please install deno"
  exit 1
fi

if (type systemctl > /dev/null 2>&1); then
  ESCAPED=`echo ${SCRIPT_DIR}|sed -e 's/\//\\\\\//g'`
  sed -e "s/ExecStart.*/ExecStart=$ESCAPED\/generate\/startEbinaStation.sh/" ebina-station.service.base > ./generate/ebina-station.service
  if [ ! -e /etc/systemd/system/ebina-station.service ]; then
    echo "link ebina-station.service to systemd"
    sudo ln -s ${SCRIPT_DIR}/generate/ebina-station.service /etc/systemd/system/ebina-station.service
  fi
fi
