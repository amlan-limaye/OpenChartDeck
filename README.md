# OpenChartDeck

**Simple, open-source market charts.**

OpenChartDeck is a lightweight open-source alternative for viewing multiple market charts. It runs locally on your computer, with no trading or account-management features.

The dashboard comes with four saved workspaces — **Gold, AI, Crypto, Indices** — and eight daily charts per workspace. Candles, SMA20 on close, volume where meaningful, synchronized cursors, focus view and a per-slot instrument picker.

## Try the offline demo

Use patched **Node.js 24.22.1 or later in the 24.x line** and npm. Python 3 is needed only for private IEX credential entry on macOS/Linux.

```sh
npm ci --ignore-scripts
npm start
```

Open **http://127.0.0.1:4175**. The default is a clearly labelled **synthetic demo**: invented deterministic prices, no provider connections, no credentials. It exercises all 32 positions and includes TSLA and the optional candidate choices. Demo values are never silently used as fallback market data.

If another dashboard already uses that port, leave it running and use `npm start -- --port 4185`. Startup never stops another process. Keep the terminal running; Control-C stops this instance.

## Use market data

First review [provider access and data rights](docs/PROVIDER-USE.md). Availability depends on region, provider, product and entitlement.

```sh
npm run start:public
```

This enables documented public sources. It can fill 17 default positions without IEX or Cboe: eight Binance perpetuals, DRV spot, six trade[XYZ] perpetual proxies, an ECB-derived daily dollar basket and daily Treasury yield. This is a coverage capability, not a promise of uninterrupted access.

For an existing, appropriately authorized Alpaca paper account with IEX access, stop only this release instance, then:

```sh
python3 scripts/start-iex.py
```

Enter your existing key ID and secret into the hidden terminal prompts. On macOS, `launchers/Start Dashboard.command` opens this same managed launcher. If a browser download/upload has lost executable file permissions, first run `chmod +x launchers/*.command` from this directory. One foreground Python launcher owns one Node child containing both the dashboard and IEX adapter. It opens the browser after authenticated stock history is ready. Keep that one Terminal window open; Control-C stops the whole session. Occupied ports are left untouched before credentials are requested. If the launcher dies, the child detects its closed pipe and exits. A process failure requires relaunch and private reentry; provider reconnection is automatic within a running session.

Supported stock changes validate history and wait for a subscription acknowledgement without another restart, within the 30-symbol limit. The original fourteen symbols are retained; unused additions can be released after ten minutes.

The launcher accepts `--port 4185`. Cboe daily VIX retrieval is disabled by default: add `--cboe` only if you have appropriate rights to use that content. Without it, VIX remains a labelled setup-required position. No Cboe data is bundled. With suitable access, the original prototype populated all 32 positions; several are daily references or explicitly different derivatives.

Alpaca paper keys also permit simulated trading at the provider. This viewer makes only market-data requests; it does not narrow the key's provider-side permissions. It cannot create/rotate keys, place orders, manage positions, or open accounts. Credentials are kept in process memory, never browser storage or source files. Restart requires private reentry.

## Change a chart

Click its ticker, search/filter by provider, review instrument type and source, then choose **Use instrument**. Availability is checked before a change. **Undo**, **Restore original ticker**, and the candidate's **Daily reference** control preserve explicit source choice. Layout/range/indicator preferences stay with the slot and are saved in this browser. Exact symbols and venues remain distinct.

## Feed limitations

This is a daily-chart viewer, not an exchange-consolidated terminal. The example catalog includes derivatives and daily reference series. **USIDX CFD delay is unknown; VOLX is a perpetual proxy, not spot VIX.** Daily Treasury yield and ECB fixings are not intraday. A 60-second REST refresh is not a guarantee of 60-second underlying freshness. [Full mappings and cadence](docs/FEEDS.md).

## Develop and verify

```sh
npm test
npm run test:private
npm run check:release
```

Tests use constructed synthetic data and dummy credentials. They do not need accounts. CI covers macOS and Linux with pinned actions. Windows runtime and secure launcher support are not verified.

[Architecture](docs/ARCHITECTURE.md) · [Validation](docs/VALIDATION.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md) · [Third-party notices](THIRD_PARTY.md) · [Release decisions](docs/RELEASE.md)

Lightweight Charts™ is created by [TradingView](https://www.tradingview.com/). Its attribution, NOTICE and Apache license are retained. Original application code is licensed under [Apache-2.0](LICENSE), copyright 2026 Amlan Limaye. The code license grants no market-data or trademark rights. This project is not affiliated with TradingView or any data provider and does not claim full TradingView feature parity.
