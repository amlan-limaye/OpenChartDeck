"""Test only dummy input and stubbed supervision; no authenticated feed starts."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import pty
import select
import signal
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parent.parent / 'scripts/start-iex.py'
sys.path.insert(0,str(SCRIPT.parent))
KEY = 'DUMMY_EXPANDED_KEY'
SECRET = 'DUMMY_EXPANDED_SECRET'


class ExpandedInputTests(unittest.TestCase):
    def test_non_terminal_refuses_before_input(self):
        p = subprocess.run([sys.executable, str(SCRIPT)], input=KEY+'\n'+SECRET+'\n', capture_output=True, text=True)
        self.assertEqual(p.returncode, 1)
        self.assertIn('Hidden terminal input is required', p.stdout)
        self.assertNotIn(KEY, p.stdout+p.stderr)
        self.assertNotIn(SECRET, p.stdout+p.stderr)

    def test_running_publisher_is_not_stopped_and_no_credentials_are_requested(self):
        spec = importlib.util.spec_from_file_location('expanded_input', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        output = io.StringIO()
        output.isatty = lambda: True
        with patch.object(module.sys.stdin, 'isatty', return_value=True), contextlib.redirect_stdout(output), \
             patch.object(module, 'port_open', return_value=True), \
             patch.object(module, 'private_pair', side_effect=AssertionError('Input must not be requested')), \
             patch.object(module, 'run_services', side_effect=AssertionError('Services must not start')):
            self.assertEqual(module.main([]), 1)
        self.assertIn('left untouched', output.getvalue())

    def test_hidden_handoff_uses_owned_child_memory_and_explicit_iex_flag(self):
        wrapper = f'''
import os, runpy, sys
sys.path.insert(0,{str(SCRIPT.parent)!r})
ns=runpy.run_path({str(SCRIPT)!r},run_name='test_only')
ns['main'].__globals__['port_open']=lambda port:False
ns['main'].__globals__['patched_node']=lambda:'node'
def checked_run(services,url,**options):
    assert len(services)==1
    args,env=services[0]['args'],services[0]['env']
    assert args[-3:]==['--iex','--port','4175']
    assert env['APCA_API_KEY_ID']=={KEY!r}
    assert env['APCA_API_SECRET_KEY']=={SECRET!r}
    assert {KEY!r} not in ' '.join(args) and {SECRET!r} not in ' '.join(args)
    print('EXPANDED_HANDOFF_OK',flush=True)
    raise SystemExit(0)
ns['main'].__globals__['run_services']=checked_run
raise SystemExit(ns['main']([]))
'''
        pid, fd = pty.fork()
        if pid == 0:
            os.execl(sys.executable, sys.executable, '-c', wrapper)
        output=bytearray(); sent_key=sent_secret=False
        try:
            deadline=time.monotonic()+8
            while time.monotonic()<deadline:
                if not select.select([fd],[],[],.2)[0]:continue
                try: chunk=os.read(fd,65536)
                except OSError:break
                if not chunk:break
                output.extend(chunk)
                if b'key ID (hidden): ' in output and not sent_key:
                    os.write(fd,(KEY+'\n').encode());sent_key=True
                if b'secret (hidden): ' in output and not sent_secret:
                    os.write(fd,(SECRET+'\n').encode());sent_secret=True
                if b'EXPANDED_HANDOFF_OK' in output:break
            text=output.decode(errors='replace')
            self.assertIn('EXPANDED_HANDOFF_OK',text)
            self.assertNotIn(KEY,text);self.assertNotIn(SECRET,text)
        finally:
            os.close(fd)
            try:os.kill(pid,signal.SIGTERM)
            except ProcessLookupError:pass
            os.waitpid(pid,0)


if __name__=='__main__':unittest.main()
