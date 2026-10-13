# Orch3stra

Orch3stra is a self-hosted AI filmmaking studio that runs in your browser. You describe a story, pick or build reference images and voices for your cast, and Orch3stra plans the film as short generated windows, renders them through a local, headless [WanGP](https://github.com/deepbeepmeep/Wan2GP) worker on your own GPU, and lets you trim, score and export the result as an MP4. Optional voice tools can transcribe source audio and group anonymous speakers locally (pyannote, or NVIDIA Nemotron-3-Diarization) to build voice references; these run on the CPU, not the GPU. Nothing is sent to a cloud renderer; an AI planner is optional and only used if you configure one.

Orch3stra was previously called Shotweft and H3 Director. That is why settings use `H3_*` names and data lives in `~/.local/share/h3-director`. Released under the [MIT license](LICENSE); third-party materials and separately installed models keep their own terms ([notices](THIRD_PARTY_NOTICES.md)).

## Showcase

_Coming soon: example films and screenshots._

## Requirements

| | |
| --- | --- |
| OS | Linux. macOS and Windows are untested. |
| GPU / VRAM | Whatever your chosen model needs in WanGP: Orch3stra adds no GPU requirement of its own, so follow [WanGP's upstream requirements](https://github.com/deepbeepmeep/Wan2GP). Memory use grows with resolution, number of references and window length, so start small (see [Timing](#configuration-basics)). |
| WanGP | An existing, working WanGP install with its own Python environment. Orch3stra does not bundle WanGP, models, or a Python environment, and never downloads models during startup. |
| Python | The WanGP environment's interpreter, Python 3.10 or newer. |
| Node.js | Node 22 or newer. No `npm install` step is needed. |
| FFmpeg | `ffmpeg` and `ffprobe` with H.264/AAC support on `PATH`, or set `FFMPEG_BIN` / `FFPROBE_BIN`. |

## Quick start

```sh
git clone https://github.com/TaylorBeeston/orch3stra.git
cd orch3stra

# 1. Point Orch3stra at your WanGP folder and its Python (e.g. /path/to/Wan2GP/.venv/bin/python).
#    Review the paths and type SAVE. Only these non-secret paths are saved; nothing is installed.
node start-headless.mjs --setup

# 2. Check paths, Python version, FFmpeg/FFprobe and the data folder. No models are loaded.
node start-headless.mjs --check

# 3. Start (or reuse) the WanGP worker and the editor.
node start-headless.mjs
```

Then open <http://127.0.0.1:8765/>.

`--check` exits **1** if a required check failed and **2** if the structural checks passed, but it can't tell whether WanGP will actually load a model. Exit 2 is the normal "good to go" result. [FIRST-RUN.md](FIRST-RUN.md) explains each message.

If you only want to edit, without starting a renderer, run `node bridge.mjs` instead.

## Making your first video

1. In the editor, write a short original brief, open **Story → Story + cast**, and review the proposal before applying it.
2. Add reference images (and, optionally, voices) that you own or are licensed to use. For each window, check which cast members appear and are heard.
3. Start with **one short window**. Review its render plan, then submit it. Rendering is always an explicit action and loads your installed model.
4. Watch progress in **Render overview**. When footage is ready, trim and mix it in **Post** and export it.
5. Also make a **portable project backup**. A movie export and a project backup are different things; see [PORTABLE-BACKUPS.md](PORTABLE-BACKUPS.md).

## Where outputs go

- **Finished movies:** in Post, use **Download Post MP4**, or **Save movie & sidecars to Videos** to write the export into `~/Videos`.
- **Project data** (projects, media, settings, credentials): `H3_DATA_DIR`, default `~/.local/share/h3-director`.
- **Worker renders:** `H3_HEADLESS_DATA_DIR`, default `$H3_DATA_DIR/headless`, which holds `uploads/`, `outputs/`, `previews/` and `continuations/` plus the job database.

Treat these folders as private. Back up the whole data directory before moving or upgrading anything, and see [docs/UPGRADING.md](docs/UPGRADING.md).

## Configuration basics

`node start-headless.mjs --setup` saves the WanGP root and Python path. These environment variables override settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `H3_WANGP_ROOT` | saved by `--setup` | WanGP folder |
| `H3_PYTHON` / `H3_WANGP_PYTHON` | saved by `--setup` | WanGP Python interpreter |
| `H3_DATA_DIR` | `~/.local/share/h3-director` | Private project data |
| `H3_HEADLESS_DATA_DIR` | `$H3_DATA_DIR/headless` | Worker jobs and renders |
| `H3_HOST` | `127.0.0.1` | Editor bind address |
| `H3_PORT` | `8765` | Editor port |
| `H3_WANGP_PORT` | `7867` | Local worker port |
| `H3_HOSTNAMES`, `H3_PUBLIC_ORIGIN` | unset | Extra allowed hosts for a deliberate network setup |

Keep the default loopback bind. `H3_HOST=0.0.0.0` enables LAN access with device pairing, but traffic is unencrypted HTTP.

**Timing.** By default each generated window aims for 15 seconds (24 fps). Windows of up to 30 seconds need an explicit opt-in in Settings. Longer windows use much more RAM and VRAM, and your model's limit still applies. See [TIMING-ADVISOR.md](TIMING-ADVISOR.md).

**AI planner.** Optional. Configure it in Settings, or sign in with a Codex subscription ([docs/USAGE.md](docs/USAGE.md#codex-subscription-sign-in)). Provider calls may cost money.

**Optional voice tools.** Check what's installed with `node scripts/setup-tools.mjs --check`. `--install-tools` installs extra packages into the selected environment, so back that environment up first. Transcription (faster-whisper) and speaker grouping (pyannote or Nemotron) run on the CPU: the voice worker is started with no visible GPU, so they don't compete with renders for VRAM, but long sources take a while. The Nemotron installer (`--nemotron`) is currently disabled until a specific Transformers release is pinned; an existing Nemotron setup keeps working. See [ENVIRONMENT.md](ENVIRONMENT.md) and [DIARIZATION.md](DIARIZATION.md).

**Lifecycle.** `node start-headless.mjs --status` shows the worker. `--stop` stops an idle worker and refuses to stop one that's rendering. Closing the browser tab doesn't stop anything. Ctrl-C stops the editor, but an accepted render keeps going in the worker. After a restart, managed sequences stay paused until you resume them.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| `--check` exits 1 | Read the failing check in its JSON output. Usually the WanGP root or Python path is wrong; rerun `--setup`. |
| Missing `wgp.py` or `shared/api.py` | Select the WanGP root folder itself, not a subfolder. |
| `spawn ... ENOENT` / Python not found | Fix the Python path with `--setup`. |
| FFmpeg/FFprobe unavailable | Install them, or set `FFMPEG_BIN` / `FFPROBE_BIN`. |
| Out of memory / very slow renders | Use a shorter window, fewer references, a lower resolution, or a smaller model. |
| "A different renderer version is running" / different WanGP root | Wait for the current render to finish, run `node start-headless.mjs --stop`, then start again. |
| Second editor refused (writer lock) | Only one editor can use a data directory at a time. Stop the other one. Never delete the lock or ledger blindly; see [docs/INTENT-LOCK-RECOVERY.md](docs/INTENT-LOCK-RECOVERY.md). |
| Unsure whether a render was submitted | Check Render overview and the worker status before you resubmit. Don't blindly repeat it. |

The full table is in [FIRST-RUN.md](FIRST-RUN.md). Logs can contain prompts and filenames, so keep them private.

## Further reading

- [docs/USAGE.md](docs/USAGE.md): usage guide
- [FIRST-RUN.md](FIRST-RUN.md): setup and error messages
- [HEADLESS.md](HEADLESS.md): the headless WanGP worker
- [EDITOR.md](EDITOR.md), [POST.md](POST.md), [SEQUENCES.md](SEQUENCES.md), [REFERENCES.md](REFERENCES.md): feature guides
- [ENVIRONMENT.md](ENVIRONMENT.md), [DIARIZATION.md](DIARIZATION.md): optional speech tools
- [docs/UPGRADING.md](docs/UPGRADING.md), [PORTABLE-BACKUPS.md](PORTABLE-BACKUPS.md): upgrades and backups
- [WANGP-COMPATIBILITY.md](WANGP-COMPATIBILITY.md): supported WanGP versions
- [CHANGELOG.md](CHANGELOG.md), [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md)

## Contributing

Run the CPU-only checks with `node scripts/check-all.mjs` (CI runs `python scripts/check-ci.py`; see [docs/CI.md](docs/CI.md)). They use synthetic fixtures and never run models. See [CONTRIBUTING.md](CONTRIBUTING.md).

Use one Git checkout for both development and running the app, and update it with `git pull` while the worker is idle. Your projects live in `H3_DATA_DIR`, not in the checkout.
