# Orch3stra 2.3.0 release candidate

Orch3stra is a browser editor for planning, reference selection, local WanGP video rendering, and non-destructive finishing. Former names were Shotweft and H3 Director; existing `H3_*` settings and project data remain compatible.

This is a private source-only candidate. The owner selected MIT for original app-owned source; see LICENSE. Public publication has not been requested. Third-party materials and separately installed models retain their own terms. See [release gates](RELEASE-GATES.md) and [third-party terms](THIRD_PARTY_NOTICES.md).

## First film

1. Review hardware fit and licenses before generation. A working, separately installed WanGP is required for rendering. This package contains no models, WanGP checkout, Python environment, or media. Model size, resolution, reference count, and duration determine memory needs; preflight cannot guarantee that a model fits.
2. On Linux, use Node 22 or newer and FFmpeg/FFprobe with H.264/AAC support. No npm installation is required. Node 20.20.2 passed local candidate checks, but Node 22+ is the documented target; a clean-machine or cross-platform installation has not been verified.
3. Extract into a new folder alongside WanGP. Run `node start-headless.mjs --setup` to select the existing WanGP folder and its Python executable. This saves nonsecret paths; it installs nothing. Then run `node start-headless.mjs --check`. Exit 1 means required structural checks failed. Exit 2 means paths/codecs passed but WanGP runtime readiness is unverified; a placeholder SDK also receives exit 2. No runtime or model is initialized by this check. Review the selected WanGP environment and its installation instructions before deliberately starting; `--status` can inspect an already running worker.
4. Start with `node start-headless.mjs`. Open `http://127.0.0.1:8765/`. The default bind is loopback. Describe an original brief, open Story → Story + cast, and review the proposal before applying it. A planner is optional; configure one deliberately in Settings.
5. Add owned/licensed references and review each window's visible/heard cast and actual input slots. Begin with one short window, review its render plan, and submit only when ready. Rendering and provider calls are explicit actions and may load installed models or incur provider charges.
6. Review saved footage, trim in Post, and export the final MP4. Also make a portable project backup containing source media. A movie export and a project backup serve different purposes.

## Timing

Settings defaults to a preferred 15-second generated window. Exceptional windows up to 30 seconds require explicit opt-in, an editable continuity reason and a resource-risk acknowledgement. Generated span includes retained footage plus overlap. H3 uses 24 fps and a `17k+5` frame grid; nominal 15/30-second ceilings are 362/736 frames. The selected model ceiling still limits the planner. Image and audio limits are separate.

An owner-reported 30-second experiment with a pruned 20B model, 20 steps, nine image references and two audio references took about an hour and exhausted available RAM/swap/VRAM. Resolution and FPS were not reported. This is an anecdote, not a capacity or timing guarantee. Existing projects retain their timing unless deliberately edited.

## Effective configuration and lifecycle

`H3_DATA_DIR` defaults to `~/.local/share/h3-director` and contains private mutable data. `H3_WANGP_ROOT`, `H3_PYTHON`/`H3_WANGP_PYTHON` override saved runtime paths. `H3_HOST` defaults to `127.0.0.1`; `H3_PORT` defaults to 8765. Use explicit `H3_HOSTNAMES` and `H3_PUBLIC_ORIGIN` only for a reviewed network deployment. LAN HTTP is unencrypted; pairing does not provide transport encryption. Keep the worker on loopback.

The launcher starts or reuses a detached worker. Closing a browser tab leaves the Node service and coordinator running. Pressing Ctrl-C in the foreground launcher stops Node; an accepted native job continues in the detached worker. `node start-headless.mjs --status` inspects status. `--stop` explicitly stops an idle worker and refuses an active render. Managed sequences pause their coordinator dispatch when Node stops; reconcile or explicitly resume them after restart. Never blindly resubmit an uncertain job.

Optional speech/media tools are separate from basic editing. [Environment details](ENVIRONMENT.md) explain protected dependency constraints. Nemotron installation is blocked pending a verified pinned Transformers revision; this candidate does not install an unpinned branch.

## Preserve and recover

See [migration and rollback](MIGRATION-2.3.0.md). Portable project backups preserve editor project/source-media data, but do not replace full worker/database/checkpoint/output backups or browser-origin storage. Never copy only project JSON and assume historical footage will follow. Fresh-path worker copies may retain every media byte while old outputs remain unavailable; use the migration guide's verified, explicitly confirmed reimport procedure. Reimport creates new owned job/output IDs and does not restore model checkpoints or original continuation provenance.

## Verify the source archive

From the extracted root run `sha256sum -c MANIFEST.sha256` and `sha256sum -c SHA256SUMS`. Both lists are generated from the same payload, including MANIFEST.json; checksum lists exclude themselves. Run `node scripts/check-all.mjs`. Optional browser fixtures require an already installed Playwright interpreter and Chromium selected with `PYTHON_BIN` and `CHROMIUM_BIN`; run `node scripts/check-all.mjs --integration`. Fixtures use synthetic projects and fake SDK/providers, never live model inference.

See [validation](VALIDATION-2.3.0.md), [contributing](CONTRIBUTING.md), and [security](SECURITY.md). Linux local fixture results are evidence for the tested paths only. macOS, Windows, real phones, clean installation, and new live-model generation remain release gates.

Render-intent storage permits one bridge writer per data directory. A second writer is refused before ledger restart recovery. Normal close/exit releases its lock; a forced-crash lock fails closed. Preserve the ledger and lock, verify the previous bridge is stopped, and inspect exact request ownership before any manual stale-lock removal. Never delete an intent ledger or replay uncertain requests to get past a lock. This protects cooperating versions; an older bridge without locking must not run against the same data directory. External file changes fence subsequent cached writes and require inspection.

[Writer-lock diagnosis and recovery](docs/INTENT-LOCK-RECOVERY.md) covers read-only checks and separately authorized stale-lock recovery. The hash guard is a pre-write consistency fence, not atomic compare-and-swap against older/noncooperating writers.

The default headless launcher acquires the same writer ownership before worker startup/reuse. A refused additional launcher does not reach worker health/bootstrap or runtime recovery. Read-only status and explicit setup/check/stop commands retain their separate scopes.

SIGINT/SIGTERM waits for the full manager/write shutdown barrier. If that cannot finish within four seconds, Node is forcibly terminated and the writer crash lock is preserved for inspection; this is not a confirmed graceful stop. See the recovery runbook before restarting.

## Contributor checks

[CPU-only CI](docs/CI.md) checks deterministic fixtures and source packaging on pull requests. It does not run WanGP, models, ASR, GPU generation or deployment.
