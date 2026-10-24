# Release validation

Local candidate checked on October 24, 2026 using Node 24.22.1 on macOS.

- 90 JavaScript tests passed: OHLCV/date/SMA validation, session/missing-bar behavior, source identity, exact ticker selection, persistence/undo, dynamic IEX acknowledgement, limits/failure recovery, candidate timing, protected loopback routes, default offline demo and Cboe opt-in.
- Ten Python launcher tests passed: three hidden-input/entry checks with dummy credentials and a stubbed supervisor, plus seven lifecycle checks with disposable local child servers. These cover patched-runtime requirements, collision refusal, readiness before browser opening, credential isolation, partial startup, authentication rejection, timeout, child exit, and no surviving fixture children after SIGINT, SIGTERM, SIGHUP or a killed parent.
- A clean `npm ci --ignore-scripts --no-audit --no-fund` installed the two pinned dependencies successfully.
- npm advisory audit reported zero known vulnerabilities for the two pinned dependencies at review time. This is a dated registry check, not a security guarantee.
- The source tree contains no required private history files. The integrated IEX runtime is verified with injected fixtures; actual authenticated production behavior was tested in the original local prototype, not by reusing its credentials in this release copy.

Browser validation at 1280×720 confirmed eight rendered charts in each of the four tabs, visible synthetic-data labels and chart attribution, PLTR→TSLA selection and persistence after reload, undo back to PLTR, cancellation, unsupported-symbol rejection, and explicit USIDX/VOLX candidate differences. No browser console errors were observed. The screenshot retained for review contains invented demo values only. Staged-tree verification is recorded in the local release handoff. CI is drafted but has not run on GitHub. Linux CI, Windows support, market-open latency for Gate candidates and universal provider/region entitlement are not established by these tests.

The 32-position demo is synthetic. A populated prototype does not mean 32 official, real-time or universally free licensed feeds. Provider delay and redistribution limits remain as described in FEEDS.md and PROVIDER-USE.md.
