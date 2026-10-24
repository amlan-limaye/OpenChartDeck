# Architecture

A single Node process serves a static vanilla-JavaScript UI, sanitized state snapshots and server-sent updates on loopback. Lightweight Charts is loaded from the pinned local dependency. No bundler, CDN, database, cloud service or telemetry is required.

- `server.mjs`: CLI modes, fixed static allowlist, Host/Origin checks, bounded picker routes and SSE.
- `lib/feeds.mjs`: provider adapters, input validation, RAM histories, cadence/backoff and status.
- `lib/alpaca.mjs`: the sole credential-bearing object; authenticated IEX REST and WebSocket only. Dynamic additions validate history, then wait for stream acknowledgement. Existing histories survive recoverable failures.
- `lib/picker.mjs`: exact provider/type search, cached metadata, validation and ten-minute leases. It receives sanitized state and an in-process subscription callback, never credentials.
- `lib/equivalents.mjs`, `gate.mjs`: reference parsing, explicit proxy semantics and timestamp validation.
- `lib/demo.mjs`: deterministic invented values. Default startup uses this offline implementation; it never substitutes for failed market data.
- `public/`: chart UI, SMA/calendar helpers, catalog and validated saved-slot preferences.

Credentials enter through a no-echo terminal prompt. A foreground Python launcher supervises the Node child, handing values through the child's initial process environment. Node removes those names after constructing the adapter. Values remain in launcher and adapter RAM until exit; they are never written by the app to files or browser storage. No promise of protection against an administrator, same-user debugger, compromised host or OS crash dump is made.

`scripts/managed_launcher.py` checks port ownership, monitors startup readiness, opens the local dashboard and cleans up only its own children. `scripts/managed-child.mjs` monitors the parent's private stdin pipe and bounds cleanup if the parent disappears. No daemon, login item, automatic process restart or credential persistence is installed. The standalone release integrates both logical services in one Node child; the originating local prototype uses the same supervisor with two children.

Market data remains in RAM. The browser persists ticker selection, active tab, order, indicators and chart ranges under a release-specific local-storage key. Export contains ticker names only. No import of the originating user's browser state or local publisher occurs.

All source selections pass through protected same-origin JSON POST routes. GET search cannot subscribe. There is no arbitrary-URL proxy, trading route, credential-upload route, external bind option or widget embedding.
