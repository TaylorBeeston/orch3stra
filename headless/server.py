#!/usr/bin/env python3
"""Loopback HTTP service; owns one persistent WanGP Python API runtime.

Run with WanGP's .venv interpreter, NOT Director's voice-tools environment.
The HTTP listener is available during initialization for useful diagnostics.
Authentication is generated once on disk and read by the Node bridge locally.
"""
from __future__ import annotations
import argparse
import fcntl
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import stat
import subprocess
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

# Package imports work both as a script outside WanGP and in unit tests.
DIRECTOR_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DIRECTOR_ROOT))
from headless.engine import HeadlessEngine, VERSION, EXTENSIONS, fingerprint, json_text

MAX_JSON = 32*1024*1024
MAX_UPLOAD = 2*1024**3


def atomic_json(path, value):
    path = Path(path)
    tmp = path.with_name(path.name+'.'+secrets.token_hex(6)+'.tmp')
    try:
        with os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f:
            json.dump(value, f)
            f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def persistent_token(root):
    """No silent rotation. Corruption/symlinks fail instead of changing credentials."""
    path = Path(root)/'token'
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    except FileExistsError:
        if path.is_symlink():
            raise ValueError('Token file must not be a symlink.')
        token = path.read_text().strip()
        if not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', token):
            raise ValueError('Invalid persisted token. Fix or deliberately replace it while the service is stopped.')
        path.chmod(0o600)
        return token
    token = secrets.token_urlsafe(48)
    with os.fdopen(fd, 'w') as f:
        f.write(token+'\n'); f.flush(); os.fsync(f.fileno())
    return token


def other_runtimes(root):
    """Best-effort Linux guard against loading a second GPU runtime for this install."""
    root = Path(root).resolve()
    results = []
    for item in Path('/proc').glob('[0-9]*'):
        if item.name == str(os.getpid()):
            continue
        try:
            cmd = item.joinpath('cmdline').read_bytes().split(b'\0')
            args = [x.decode(errors='replace') for x in cmd if x]
            relevant = any(Path(a).name == 'wgp.py' or a in {'shared.mcp_server', 'shared.api_cli'} for a in args)
            if relevant:
                cwd = item.joinpath('cwd').resolve(strict=True)
                if cwd == root or any(a == str(root/'wgp.py') for a in args):
                    results.append(int(item.name))
        except (OSError, ValueError):
            pass
    return results


