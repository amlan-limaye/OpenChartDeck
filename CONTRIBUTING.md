# Contributing

Use the synthetic demo and offline tests first. Keep changes narrow and explain the user-visible behavior and validation in a pull request. Never add credentials, provider response dumps, market-data archives, private chart inventories or actual-price screenshots without separate rights review.

Run `npm ci --ignore-scripts`, `npm test`, `npm run test:private`, and `npm run check:release`. Tests must use dummy credentials and constructed data; they must not place trades, access accounts or depend on live provider availability.

New sources need exact instrument/type/units, documented endpoints, session/date conventions, meaningful volume, failure/staleness behavior and provider-use notes. Preserve explicit proxy differences. A recent HTTP response does not prove a fresh underlying price.

Keep attribution and dependency licenses. Update the lockfile deliberately. Add no install scripts, remote code loading, credential persistence or external network binding. Treat supported calendar horizons and data-schema changes as maintenance work. Security reports should use the private route described in SECURITY.md.
