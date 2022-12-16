#!/bin/sh
cd `dirname $0`
#export PATH=$PATH
deno run --allow-env --allow-run --allow-net --allow-read=./project,./logs,./sh,./.env,./.env.defaults,./nginx.conf.base,./entrance.ts,/etc/ssl/certs/dhparam.pem --allow-write=./project,./logs,./docker-compose.yml ./honbu/main.ts
