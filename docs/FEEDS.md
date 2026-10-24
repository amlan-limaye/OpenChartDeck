# Instruments, timing and honest limitations

All charts use daily observations. Provider identifiers are configuration, not bundled market data. Sources can change availability, contract definitions and terms; the adapters validate identity and stop after access denial.

| Default route | Positions | Meaning and cadence |
|---|---:|---|
| Alpaca IEX | 14 | DRAM, CRWV, MAGS, AAPL, ORCL, SOXX, META, BOT, PLTR, GDX, HOOD, IGV, SPCX, ARKG. Daily raw share-volume history plus daily-bar WebSocket updates. New York session calendar; 15-second health checks, not a trade-tick subscription. |
| Binance USDⓈ-M | 8 | BTC, ETH, LIT, HYPE, WLD, ZEC, VVV, AAVE against USDT, exact perpetual markets. UTC daily trade OHLCV; 60-second REST cycle. |
| Hyperliquid spot | 1 | DRV/USDC resolved from public metadata. UTC daily trade OHLCV; 60-second cycle. |
| Hyperliquid trade[XYZ] | 6 | `xyz:JPY`, `xyz:XYZ100`, `xyz:KR200`, `xyz:GOLD`, `xyz:CL`, `xyz:SILVER`. Actual perpetual trades; 60-second cycle. |
| ECB reference | 1 | Indicative six-FX dollar basket calculated from daily ECB fixings. Different source/fixing time from official ICE DXY. Hourly checks, daily observations, no volume. |
| US Treasury | 1 | Official ten-year constant-maturity par yield, percent per year. Daily reference, hourly checks; not intraday on-the-run yield or a bond price. |
| Cboe, opt-in | 1 | Spot VIX daily OHLC, no trading volume. Hourly checks do not create intraday values. Requires appropriate content rights and `--cboe`. |

Total: 32 default positions. Public mode without IEX/Cboe has 17 potential populated positions; optional IEX adds 14; permitted Cboe access adds one. Failed routes remain honestly empty/stale with retained prior bars where available.

## Material proxy differences

- USDJPY: `xyz:JPY` is quoted in yen per US dollar, settled in USDC; perpetual basis and funding differ from spot FX.
- NAS100USD: `xyz:XYZ100` is trade[XYZ]'s technology/growth benchmark; do not call it official Nasdaq-100 or the original CFD.
- KOSPI: `xyz:KR200` covers a Korean 200-stock benchmark, narrower than KOSPI Composite. Displayed units are local index points, with quanto settlement.
- GC1!: `xyz:GOLD` is spot-linked gold in USD per troy ounce; no continuous-COMEX roll/back-adjustment convention.
- OILUSD: `xyz:CL` is WTI, USD per barrel, with futures-reference rolls and perpetual funding/basis.
- XAGUSD: `xyz:SILVER` is spot-linked silver, USD per troy ounce, traded as a perpetual.

These relationships are displayed in source details. Public derivatives can trade while their underlying cash markets are closed. Their candles and volume belong to the derivative.

## Optional Gate candidates

`GATE:CFD:USIDX`: dollar-index CFD, no volume. Exact upstream construction and underlying delay remain unverified. Broker-day boundaries may be 21:00/22:00 UTC and are labelled by the following session date. Retains the ECB basket as a separate reference.

`GATE:PERP:VOLX_USDT`: volatility perpetual trade OHLCV, 0.1 contract multiplier. Not official spot VIX. Its composite reference can include its own perpetual; funding, thin liquidity and retained closing inputs create material basis. Underlying delay remains unknown. Cboe fallback requires separate content rights.

Gate candidates are selected explicitly and refresh on a 60-second cycle. The CFD response timestamp is server time; its latest minute timestamp is a bar boundary. Perpetual book timestamps date book changes, not underlying inputs. Gate's documented once-per-second index calculation is not a guarantee of current external input. Saturday connectivity checks cannot establish market-open latency. [Gate timing rules](https://www.gate.com/help/futures/futures-logic/22069/index-price).

## Failure and time conventions

Successful polling waits its base interval after the operation finishes, so request duration adds to cadence. Failed cycles back off; access denials halt the route. HTTP freshness, current-candle age, market closure and reconnecting are distinct. Daily lines do not invent OHLC or volume. SMA20 uses twenty received closes, with a nineteen-observation warmup; missing sessions stay empty. Daily data from different sources is never spliced into one history.

The static session/holiday helper covers 2025–2028 and must be maintained; beyond its known horizon, status is unknown. This release has no IBKR integration, TradingView hosted widgets, Pine overlays, or automatic fallback to a similarly named instrument.