def acquire_lock(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        raise RuntimeError('A renderer already owns this lock: '+str(path))
    os.ftruncate(fd, 0)
    os.write(fd, str(os.getpid()).encode())
    return fd


def build_http(engine, token, port):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        def setup(self):
            super().setup()
            self.connection.settimeout(120)
        def log_message(self, *_args):
            pass
        def reply(self, code, value):
            blob = json_text(value).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(blob)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Connection', 'close')
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(blob)
            self.close_connection = True
        def auth(self):
            actual_port = self.server.server_address[1]
            if self.headers.get('Host') not in {'127.0.0.1:'+str(actual_port), 'localhost:'+str(actual_port)}:
                self.reply(403, {'error': 'Unexpected Host. The worker is loopback-only.'}); return False
            # Browsers connect to the paired Node server, never directly here.
            if self.headers.get('Origin'):
                self.reply(403, {'error': 'Browser access is not allowed. Use Orch3stra.'}); return False
            if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer '+token):
                self.reply(401, {'error': 'Invalid headless service credential. Director reads it from the local token file.'}); return False
            return True
        def body(self):
            if self.headers.get('Transfer-Encoding'):
                raise ValueError('Chunked request bodies are not supported here.')
            size = int(self.headers.get('Content-Length', '0'))
            if not 1 <= size <= MAX_JSON:
                raise ValueError('JSON request must be between 1 byte and 32 MiB.')
            data = self.rfile.read(size)
            if len(data) != size:
                raise ValueError('Incomplete request body.')
            return json.loads(data)
        def do_HEAD(self):
            self.do_GET()
        def do_GET(self):
            if not self.auth(): return
            try:
                u = urlsplit(self.path)
                parts = u.path.strip('/').split('/')
                if u.path == '/health':
                    return self.reply(200, engine.health())
                if u.path in {'/queue', '/jobs'}:
                    return self.reply(200, engine.queue_state())
                if u.path == '/music-models':
                    return self.reply(200, {'models': engine.music_models()})
                if u.path == '/music-model':
                    return self.reply(200, engine.music_model_info(parse_qs(u.query).get('model_type', [''])[0]))
                if u.path == '/voice-models':
                    return self.reply(200, {'models': engine.voice_models()})
                if u.path == '/voice-model':
                    return self.reply(200, engine.voice_model_info(parse_qs(u.query).get('model_type', [''])[0]))
                if u.path == '/image-models':
                    return self.reply(200, {'models': engine.reference_models()})
                if u.path == '/image-model':
                    return self.reply(200, engine.reference_model_info(parse_qs(u.query).get('model_type', [''])[0]))
                if u.path == '/models':
                    if engine.runtime_state != 'ready':
                        raise ValueError('Runtime is '+engine.runtime_state+': '+str(engine.runtime_error or 'loading modules'))
                    return self.reply(200, {'models': engine.metadata_cache})
                if u.path == '/model':
                    return self.reply(200, engine.model_info(parse_qs(u.query).get('model_type', [''])[0]))
                if len(parts) == 2 and parts[0] == 'requests':
                    key = next((k for k,j in engine.jobs.items() if j.get('request_id') == parts[1]), None)
                    return self.reply(200, {'found': key is not None, **(engine.job_state(key) if key else {})})
                if len(parts) >= 2 and parts[0] == 'jobs' and re.fullmatch(r'[a-f0-9]{32}', parts[1]):
                    if len(parts) == 2:
                        return self.reply(200, engine.job_state(parts[1]))
                    if len(parts) == 3 and parts[2] == 'metadata':
                        return self.reply(200, engine.job_metadata(parts[1]))
                    if len(parts) == 4 and parts[2] == 'outputs' and re.fullmatch(r'[a-f0-9]{32}', parts[3]):
                        return self.send_output(parts[1], parts[3])
                self.reply(404, {'error': 'Unknown headless endpoint.'})
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as exc:
                self.reply(400, {'error': str(exc)})
        def send_output(self, job_id, output_id):
            record = engine.output_record(job_id, output_id)
            if not engine.output_available(record):
                return self.reply(410, {'error': 'Archived output is missing or changed.'})
            fd = os.open(record['path'], os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
            with os.fdopen(fd, 'rb') as f:
                st = os.fstat(f.fileno())
                if (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns) != tuple(record['stat']) or not stat.S_ISREG(st.st_mode):
                    return self.reply(410, {'error': 'Archived output changed.'})
                size = st.st_size
                start, end, status_code = 0, size-1, 200
                raw = self.headers.get('Range')
                if raw:
                    match = re.fullmatch(r'bytes=(\d*)-(\d*)', raw)
                    if not match or not any(match.groups()):
                        return self.reply(416, {'error': 'Only one byte range is supported.'})
                    a,b = match.groups()
                    if a:
                        start, end = int(a), min(size-1, int(b)) if b else size-1
                    else:
                        start = max(0, size-int(b))
                    if start >= size or end < start:
                        self.send_response(416)
                        self.send_header('Content-Range', 'bytes */'+str(size)); self.send_header('Content-Length', '0')
                        self.end_headers(); return
                    status_code = 206
                self.send_response(status_code)
                self.send_header('Content-Type', record['content_type'])
                self.send_header('Content-Length', str(end-start+1))
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                if status_code == 206: self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
                self.end_headers()
                if self.command == 'HEAD': return
                f.seek(start); remaining = end-start+1
                while remaining:
                    data = f.read(min(1024*1024, remaining))
                    if not data: break
                    self.wfile.write(data); remaining -= len(data)
        def do_POST(self):
            if not self.auth(): return
            try:
                u = urlsplit(self.path)
                parts = u.path.strip('/').split('/')
                if u.path == '/upload':
                    if self.headers.get('Transfer-Encoding'): raise ValueError('Send a fixed Content-Length.')
                    size = int(self.headers.get('Content-Length', '0'))
                    name = Path(parse_qs(u.query).get('filename', ['reference'])[0].replace('\\', '/')).name
                    suffix = Path(name).suffix.lower()
                    if suffix not in EXTENSIONS:
                        raise ValueError('Unsupported media filename extension: ' + (suffix or '(none)') + '. Supply an image, audio, or video filename with its extension.')
                    if not 1 <= size <= MAX_UPLOAD:
                        raise ValueError('Upload is empty or exceeds the 2 GiB per-file limit.')
                    path = engine.root/'uploads'/(secrets.token_hex(16)+suffix)
                    remaining = size
                    try:
                        with path.open('xb') as f:
                            path.chmod(0o600)
                            while remaining:
                                chunk = self.rfile.read(min(1024*1024, remaining))
                                if not chunk: raise ValueError('Upload ended early.')
                                f.write(chunk); remaining -= len(chunk)
                            f.flush(); os.fsync(f.fileno())
                        result = engine.register_upload(path, name, self.headers.get('Content-Type', 'application/octet-stream'))
                    except Exception:
                        path.unlink(missing_ok=True); raise
                    return self.reply(200, result)
                b = self.body()
                if u.path == '/generate': return self.reply(200, engine.submit(b))
                if u.path == '/import-render': return self.reply(200, engine.import_render(b))
                if u.path == '/queue/pause': return self.reply(200, engine.set_paused(True))
                if u.path == '/queue/resume': return self.reply(200, engine.set_paused(False))
                if len(parts) == 3 and parts[0] == 'jobs' and parts[2] == 'cancel':
                    return self.reply(200, engine.cancel(parts[1]))
                if u.path == '/shutdown':
                    with engine.lock:
                        if engine.active_id:
                            raise ValueError('Finish or cancel the active render before stopping the service.')
                    self.reply(200, {'stopping': True})
                    threading.Thread(target=self.server.shutdown, daemon=True).start()
                    return
                self.reply(404, {'error': 'Unknown headless endpoint.'})
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as exc:
                self.reply(400, {'error': str(exc)})
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    return server


def runtime_info(root):
    info = {'root': str(root), 'python': sys.executable, 'python_version': sys.version.split()[0]}
    try:
        text = (root/'README.md').read_text(errors='replace')
        match = re.search(r'^##[^\n]*WanGP v([^\s,]+)', text, re.M)
        if match: info['readme_version'] = match.group(1)
    except OSError:
        pass
    try:
        r = subprocess.run(['git', '-C', str(root), 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True, timeout=5)
        if r.returncode == 0: info['commit'] = r.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return info


def load_runtime(engine, root, cli_args):
    try:
        # Required by some model loaders using relative repository paths.
        os.chdir(root)
        sys.path.insert(0, str(root))
        from shared.api import init
        session = init(root=root, cli_args=cli_args, console_output=True, console_isatty=False)
        engine.set_session(session, runtime_info(root))
        print('H3 headless WanGP ready. Browser and plugin are not required.', flush=True)
    except BaseException as exc:
        engine.initialization_failed(type(exc).__name__+': '+str(exc))
        print('WanGP initialization failed; diagnostics remain available over HTTP.', file=sys.stderr, flush=True)
        traceback.print_exc()


def main():
    parser = argparse.ArgumentParser(description='Orch3stra standalone WanGP worker (Linux).')
    parser.add_argument('--wangp-root', '--root', dest='wangp_root', default=os.environ.get('H3_WANGP_ROOT', str(Path(__file__).resolve().parents[2]/'Wan2GP')))
    parser.add_argument('--data-dir', default=os.environ.get('H3_HEADLESS_DATA_DIR', str(Path(os.environ.get('H3_DATA_DIR', str(Path.home()/'.local/share/h3-director')))/'headless')))
    parser.add_argument('--port', type=int, default=int(os.environ.get('H3_HEADLESS_PORT', '7867')))
    parser.add_argument('--check', action='store_true', help='Check paths/codecs without importing GPU runtime: exit 1 failure, exit 2 readiness unverified.')
    args = parser.parse_args()
    root = Path(args.wangp_root).expanduser().resolve()
    data = Path(args.data_dir).expanduser().resolve()
    if not args.check and (not (root/'wgp.py').is_file() or not (root/'shared/api.py').is_file()):
        parser.error('WanGP installation not found at '+str(root))
    if not 1 <= args.port <= 65535: parser.error('Port must be 1–65535.')
    try:
        extra = json.loads(os.environ.get('H3_WANGP_ARGS_JSON', '[]'))
        if not isinstance(extra, list) or not all(isinstance(a, str) for a in extra): raise ValueError()
        if any(a.split('=')[0] in {'--listen', '--server-name', '--mcp', '--open-browser', '--process', '--process-queue'} for a in extra):
            parser.error('Use generation/performance flags only, not UI/MCP/CLI job startup flags.')
    except (ValueError, TypeError): parser.error('H3_WANGP_ARGS_JSON must be a JSON array of argument strings.')
    if args.check:
        from headless.preflight import preflight
        result = preflight(root, data)
        print(json.dumps({**runtime_info(root), 'conflicting_processes': other_runtimes(root), 'ffprobe': shutil_which('ffprobe'), 'preflight': result}, indent=2))
        return result['exit_code']
    conflicts = other_runtimes(root)
    if conflicts:
        parser.error('Stop the existing WanGP/MCP process after it is idle. Refusing a second GPU runtime. PID(s): '+','.join(map(str, conflicts)))
    data.mkdir(parents=True, exist_ok=True, mode=0o700); data.chmod(0o700)
    # Root-scoped lock also prevents using another data-dir to duplicate this worker.
    locks = [acquire_lock(data/'service.lock'), acquire_lock(root/'.h3-director-headless.lock')]
    token = persistent_token(data)
    engine = HeadlessEngine(data)
    engine.runtime_info = runtime_info(root)
    server = build_http(engine, token, args.port)
    atomic_json(data/'connection.json', {'url': 'http://127.0.0.1:'+str(args.port), 'version': VERSION, 'pid': os.getpid(), 'root': str(root)})
    def stop(*_):
        with engine.wake:
            engine.closed = True; engine.paused = True; engine._save_pause()
            if engine.active_id: engine.cancel(engine.active_id)
            engine.wake.notify_all()
        threading.Thread(target=server.shutdown, daemon=True).start()
    for sig in (signal.SIGTERM, signal.SIGINT): signal.signal(sig, stop)
    boot = threading.Thread(target=load_runtime, args=(engine, root, extra), name='h3-wangp-init', daemon=True)
    boot.start()
    print('H3 headless service on 127.0.0.1:'+str(args.port)+'; private state: '+str(data), flush=True)
    try:
        server.serve_forever(poll_interval=.25)
    finally:
        server.server_close()
        clean = engine.close(timeout=60)
        if not clean: print('Cancellation did not finish in 60s; active work will be marked interrupted on restart.', file=sys.stderr, flush=True)
        for fd in locks: os.close(fd)
    return 0


def shutil_which(name):
    from shutil import which
    return which(os.environ.get('FFPROBE_BIN', name))


if __name__ == '__main__':
    raise SystemExit(main())
