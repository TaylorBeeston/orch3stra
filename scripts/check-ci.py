"""Dependency-free CPU checks run by GitHub Actions; no inference, models or network."""
import ast
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = [
    "check-provider-startup.cjs", "check-storage-decoder.cjs", "check-timing.mjs", "check-planner-timing.mjs",
    "check-edit.mjs", "check-take-dependencies.mjs", "check-speech-review.mjs",
    "check-speech-quality.mjs",
]
# Upstream-derived research material that must stay out of the public repository
# until its licensing is reviewed (see THIRD_PARTY_NOTICES.md).
EXCLUDED = {"tests/fixtures/wangp_audio_mux_17_17.py", "tests/test_wangp_mux_timing.py",
            "patches/wangp-17.17-exact-video-mux.patch"}


def run(command):
    print("RUN " + " ".join(command), flush=True)
    subprocess.run(command, cwd=ROOT, check=True, timeout=60)


def tracked_files():
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True, timeout=30).stdout
    return [name for name in out.decode().split("\0") if name]


def main():
    names = tracked_files()
    for name in names:
        if not (ROOT / name).is_file():
            continue
        if name.endswith((".js", ".mjs", ".cjs")):
            subprocess.run(["node", "--check", name], cwd=ROOT, check=True,
                           stdout=subprocess.DEVNULL, timeout=10)
        elif name.endswith(".py"):
            ast.parse((ROOT / name).read_text(), filename=name)
    print("PASS tracked JavaScript/Python syntax", flush=True)
    for required in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
        if not (ROOT / required).read_text().strip():
            raise AssertionError("Missing notice: " + required)
    if EXCLUDED & set(names):
        raise AssertionError("Excluded upstream research material is tracked")
    print("PASS license notices present and excluded upstream material untracked", flush=True)
    for fixture in FIXTURES:
        run(["node", "scripts/" + fixture])
    print("PASS CPU-only CI; no browser/runtime/model/media rendering verified", flush=True)


if __name__ == "__main__":
    main()
