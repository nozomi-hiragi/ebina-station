#!/bin/sh
cd `dirname $0`
deno run --allow-run --allow-read --allow-write --allow-net honbu/main.ts
