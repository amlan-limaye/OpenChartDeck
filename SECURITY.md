# Security policy

Scope: local, single-user viewing. Internet exposure and multiuser hosting are unsupported. Do not forward the loopback port or treat this process as an authenticated public data API.

Use GitHub private vulnerability reporting if it is enabled for this repository. Otherwise, open a public issue requesting a private contact channel without exploit details, credentials or sensitive data. Wait for the maintainer to provide that channel before sharing details.

## Controls reviewed

- Loopback binding and local Host checks; exact Origin and JSON requirements for mutations; bounded request sizes, concurrency and request rate.
- Fixed static file allowlist; source files, `.env`, directories and traversal requests are not served.
- CSP restricts scripts/connect/frame/base/object sources. Inline styles are retained for chart layout; inline/eval scripts are not allowed. No-store, no-referrer and nosniff headers.
- No trading/account/key-management endpoint, arbitrary upstream proxy or credential-upload browser form.
- Credentials are accepted only through explicit IEX startup. Hidden-input fallback is refused; occupied ports are left alone. Secret values are absent from browser state, source, command-line arguments and application logs. Bootstrap uses the process environment before values are removed from it; active adapter RAM still contains them.
- Fixed provider endpoints reject redirects. Provider bodies/headers and raw exception text are not sent to the UI. Instrument identity, OHLCV, dates and units are validated.
- Access denial halts the route; reconnect/backoff retains last good data without calling it fresh. Candidate freshness cannot verify hidden underlying input timestamps.
- Locked dependencies, local chart bundle, retained notices, pinned CI actions and read-only CI permissions. No pull-request secrets or deployment workflow.

## Release checks

Run `npm test`, `npm run test:private`, `npm run check:release` and a current dependency advisory check. The scanner checks the proposed tree, staged blobs and this repository's reachable commit history. It prints file/reason only for possible secrets. It checks common patterns and accidental inclusions, not every possible credential format.

The review found no confirmed critical/high issue in the scoped candidate. This is not a penetration test or a guarantee against vulnerabilities. Host compromise, other local software and provider entitlement rules remain outside these controls. Use a patched supported Node runtime. Session calendars and upstream schemas require maintenance.

For every release, review the exact public file manifest, commit identity and provider scope. Keep synthetic demos and actual data unmistakably separate.
