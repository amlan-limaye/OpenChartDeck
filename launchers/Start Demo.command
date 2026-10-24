#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
printf '%s\n' 'Starting the synthetic demo. Keep this Terminal window open.'
exec node server.mjs --demo "$@"
