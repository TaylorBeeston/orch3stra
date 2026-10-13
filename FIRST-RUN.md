# First run and common setup errors

This source-only candidate needs an existing working WanGP installation. It does
not install Python packages, download models, choose licenses or upgrade a worker.
The launcher/worker platform is Linux. Use Node.js 22 or newer and make FFmpeg and
FFprobe available. Other platforms and model-specific memory requirements remain
unverified.

Open a terminal in the extracted source folder:

```sh
node start-headless.mjs --setup
node start-headless.mjs --check
```

Setup asks for the existing runtime folder and its Python executable. Review the
paths before typing SAVE. Generic examples are `/path/to/Wan2GP` and
`/path/to/Wan2GP/.venv/bin/python`; spaces are supported. Only nonsecret runtime
paths are saved. Existing project storage and tokens stay in place.

`--check` inspects required paths, Python version, FFmpeg/FFprobe and data-directory
access without loading models or importing the GPU SDK. Its JSON distinguishes
required failures from advisories. Runtime dependencies and decoded-media support
remain unknown until explicitly checked with the actual installation. Exit 1 and
`status: required_checks_failed` mean a required structural check failed. Exit 2 and
`status: readiness_unverified` mean structural checks passed, with `structural_ok: true`
and `ready: false`; even a folder containing placeholder SDK files receives exit 2.
This is a limited check, not a readiness success or proof that a model will initialize or fit.

After structural checks pass (exit 2), review the existing WanGP environment's
installation instructions; use `node start-headless.mjs --status` to inspect an already
running worker. Use `node bridge.mjs` for editing without starting a
renderer. Use `node start-headless.mjs` when explicitly ready to start or reuse the
configured renderer. Open the printed local URL. Confirm an installed preset and
begin with one short window before committing to a long film.

| Message or observation | Next step |
| --- | --- |
| Exit 2 / readiness_unverified | Structural checks passed; SDK initialization, decoded-media support and model fit remain unverified. Review the existing environment before deliberately starting. Nothing was installed or started. |
| Python executable missing, including `spawn ... ENOENT` | Review the selected Python path with `--setup`, then rerun `--check`. Do not create a replacement environment blindly. |
| Missing `wgp.py` or `shared/api.py` | Select the existing WanGP root, rather than a source subfolder or unrelated environment. |
| FFmpeg/FFprobe unavailable | Review PATH or explicit `FFMPEG_BIN`/`FFPROBE_BIN`; correct the intended tool path, then rerun `--check`. |
| Data directory inaccessible | Choose an accessible private data location for a new setup. For an existing setup, preserve its data and investigate access before changing paths. |
| Malformed runtime settings | Review or restore the nonsecret settings file. Preserve project storage, connection files and tokens. |
| Runtime initialization failed | Inspect the private worker log for the named missing module or runtime error. Check the existing environment; do not force-upgrade protected packages. |
| GPU unknown, busy or nearly full | Verify device ownership and model requirements before rendering. The check does not reserve VRAM or authorize stopping another process. |
| Low free disk space | Review room for model files, rendered outputs and temporary finishing files. The 5 GiB advisory threshold is not a long-film capacity guarantee. |
| Existing worker has another root/version | Finish or park work and review an explicit idle cutover. Do not launch a competing GPU runtime. |
| Startup outcome unconfirmed | Inspect the exact worker/log/queue identity. Do not blindly repeat launch or render submission. |

Keep logs private: they can contain filenames, prompts and runtime details. Optional
CPU speech tools are separate from the minimum editing setup; inspect them with
`node scripts/setup-tools.mjs --check` before deciding on any explicit installation.
Never infer speaker identities or silence from a model-free check or an ASR draft.

Before upgrading, read [docs/UPGRADING.md](docs/UPGRADING.md). For the distinction
between a finished movie and editable source backup, read
[PORTABLE-BACKUPS.md](PORTABLE-BACKUPS.md).
