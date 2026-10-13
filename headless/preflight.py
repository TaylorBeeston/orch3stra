"""Read-only startup checks. No runtime import, model loading, network or writes."""
import os
import json
from pathlib import Path
import shutil
import subprocess
import sys

def preflight(root, data, which=shutil.which, env=None):
    env = os.environ if env is None else env
    root, data = Path(root), Path(data)
    checks = []
    def add(name, requirement, state, detail):
        checks.append(dict(name=name, requirement=requirement, state=state, detail=detail))
    for name in ('wgp.py', 'shared/api.py'):
        add(name, 'required', 'pass' if (root/name).is_file() else 'fail', 'Select an existing WanGP installation containing '+name+'.')
    add('python', 'required', 'pass' if sys.version_info >= (3, 10) else 'fail', 'Use the selected WanGP environment, Python 3.10 or newer; no packages are installed by this check.')
    media_tools = {}
    for name in ('ffmpeg', 'ffprobe'):
        selected = env.get(name.upper()+'_BIN') or name
        found = which(selected)
        usable = False
        if found:
            try:
                version = subprocess.run([found, '-version'], capture_output=True, timeout=5)
                usable = version.returncode == 0 and name.encode() in version.stdout.lower()
            except (OSError, subprocess.SubprocessError):
                pass
        if usable:
            media_tools[name] = found
        add(name, 'required', 'pass' if usable else 'fail', str(found) if usable else 'Selected '+name+' executable unavailable or version check failed: '+selected+'. Review the override or PATH, then rerun --check.')
    if len(media_tools) == 2:
        try:
            encoded = subprocess.run([media_tools['ffmpeg'], '-v', 'error', '-f', 'lavfi', '-i', 'color=size=32x32:rate=24', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '0.125', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'matroska', 'pipe:1'], capture_output=True, timeout=10)
            probed = subprocess.run([media_tools['ffprobe'], '-v', 'error', '-show_streams', '-of', 'json', 'pipe:0'], input=encoded.stdout, capture_output=True, timeout=5)
            codecs = {stream.get('codec_name') for stream in json.loads(probed.stdout).get('streams', [])}
            valid = encoded.returncode == 0 and probed.returncode == 0 and {'h264', 'aac'} <= codecs
            add('media_codecs', 'required', 'pass' if valid else 'fail', 'Synthetic H.264/AAC encode and probe through memory pipes; no source files or models used.')
        except (OSError, subprocess.SubprocessError, ValueError):
            add('media_codecs', 'required', 'fail', 'Synthetic H.264/AAC encode/probe failed or timed out. Install a compatible FFmpeg build before rendering.')
    add('runtime_root_access', 'required', 'pass' if root.is_dir() and os.access(root, os.W_OK|os.X_OK) else 'fail', 'WanGP checkout must be writable for its worker lock: '+str(root)+'. No lock file was created.')
    parent = data
    while not parent.exists() and parent != parent.parent:
        parent = parent.parent
    add('storage_access', 'required', 'pass' if parent.is_dir() and os.access(parent, os.W_OK|os.X_OK) else 'fail', 'Writable data directory ancestor: '+str(parent)+'; no test file or token was created.')
    try:
        free = shutil.disk_usage(parent).free
        add('disk_space', 'advisory', 'pass' if free >= 5*1024**3 else 'review', str(free)+' free bytes; model and long-film temporary space varies. This is not a capacity guarantee.')
    except OSError:
        add('disk_space', 'advisory', 'unknown', 'Could not read free space.')
    try:
        ram = os.sysconf('SC_PAGE_SIZE')*os.sysconf('SC_PHYS_PAGES')
        add('ram', 'advisory', 'pass', str(ram)+' physical bytes; runtime availability and model requirements still need review.')
    except (ValueError, OSError, AttributeError):
        add('ram', 'advisory', 'unknown', 'Physical RAM could not be measured.')
    gpu = which('nvidia-smi')
    if gpu:
        try:
            result = subprocess.run([gpu, '--query-gpu=memory.total,memory.free,utilization.gpu', '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=3)
            lines = result.stdout.strip().splitlines()
            safe = lines and all(all(x.strip().isdigit() for x in line.split(',')) and len(line.split(',')) == 3 for line in lines)
            described = '; '.join('GPU %d: %s MiB total, %s MiB free, %s%% busy' % (i, *(x.strip() for x in line.split(','))) for i, line in enumerate(lines)) if safe else ''
            add('gpu', 'advisory', 'review' if result.returncode == 0 and safe else 'unknown', described+'. Other programs using VRAM reduce what WanGP can load.' if safe else 'GPU query failed; inspect installed driver. No runtime or model was loaded.')
        except (OSError, subprocess.SubprocessError):
            add('gpu', 'advisory', 'unknown', 'GPU query unavailable; inspect driver and GPU ownership before generation.')
    else:
        add('gpu', 'advisory', 'unknown', 'nvidia-smi unavailable. Device support and free VRAM are unverified; no universal VRAM guarantee.')
    add('runtime_dependencies', 'advisory', 'unknown', 'The full WanGP environment and decoded-media API are verified during runtime initialization/explicit bounded tests, not by a model-free check.')
    structural_ok = not any(c['requirement'] == 'required' and c['state'] == 'fail' for c in checks)
    # A structural, model-free probe must not certify an uninitialized SDK.
    return dict(ok=False, structural_ok=structural_ok, ready=False,
                status='readiness_unverified' if structural_ok else 'required_checks_failed',
                exit_code=2 if structural_ok else 1, offline=True, model_loaded=False,
                message=('Structural checks passed; WanGP runtime readiness is unverified. '
                         'Review the selected environment using its WanGP installation instructions. '
                         'Use --status to inspect an already running worker. No runtime was started.'
                         if structural_ok else 'Required structural checks failed. Resolve the failed checks before starting.'),
                checks=checks)
