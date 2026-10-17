#!/usr/bin/env python3
"""Real Orch3stra editing-only verification; no application fixtures or setters."""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[4]
NAME = "Verification lantern"
BRIEF = "A lighthouse keeper repairs a lantern before dawn. No dialogue."


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def build_hash():
    digest = hashlib.sha256()
    for path in sorted(ROOT.iterdir()):
        if path.is_file() and path.suffix in {".js", ".mjs", ".html", ".css"}:
            digest.update(path.name.encode() + b"\0" + path.read_bytes())
    return digest.hexdigest()


def birth(pid):
    text = Path(f"/proc/{pid}/stat").read_text()
    fields = text[text.rfind(")") + 2:].split()
    require(fields[0] != "Z", "Server is a zombie; do not drive it")
    return fields[19]


def request_json(url, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-H3-Token"] = token
    req = Request(url, data=None if body is None else json.dumps(body).encode(), headers=headers)
    with urlopen(req, timeout=5) as response:
        return json.load(response)


def doctor(evidence):
    """Read-only ownership, build, auth and storage-readiness check."""
    state = json.loads((evidence / "run.json").read_text())
    require(state["status"] == "running", "Run is not active")
    pid = state["pid"]
    require(birth(pid) == state["birth"], "PID birth identity changed")
    cmd = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")[:-1]
    require(cmd == [state["node"].encode(), str(ROOT / "bridge.mjs").encode()], "Unexpected server command")
    require(Path(f"/proc/{pid}/cwd").resolve() == ROOT, "Server checkout changed")
    require(state["build_sha256"] == build_hash(), "Source changed since launch; restart owned instance")
    environment = dict(part.split(b"=", 1) for part in Path(f"/proc/{pid}/environ").read_bytes().split(b"\0") if b"=" in part)
    for key, expected in {"H3_DATA_DIR": state["data"], "H3_HEADLESS_DATA_DIR": str(Path(state["data"]) / "headless"), "HOME": str(Path(state["scratch"]) / "home"), "H3_WANGP_BACKEND": "headless"}.items():
        require(environment.get(key.encode()) == expected.encode(), f"Wrong {key}")
    sockets = set()
    for fd in Path(f"/proc/{pid}/fd").iterdir():
        try:
            target = os.readlink(fd)
            if target.startswith("socket:["):
                sockets.add(target[8:-1])
        except FileNotFoundError:
            pass
    port = urlsplit(state["url"]).port
    endpoint = f"0100007F:{port:04X}"
    listeners = [line.split() for line in Path("/proc/net/tcp").read_text().splitlines()[1:]]
    require(any(row[1] == endpoint and row[3] == "0A" and row[9] in sockets for row in listeners), "Loopback listener is not owned by this server")
    health = request_json(state["url"] + "/api/health")
    require(health.get("app") == "h3-director-bridge", "Wrong application")
    require(health.get("version") == state["version"], "Wrong version")
    require(health.get("network") is False and health["wangp_backend"]["mode"] == "headless", "Unexpected auth/backend mode")
    listing = request_json(state["url"] + "/api/studio", {"action": "list"}, health["token"])
    require(isinstance(listing.get("projects"), list), "Studio storage is not ready")
    return {"status": "PASS", "url": state["url"], "pid": pid, "version": health["version"], "build_sha256": state["build_sha256"], "data": state["data"], "project_count": len(listing["projects"]), "auth": "loopback + valid ephemeral bridge token", "renderer": "intentionally absent"}


@contextmanager
def launch(args):
    node = shutil.which(args.node)
    require(node, "Node executable not found; supply --node /absolute/path/to/node (22+)")
    node = str(Path(node).resolve())
    version = subprocess.check_output([node, "--version"], text=True).strip()
    require(int(version.lstrip("v").split(".")[0]) >= 22, f"Node 22+ required, found {version}")
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=False)
    evidence.chmod(0o700)
    scratch = Path(tempfile.mkdtemp(prefix="orch3stra-verify-"))
    home = scratch / "home"
    for directory in [home, scratch / "tmp", home / ".config", home / ".cache", home / ".local/share", home / ".local/state"]:
        directory.mkdir(parents=True, exist_ok=True)
    env = {
        "PATH": str(Path(node).parent) + ":/usr/bin:/bin", "HOME": str(home),
        "XDG_CONFIG_HOME": str(home / ".config"), "XDG_CACHE_HOME": str(home / ".cache"),
        "XDG_DATA_HOME": str(home / ".local/share"), "XDG_STATE_HOME": str(home / ".local/state"),
        "CODEX_HOME": str(home / ".codex"), "HF_HOME": str(home / ".cache/huggingface"),
        "TMPDIR": str(scratch / "tmp"), "H3_DATA_DIR": str(scratch / "data"),
        "H3_HEADLESS_DATA_DIR": str(scratch / "data/headless"), "H3_HOST": "127.0.0.1", "H3_PORT": "0",
        "H3_WANGP_BACKEND": "headless", "H3_PYTHON": str(scratch / "disabled-python"),
        "CODEX_BIN": str(scratch / "disabled-codex"), "CUDA_VISIBLE_DEVICES": "",
        "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
    }
    child = None
    state = {"status": "starting", "scratch": str(scratch), "data": env["H3_DATA_DIR"], "node": node, "node_version": version, "build_sha256": build_hash(), "root": str(ROOT)}
    save(evidence / "run.json", state)
    old_handlers = {}
    def interrupted(signum, frame):
        raise SystemExit(128 + signum)
    try:
        for sig in (signal.SIGINT, signal.SIGTERM):
            old_handlers[sig] = signal.signal(sig, interrupted)
        with (evidence / "server.log").open("w") as log:
            child = subprocess.Popen([node, str(ROOT / "bridge.mjs")], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
            state.update(pid=child.pid, birth=birth(child.pid))
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                require(child.poll() is None, "Bridge exited; inspect server.log")
                text = (evidence / "server.log").read_text()
                match = re.search(r"Orch3stra ([^:]+): (http://127\.0\.0\.1:\d+)", text)
                if match and "Keep this server running." in text:
                    state.update(status="running", version=match[1], url=match[2])
                    save(evidence / "run.json", state)
                    result = doctor(evidence)
                    require(result["project_count"] == 0, "Fresh server unexpectedly contains projects")
                    save(evidence / "doctor.json", result)
                    print(json.dumps(result), flush=True)
                    yield evidence
                    break
                time.sleep(0.1)
            else:
                raise RuntimeError("Bridge readiness timed out; inspect server.log")
    finally:
        for sig in old_handlers:
            signal.signal(sig, signal.SIG_IGN)
        forced = False
        if child is not None and child.poll() is None:
            child.terminate()  # Popen owns this unreaped child; never find/kill by process name.
            try:
                child.wait(timeout=12)
            except subprocess.TimeoutExpired:
                forced = True
                child.kill()
                child.wait(timeout=5)
        shutil.rmtree(scratch)
        state["status"] = "stopped"
        save(evidence / "run.json", state)
        save(evidence / "cleanup.json", {"server_exited": child is None or child.poll() is not None, "server_returncode": None if child is None else child.returncode, "forced_kill": forced, "scratch_removed": not scratch.exists(), "evidence_preserved": evidence.exists()})
        for sig, previous in old_handlers.items():
            signal.signal(sig, previous)
        print(f"Cleanup complete; evidence retained: {evidence}", flush=True)


def drive(args):
    from playwright.sync_api import sync_playwright, expect
    evidence = args.evidence.resolve()
    health = doctor(evidence)
    state = json.loads((evidence / "run.json").read_text())
    require(not (evidence / "actions.jsonl").exists(), "Drive already attempted here; start a fresh run to preserve proof")
    browser_bin = args.chromium or os.environ.get("CHROMIUM_BIN")
    errors, requests = [], []
    result = {"feature": "projects-and-sharing", "status": "FAIL", "entrypoints": []}
    with (evidence / "actions.jsonl").open("w") as actions, sync_playwright() as pw:
        def record(action, **details):
            actions.write(json.dumps({"time": time.time(), "action": action, **details}) + "\n")
            actions.flush()
        browser = pw.chromium.launch(executable_path=browser_bin, headless=True, args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        context.tracing.start(screenshots=True, snapshots=True, sources=False)
        page = context.new_page()
        page.set_default_timeout(15000)
        page.on("pageerror", lambda error: errors.append(str(error)))
        def on_request(req):
            row = {"method": req.method, "url": req.url}
            if req.post_data and urlsplit(req.url).path.startswith("/api/"):
                try:
                    body = json.loads(req.post_data)
                    row.update({key: body[key] for key in ("action", "path", "method") if key in body})
                except (ValueError, TypeError):
                    pass
            requests.append(row)
        page.on("request", on_request)
        def click(selector):
            record("click", selector=selector)
            page.locator(selector).click()
        def fill(selector, value):
            record("fill", selector=selector, value=value)
            page.locator(selector).fill(value)
        def capture(label):
            page.screenshot(path=str(evidence / f"{label}.png"), full_page=True)
            (evidence / f"{label}.aria.yml").write_text(page.locator("body").aria_snapshot())
        try:
            record("navigate", url=health["url"])
            page.goto(health["url"], wait_until="domcontentloaded")
            expect(page.locator("#project-name")).to_have_value("The last light")
            expect(page.locator("#save-status")).to_contain_text("Saved in this browser")
            expect(page.locator("#workspace-home")).to_be_visible()
            capture("01-ready")
            click('.workspace-header-actions [data-action="projects"]')
            click('#dialog [data-action="new-project"]')
            fill("#project-name", NAME)
            click('nav.workspace-navigation [data-workspace-area="story"]')
            fill("#request", BRIEF)
            record("keyboard", keys="Control+s")
            page.keyboard.press("Control+s")
            expect(page.locator("#save-status")).to_contain_text("Saved in this browser")
            capture("02-edited")
            record("reload")
            page.reload(wait_until="domcontentloaded")
            expect(page.locator("#project-name")).to_have_value(NAME)
            expect(page.locator("#request")).to_have_value(BRIEF)
            capture("03-persisted")
            result["entrypoints"].append("Projects header -> New blank project; Story edit; Ctrl+S; reload")
            # Cover the overview route and both visible Film desk brief editors.
            click('nav.workspace-navigation [data-workspace-area="overview"]')
            click('#workspace-home [data-workspace-area="story"]')
            fill("#request", BRIEF + " Warm light.")
            expect(page.locator("#save-status")).to_contain_text("Saved in this browser")
            record("reload", reason="autosave without Ctrl+S")
            page.reload(wait_until="domcontentloaded")
            expect(page.locator("#request")).to_have_value(BRIEF + " Warm light.")
            click('#workspace-home [data-film="open"]')
            fill("#film-brief", BRIEF + " A quiet ending.")
            click('#dialog [data-film="save-brief"]')
            expect(page.locator("#save-status")).to_contain_text("Saved in this browser")
            capture("03a-film-brief")
            click('#dialog [data-action="close-dialog"]')
            page.reload(wait_until="domcontentloaded")
            expect(page.locator("#request")).to_have_value(BRIEF + " A quiet ending.")
            click('nav.workspace-navigation [data-workspace-tool="tools"]')
            fill("#workspace-tool-search", "Film desk")
            click('#dialog-body [data-film="open"]')
            fill("#film-brief", BRIEF)
            click('#dialog [data-film="save-brief"]')
            expect(page.locator("#save-status")).to_contain_text("Saved in this browser")
            click('#dialog [data-action="close-dialog"]')
            page.reload(wait_until="domcontentloaded")
            expect(page.locator("#request")).to_have_value(BRIEF)
            result["entrypoints"].extend(["Overview -> Develop the story -> brief autosave -> reload", "Story -> Refine with the assistant -> Save brief -> reload", "All tools / settings -> Film desk -> Save brief -> reload"])
            # Reopen the saved local project through the other Projects entry point.
            click('nav.workspace-navigation [data-workspace-tool="tools"]')
            fill("#workspace-tool-search", "Projects")
            click('#dialog [data-action="projects"]')
            local = page.locator("#dialog .project-item").filter(has_text=NAME)
            expect(local).to_have_count(1)
            record("click", selector="Local projects row / Open", project=NAME)
            local.locator("[data-open-project]").click()
            expect(page.locator("#project-name")).to_have_value(NAME)
            expect(page.locator("#request")).to_have_value(BRIEF)
            # Opening a project returns to the parent tool finder; close that layer.
            click('#dialog [data-action="close-dialog"]')
            result["entrypoints"].append("All tools / settings -> Projects -> Open")
            record("keyboard", keys="Control+k")
            page.keyboard.press("Control+k")
            fill("#workspace-tool-search", "Projects")
            click('#dialog [data-action="projects"]')
            local = page.locator("#dialog .project-item").filter(has_text=NAME)
            record("click", selector="Local projects row / Open via Ctrl+K", project=NAME)
            local.locator("[data-open-project]").click()
            click('#dialog [data-action="close-dialog"]')
            expect(page.locator("#project-name")).to_have_value(NAME)
            expect(page.locator("#request")).to_have_value(BRIEF)
            result["entrypoints"].append("Ctrl+K -> Projects -> Open")
            # Exercise the button entry into Studio and then its keyboard alternative.
            click('nav.workspace-navigation [data-workspace-tool="tools"]')
            fill("#workspace-tool-search", "Studio")
            click('#dialog [data-studio-action="shared"]')
            expect(page.locator('#dialog [data-studio-action="publish"]')).to_be_visible()
            click('#dialog [data-action="close-dialog"]')
            record("keyboard", keys="Control+k")
            page.keyboard.press("Control+k")
            fill("#workspace-tool-search", "Studio")
            click('#dialog [data-studio-action="shared"]')
            click('#dialog [data-studio-action="publish"]')
            shared = page.locator("#dialog .project-item").filter(has_text=NAME)
            expect(shared).to_contain_text("revision 1")
            capture("04-published")
            result["entrypoints"].extend(["All tools / settings -> Studio", "Ctrl+K -> Studio -> Publish / save current project"])
            # Files are a second read-only observation, not the drive interface.
            records = [json.loads(path.read_text()) for path in (Path(state["data"]) / "projects").glob("*.json")]
            require(len(records) == 1, "Expected exactly one published project")
            stored = records[0]
            require(stored["project"]["name"] == NAME and stored["project"]["request"] == BRIEF, "Published file differs from user edits")
            save(evidence / "published-project.json", stored)
            # Change only the browser copy, then pull the stored revision through UI.
            click('#dialog [data-action="close-dialog"]')
            fill("#project-name", "Unsynced verification edit")
            page.keyboard.press("Control+s")
            expect(page.locator("#save-status")).to_contain_text("Saved in this browser")
            click('nav.workspace-navigation [data-workspace-tool="tools"]')
            fill("#workspace-tool-search", "Studio")
            click('#dialog [data-studio-action="shared"]')
            click('#dialog [data-studio-action="shared"]')
            shared = page.locator("#dialog .project-item").filter(has_text=NAME)
            record("click", selector="Server project row / Open / pull", project=NAME)
            shared.locator("[data-studio-pull]").click()
            expect(page.locator("#app-confirm-summary")).to_contain_text("Open the server version?")
            capture("05-pull-approval")
            click('#app-confirm [data-app-confirm="accept"]')
            expect(page.locator("#project-name")).to_have_value(NAME)
            expect(page.locator("#request")).to_have_value(BRIEF)
            expect(page.locator("#save-status")).to_contain_text("Saved in this browser")
            page.reload(wait_until="domcontentloaded")
            expect(page.locator("#project-name")).to_have_value(NAME)
            expect(page.locator("#request")).to_have_value(BRIEF)
            capture("06-restored")
            result["entrypoints"].append("Studio -> Refresh list -> Open / pull -> explicit confirmation -> reload")
            require(not errors, "Browser page errors: " + repr(errors))
            require(all(urlsplit(row["url"]).netloc == urlsplit(health["url"]).netloc or urlsplit(row["url"]).scheme in {"blob", "data"} for row in requests), "Unexpected browser network destination")
            require(not any(row.get("action") in {"start", "generate", "restart", "resume"} or row.get("path") == "/generate" for row in requests), "Unexpected generation/lifecycle request")
            require(not (Path(state["data"]) / "headless/connection.json").exists(), "Unexpected renderer connection")
            require(not list((Path(state["data"]) / "runs").glob("*.json")), "Unexpected managed run")
            result.update(status="PASS", persisted_name=NAME, persisted_brief=BRIEF, server_revision=stored["serverRevision"], browser_errors=errors, safety="Observed browser requests stay on owned origin; no generation/start/restart/resume request, renderer connection, or managed run. Not a system-wide network sandbox.")
            record("assertions-passed", feature=result["feature"])
        except BaseException as error:
            result["error"] = str(error)
            try:
                capture("failure")
            except Exception:
                pass
            raise
        finally:
            save(evidence / "result.json", result)
            save(evidence / "requests.json", requests)
            save(evidence / "page-errors.json", errors)
            try:
                context.tracing.stop(path=str(evidence / "trace.zip"))
            finally:
                context.close()
                browser.close()
    print(json.dumps(result), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["run", "serve", "doctor", "drive"])
    parser.add_argument("--evidence", type=Path, required=True, help="New directory for run/serve; existing active run for doctor/drive")
    parser.add_argument("--node", default="node", help="Node 22+ executable")
    parser.add_argument("--chromium", help="Existing Chromium/Chrome executable; otherwise Playwright installed Chromium")
    args = parser.parse_args()
    if args.command == "doctor":
        print(json.dumps(doctor(args.evidence.resolve()), indent=2))
    elif args.command == "drive":
        drive(args)
    else:
        with launch(args):
            if args.command == "run":
                drive(args)
            else:
                print("Ready for browser driving; Ctrl-C/SIGTERM cleans this owned server and scratch data.", flush=True)
                while True:
                    time.sleep(3600)


if __name__ == "__main__":
    main()
