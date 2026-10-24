#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
printf '%s\n' 'Starting public feeds. Keep this Terminal window open.'
exec node server.mjs --public "$@"
