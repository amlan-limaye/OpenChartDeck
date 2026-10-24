# Privacy

The default demo makes no market-data calls. Explicit public mode sends selected instrument names and ordinary network metadata (including IP address) to the corresponding providers. Optional IEX also sends the supplied key pair to Alpaca's fixed authenticated market-data endpoints. No telemetry or analytics service is included.

Credentials are not written to files, browser storage or command arguments. The private launcher uses the child's initial process environment to transfer them into Node; Node removes those environment names after creating the adapter. Credentials remain in launcher and adapter RAM until process exit. This does not protect against an administrator or compromised local host. Do not paste secrets into GitHub, screenshots, shell arguments or chat.

Provider bars and response state remain in process/browser RAM. Local storage contains only preferences and ticker identifiers. Browser/device backup may preserve that storage. Clear this site's storage to reset preferences. Ticker export is a small JSON configuration, not credential or price export.

The release excludes the originating user's TradingView inventory, saved views, screenshots, logs, filesystem paths, accounts and market-data cache. Source and synthetic fixtures can be reviewed without connecting to any financial account.
