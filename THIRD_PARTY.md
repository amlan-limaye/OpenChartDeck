# Provenance and notices

| Component | Version / origin | License and treatment |
|---|---|---|
| Original application | Authored with AI assistance for a local chart prototype; ported into this standalone source tree | Apache-2.0; copyright 2026 Amlan Limaye. No prior project history or proprietary overlay copied. |
| Lightweight Charts | 5.2.1, [TradingView upstream](https://github.com/tradingview/lightweight-charts) | Apache-2.0. Exact package/integrity pinned; full text in `licenses/lightweight-charts.txt`, creator notice in `NOTICE`, logo and visible TradingView link retained. |
| fancy-canvas | 2.1.0, [upstream](https://github.com/tradingview/fancy-canvas) | MIT. Included by the chart bundle; full upstream license in `licenses/fancy-canvas.txt`. |
| CI actions | Official checkout v5, setup-node v5, setup-python v6 | Referenced by verified immutable commit IDs; not vendored. Read-only token, no deployment or credential handoff. |
| Synthetic generator/tests | Original deterministic arithmetic and constructed fixtures | No captured provider dataset. Demonstration prices are invented and visibly labelled. |
| Provider adapters | Original implementations against documented APIs | No market-data rights transferred. See [provider-use review](docs/PROVIDER-USE.md). |
| Calendar date facts | [NYSE calendar](https://www.nyse.com/markets/hours-calendars) and provider session documentation | Original helper with bounded 2025–2028 coverage; future dates require maintenance. |

[Lightweight Charts attribution requirements](https://tradingview.github.io/lightweight-charts/docs#license-and-attribution) apply independently of the original-code license. The project includes no TradingView hosted widget loader, Advanced Charts code, proprietary Pine code, provider brand artwork, private endpoint scraper or login material.

The original-code license must not be presented as licensing the chart dependencies, index trademarks or market data. API accessibility is not proof of redistribution rights.
