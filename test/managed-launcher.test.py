"""Real local fixture children; no market providers or actual credentials."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import select
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import managed_launcher as launcher


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def service(port, credential=False, kind="normal", delay=0):
    env = launcher.clean_environment()
    if credential:
        env.update(APCA_API_KEY_ID="DUMMY_KEY", APCA_API_SECRET_KEY="DUMMY_SECRET")
    return {"name": "Fixture", "port": port, "cwd": str(ROOT), "env": env,
            "args": [shutil.which("node"), str(ROOT / "scripts" / "managed-child.mjs"),
                     str(ROOT / "test" / "fixtures" / "managed-service.mjs"), str(port), kind, str(delay)],
            "ready": lambda state: state.get("ready") is True}


class ManagedTests(unittest.TestCase):
    def test_runtime_guard_requires_the_patched_24_line(self):
        for version, accepted in (("v22.22.0",False),("v24.13.0",False),("v24.22.0",False),("v24.22.1",True),("v24.23.0",True),("v25.0.0",False)):
            with patch.object(launcher.shutil,"which",return_value="node"),patch.object(launcher.subprocess,"run",return_value=subprocess.CompletedProcess([],0,version+"\n","")):
                if accepted:self.assertEqual(launcher.patched_node(),"node")
                else:self.assertRaises(ValueError,launcher.patched_node)
    def test_occupied_port_never_spawns_or_touches_existing_listener(self):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0));sock.listen();port = sock.getsockname()[1]
            with patch.object(launcher.subprocess, "Popen") as spawn, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(launcher.run_services([service(port)], "http://127.0.0.1/", browser=False), 1)
            spawn.assert_not_called();self.assertTrue(launcher.port_open(port))

    def test_ready_browser_waits_for_both_and_secrets_reach_only_publisher(self):
        ports = [free_port(), free_port()];stop = threading.Event();events = [];output = io.StringIO();opened = []
        def browser(url):
            stop.set()
            states = [launcher.read_state(p) for p in ports]
            self.assertTrue(all(s["ready"] for s in states))
            self.assertTrue(states[0]["credentialPresent"]);self.assertFalse(states[1]["credentialPresent"])
            opened.append(url);stop.set();return True
        specs = [service(ports[0], True), service(ports[1], delay=150)]
        with contextlib.redirect_stdout(output):
            result = launcher.run_services(specs, "http://127.0.0.1/", stop=stop, startup_timeout=3, open_browser=browser, event=lambda n,f:events.append((n,f)))
        self.assertEqual(result, 0);self.assertEqual(len(opened), 1)
        self.assertFalse(any(launcher.port_open(p) for p in ports))
        for name in ("DUMMY_KEY", "DUMMY_SECRET"):
            self.assertNotIn(name, output.getvalue()+repr(events)+repr([s["args"] for s in specs]))

    def test_partial_spawn_failure_cleans_only_its_child(self):
        ports = [free_port(), free_port()];real_spawn = subprocess.Popen;children = []
        def spawn(*args, **kwargs):
            if children:raise OSError("fixture failure")
            child = real_spawn(*args, **kwargs);children.append(child);return child
        with patch.object(launcher.subprocess, "Popen", side_effect=spawn), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(launcher.run_services([service(p) for p in ports], "http://127.0.0.1/", browser=False), 1)
        self.assertIsNotNone(children[0].poll());self.assertFalse(any(launcher.port_open(p) for p in ports))

    def test_startup_timeout_and_child_exit_leave_no_listener(self):
        for kind, delay, timeout in (("normal", 999999, .2), ("crash", 0, 3)):
            ports = [free_port(), free_port()]
            with contextlib.redirect_stdout(io.StringIO()):
                result = launcher.run_services([service(ports[0], kind=kind, delay=delay), service(ports[1])], "http://127.0.0.1/", browser=False, startup_timeout=timeout)
            self.assertEqual(result, 1);self.assertFalse(any(launcher.port_open(p) for p in ports))

    def test_authentication_failure_never_opens_browser(self):
        port = free_port()
        with contextlib.redirect_stdout(io.StringIO()), patch.object(launcher.webbrowser, "open") as browser:
            result = launcher.run_services([service(port)], "http://127.0.0.1/", read=lambda p:{"connection":"access-required"}, open_browser=browser)
        self.assertEqual(result, 1);browser.assert_not_called();self.assertFalse(launcher.port_open(port))

    def test_ordinary_shutdown_and_killed_parent_do_not_orphan_children(self):
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP, signal.SIGKILL):
            ports = [free_port(), free_port()]
            script = f'''
import importlib.util, json, sys
from pathlib import Path
sys.path.insert(0, {str(ROOT / "scripts")!r})
spec=importlib.util.spec_from_file_location("fixtures", {str(Path(__file__).resolve())!r})
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def event(name,fields):
    if name=="ready":print("TEST_READY:"+json.dumps(fields),flush=True)
raise SystemExit(m.launcher.run_services([m.service(p) for p in {ports!r}],"http://127.0.0.1/",browser=False,event=event))
'''
            parent = subprocess.Popen([sys.executable, "-B", "-c", script], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
            child_pids = [];buffer = b""
            try:
                deadline = time.monotonic()+8
                while time.monotonic()<deadline and not child_pids:
                    if select.select([parent.stdout],[],[],.2)[0]:
                        chunk = os.read(parent.stdout.fileno(),65536)
                        if not chunk:break
                        buffer += chunk
                        for line in buffer.splitlines():
                            if line.startswith(b"TEST_READY:"):
                                child_pids = json.loads(line.split(b":",1)[1])["pids"]
                self.assertEqual(len(child_pids), 2, "fixture supervisor did not become ready")
                parent.send_signal(sig);parent.wait(timeout=8)
                deadline = time.monotonic()+7
                while time.monotonic()<deadline and any(launcher.port_open(p) for p in ports):time.sleep(.05)
                self.assertFalse(any(launcher.port_open(p) for p in ports), str(sig))
                for pid in child_pids:
                    deadline = time.monotonic()+3
                    while time.monotonic()<deadline:
                        try:os.kill(pid,0)
                        except ProcessLookupError:break
                        time.sleep(.05)
                    else:self.fail("fixture child survived its parent")
            finally:
                if parent.poll() is None:parent.kill();parent.wait()
                parent.stdout.close()
                for pid in child_pids:
                    try:os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:pass


if __name__ == "__main__":
    unittest.main()
