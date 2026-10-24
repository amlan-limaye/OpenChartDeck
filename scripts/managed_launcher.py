"""Foreground-only service ownership. No credentials or child output are logged."""
import getpass
import http.client
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import warnings
import webbrowser


def port_open(port):
    with socket.socket() as probe:
        probe.settimeout(0.3)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def clean_environment():
    env = dict(os.environ)
    for name in ("APCA_API_KEY_ID", "APCA_API_SECRET_KEY", "NODE_OPTIONS", "NODE_PATH"):
        env.pop(name, None)
    return env


def patched_node():
    node = shutil.which("node")
    if not node:
        raise ValueError("node")
    result = subprocess.run([node, "--version"], env=clean_environment(), capture_output=True, text=True, timeout=5, check=True)
    match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)\s*", result.stdout)
    if not match or int(match[1]) != 24 or (int(match[2]), int(match[3])) < (22, 1):
        raise ValueError("node")
    return node


def private_pair():
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise ValueError("terminal")
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        key = getpass.getpass("Paper API key ID (hidden): ", stream=sys.stdout).strip()
        secret = getpass.getpass("Paper API secret (hidden): ", stream=sys.stdout).strip()
    if not key or not secret or any(c.isspace() for c in key + secret):
        raise ValueError("input")
    return key, secret


def read_state(port):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
    try:
        connection.request("GET", "/api/state")
        response = connection.getresponse()
        if response.status != 200:
            return None
        body = response.read(4000001)
        if len(body) > 4000000:
            return None
        value = json.loads(body)
        return value if isinstance(value, dict) else None
    except (OSError, ValueError, http.client.HTTPException):
        return None
    finally:
        connection.close()


def stop_owned(children):
    # Only Popen objects created by this invocation are eligible for cleanup.
    # Closing the private stdin pipe also stops a child if this parent is killed.
    for child in children:
        if child.stdin:
            try:
                child.stdin.close()
            except OSError:
                pass
    for child in reversed(children):
        for action, timeout in ((None, 4), ("terminate", 1), ("kill", 1)):
            if child.poll() is not None:
                break
            if action:
                try:
                    getattr(child, action)()
                except ProcessLookupError:
                    break
            try:
                child.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                continue
        child.wait()


def run_services(services, url, *, browser=True, startup_timeout=90, stop=None,
                 event=lambda name, fields: None, read=read_state, open_browser=webbrowser.open):
    stop = stop or threading.Event()
    children = []
    old_handlers = {}
    ready = False
    result = 1

    def say(message):
        try:
            print(message, flush=True)
        except OSError:
            pass

    def interrupted(signum, frame):
        event("signal", {"signal": signum})
        stop.set()

    try:
        if threading.current_thread() is threading.main_thread():
            for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
                old_handlers[sig] = signal.signal(sig, interrupted)
        if len({s["port"] for s in services}) != len(services) or any(port_open(s["port"]) for s in services):
            say("A required local port is occupied. Existing processes were left untouched.")
            return 1
        for service in services:
            if stop.is_set():
                return 130
            child = subprocess.Popen(service["args"], cwd=service["cwd"], env=service["env"],
                                     stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL, start_new_session=True)
            children.append(child)
            event("child-started", {"service": service["name"], "pid": child.pid, "port": service["port"]})
        deadline = time.monotonic() + startup_timeout
        say("Starting both services. Waiting for authenticated IEX history and the dashboard…")
        while not stop.is_set():
            for service, child in zip(services, children):
                code = child.poll()
                if code is not None:
                    event("child-exited", {"service": service["name"], "pid": child.pid, "code": code})
                    say(service["name"] + " exited. Stopping only this launcher's other service. Relaunch to retry.")
                    return 1
            if not ready:
                states = [read(s["port"]) for s in services]
                if any(isinstance(state, dict) and (state.get("connection") == "access-required" or any(value.get("feed") == "IEX" and value.get("connection") == "access-required" for value in state.get("symbols", {}).values() if isinstance(value, dict))) for state in states):
                    say("IEX authentication or access was rejected. Check the current paper key pair and entitlement; no credentials were saved.")
                    return 1
                if all(state and s["ready"](state) for s, state in zip(services, states)):
                    ready = True
                    event("ready", {"pids": [p.pid for p in children]})
                    say("Ready: " + url)
                    say("Keep this one Terminal window open. Control-C stops both services. Feed outages reconnect automatically; a process exit stops this session.")
                    if browser:
                        try:
                            if open_browser(url) is False:
                                say("Open the dashboard address above in your browser.")
                        except Exception:
                            say("Open the dashboard address above in your browser.")
                elif time.monotonic() >= deadline:
                    say("Startup did not become ready within the time limit. Check data access or connectivity, then relaunch. No existing process was stopped.")
                    return 1
            stop.wait(0.5 if not ready else 1)
        result = 0 if ready else 130
        return result
    except Exception:
        say("The managed session could not start or continue. Only its own children will be stopped; no credential values are logged.")
        return 1
    finally:
        stop_owned(children)
        event("stopped", {"pids": [p.pid for p in children]})
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)
