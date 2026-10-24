#!/usr/bin/env python3
"""Hidden paper-key entry. No files, key generation, account calls or trading."""
import argparse
from pathlib import Path
import sys
from managed_launcher import clean_environment, patched_node, port_open, private_pair, run_services


def main(argv=None):
    parser = argparse.ArgumentParser(description="Private local IEX launcher")
    parser.add_argument("--port", type=int, default=4175)
    parser.add_argument("--cboe", action="store_true", help="Enable Cboe daily history only with appropriate content rights")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args(argv)
    if not 1024 <= args.port <= 65535:
        print("Port must be between 1024 and 65535.")
        return 1
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        print("Hidden terminal input is required. Open this launcher in a terminal.")
        return 1
    if port_open(args.port):
        print("The local port is occupied. The existing app was left untouched; no input requested.")
        return 1
    try:
        node = patched_node()
    except Exception:
        print("Patched Node.js 24.22.1 or newer in the 24.x line is required.")
        return 1
    print("Enter an existing paper API key pair. Both entries are hidden.")
    print("This launcher does not create keys, save them, or call trading/account APIs.")
    try:
        key, secret = private_pair()
        env = clean_environment()
        env.update(APCA_API_KEY_ID=key, APCA_API_SECRET_KEY=secret)
        root = Path(__file__).resolve().parent.parent
        original = ['DRAM','CRWV','MAGS','AAPL','ORCL','SOXX','META','BOT','PLTR','GDX','HOOD','IGV','SPCX','ARKG']
        services = [{"name":"Dashboard and IEX", "port":args.port, "cwd":str(root), "env":env,
                     "args":[node,str(root/'scripts'/'managed-child.mjs'),str(root/'server.mjs'),'--iex','--port',str(args.port)] + (['--cboe'] if args.cboe else []),
                     "ready":lambda s:s.get('version')==1 and all(s.get('symbols',{}).get(k,{}).get('connection')=='connected' and len(s['symbols'][k].get('bars',[]))>=20 for k in original)}]
        return run_services(services, f"http://127.0.0.1:{args.port}/", browser=not args.no_browser)
    except (KeyboardInterrupt, EOFError):
        print("\nCancelled. No connection started.")
        return 1
    except Exception:
        print("The local app could not start. No credential values are logged or saved.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
