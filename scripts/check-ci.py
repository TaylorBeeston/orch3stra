"""Dependency-free CPU fixtures and source-only archive checks; no inference."""
import ast
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = [
    "check-provider-startup.cjs", "check-storage-decoder.cjs", "check-timing.mjs", "check-planner-timing.mjs",
    "check-edit.mjs", "check-take-dependencies.mjs", "check-speech-review.mjs",
    "check-speech-quality.mjs",
]


def run(command):
    print("RUN " + " ".join(command), flush=True)
    subprocess.run(command, cwd=ROOT, check=True, timeout=60)


def main():
    names = json.loads((ROOT / "scripts/release-source-files.json").read_text())
    for name in names:
        if name.endswith((".js", ".mjs", ".cjs")):
            subprocess.run(["node", "--check", name], cwd=ROOT, check=True,
                           stdout=subprocess.DEVNULL, timeout=10)
        elif name.endswith(".py"):
            ast.parse((ROOT / name).read_text(), filename=name)
    print("PASS reviewed JavaScript/Python syntax", flush=True)
    for fixture in FIXTURES:
        run(["node", "scripts/" + fixture])
    run([sys.executable, "-B", "-m", "unittest", "tests.test_release_package"])

    spec = importlib.util.spec_from_file_location("package_release", ROOT / "scripts/package-release.py")
    package = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(package)
    with tempfile.TemporaryDirectory(prefix="orch3stra-ci-") as tmp:
        root = Path(tmp)
        first, second, label = root / "first", root / "second", "ci-source"
        package.build(ROOT, first, label)
        package.build(ROOT, second, label)
        if (first / (label + ".zip")).read_bytes() != (second / (label + ".zip")).read_bytes():
            raise AssertionError("Source ZIP is not reproducible")
        expected = set(names) | package.CHECKSUMS
        for suffix in (".zip", ".tar.gz"):
            destination = root / ("extracted-zip" if suffix == ".zip" else "extracted-tar")
            if suffix == ".zip":
                with zipfile.ZipFile(first / (label + suffix)) as archive:
                    if archive.testzip() is not None:
                        raise AssertionError("ZIP integrity failed")
                    archive.extractall(destination)
            else:
                with tarfile.open(first / (label + suffix)) as archive:
                    archive.extractall(destination, filter="data")
            source = destination / label
            actual = {p.relative_to(source).as_posix() for p in source.rglob("*") if p.is_file()}
            if actual != expected:
                raise AssertionError("Archive inventory differs from reviewed allowlist")
            if package.verify(source) != len(names):
                raise AssertionError("Wrong payload count")
            for required in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
                if not (source / required).read_text().strip():
                    raise AssertionError("Missing release notice: " + required)
            forbidden = {"tests/fixtures/wangp_audio_mux_17_17.py", "tests/test_wangp_mux_timing.py",
                         "patches/wangp-17.17-exact-video-mux.patch"}
            if actual & forbidden:
                raise AssertionError("Excluded upstream research material entered archive")
        print("PASS ZIP/TAR extraction, manifest/checksums, notice presence, exclusions and reproducible ZIP", flush=True)
    print("PASS CPU-only CI; no browser/runtime/model/media rendering verified", flush=True)


if __name__ == "__main__":
    main()
